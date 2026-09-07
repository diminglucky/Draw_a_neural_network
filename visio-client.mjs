export function buildVisioRenderRequest({ documentPath, pageName = "Page-1", ir, figurePlan, source, framework, images, prompt, metadata } = {}) {
  const path = String(documentPath || "").trim();
  if (!path) throw new Error("documentPath is required to render into an existing Visio document.");
  if (figurePlan) throw new Error("Client-supplied Figure Plans are not accepted; render must start from source, image, or Universal IR through Agent Run.");
  if (!ir && !(typeof source === "string" && source.trim()) && !(Array.isArray(images) && images.length)) {
    throw new Error("Universal IR, source code, or images are required to render into Visio.");
  }
  const body = {
    documentPath: path,
    pageName: String(pageName || "Page-1"),
    ...(ir ? { ir } : typeof source === "string" && source.trim() ? { source, framework } : { images, prompt, metadata }),
  };
  return { url: "/api/render-visio", init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, body };
}

export async function renderCurrentIRToVisio(options = {}) {
  const request = buildVisioRenderRequest(options);
  const response = await fetch(request.url, request.init);
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || `Visio render failed with HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}
