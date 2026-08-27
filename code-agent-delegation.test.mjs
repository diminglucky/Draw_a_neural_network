import assert from "node:assert/strict";
import test from "node:test";
import { setupCodeWorkflow } from "./code-workflow.js";

test("code workflow delegates source input to the injected Universal IR agent", () => {
  const handlers = new Map();
  const elements = new Map([
    ["#modelCodeInput", { value: "class Net: pass" }],
    ["#codeFrameworkInput", { value: "pytorch" }],
    ["#codeGenerateButton", { addEventListener(type, handler) { handlers.set(type, handler); } }],
    ["#codeFileInput", { files: [], addEventListener() {} }],
    ["#codeStatusText", { textContent: "" }],
  ]);
  const previousDocument = globalThis.document;
  globalThis.document = { querySelector(selector) { return elements.get(selector) || null; } };

  let analyzedInput;
  let appliedDocument;
  try {
    setupCodeWorkflow({
      analyzeArchitectureInput(input) {
        analyzedInput = input;
        return {
          status: "ready_for_preview",
          readyForPreview: true,
          ir: { nodes: [{ id: "agent-node" }], edges: [] },
          canvasDocument: {
            figure: { title: "Agent figure" },
            nodes: [{ id: "agent-node" }],
            edges: [],
          },
        };
      },
      applyDiagramDocument(document) {
        appliedDocument = document;
        return true;
      },
      setStatus() {},
    });
    handlers.get("click")();
  } finally {
    globalThis.document = previousDocument;
  }

  assert.deepEqual(analyzedInput, {
    kind: "source",
    framework: "pytorch",
    source: "class Net: pass",
  });
  assert.equal(appliedDocument.nodes[0].id, "agent-node");
});
