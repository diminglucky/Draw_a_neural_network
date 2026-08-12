import fs from "node:fs/promises";
import path from "node:path";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", async () => {
  const request = JSON.parse(input.trim());
  await fs.mkdir(path.dirname(request.outputPath), { recursive: true });
  await fs.writeFile(request.outputPath, "fake-vsdx");
  process.stdout.write(JSON.stringify({
    protocolVersion: 1,
    requestId: request.requestId,
    jobId: request.jobId,
    status: "succeeded",
    path: request.outputPath,
    readback: { valid: true, shapeCount: 3, connectorCount: 2 },
    error: null,
  }) + "\n");
});
