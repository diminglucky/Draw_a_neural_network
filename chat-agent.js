import { projectCanvasSnapshot } from "./canvas-actions.js";
import { resolveFoundationApiBase } from "./apps/client/api-base.js";
import { clearProviderApiKey, maskProviderApiKey, readProviderApiKey, saveProviderApiKey } from "./apps/client/provider-key.js";

export const AGENT_LIMITS = Object.freeze({
  messageChars: 12000,
  attachments: 6,
  codeChars: 200000,
  imageBytes: 8 * 1024 * 1024,
});

const CODE_EXTENSIONS = new Set([".py", ".ipynb", ".txt", ".md", ".json"]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const CODE_TYPES = new Set(["text/plain", "text/markdown", "text/x-python", "application/json", "application/x-ipynb+json"]);

function extension(name = "") {
  const value = String(name).toLowerCase();
  const index = value.lastIndexOf(".");
  return index >= 0 ? value.slice(index) : "";
}

export function validateMessage(message) {
  const value = String(message ?? "");
  if (!value.trim()) return { ok: false, error: "请输入消息" };
  if (value.length > AGENT_LIMITS.messageChars) return { ok: false, error: `消息不能超过 ${AGENT_LIMITS.messageChars} 个字符` };
  return { ok: true };
}

export function validateAttachment(file = {}) {
  const name = String(file.name ?? "");
  const mimeType = String(file.type ?? file.mimeType ?? "").toLowerCase();
  const ext = extension(name);
  const isCode = CODE_EXTENSIONS.has(ext) || CODE_TYPES.has(mimeType);
  const isImage = IMAGE_TYPES.has(mimeType);
  if (!isCode && !isImage) return { ok: false, error: "仅支持 .py/.ipynb/.txt/.md/.json 和 PNG/JPG/WebP" };
  if (isImage && Number(file.size || 0) > AGENT_LIMITS.imageBytes) return { ok: false, error: "单张图片不能超过 8 MB" };
  if (isCode && Number(file.textLength ?? file.size ?? 0) > AGENT_LIMITS.codeChars) return { ok: false, error: "单个代码附件不能超过 200000 个字符" };
  return { ok: true, kind: isImage ? "image" : "code" };
}

export function validateAttachments(attachments = []) {
  if (attachments.length > AGENT_LIMITS.attachments) return { ok: false, error: `最多添加 ${AGENT_LIMITS.attachments} 个附件` };
  for (const attachment of attachments) {
    const result = validateAttachment(attachment);
    if (!result.ok) return result;
  }
  return { ok: true };
}

export function buildAgentPayload(message, attachments = [], conversationId = "", canvas = undefined) {
  const messageCheck = validateMessage(message);
  if (!messageCheck.ok) throw new Error(messageCheck.error);
  const attachmentCheck = validateAttachments(attachments);
  if (!attachmentCheck.ok) throw new Error(attachmentCheck.error);
  return {
    ...(conversationId ? { conversationId } : {}),
    message: String(message),
    attachments: attachments.map(({ name, mimeType, kind, data }) => ({ name, mimeType, kind, data })),
    ...(canvas && typeof canvas === "object" ? { canvas: projectCanvasSnapshot(canvas) } : {}),
  };
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function isAgentAuthorized({ gateState, token } = {}) {
  return gateState === "authorized" && Boolean(String(token ?? "").trim());
}

export function confirmAgentCanvasMutation(message, confirmImpl = globalThis.confirm) {
  return typeof confirmImpl === "function" && confirmImpl(String(message)) === true;
}

export function createIdempotencyKey(randomUUIDFactory = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)) {
  const generated = typeof randomUUIDFactory === "function"
    ? randomUUIDFactory()
    : `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return String(generated).slice(0, 128);
}

export function buildAgentRequestHeaders(token, key, providerApiKey = "") {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${String(token ?? "")}`,
    "Idempotency-Key": String(key),
  };
  const relayKey = String(providerApiKey ?? "").trim();
  if (relayKey) headers["X-Synapse-Provider-Api-Key"] = relayKey;
  return headers;
}

