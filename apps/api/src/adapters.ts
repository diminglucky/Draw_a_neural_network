import { ApiErrorCode, FoundationError } from "./domain.js";

export interface ChatInput {
  message: string;
}

export interface CodeAnalysisInput {
  source: string;
  framework?: string;
}

export interface ImageAnalysisInput {
  dataUrl: string;
  prompt?: string;
}

export interface AnalysisResult {
  summary: string;
  document: unknown | null;
}

export type AgentAttachmentKind = "code" | "image";

export interface AgentAttachment {
  kind: AgentAttachmentKind;
  name: string;
  mimeType: string;
  data: string;
}

export interface AgentDraftInput {
  userId: string;
  conversationId: string;
  message: string;
  attachments: AgentAttachment[];
}

export interface AgentEvidence {
  kind: "text" | "code" | "image";
  label: string;
  detail: string;
  confidence: number;
}

export interface AgentDraftOutput {
  provider: "local-deterministic" | "openai-responses";
  responseText: string;
  summary: string;
  confidence: number;
  evidence: AgentEvidence[];
  warnings: string[];
  networkIR: unknown;
}

export interface AgentProvider {
  chat(input: ChatInput): Promise<{ text: string }>;
  analyzeCode(input: CodeAnalysisInput): Promise<AnalysisResult>;
  analyzeImage(input: ImageAnalysisInput): Promise<AnalysisResult>;
  buildDraft(input: AgentDraftInput): Promise<AgentDraftOutput>;
}

export interface VisioHealthResult {
  connected: boolean;
  reason?: string;
}

export interface VisioExecutor {
  healthCheck(): Promise<VisioHealthResult>;
  executeDiagram(input: { jobId: string }): Promise<{ path: string }>;
  readback(input: { path: string }): Promise<{ valid: boolean; shapeCount: number }>;
}

export interface OpenAIResponsesAgentProviderOptions {
  apiKey?: string | null;
  model?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  parseNetworkIR?: (value: unknown) => unknown;
}

interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<ResponseLike>;

const networkIRStructuredOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["figure", "nodes", "edges", "groups", "annotations", "style", "layout"],
  properties: {
    figure: {
      type: "object",
      additionalProperties: false,
      required: ["id", "title", "description"],
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: ["string", "null"] },
      },
    },
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "label", "tensor", "stage", "confidence", "sourceEvidence"],
        properties: {
          id: { type: "string" },
          kind: { type: "string" },
          label: { type: "string" },
          tensor: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["shape", "dtype"],
                properties: {
                  shape: { type: "array", items: { type: ["integer", "string"] } },
                  dtype: { type: ["string", "null"] },
                },
              },
            ],
          },
          stage: { type: "integer" },
          confidence: { type: ["number", "null"] },
          sourceEvidence: { type: "array", items: { $ref: "#/$defs/sourceEvidence" } },
        },
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "target", "kind", "label", "shape", "skip", "confidence", "sourceEvidence"],
        properties: {
          source: { type: "string" },
          target: { type: "string" },
          kind: { type: "string" },
          label: { type: ["string", "null"] },
          shape: { type: ["string", "null"] },
          skip: { type: "boolean" },
          confidence: { type: ["number", "null"] },
          sourceEvidence: { type: "array", items: { $ref: "#/$defs/sourceEvidence" } },
        },
      },
    },
    groups: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "label", "nodeIds", "confidence", "sourceEvidence"], properties: { id: { type: "string" }, label: { type: "string" }, nodeIds: { type: "array", items: { type: "string" } }, confidence: { type: ["number", "null"] }, sourceEvidence: { type: "array", items: { $ref: "#/$defs/sourceEvidence" } } } } },
    annotations: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "text", "targetId", "confidence", "sourceEvidence", "metadata"], properties: { id: { type: "string" }, text: { type: "string" }, targetId: { type: ["string", "null"] }, confidence: { type: ["number", "null"] }, sourceEvidence: { type: "array", items: { $ref: "#/$defs/sourceEvidence" } }, metadata: { type: "object", additionalProperties: false } } } },
    style: { type: "object", additionalProperties: false },
    layout: { type: "object", additionalProperties: false },
  },
  $defs: {
    sourceEvidence: {
      type: "object",
      additionalProperties: false,
      required: ["type", "value", "locator", "excerpt"],
      properties: {
        type: { type: "string" },
        value: { type: "string" },
        locator: { type: ["string", "null"] },
        excerpt: { type: ["string", "null"] },
      },
    },
  },
} as const;

