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

export function buildAgentPayload(message, attachments = [], conversationId = "") {
  const messageCheck = validateMessage(message);
  if (!messageCheck.ok) throw new Error(messageCheck.error);
  const attachmentCheck = validateAttachments(attachments);
  if (!attachmentCheck.ok) throw new Error(attachmentCheck.error);
  return {
    ...(conversationId ? { conversationId } : {}),
    message: String(message),
    attachments: attachments.map(({ name, mimeType, kind, data }) => ({ name, mimeType, kind, data })),
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

export function createIdempotencyKey(randomUUIDFactory = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)) {
  const generated = typeof randomUUIDFactory === "function"
    ? randomUUIDFactory()
    : `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return String(generated).slice(0, 128);
}

export function buildAgentRequestHeaders(token, key) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${String(token ?? "")}`,
    "Idempotency-Key": String(key),
  };
}

export function buildVisioExportRequestHeaders(token, key) {
  return buildAgentRequestHeaders(token, key);
}

export async function exportDiagramToVisio(diagram, options = {}) {
  if (!diagram || typeof diagram !== "object" || Array.isArray(diagram) || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) {
    throw new Error("Visio 导出需要有效的 diagram");
  }
  const token = String(options.token ?? "").trim();
  if (!token) throw new Error("在线授权后才能导出到 Visio");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("当前环境不支持网络请求");
  const apiBase = (options.apiBase || globalThis.SYNAPSE_API_BASE || "http://127.0.0.1:4180").replace(/\/$/, "");
  const key = String(options.idempotencyKey || createIdempotencyKey(options.randomUUIDFactory));
  const response = await fetchImpl(`${apiBase}/api/visio/export`, {
    method: "POST",
    headers: buildVisioExportRequestHeaders(token, key),
    body: JSON.stringify({ diagram }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `Visio 导出失败 (${response.status})`);
  const output = body?.output;
  if (body?.type !== "visio-export" || body?.status !== "succeeded" || !output?.path || output?.readback?.valid !== true) {
    throw new Error("Visio 导出返回了无效结果");
  }
  return body;
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
  const setError = (message = "") => { errorNode.textContent = message; errorNode.hidden = !message; };
  const setStage = (stage) => { statusNode.textContent = stage?.name ? `阶段：${stage.name}` : "准备发送"; };

  toggle.addEventListener("click", () => { drawer.classList.toggle("is-open"); refreshLock(); if (!drawer.classList.contains("is-open")) toggle.focus(); });
  drawer.querySelector("[data-agent-close]")?.addEventListener("click", () => { drawer.classList.remove("is-open"); toggle.focus(); });
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
      const payload = buildAgentPayload(message, attachments, conversationId);
      const requestKey = createIdempotencyKey();
      const apiBase = (globalThis.SYNAPSE_API_BASE || "http://127.0.0.1:4180").replace(/\/$/, "");
      const response = await fetch(`${apiBase}/api/agent/chat`, { method: "POST", headers: buildAgentRequestHeaders(readToken(), requestKey), body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || `Agent 请求失败 (${response.status})`);
      conversationId = body.conversationId || conversationId;
      (body.stages || []).forEach(setStage);
      const answer = body.response || {};
      resultNode.innerHTML = `<div class="agent-chat-answer"><p>${escapeHtml(textContent(answer.text || answer.summary || "Agent 未返回说明"))}</p><div class="agent-chat-meta"><span>confidence ${escapeHtml(answer.confidence ?? "-")}</span></div><h4>证据</h4>${renderList(answer.evidence, "暂无证据") }<h4>警告</h4>${renderList(answer.warnings, "无")}</div>${body.diagram ? '<div class="agent-chat-result-actions"><button type="button" class="primary-button" data-agent-apply>应用到画布</button><button type="button" class="ghost-button" data-agent-visio-export>导出到 Visio</button></div>' : ""}`;
      resultNode.hidden = false;
      resultNode.querySelector("[data-agent-apply]")?.addEventListener("click", () => { if (typeof globalThis.synapseApplyAgentDiagram === "function") globalThis.synapseApplyAgentDiagram(body.diagram); });
      resultNode.querySelector("[data-agent-visio-export]")?.addEventListener("click", async (event) => {
        const exportButton = event.currentTarget;
        if (!(exportButton instanceof HTMLButtonElement) || busy) return;
        busy = true;
        exportButton.disabled = true;
        refreshLock();
        setError("");
        statusNode.textContent = "阶段：visio-exporting";
        try {
          const exportJob = await exportDiagramToVisio(body.diagram, {
            apiBase,
            token: readToken(),
            idempotencyKey: createIdempotencyKey(),
          });
          const readback = exportJob.output.readback;
          const exportResult = document.createElement("p");
          exportResult.className = "agent-chat-visio-result";
          exportResult.textContent = `Visio 导出成功：${exportJob.output.path}（${readback.shapeCount} 个形状，${readback.connectorCount} 条连接线）`;
          resultNode.appendChild(exportResult);
          statusNode.textContent = "阶段：visio-completed";
        } catch (error) {
          statusNode.textContent = "阶段：visio-failed";
          setError(error instanceof Error ? error.message : "Visio 导出失败");
        } finally {
          busy = false;
          exportButton.disabled = false;
          refreshLock();
        }
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