export function buildVisioExportRequestHeaders(token, key) {
  return buildAgentRequestHeaders(token, key);
}

const VISIO_TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "expired"]);
const VISIO_CANCELLABLE_STATUSES = new Set(["queued", "running"]);

function assertVisioDiagram(diagram) {
  if (!diagram || typeof diagram !== "object" || Array.isArray(diagram) || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) {
    throw new Error("Visio diagram is invalid");
  }
}

function visioRequestContext(options = {}) {
  const token = String(options.token ?? "").trim();
  if (!token) throw new Error("在线授权后才能导出到 Visio");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("当前环境不支持网络请求");
  const apiBase = resolveFoundationApiBase(options);
  return { token, fetchImpl, apiBase };
}

function bearerHeaders(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function readVisioResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `Visio export failed (${response.status})`);
  return body;
}

function validateVisioJob(body) {
  if (!body || body.type !== "visio-export" || typeof body.id !== "string" || !body.status) {
    throw new Error("Visio Job returned an invalid result");
  }
  return body;
}

export function isVisioJobCancellable(statusOrJob) {
  const status = typeof statusOrJob === "string" ? statusOrJob : statusOrJob?.status;
  return VISIO_CANCELLABLE_STATUSES.has(status);
}

export function renderVisioError(node, message = "") {
  node.textContent = String(message ?? "");
  node.hidden = !message;
}

export async function submitVisioExport(diagram, options = {}) {
  assertVisioDiagram(diagram);
  const { token, fetchImpl, apiBase } = visioRequestContext(options);
  const key = String(options.idempotencyKey || createIdempotencyKey(options.randomUUIDFactory));
  const response = await fetchImpl(`${apiBase}/api/visio/export`, {
    method: "POST",
    headers: buildVisioExportRequestHeaders(token, key),
    body: JSON.stringify({ diagram }),
    signal: options.signal,
  });
  return validateVisioJob(await readVisioResponse(response));
}

export async function getVisioExportJob(jobId, options = {}) {
  const id = String(jobId ?? "").trim();
  if (!id) throw new Error("Visio Job id is required");
  const { token, fetchImpl, apiBase } = visioRequestContext(options);
  const response = await fetchImpl(`${apiBase}/api/jobs/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: bearerHeaders(token),
    signal: options.signal,
  });
  return validateVisioJob(await readVisioResponse(response));
}

export async function cancelVisioExportJob(jobId, options = {}) {
  const id = String(jobId ?? "").trim();
  if (!id) throw new Error("Visio Job id is required");
  if (options.status !== undefined && !isVisioJobCancellable(options.status)) {
    throw new Error("Job cannot be cancelled");
  }
  const { token, fetchImpl, apiBase } = visioRequestContext(options);
  const response = await fetchImpl(`${apiBase}/api/jobs/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    headers: bearerHeaders(token),
    signal: options.signal,
  });
  return validateVisioJob(await readVisioResponse(response));
}

export async function waitForVisioExport(jobId, options = {}) {
  const sleepImpl = options.sleepImpl || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  const nowImpl = options.nowImpl || (() => Date.now());
  const maxWaitMs = Number.isFinite(options.maxWaitMs) ? Math.max(0, options.maxWaitMs) : 120_000;
  const delays = [100, 250, 500, 1_000];
  const startedAt = nowImpl();
  let attempt = 0;

  while (true) {
    const job = await getVisioExportJob(jobId, options);
    options.onStatus?.(job);
    if (VISIO_TERMINAL_STATUSES.has(job.status)) return job;
    const elapsed = nowImpl() - startedAt;
    if (elapsed >= maxWaitMs) throw new Error("Visio Job polling timed out");
    await sleepImpl(Math.min(delays[Math.min(attempt, delays.length - 1)], maxWaitMs - elapsed));
    attempt += 1;
  }
}

export async function exportDiagramToVisio(diagram, options = {}) {
  const job = await submitVisioExport(diagram, options);
  if (VISIO_TERMINAL_STATUSES.has(job.status)) return job;
  return waitForVisioExport(job.id, options);
}

