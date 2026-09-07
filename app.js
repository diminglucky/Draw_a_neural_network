import { renderCurrentIRToVisio } from "./visio-client.mjs";

const state = { analysis: null, figurePlan: null, renderRequest: null, runId: null };
const $ = (selector) => document.querySelector(selector);
function setStatus(message) { $("#statusText").textContent = message; }
function setEvidence(analysis) {
  const summary = analysis?.summary || {};
  $("#evidenceStatus").textContent = analysis?.status || "未分析";
  $("#evidenceNodeCount").textContent = String(summary.nodeCount || analysis?.ir?.nodes?.length || 0);
  $("#evidenceEdgeCount").textContent = String(summary.edgeCount || analysis?.ir?.edges?.length || 0);
  $("#evidenceUnresolvedCount").textContent = String(summary.unresolvedNodeCount || 0);
}
function rememberAnalysis(analysis, renderRequest) {
  state.analysis = analysis;
  state.figurePlan = analysis?.figurePlan || null;
  state.renderRequest = renderRequest || null;
  state.runId = analysis?.id || null;
  setEvidence(analysis);
  setStatus(analysis?.status === "needs_confirmation" ? "分析完成：部分结构待确认，尚未写入 Visio" : analysis?.status || "分析完成");
}
async function renderToVisio(statusElement, button) {
  if (!state.renderRequest) { statusElement.textContent = "请先提交源码或图像证据。"; return; }
  if (state.analysis?.status === "needs_confirmation" || state.analysis?.status === "needs-confirmation") {
    statusElement.textContent = "当前结构包含待确认模块，请先确认后再写入 Visio。";
    return;
  }
  const documentPath = $("#visioDocumentPathInput").value.trim();
  const pageName = $("#visioPageInput").value.trim() || "Page-1";
  if (!documentPath) { statusElement.textContent = "请填写已有 Visio 文档路径。"; return; }
  button.disabled = true;
  statusElement.textContent = "正在通过 PowerShell/COM 写入 Visio 并回读验证……";
  setStatus("Visio 正在执行 Figure Plan");
  try {
    const result = await renderCurrentIRToVisio({ ...state.renderRequest, documentPath, pageName });
    state.analysis = result;
    state.figurePlan = result.figurePlan || null;
    setEvidence(result);
    if (result.status === "dry_run") statusElement.textContent = `Visio 计划已生成：${result.plan?.shapes?.length || 0} 个 Shape。`;
    else if (result.status === "readback_failed") statusElement.textContent = `Visio 已写入，但回读未通过：缺少 ${result.readbackValidation?.missingSourceNodeIds?.length || 0} 个节点。`;
    else statusElement.textContent = `Visio 已保存并回读：${result.createdShapes || 0} 个 Shape，${result.createdConnectorSegments || 0} 段连接器。`;
    setStatus(statusElement.textContent);
  } catch (error) {
    if (error.payload?.id) state.runId = error.payload.id;
    if (error.payload?.status === "needs_confirmation") statusElement.textContent = "当前结构包含待确认模块，请先确认后再写入 Visio。";
    else if (error.payload?.status === "needs_external_vision") statusElement.textContent = "图像需要可用的视觉分析器后才能写入 Visio。";
    else statusElement.textContent = `Visio 执行失败：${error.message}`;
    $("#visioConfirmButton").hidden = error.payload?.status !== "needs_confirmation";
    setStatus(statusElement.textContent);
  }
  finally { button.disabled = false; }
}
async function confirmAndContinue() {
  const button = $("#visioConfirmButton");
  if (!state.runId) return;
  button.disabled = true;
  $("#visioStatusText").textContent = "正在确认结构并继续 Agent Run……";
  try {
    const response = await fetch(`/api/agent-run/${encodeURIComponent(state.runId)}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "confirm", value: { accepted: true } }),
    });
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(payload.error || "Agent Run resume failed"), { payload });
    state.analysis = payload;
    state.figurePlan = payload.figurePlan || null;
    setEvidence(payload);
    button.hidden = true;
    if (payload.status === "completed" || payload.status === "rendered" || payload.status === "dry_run") {
      $("#visioStatusText").textContent = payload.status === "dry_run" ? "Visio 计划已生成。" : "Visio 已保存并完成回读。";
      setStatus($("#visioStatusText").textContent);
    } else {
      $("#visioStatusText").textContent = `Agent Run 状态：${payload.status}`;
    }
  } catch (error) {
    $("#visioStatusText").textContent = `确认失败：${error.message}`;
    setStatus($("#visioStatusText").textContent);
  } finally { button.disabled = false; }
}
$("#codeFileInput").addEventListener("change", async (event) => {
  const [file] = event.target.files; if (!file) return;
  $("#modelCodeInput").value = await file.text(); $("#codeStatusText").textContent = `已导入 ${file.name}，可以开始分析。`; event.target.value = "";
});
$("#codeGenerateButton").addEventListener("click", async () => {
  const source = $("#modelCodeInput").value.trim(); const status = $("#codeStatusText"); const button = $("#codeGenerateButton");
  if (!source) { status.textContent = "请先粘贴或导入模型源码。"; return; }
  button.disabled = true; status.textContent = "正在提取源码证据并生成 Figure Plan……";
  try {
    rememberAnalysis(null, { source, framework: $("#codeFrameworkInput").value });
    await renderToVisio($("#visioStatusText"), $("#visioRenderButton"));
  } catch (error) { status.textContent = `源码分析失败：${error.message}`; setStatus(status.textContent); } finally { button.disabled = false; }
});
$("#aiAnalyzeButton").addEventListener("click", async () => {
  const files = [...$("#aiImageInput").files]; const status = $("#aiStatusText"); const button = $("#aiAnalyzeButton");
  if (!files.length) { status.textContent = "请先选择至少一张参考图像。"; return; }
  button.disabled = true; status.textContent = "正在调用视觉分析器并生成 Figure Plan……";
  try {
    const images = await Promise.all(files.map(readImage));
    rememberAnalysis(null, { prompt: $("#aiPromptInput").value.trim(), images });
    await renderToVisio($("#visioStatusText"), $("#visioRenderButton"));
  } catch (error) { status.textContent = `图像分析失败：${error.message}`; setStatus(status.textContent); } finally { button.disabled = false; }
});
$("#visioRenderButton").addEventListener("click", () => renderToVisio($("#visioStatusText"), $("#visioRenderButton")));
$("#visioConfirmButton").addEventListener("click", confirmAndContinue);
function readImage(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, dataUrl: reader.result }); reader.onerror = reject; reader.readAsDataURL(file); }); }