export class NotConfiguredAgentProvider implements AgentProvider {
  async chat(_input: ChatInput): Promise<{ text: string }> {
    throw new FoundationError(ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED, "Agent provider is not configured", 503);
  }

  async analyzeCode(_input: CodeAnalysisInput): Promise<AnalysisResult> {
    throw new FoundationError(ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED, "Agent provider is not configured", 503);
  }

  async analyzeImage(_input: ImageAnalysisInput): Promise<AnalysisResult> {
    throw new FoundationError(ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED, "Agent provider is not configured", 503);
  }

  async buildDraft(_input: AgentDraftInput): Promise<AgentDraftOutput> {
    throw new FoundationError(ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED, "Agent provider is not configured", 503);
  }
}

export class NotConnectedVisioExecutor implements VisioExecutor {
  async healthCheck(): Promise<VisioHealthResult> {
    return { connected: false, reason: ApiErrorCode.VISIO_EXECUTOR_NOT_CONFIGURED };
  }

  async executeDiagram(_input: { jobId: string }): Promise<{ path: string }> {
    throw new FoundationError(ApiErrorCode.VISIO_EXECUTOR_NOT_CONFIGURED, "Visio executor is not configured", 503);
  }

  async readback(_input: { path: string }): Promise<{ valid: boolean; shapeCount: number }> {
    throw new FoundationError(ApiErrorCode.VISIO_EXECUTOR_NOT_CONFIGURED, "Visio executor is not configured", 503);
  }
}

export function createLocalDeterministicAgentProvider(): AgentProvider {
  return new LocalDeterministicAgentProvider();
}

export function createOpenAIResponsesAgentProvider(options: OpenAIResponsesAgentProviderOptions): AgentProvider {
  if (!options.apiKey?.trim()) return new NotConfiguredAgentProvider();
  return new OpenAIResponsesAgentProvider(options);
}

class LocalDeterministicAgentProvider implements AgentProvider {
  async chat(input: ChatInput): Promise<{ text: string }> {
    return {
      text: `Local deterministic draft prepared for: ${input.message.slice(0, 120)}`,
    };
  }

  async analyzeCode(input: CodeAnalysisInput): Promise<AnalysisResult> {
    return {
      summary: `Deterministic code pattern scan found: ${collectLayerKinds(input.source).join(", ") || "dense"}`,
      document: { layerKinds: collectLayerKinds(input.source), framework: input.framework ?? null },
    };
  }

  async analyzeImage(input: ImageAnalysisInput): Promise<AnalysisResult> {
    return {
      summary: input.prompt
        ? `Reference-only image evidence recorded for prompt: ${input.prompt}`
        : "Reference-only image evidence recorded. No real vision analysis was performed.",
      document: null,
    };
  }

  async buildDraft(input: AgentDraftInput): Promise<AgentDraftOutput> {
    const codeAttachments = input.attachments.filter((attachment) => attachment.kind === "code");
    const imageAttachments = input.attachments.filter((attachment) => attachment.kind === "image");
    const evidence: AgentEvidence[] = [
      {
        kind: "text",
        label: "message",
        detail: "Deterministic pattern match from the user message.",
        confidence: 0.72,
      },
      ...codeAttachments.map((attachment) => ({
        kind: "code" as const,
        label: attachment.name,
        detail: "Pattern match from code attachment text.",
        confidence: 0.82,
      })),
      ...imageAttachments.map((attachment) => ({
        kind: "image" as const,
        label: attachment.name,
        detail: "Reference-only image evidence. No real vision analysis was performed.",
        confidence: 0.25,
      })),
    ];
    const layerKinds = collectLayerKinds([input.message, ...codeAttachments.map((attachment) => decodeCodeAttachment(attachment.data))].join("\n"));
    const nodes = buildNodes(layerKinds, evidence);
    const responseFragments = ["deterministic draft generated from text and code patterns."];
    if (imageAttachments.length > 0) {
      responseFragments.push("Image attachments were treated as low-confidence reference evidence only.");
    }
    return {
      provider: "local-deterministic",
      responseText: responseFragments.join(" "),
      summary: `Drafted ${Math.max(nodes.length - 2, 0)} inferred architecture steps from deterministic pattern matching.`,
      confidence: imageAttachments.length > 0 ? 0.68 : 0.74,
      evidence,
      warnings: imageAttachments.length > 0 ? ["Image evidence is reference-only in the local deterministic provider."] : [],
      networkIR: {
        figure: { id: "figure-deterministic", title: "Deterministic network draft", description: "Local deterministic draft" },
        nodes,
        edges: nodes.slice(0, -1).map((node, index) => ({ source: node.id, target: nodes[index + 1].id, kind: "flow" })),
        groups: [],
        annotations: [],
        style: { paletteName: "deterministic" },
        layout: { algorithm: "publication-v1" },
      },
    };
  }
}

