import assert from "node:assert/strict";
import test from "node:test";
import { analyzeWithOptionalBackend } from "./ai-workflow.js";

test("image workflow does not synthesize a fixed topology when vision backend is unavailable", async () => {
  const previousFetch = globalThis.fetch;
  let analyzerInput;
  globalThis.fetch = async () => ({ ok: false, status: 503 });

  try {
    const result = await analyzeWithOptionalBackend(
      { images: [{ name: "paper.png", dataUrl: "data:image/png;base64,AA==" }] },
      (input) => {
        analyzerInput = input;
        return {
          status: "needs_external_vision",
          readyForPreview: false,
          diagnostics: [{ kind: "vision-analyzer-required" }],
        };
      },
    );

    assert.equal(analyzerInput.kind, "image");
    assert.equal(result.status, "needs_external_vision");
    assert.equal(result.readyForPreview, false);
    assert.equal(result.nodes, undefined);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
