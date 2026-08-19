import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const args = process.argv.slice(2);
const outputRoot = args[args.indexOf("--output-root") + 1];
const missingReadback = args.includes("--missing-readback");
const hangAfterClose = args.includes("--hang-after-close");
const exitNonzeroAfterClose = args.includes("--exit-nonzero-after-close");
const malformedAfterClose = args.includes("--malformed-after-close");
const tracePath = path.join(outputRoot, "session-trace.jsonl");
let outputPath = null;

async function trace(entry) {
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.appendFile(tracePath, `${JSON.stringify(entry)}\n`);
}

function readback() {
  return {
    valid: true,
    shapeCount: 1,
    connectorCount: 0,
    expectedPrimitiveIds: ["node-1"],
    actualPrimitiveIds: ["node-1"],
    missingPrimitiveIds: [],
    expectedConnectorIds: [],
    actualConnectorIds: [],
    missingConnectorIds: [],
    shapeDataFailures: [],
  };
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const request = JSON.parse(line);
  await trace({ command: request.command, request });
  if (request.protocolVersion !== 2 || Object.hasOwn(request, "planHash")) {
    process.stdout.write(`${JSON.stringify({ requestId: request.requestId, status: "failed", error: "unexpected v2 request" })}\n`);
    continue;
  }
  if (request.command === "open") outputPath = request.outputPath;
  if (request.command === "apply" || request.command === "applyDiff") {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, "fake-vsdx");
  }
  const response = { requestId: request.requestId, status: "succeeded", outputPath };
  if ((request.command === "apply" || request.command === "applyDiff") && !missingReadback) response.readback = readback();
  process.stdout.write(`${JSON.stringify(response)}\n`);
  if (request.command === "close" && malformedAfterClose) process.stdout.write("not-json\n");
}

if (hangAfterClose) await new Promise(() => setInterval(() => {}, 1_000));
await trace({ event: "eof" });
if (exitNonzeroAfterClose) process.exitCode = 2;