class OpenAIResponsesAgentProvider implements AgentProvider {
  private readonly fetchImpl: FetchLike;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly parseNetworkIR: (value: unknown) => unknown;

  constructor(options: OpenAIResponsesAgentProviderOptions) {
    this.apiKey = options.apiKey?.trim() ?? "";
    this.model = options.model?.trim() || "gpt-5.6";
    this.baseUrl = (options.baseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.parseNetworkIR = options.parseNetworkIR ?? ((value) => value);
  }

  async chat(input: ChatInput): Promise<{ text: string }> {
    const draft = await this.buildDraft({
      userId: "server",
      conversationId: "chat-only",
      message: input.message,
      attachments: [],
    });
    return { text: draft.responseText };
  }

  async analyzeCode(input: CodeAnalysisInput): Promise<AnalysisResult> {
    const draft = await this.buildDraft({
      userId: "server",
      conversationId: "code-analysis",
      message: "Analyze the attached model code and return the structured network IR only.",
      attachments: [{ kind: "code", name: "code.txt", mimeType: "text/plain", data: input.source }],
    });
    return { summary: draft.summary, document: draft.networkIR };
  }

  async analyzeImage(input: ImageAnalysisInput): Promise<AnalysisResult> {
    const draft = await this.buildDraft({
      userId: "server",
      conversationId: "image-analysis",
      message: input.prompt || "Analyze this neural network diagram and return structured network IR only.",
      attachments: [{ kind: "image", name: "image", mimeType: "image/*", data: input.dataUrl }],
    });
    return { summary: draft.summary, document: draft.networkIR };
  }

  async buildDraft(input: AgentDraftInput): Promise<AgentDraftOutput> {
    if (!this.apiKey) {
      throw new FoundationError(ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED, "Agent provider is not configured", 503);
    }

    const body = {
      model: this.model,
      store: false,
      instructions: [
        "You analyze neural-network descriptions and return only structured JSON.",
        "Do not call tools, do not execute code, and do not return raw SVG or desktop commands.",
        "Summarize uncertainty briefly and keep evidence references concise.",
      ].join(" "),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildOpenAIUserText(input),
            },
            ...input.attachments
              .filter((attachment) => attachment.kind === "image")
              .map((attachment) => ({
                type: "input_image",
                image_url: toImageDataUrl(attachment),
              })),
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "network_ir",
          strict: true,
          schema: networkIRStructuredOutputSchema,
        },
      },
      max_output_tokens: 2000,
      metadata: {
        feature: "agent-chat-vision-mvp",
        conversationId: input.conversationId,
      },
    };

    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "OpenAI Responses request failed", 502, {
        provider: "openai-responses",
        httpStatus: response.status,
      });
    }

    const payload = await response.json() as {
      output?: Array<{ type?: string; name?: string; content?: Array<{ type?: string; text?: string }> }>;
    };

    const output = Array.isArray(payload.output) ? payload.output : [];
    if (output.some((item) => item?.type && item.type !== "message")) {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "OpenAI Responses provider returned unsupported tool output", 502, {
        provider: "openai-responses",
      });
    }

    const textChunks = output.flatMap((item) =>
      Array.isArray(item.content)
        ? item.content.filter((content) => content?.type === "output_text" && typeof content.text === "string").map((content) => content.text as string)
        : [],
    );
    if (textChunks.length === 0) {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "OpenAI Responses provider returned no structured output", 502, {
        provider: "openai-responses",
      });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(textChunks.join("\n"));
    } catch {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "OpenAI Responses provider returned invalid JSON", 502, {
        provider: "openai-responses",
      });
    }

    try {
      parsedJson = this.parseNetworkIR(parsedJson);
    } catch {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "OpenAI Responses provider returned invalid network IR", 502, {
        provider: "openai-responses",
      });
    }

    return {
      provider: "openai-responses",
      responseText: "Structured network draft returned by the OpenAI Responses provider.",
      summary: "Structured provider draft is ready for deterministic layout and validation.",
      confidence: 0.8,
      evidence: [
        {
          kind: "text",
          label: "message",
          detail: "Primary request text sent to the server-side provider.",
          confidence: 0.8,
        },
        ...input.attachments.map((attachment) => ({
          kind: attachment.kind === "image" ? "image" as const : "code" as const,
          label: attachment.name,
          detail: attachment.kind === "image" ? "Image attachment sent server-side as bounded input_image content." : "Code attachment serialized into provider text input.",
          confidence: attachment.kind === "image" ? 0.55 : 0.72,
        })),
      ],
      warnings: [],
      networkIR: parsedJson,
    };
  }
}

