import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const args = process.argv.slice(2);
const outputRoot = args[args.indexOf("--output-root") + 1];
const tracePath = path.join(outputRoot, "session-trace.jsonl");
const waitingForSelectedPage = args.includes("--waiting-for-selected-page");
const hangOnAttach = args.includes("--hang-on-attach");
const expectedCommands = ["attachSelectedPage", "applyOwnedRegion", "saveSelectedDocument", "readSelectedPage", "closeSession"];
let commandIndex = 0;

async function trace(entry) {
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.appendFile(tracePath, `${JSON.stringify(entry)}\n`);
}

function readback(binding) {
  return {
    valid: true,
    documentId: binding.documentId,
    pageId: binding.pageId,
    documentFingerprint: binding.documentFingerprint,
    pageFingerprint: binding.pageFingerprint,
    expectedRevision: binding.expectedRevision,
    ownershipNamespace: binding.ownershipNamespace,
    userOwnedShapeCount: 1,
    agentOwnedShapes: [{
      nativeShapeId: "agent-shape-1",
      ownershipNamespace: binding.ownershipNamespace,
      sourceMappingSemanticIds: ["semantic-1"],
    }],
    unclassifiedShapeCount: 0,
  };
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const request = JSON.parse(line);
  await trace({ pid: process.pid, command: request.command, request });
  if (hangOnAttach && request.command === "attachSelectedPage") continue;
  if (waitingForSelectedPage && request.command === "attachSelectedPage") {
    process.stdout.write(`${JSON.stringify({
      protocolVersion: 3,
      requestId: request.requestId,
      status: "failed",
      error: "waiting_for_selected_page",
      selectedPage: request.binding,
    })}\n`);
    continue;
  }
  if (request.command === "captureSelectedPage") {
    const validCapture = request.protocolVersion === 3
      && !Object.hasOwn(request, "binding")
      && !Object.hasOwn(request, "outputPath")
      && !Object.hasOwn(request, "createDocument")
      && !Object.hasOwn(request, "createPage");
    process.stdout.write(`${JSON.stringify(validCapture
      ? { protocolVersion: 3, requestId: request.requestId, status: "succeeded", capturedTarget: { documentId: "document-captured", pageId: "page-captured", documentFingerprint: "a".repeat(64), pageFingerprint: "b".repeat(64), expectedRevision: 0 } }
      : { protocolVersion: 3, requestId: request.requestId, status: "failed", error: "unexpected capture command" })}\n`);
    continue;
  }
  const valid = request.protocolVersion === 3
    && request.command === expectedCommands[commandIndex]
    && request.binding
    && !Object.hasOwn(request, "outputPath")
    && !Object.hasOwn(request, "createDocument")
    && !Object.hasOwn(request, "createPage");
  if (!valid) {
    process.stdout.write(`${JSON.stringify({ protocolVersion: 3, requestId: request.requestId, status: "failed", error: "unexpected selected-page command", selectedPage: request.binding })}\n`);
    continue;
  }
  commandIndex += 1;
  const response = {
    protocolVersion: 3,
    requestId: request.requestId,
    status: "succeeded",
    selectedPage: request.binding,
    ...(request.command === "readSelectedPage" ? { readback: readback(request.binding) } : {}),
  };
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

await trace({ pid: process.pid, event: "eof" });
