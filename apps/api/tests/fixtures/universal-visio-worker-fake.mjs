let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  if (process.argv.includes("--fail-with-path")) {
    process.stdout.write(JSON.stringify({
      protocolVersion: 1,
      requestId: request.requestId,
      jobId: request.jobId,
      status: "failed",
      error: { code: "RENDER_FAILED", message: "C:\\internal\\secret-worker.log" },
    }) + "\n");
    process.exitCode = 1;
    return;
  }
  if ("diagram" in request || "outputPath" in request || "planUrl" in request || "planPath" in request) {
    process.stdout.write(JSON.stringify({
      protocolVersion: 1,
      requestId: request.requestId,
      jobId: request.jobId,
      status: "failed",
      error: { code: "UNSAFE_REQUEST", message: "universal Worker request contained an unsafe client payload" },
    }) + "\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write(JSON.stringify({
    protocolVersion: 1,
    requestId: request.requestId,
    jobId: request.jobId,
    status: "succeeded",
    artifacts: [
      { format: "vsdx", sha256: "a".repeat(64), bytes: 100 },
      { format: "pdf", sha256: "b".repeat(64), bytes: 101 },
      { format: "png", sha256: "c".repeat(64), bytes: 102 },
    ],
    readback: {
      valid: true,
      shapeCount: 2,
      connectorCount: 1,
      nativeShapes: [{ semanticId: "node-input", nativeShapeId: "shape-1", shapeKind: "rectangle" }],
      connectorEndpoints: [{ semanticId: "edge-output", sourceNativeShapeId: "shape-1", targetNativeShapeId: "shape-2" }],
    },
    rendererQa: {
      pageFit: { passed: true, detail: "all content fits" },
      textOverflow: { passed: true, detail: "no overflow" },
      fontFallback: { passed: true, detail: "no fallback" },
      connectorEndpoints: { passed: true, detail: "endpoints attached" },
      ocrReadability: { passed: true, detail: "legible" },
      geometryTolerance: { passed: true, detail: "within tolerance" },
      officeContentSafety: { passed: true, detail: "safe document" },
    },
  }) + "\n");
});
