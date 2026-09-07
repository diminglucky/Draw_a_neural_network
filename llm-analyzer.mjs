const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4.1-mini";

const SYSTEM_PROMPT = [
  "You are a neural-network architecture analyzer for a Visio diagram compiler.",
  "Given source code, a natural-language description, or a diagram image, extract a framework-neutral Universal Neural Network IR as JSON that drives diagram rendering.",
  "",
  "Return ONLY a JSON object (no Markdown, no prose, no code fences) with this exact shape:",
  "{",
  '  "figure": { "title": string, "subtitle": string, "stages": [string, ...] },',
  '  "nodes": [ { "id": string, "op": string, "family": string, "label": string,',
  '               "subtitle": string, "stage": number, "confidence": number,',
  '               "attributes": { "constructorArgs": string } }, ... ],',
  '  "edges": [ { "id": string, "source": string, "target": string,',
  '               "type": string, "confidence": number }, ... ]',
  "}",
  "",
  "Rules:",
  '1. "family" must be one of: input, output, conv, pool, dense, flatten, norm,',
  "   activation, attention, merge, recurrent, graph, volume, custom.",
  "   Map op names by their clear meaning: Conv2d -> conv, MaxPool2d/AdaptiveAvgPool2d -> pool,",
  "   Linear/Dense -> dense, ReLU/GELU/Sigmoid -> activation, BatchNorm2d/LayerNorm -> norm,",
  "   flatten/reshape/view -> flatten, torch.cat/add -> merge, MultiheadAttention -> attention,",
  "   LSTM/GRU/RNN -> recurrent. The entry tensor is family input and the final result is family output.",
  '2. Residual / skip connections (x += y, x = x + y, out = x + identity, self.shortcut,',
  '   x = x + self.downsample(x)) become an edge with type "residual".',
  "3. Recursively expand custom nn.Module subclasses (e.g. BasicBlock, Bottleneck, TransformerBlock):",
  "   emit the internal layers of their forward() method as regular nodes and connect them,",
  "   instead of collapsing the whole block into one custom node.",
  '4. Put each layer\'s constructor arguments into attributes.constructorArgs as a string',
  '   (e.g. Conv2d -> "3, 64, kernel_size=3, padding=1", MaxPool2d -> "2, 2",',
  '   Linear -> "512, 1000", AdaptiveAvgPool2d -> "(7, 7)"). This string drives exact',
  "   feature-map shape inference downstream, so include channel/kernel/stride/padding values.",
  '5. edge.type: "signal" for plain data flow, "residual" for skip/add shortcuts,',
  '   "merge" for concatenation, "attention" for attention interactions, "output" for the',
  "   final connection into the output node.",
  "6. Preserve the true topology. Never invent hidden layers without evidence; for a",
  '   genuinely unknown operator use family "custom".',
  "7. confidence is a number in [0, 1] reflecting certainty per node and per edge.",
  '8. "stages" is the ordered list of stage labels (e.g. ["Input", "Conv1", "Pool1", "Output"]).',
  "9. For modern operators, emit accurate constructorArgs so shape inference is exact:",
  "   include dilation for dilated conv, output_padding for transposed conv, scale_factor or",
  "   size for upsample, and keep residual (add) branches at identical spatial dimensions.",
].join("\n");

function sourceUserPrompt(source, framework) {
  return [
    `Analyze this ${framework || "neural-network"} source code and return the IR.`,
    "Extract every layer, its argument list, and every connection including residuals and",
    "custom-module internal layers.",
    "",
    "<code>",
    String(source || ""),
    "</code>",
  ].join("\n");
}

function visionUserPrompt(instruction) {
  return [
    "Analyze the attached diagram image(s) and return the IR.",
    "Preserve labels and important arrows when visible; if ambiguous, infer a clean neural",
    "architecture rather than copying visual noise.",
    `Instruction: ${instruction || "Generate a clear editable neural-network diagram."}`,
  ].join("\n");
}

function buildRequest(input) {
  const kind = input?.kind;
  if (kind === "source") {
    return {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: sourceUserPrompt(input.source, input.framework) },
      ],
    };
  }
  if (kind === "prompt") {
    return {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Analyze this architecture description and return the IR:\n\n${input.prompt || ""}` },
      ],
    };
  }
  if (kind === "image") {
    const images = Array.isArray(input.images) ? input.images.filter(Boolean).slice(0, 6) : [];
    if (!images.length) return null;
    return {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: visionUserPrompt(input.prompt) },
            ...images.map((image) => ({
              type: "image_url",
              image_url: { url: String(image.dataUrl || image.url || "") },
            })),
          ],
        },
      ],
    };
  }
  return null;
}

function extractJSONContent(content) {
  const text = String(content || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

/**
 * Build a configurable OpenAI-compatible analyzer. Works with any endpoint that
 * implements the Chat Completions protocol (OpenAI, DeepSeek, Ollama, vLLM, ...).
 * Exposes `analyze` for first-pass extraction and `refine` for correction rounds
 * driven by downstream shape-inference feedback (the self-correction loop).
 */
export function createLLMAnalyzer(config = {}) {
  const baseUrl = String(config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = String(config.apiKey || "");
  const model = String(config.model || DEFAULT_MODEL);
  const available = Boolean(apiKey);

  async function post(messages) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          response_format: { type: "json_object" },
        }),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        return {
          status: "error",
          message: `${response.status}: ${detail}`,
          diagnostics: [{ kind: "llm-http-error", message: `${response.status}: ${detail}` }],
        };
      }
      const payload = await response.json();
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        return {
          status: "error",
          message: "LLM returned no content.",
          diagnostics: [{ kind: "llm-empty-response", message: "LLM returned no content." }],
        };
      }
      const candidate = extractJSONContent(content);
      if (!candidate) {
        return {
          status: "error",
          message: "LLM output was not valid JSON.",
          diagnostics: [{ kind: "llm-invalid-json", message: "LLM output was not valid JSON." }],
        };
      }
      const json = JSON.parse(candidate);
      return { ir: json.ir || json, diagnostics: Array.isArray(json.diagnostics) ? json.diagnostics : [] };
    } catch (error) {
      return {
        status: "error",
        message: error.message,
        diagnostics: [{ kind: "llm-request-failed", message: error.message }],
      };
    }
  }

  async function analyze(input = {}) {
    if (!available) {
      return {
        status: "unavailable",
        diagnostics: [{ kind: "llm-analyzer-required", message: "No LLM API key configured." }],
      };
    }
    const request = buildRequest(input);
    if (!request) {
      return {
        status: "unavailable",
        diagnostics: [{ kind: "llm-input-unsupported", message: `No LLM analysis path for kind "${input?.kind}".` }],
      };
    }
    return post(request.messages);
  }

  // Correction round: replay the original request, the previous IR as an assistant turn,
  // and the concrete shape-inference feedback as a user turn, asking for a corrected IR.
  async function refine(input, previousIR, feedback) {
    if (!available) {
      return { status: "unavailable", diagnostics: [{ kind: "llm-analyzer-required", message: "No LLM API key configured." }] };
    }
    const request = buildRequest(input);
    if (!request) {
      return { status: "unavailable", diagnostics: [{ kind: "llm-input-unsupported", message: `No LLM analysis path for kind "${input?.kind}".` }] };
    }
    const messages = [
      ...request.messages,
      { role: "assistant", content: JSON.stringify(previousIR || {}) },
      { role: "user", content: String(feedback || "") },
    ];
    return post(messages);
  }

  return { analyze, refine, available, config: { baseUrl, model, apiKeyConfigured: available } };
}