function readToken(storage = globalThis.localStorage) {
  try { return storage?.getItem("synapse.accessToken") || ""; } catch { return ""; }
}

function getGateState() {
  return globalThis.synapseAuthGate?.getState?.() || globalThis.document?.querySelector?.("#foundationGate")?.dataset?.state || "locked";
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ""));
    reader.onerror = () => reject(new Error("附件读取失败"));
    reader.readAsDataURL(blob);
  });
}

export async function encodeAttachment(file) {
  const check = validateAttachment(file);
  if (!check.ok) throw new Error(check.error);
  let data;
  let textLength;
  if (check.kind === "code") {
    const text = await file.text();
    textLength = text.length;
    const sizeCheck = validateAttachment({ ...file, kind: "code", textLength });
    if (!sizeCheck.ok) throw new Error(sizeCheck.error);
    data = await readAsDataUrl(new Blob([text], { type: file.type || "text/plain" }));
  } else {
    data = await readAsDataUrl(file);
  }
  return { name: file.name, mimeType: file.type || (check.kind === "image" ? "image/png" : "text/plain"), kind: check.kind, data, size: file.size, ...(textLength == null ? {} : { textLength }) };
}

function textContent(value) {
  return typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
}

function renderList(items, empty) {
  if (!Array.isArray(items) || items.length === 0) return empty ? `<p class="agent-chat-muted">${escapeHtml(empty)}</p>` : "";
  return `<ul>${items.map((item) => `<li>${escapeHtml(typeof item === "string" ? item : item.text || item.detail || JSON.stringify(item))}</li>`).join("")}</ul>`;
}

