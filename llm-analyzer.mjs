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
  '               "compoundKind": string?,',
  '               "attributes": { "constructorArgs": string,',
  '                 "internalGraph": { "nodes": [node, ...], "edges": [edge, ...] }? } }, ... ],',
  '  "edges": [ { "id": string, "source": string, "target": string,',
  '               "type": string, "confidence": number }, ... ],',
  '  "groups": [ { "id": string, "label": string, "kind": string, "nodeIds": [string, ...] }, ... ]',
  "}",
  "",
  "Rules:",
  '1. "family" must be one of: input, output, conv, upsample, pool, dense, flatten, norm,',
  "   activation, attention, merge, recurrent, graph, volume, custom.",
  "   Map op names by their clear meaning:",
  "   Conv2d -> conv; MaxPool2d/AvgPool2d/AdaptiveAvgPool2d/GlobalAvgPool -> pool (DOWNSAMPLE, resolution decreases);",
  "   Upsample/F.interpolate/PixelShuffle -> upsample (UPSAMPLE, resolution increases);",
  "   Linear/Dense -> dense; ReLU/GELU/SiLU -> activation; BatchNorm2d/LayerNorm -> norm;",
  "   flatten/reshape/view -> flatten; torch.cat/add -> merge; MultiheadAttention -> attention;",
  "   LSTM/GRU/RNN -> recurrent. The entry tensor is family input and the final result is family output.",
  "   Keep pool (down) and upsample (up) strictly distinct — they carry opposite spatial semantics.",
  '2. Residual / skip connections (x += y, x = x + y, out = x + identity, self.shortcut,',
  '   x = x + self.downsample(x)) become an edge with type "residual".',
  "3. Named composite modules (e.g. YOLO's C2f, CSP, SPPF, Bottleneck, ResBlock, TransformerBlock)",
  "   are drawn as a SINGLE labeled color block. Do NOT expand their internal layers and do",
  "   NOT emit attributes.internalGraph. Set family \"custom\", compoundKind \"module\", and",
  "   label to the module name (e.g. \"C2f\", \"SPPF\", \"Bottleneck\"). Only a plain inline",
  "   conv+bn+relu run should be decomposed into regular top-level conv/norm/activation nodes.",
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
  "10. Nodes must be CONCRETE network layers only. Never emit meta or placeholder nodes such",
  "    as 'hypothesis', 'assumption', 'placeholder', 'architecture', or a restatement of the",
  "    prompt. If the description is too vague to determine real layers, return a minimal",
  "    input -> output graph (exactly two nodes, one edge) rather than inventing structure.",
  "11. When the architecture has recognizable high-level sections — detector Backbone/Neck/Head,",
  "    U-Net encoder/bottleneck/decoder, a CNN's stage1..stage5, a Transformer encoder/decoder",
  "    stack, etc. — emit a top-level \"groups\" array that DRIVES THE LAYOUT:",
  "    [ { \"id\": string, \"label\": string, \"kind\": string, \"nodeIds\": [ node ids ] } ].",
  "    THE ARRAY ORDER IS THE LEFT-TO-RIGHT COLUMN ORDER: list groups in the visual order they",
  "    should appear (e.g. [encoder, bottleneck, decoder] for a U-Net, [backbone, neck, head] for",
  "    a detector). Within a group, nodes are auto-arranged by feature-map resolution, largest on",
  "    top. \"kind\" is a free label used only for the legend/color, never a layout directive — any",
  "    grouping you describe (U-Net, ResNet, VGG, ViT, …) renders through the same generic grid.",
  "    Each node belongs to at most one group. If no clear grouping exists, omit groups.",
].join("\n");

function sourceUserPrompt(source, framework) {
  return [
    `Analyze this ${framework || "neural-network"} source code and return the IR.`,
    "Extract every layer, its argument list, and every connection including residuals and",
    "named composite modules (as single labeled blocks, not expanded).",
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

// 从上游错误响应里提取可读的关键信息，避免把整段 HTML 错误页塞给用户。
function extractErrorDetail(text, status) {
  const raw = String(text || "").trim();
  if (!raw) return `HTTP ${status}`;
  const title = raw.match(/<title>([^<]*)<\/title>/i);
  if (title && title[1].trim()) return title[1].trim();
  if (raw.startsWith("{")) {
    try {
      const obj = JSON.parse(raw);
      return obj.error?.message || obj.error || obj.message || raw.slice(0, 200);
    } catch { /* 非合法 JSON */ }
  }
  return raw.slice(0, 200);
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
    // 部分 OpenAI-compatible 端点对 response_format: json_object 支持不稳定
    // （返回 400「必须含 json 字样」/ 502「不支持模型」）。SYSTEM_PROMPT 已强制纯 JSON 输出，
    // extractJSONContent 会兜底提取，故 json_object 失败时降级为无格式约束重试。
    const formatOptions = [{ response_format: { type: "json_object" } }, {}];
    let lastError = null;
    for (const options of formatOptions) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ model, messages, ...options }),
            signal: AbortSignal.timeout(180000),
          });
          if (!response.ok) {
            const detail = extractErrorDetail(await response.text(), response.status);
            lastError = {
              status: "error",
              message: `${response.status}: ${detail}`,
              diagnostics: [{ kind: "llm-http-error", message: `${response.status}: ${detail}` }],
            };
            // 400 = json_object 格式约束明确不受支持 → 降级无格式（跳出当前 format 的重试循环）。
            // 502/503/524 = 网关瞬时故障 → 退避重试；重试耗尽后若仍在 json_object 阶段则降级再试。
            if (options.response_format && response.status === 400) break;
            if ([502, 503, 524].includes(response.status)) {
              if (attempt === 1) {
                if (options.response_format) break;
                return lastError;
              }
              await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
              continue;
            }
            return lastError;
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
          const isTimeout = error?.name === "AbortError" || error?.name === "TimeoutError";
          const message = isTimeout
            ? "请求超时（端点响应超过 180 秒，模型推理过慢或服务过载）"
            : error.message;
          lastError = {
            status: "error",
            message,
            diagnostics: [{ kind: isTimeout ? "llm-timeout" : "llm-request-failed", message }],
          };
          if (attempt === 1) break;
          // 网络临时故障：退避重试。
          await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
        }
      }
    }
    return lastError || { status: "error", message: "LLM request failed." };
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

  // Generic chat for the interactive UI: plain text, no forced JSON extraction.
  async function chat(messages) {
    if (!available) {
      return { status: "unavailable", message: "No LLM API key configured. Set one in the settings panel." };
    }
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages }),
        signal: AbortSignal.timeout(180000),
      });
      if (!response.ok) {
        const detail = extractErrorDetail(await response.text(), response.status);
        return { status: "error", message: `${response.status}: ${detail}` };
      }
      const payload = await response.json();
      const content = payload.choices?.[0]?.message?.content;
      if (!content) return { status: "error", message: "LLM returned no content." };
      return { content };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  }

  return { analyze, refine, chat, available, config: { baseUrl, model, apiKeyConfigured: available } };
}
