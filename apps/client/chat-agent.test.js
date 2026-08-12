import { describe, expect, it } from "vitest";
import {
  AGENT_LIMITS,
  buildAgentRequestHeaders,
  buildAgentPayload,
  createIdempotencyKey,
  escapeHtml,
  isAgentAuthorized,
  validateAttachment,
  validateMessage,
} from "../../chat-agent.js";

describe("Agent Chat client contracts", () => {
  it("accepts supported code and image attachments and rejects unsupported types", () => {
    expect(validateAttachment({ name: "model.py", type: "text/x-python", size: 12, kind: "code" })).toEqual({ ok: true, kind: "code" });
    expect(validateAttachment({ name: "notes.md", type: "text/markdown", size: 12, kind: "code" })).toEqual({ ok: true, kind: "code" });
    expect(validateAttachment({ name: "diagram.webp", type: "image/webp", size: 12, kind: "image" })).toEqual({ ok: true, kind: "image" });
    expect(validateAttachment({ name: "script.exe", type: "application/octet-stream", size: 12 })).toMatchObject({ ok: false });
  });

  it("enforces attachment count, code characters, and image byte limits", () => {
    expect(validateAttachment({ name: "big.py", type: "text/x-python", size: AGENT_LIMITS.codeChars + 1, kind: "code", textLength: AGENT_LIMITS.codeChars + 1 })).toMatchObject({ ok: false });
    expect(validateAttachment({ name: "big.png", type: "image/png", size: AGENT_LIMITS.imageBytes + 1, kind: "image" })).toMatchObject({ ok: false });
    expect(validateMessage("x".repeat(AGENT_LIMITS.messageChars + 1))).toMatchObject({ ok: false });
  });

  it("builds the API payload without provider credentials", () => {
    const payload = buildAgentPayload("draw a CNN", [
      { name: "model.py", mimeType: "text/x-python", kind: "code", data: "YWJj", textLength: 3 },
      { name: "sketch.png", mimeType: "image/png", kind: "image", data: "aW1n", size: 3 },
    ], "conversation-1");
    expect(payload).toEqual({
      conversationId: "conversation-1",
      message: "draw a CNN",
      attachments: [
        { name: "model.py", mimeType: "text/x-python", kind: "code", data: "YWJj" },
        { name: "sketch.png", mimeType: "image/png", kind: "image", data: "aW1n" },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain("apiKey");
  });

  it("creates a bounded idempotency key and sends it with the bearer request", () => {
    const key = createIdempotencyKey(() => "fixed-agent-key");
    const headers = buildAgentRequestHeaders("bearer-token", key);

    expect(key).toBe("fixed-agent-key");
    expect(headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer bearer-token",
      "Idempotency-Key": "fixed-agent-key",
    });
    expect(JSON.stringify(headers)).not.toContain("apiKey");
  });

  it("escapes assistant text before it is inserted into the UI", () => {
    expect(escapeHtml(`<img src=x onerror="bad()"> & 'quoted'`)).toBe("&lt;img src=x onerror=&quot;bad()&quot;&gt; &amp; &#39;quoted&#39;");
  });

  it("locks sending unless both the gate and token authorize the request", () => {
    expect(isAgentAuthorized({ gateState: "authorized", token: "bearer" })).toBe(true);
    expect(isAgentAuthorized({ gateState: "locked", token: "bearer" })).toBe(false);
    expect(isAgentAuthorized({ gateState: "authorized", token: "" })).toBe(false);
  });
});