function collectLayerKinds(text: string): string[] {
  const lower = text.toLowerCase();
  const matches: string[] = [];
  const checks: Array<{ regex: RegExp; kind: string }> = [
    { regex: /\b(conv|conv1d|conv2d|conv3d|convolution)\b/g, kind: "conv" },
    { regex: /\b(maxpool|avgpool|adaptiveavgpool|pool)\b/g, kind: "pool" },
    { regex: /\b(linear|dense|fully connected|fc)\b/g, kind: "dense" },
    { regex: /\b(relu|gelu|sigmoid|tanh|activation)\b/g, kind: "activation" },
    { regex: /\b(batchnorm|layernorm|normalization|norm)\b/g, kind: "normalization" },
    { regex: /\b(flatten)\b/g, kind: "flatten" },
    { regex: /\b(attention|self-attention|multi-head)\b/g, kind: "attention" },
    { regex: /\b(embedding|token)\b/g, kind: "embedding" },
    { regex: /\b(concat|cat)\b/g, kind: "concat" },
    { regex: /\b(skip|residual)\b/g, kind: "residual" },
  ];

  for (const check of checks) {
    const occurrences = lower.match(check.regex)?.length ?? 0;
    for (let index = 0; index < occurrences; index += 1) {
      matches.push(check.kind);
    }
  }

  return matches.length > 0 ? matches : ["dense"];
}

function buildNodes(layerKinds: string[], evidence: AgentEvidence[]) {
  const sourceEvidence = evidence.map((item) => ({
    type: item.kind,
    value: item.label,
    locator: null,
    excerpt: item.detail,
  }));
  const inputNode = {
    id: "node-input",
    kind: "input",
    label: "Input",
    stage: 0,
    confidence: 0.9,
    sourceEvidence,
  };
  const middleNodes = layerKinds.map((kind, index) => ({
    id: `node-${index + 1}`,
    kind,
    label: toTitleCase(kind),
    stage: index + 1,
    confidence: 0.76,
    sourceEvidence,
  }));
  const outputNode = {
    id: "node-output",
    kind: "output",
    label: "Output",
    stage: layerKinds.length + 1,
    confidence: 0.9,
    sourceEvidence,
  };
  return [inputNode, ...middleNodes, outputNode];
}

function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function buildOpenAIUserText(input: AgentDraftInput): string {
  const lines = [
    "Return a single JSON object describing the neural-network architecture.",
    `Conversation: ${input.conversationId}`,
    `Message: ${input.message}`,
  ];
  const codeAttachments = input.attachments.filter((attachment) => attachment.kind === "code");
  if (codeAttachments.length > 0) {
    lines.push("Code attachments:");
    for (const attachment of codeAttachments) {
      lines.push(`--- ${attachment.name} (${attachment.mimeType}) ---`);
      lines.push(decodeCodeAttachment(attachment.data));
    }
  }
  const imageAttachments = input.attachments.filter((attachment) => attachment.kind === "image");
  if (imageAttachments.length > 0) {
    lines.push(`Image attachments: ${imageAttachments.map((attachment) => attachment.name).join(", ")}`);
  }
  return lines.join("\n");
}

function decodeCodeAttachment(data: string): string {
  const normalized = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    return data;
  }

  try {
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    return decoded.includes("\uFFFD") ? data : decoded;
  } catch {
    return data;
  }
}

function toImageDataUrl(attachment: AgentAttachment): string {
  return attachment.data.startsWith("data:")
    ? attachment.data
    : `data:${attachment.mimeType};base64,${attachment.data}`;
}