function mountAgentChat() {
  const toggle = document.querySelector("#agentChatToggle");
  const drawer = document.querySelector("#agentChatDrawer");
  if (!toggle || !drawer) return;
  const form = drawer.querySelector("[data-agent-form]");
  const messageInput = drawer.querySelector("[data-agent-message]");
  const fileInput = drawer.querySelector("[data-agent-file]");
  const attachmentsNode = drawer.querySelector("[data-agent-attachments]");
  const statusNode = drawer.querySelector("[data-agent-status]");
  const resultNode = drawer.querySelector("[data-agent-result]");
  const errorNode = drawer.querySelector("[data-agent-error]");
  const sendButton = drawer.querySelector("[data-agent-send]");
  const providerKeyInput = drawer.querySelector("[data-agent-provider-key]");
  const providerKeySave = drawer.querySelector("[data-agent-provider-key-save]");
  const providerKeyClear = drawer.querySelector("[data-agent-provider-key-clear]");
  const providerKeyStatus = drawer.querySelector("[data-agent-provider-key-status]");
  let attachments = [];
  let conversationId = "";
  let busy = false;

  const authorized = () => isAgentAuthorized({ gateState: getGateState(), token: readToken() });
  const refreshLock = () => {
    const locked = !authorized() || busy;
    drawer.classList.toggle("is-locked", !authorized());
    messageInput.disabled = locked;
    fileInput.disabled = locked;
    sendButton.disabled = locked;
    drawer.querySelector("[data-agent-lock]").textContent = authorized() ? "已授权，可向 Agent 提问" : "请先完成在线授权，Agent 对话已锁定";
  };
  const renderAttachments = () => {
    attachmentsNode.innerHTML = attachments.map((item, index) => `<span class="agent-chat-attachment"><span>${escapeHtml(item.name)}</span><button type="button" data-agent-remove="${index}" aria-label="删除 ${escapeHtml(item.name)}">×</button></span>`).join("");
    attachmentsNode.querySelectorAll("[data-agent-remove]").forEach((button) => button.addEventListener("click", () => { attachments.splice(Number(button.dataset.agentRemove), 1); renderAttachments(); }));
  };
  const setError = (message = "") => { renderVisioError(errorNode, message); };
  const setStage = (stage) => { statusNode.textContent = stage?.name ? `阶段：${stage.name}` : "准备发送"; };
  const refreshProviderKey = () => {
    const key = readProviderApiKey();
    if (providerKeyInput) providerKeyInput.value = key;
    if (providerKeyStatus) providerKeyStatus.textContent = key
      ? `已配置 ${maskProviderApiKey(key)}；仅在本次应用会话中使用。`
      : "URL 由客户端固定，Key 仅用于本次应用会话。";
  };

  toggle.addEventListener("click", () => { drawer.classList.toggle("is-open"); refreshLock(); if (!drawer.classList.contains("is-open")) toggle.focus(); });
  drawer.querySelector("[data-agent-close]")?.addEventListener("click", () => { drawer.classList.remove("is-open"); toggle.focus(); });
  providerKeySave?.addEventListener("click", () => {
    try {
      saveProviderApiKey(providerKeyInput?.value || "");
      refreshProviderKey();
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "API Key 保存失败");
    }
  });
  providerKeyClear?.addEventListener("click", () => {
    clearProviderApiKey();
    refreshProviderKey();
  });
  refreshProviderKey();
  fileInput.addEventListener("change", async () => {
    setError("");
    const selected = [...fileInput.files];
    if (attachments.length + selected.length > AGENT_LIMITS.attachments) { setError(`最多添加 ${AGENT_LIMITS.attachments} 个附件`); fileInput.value = ""; return; }
    try { attachments.push(...await Promise.all(selected.map(encodeAttachment))); renderAttachments(); } catch (error) { setError(error.message); }
    fileInput.value = "";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("");
    if (!authorized()) { refreshLock(); setError("请先完成在线授权"); return; }
    const message = messageInput.value;
    const messageCheck = validateMessage(message);
    if (!messageCheck.ok) { setError(messageCheck.error); return; }
    busy = true; refreshLock(); resultNode.hidden = true; statusNode.textContent = "阶段：received";
    try {
      const canvas = typeof globalThis.synapseGetCanvasDocument === "function" ? globalThis.synapseGetCanvasDocument() : undefined;
      const payload = buildAgentPayload(message, attachments, conversationId, canvas);
      const requestKey = createIdempotencyKey();
      const apiBase = resolveFoundationApiBase();
      const response = await fetch(`${apiBase}/api/agent/chat`, { method: "POST", headers: buildAgentRequestHeaders(readToken(), requestKey, readProviderApiKey()), body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || `Agent 请求失败 (${response.status})`);
      conversationId = body.conversationId || conversationId;
      (body.stages || []).forEach(setStage);
      const answer = body.response || {};
      const hasActions = Array.isArray(body.actions?.actions) && body.actions.actions.length > 0;
      const resultActions = body.diagram ? `<div class="agent-chat-result-actions">${hasActions ? '<button type="button" class="ghost-button" data-agent-preview>预览修改</button><button type="button" class="primary-button" data-agent-apply-actions>应用修改</button>' : ""}<button type="button" class="${hasActions ? "ghost-button" : "primary-button"}" data-agent-apply>应用完整图</button><button type="button" class="ghost-button" data-agent-visio-export>导出到 Visio</button></div>` : "";
      resultNode.innerHTML = `<div class="agent-chat-answer"><p>${escapeHtml(textContent(answer.text || answer.summary || "Agent 未返回说明"))}</p><div class="agent-chat-meta"><span>confidence ${escapeHtml(answer.confidence ?? "-")}</span><span>intent ${escapeHtml(body.diagramIntent || "replace")}</span></div><h4>证据</h4>${renderList(answer.evidence, "暂无证据") }<h4>警告</h4>${renderList(answer.warnings, "无")}</div>${resultActions}<div class="agent-chat-action-preview" data-agent-action-preview hidden></div>`;
      resultNode.hidden = false;
      resultNode.querySelector("[data-agent-visio-export]")?.addEventListener("click", async (event) => {
        const exportButton = event.currentTarget;
        if (!(exportButton instanceof HTMLButtonElement) || busy) return;
        busy = true;
        exportButton.disabled = true;
        refreshLock();
        setError("");
        const jobStatus = document.createElement("p");
        jobStatus.className = "agent-chat-visio-job";
        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "ghost-button agent-chat-visio-cancel";
        cancelButton.textContent = "取消 Visio 导出";
        cancelButton.disabled = true;
        resultNode.append(jobStatus, cancelButton);
        const renderJob = (job) => {
          statusNode.textContent = `阶段：visio-${job.status}`;
          jobStatus.textContent = `Visio Job：${job.status}`;
          cancelButton.disabled = !isVisioJobCancellable(job);
        };
        try {
          const queuedJob = await submitVisioExport(body.diagram, {
            apiBase,
            token: readToken(),
            idempotencyKey: createIdempotencyKey(),
          });
          renderJob(queuedJob);
          cancelButton.addEventListener("click", async () => {
            if (cancelButton.disabled) return;
            cancelButton.disabled = true;
            try {
              renderJob(await cancelVisioExportJob(queuedJob.id, { apiBase, token: readToken(), status: queuedJob.status }));
            } catch (error) {
              setError(error instanceof Error ? error.message : "Visio 导出取消失败");
            }
          });
          const exportJob = await waitForVisioExport(queuedJob.id, {
            apiBase,
            token: readToken(),
            onStatus: renderJob,
          });
          if (exportJob.status === "succeeded") {
            const readback = exportJob.output.readback;
            const exportResult = document.createElement("p");
            exportResult.className = "agent-chat-visio-result";
            exportResult.textContent = `Visio 导出成功：${exportJob.output.path}（${readback.shapeCount} 个形状，${readback.connectorCount} 条连接线）`;
            resultNode.appendChild(exportResult);
          } else if (exportJob.errorMessage) {
            setError(exportJob.errorMessage);
          }
        } catch (error) {
          setError(error instanceof Error ? error.message : "Visio 导出失败");
          statusNode.textContent = "阶段：visio-failed";
        } finally {
          busy = false;
          exportButton.disabled = false;
          refreshLock();
        }
      });
      resultNode.querySelector("[data-agent-apply]")?.addEventListener("click", () => {
        if (typeof globalThis.synapsePreviewAgentDiagram !== "function" || typeof globalThis.synapseApplyAgentDiagram !== "function") return;
        try {
          const diagramPreview = globalThis.synapsePreviewAgentDiagram(body.diagram);
          if (!confirmAgentCanvasMutation("确认将 Agent 生成的完整图替换当前画布吗？")) return;
          globalThis.synapseApplyAgentDiagram(body.diagram, diagramPreview.token);
        } catch (error) { setError(error instanceof Error ? error.message : "应用完整图失败"); }
      });
      let actionPreview;
      const renderActionPreview = () => {
        const previewNode = resultNode.querySelector("[data-agent-action-preview]");
        if (!previewNode || typeof globalThis.synapsePreviewAgentActions !== "function") return false;
        try {
          actionPreview = globalThis.synapsePreviewAgentActions(body.actions);
          previewNode.textContent = `已生成修改预览：${actionPreview.summary}`;
          previewNode.hidden = false;
          return true;
        } catch (error) {
          setError(error instanceof Error ? error.message : "动作预览失败");
          return false;
        }
      };
      resultNode.querySelector("[data-agent-preview]")?.addEventListener("click", renderActionPreview);
      resultNode.querySelector("[data-agent-apply-actions]")?.addEventListener("click", () => {
        if (typeof globalThis.synapseApplyAgentActions !== "function") return;
        if (!renderActionPreview()) return;
        if (!confirmAgentCanvasMutation("确认将这些结构化修改应用到当前画布吗？")) return;
        try { globalThis.synapseApplyAgentActions(body.actions, actionPreview.token); } catch (error) { setError(error instanceof Error ? error.message : "应用画布修改失败"); }
      });
      statusNode.textContent = "阶段：completed";
      messageInput.value = "";
      attachments = []; renderAttachments();
    } catch (error) { statusNode.textContent = "阶段：failed"; setError(error.message); } finally { busy = false; refreshLock(); }
  });
  refreshLock();
  globalThis.setInterval(refreshLock, 1000);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAgentChat, { once: true });
  else mountAgentChat();
}
