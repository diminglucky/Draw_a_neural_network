import { resolveFoundationApiBase } from "./api-base.js";

const STATUS_LABELS = Object.freeze({
  received: "等待输入",
  input_accepted: "输入已接收",
  analyzing: "分析中",
  awaiting_interpreter: "等待结构解释",
  candidate_structure: "候选结构",
  awaiting_clarification: "等待澄清",
  formal_ugs: "结构已确认",
  composing_pvp: "生成图稿计划",
  preview_ready: "预览就绪",
  awaiting_page_binding: "等待选择 Visio 页面",
  page_bound: "页面已绑定",
  awaiting_apply_confirmation: "等待应用确认",
  applying: "正在应用",
  readback_verified: "已完成并读回验证",
  cancelled: "已取消",
  rejected: "已拒绝",
  failed: "失败",
  conflicted: "发生冲突",
});

const ERROR_LABELS = Object.freeze({
  none: "",
  validation: "输入或结构校验失败",
  provider_unavailable: "结构解释服务不可用",
  provider_timeout: "结构解释超时",
  provider_invalid: "结构解释结果无效",
  worker: "Visio Worker 执行失败",
  conflict: "运行版本冲突",
  cancelled: "用户已取消",
});

function tokenFromStorage(storage = globalThis.localStorage) {
  try { return String(storage?.getItem("synapse.accessToken") || "").trim(); } catch { return ""; }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function statusLabel(status) {
  return STATUS_LABELS[status] || "未知状态";
}

function errorLabel(errorCategory) {
  return ERROR_LABELS[errorCategory] || "运行失败";
}

function createRequestKey(randomUUIDFactory = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)) {
  const value = typeof randomUUIDFactory === "function"
    ? randomUUIDFactory()
    : `drawing-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return String(value).slice(0, 128);
}

function requestContext(options = {}) {
  const token = String(options.token ?? tokenFromStorage(options.storage)).trim();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!token) throw new Error("在线授权后才能查看 Drawing Run 状态");
  if (typeof fetchImpl !== "function") throw new Error("当前环境不支持网络请求");
  return { token, fetchImpl, apiBase: options.apiBase || resolveFoundationApiBase(options) };
}

async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `Drawing Run 请求失败 (${response.status})`);
  return body;
}

export async function listDrawingRuns(options = {}) {
  const { token, fetchImpl, apiBase } = requestContext(options);
  const response = await fetchImpl(`${apiBase}/api/drawing-runs`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: options.signal,
  });
  const body = await readResponse(response);
  if (!Array.isArray(body.runs)) throw new Error("Drawing Run 状态返回了无效结果");
  return body.runs;
}

export async function startDrawingRun(intent, options = {}) {
  const { token, fetchImpl, apiBase } = requestContext(options);
  const response = await fetchImpl(`${apiBase}/api/drawing-runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": createRequestKey(options.randomUUIDFactory) },
    body: JSON.stringify({ intent }),
    signal: options.signal,
  });
  return readResponse(response);
}

function encodeBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  if (typeof globalThis.btoa === "function") return globalThis.btoa(binary);
  throw new Error("当前环境不支持私有输入编码");
}

async function sha256Hex(bytes, implementation) {
  if (implementation) return String(await implementation(bytes));
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) throw new Error("当前环境不支持私有输入摘要计算");
  const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function submitDrawingRunReceipt(runId, expectedRevision, source, options = {}) {
  const id = String(runId ?? "").trim();
  const text = String(source ?? "");
  if (!id || !text.trim()) throw new Error("PyTorch source is required");
  if (!Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) < 0) throw new Error("Drawing Run revision is invalid");
  const bytes = new TextEncoder().encode(text);
  const { token, fetchImpl, apiBase } = requestContext(options);
  const response = await fetchImpl(`${apiBase}/api/drawing-runs/${encodeURIComponent(id)}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": createRequestKey(options.randomUUIDFactory) },
    body: JSON.stringify({
      expectedRevision: Number(expectedRevision),
      receipts: [{ kind: "pytorch_source", mimeType: "text/x-python", data: encodeBase64(bytes), sha256: await sha256Hex(bytes, options.sha256Impl), retention: "owner_revision" }],
    }),
    signal: options.signal,
  });
  return readResponse(response);
}

export async function submitPyTorchDrawingRun(source, options = {}) {
  const started = await startDrawingRun({ action: "analyze_network", requestedDetail: "architecture", target: "browser_preview", sourceKinds: ["pytorch_source"] }, options);
  return submitDrawingRunReceipt(started.runId, started.revision, source, options);
}

export async function cancelDrawingRun(runId, expectedRevision, options = {}) {
  const id = String(runId ?? "").trim();
  if (!id) throw new Error("Drawing Run id is required");
  if (!Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) < 0) throw new Error("Drawing Run revision is invalid");
  const { token, fetchImpl, apiBase } = requestContext(options);
  const response = await fetchImpl(`${apiBase}/api/drawing-runs/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": createRequestKey(options.randomUUIDFactory) },
    body: JSON.stringify({ expectedRevision: Number(expectedRevision) }),
    signal: options.signal,
  });
  return readResponse(response);
}

export async function answerDrawingRunClarification(runId, expectedRevision, clarificationId, answer, options = {}) {
  const id = String(runId ?? "").trim();
  const questionId = String(clarificationId ?? "").trim();
  const text = String(answer ?? "").trim();
  if (!id || !questionId) throw new Error("Drawing Run clarification is invalid");
  if (!text) throw new Error("请输入澄清回答");
  if (text.length > 1024) throw new Error("澄清回答不能超过 1024 个字符");
  if (!Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) < 0) throw new Error("Drawing Run revision is invalid");
  const { token, fetchImpl, apiBase } = requestContext(options);
  const response = await fetchImpl(`${apiBase}/api/drawing-runs/${encodeURIComponent(id)}/clarification`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": createRequestKey(options.randomUUIDFactory) },
    body: JSON.stringify({ expectedRevision: Number(expectedRevision), clarificationId: questionId, answer: text }),
    signal: options.signal,
  });
  return readResponse(response);
}

export function renderDrawingRunStatusList(runs = []) {
  if (!Array.isArray(runs) || runs.length === 0) return '<p class="drawing-run-empty">暂无 Drawing Run</p>';
  return runs.map((run) => {
    const status = String(run?.status || "");
    const clarification = run?.clarification;
    const errorCategory = String(run?.errorCategory || "none");
    const errorText = errorCategory === "none" ? "" : `<p class="drawing-run-row__error">${escapeHtml(errorLabel(errorCategory))}</p>`;
    const cancelable = Array.isArray(run?.allowedActions) && run.allowedActions.includes("cancel");
    const answerable = status === "awaiting_clarification" && clarification?.id;
    return `<article class="drawing-run-row" data-drawing-run-id="${escapeHtml(run?.runId)}">
      <div class="drawing-run-row__top"><strong>${escapeHtml(statusLabel(status))}</strong><span>Revision ${escapeHtml(run?.revision ?? "-")}</span></div>
      <p class="drawing-run-row__id">${escapeHtml(String(run?.runId || "").slice(0, 18))}</p>
      ${errorText}
      ${clarification?.prompt ? `<p class="drawing-run-row__question">${escapeHtml(clarification.prompt)}</p>` : ""}
      <div class="drawing-run-row__actions">
        ${answerable ? '<button type="button" class="drawing-run-action" data-drawing-run-answer>回答</button>' : ""}
        ${cancelable ? '<button type="button" class="drawing-run-action drawing-run-action--danger" data-drawing-run-cancel>取消</button>' : ""}
      </div>
    </article>`;
  }).join("");
}

export function mountDrawingRunStatus(options = {}) {
  const root = options.root || globalThis.document?.querySelector?.("[data-drawing-run-status]");
  if (!root) return { refresh: async () => [], destroy: () => {} };
  const listNode = root.querySelector("[data-drawing-run-list]");
  const statusNode = root.querySelector("[data-drawing-run-message]");
  const refreshButton = root.querySelector("[data-drawing-run-refresh]");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const storage = options.storage || globalThis.localStorage;
  const apiOptions = () => ({ ...options, fetchImpl, storage });
  let timer;
  let stopped = false;

  const render = (runs) => {
    if (listNode) listNode.innerHTML = renderDrawingRunStatusList(runs);
    if (statusNode) statusNode.textContent = `已更新 · ${new Date().toLocaleTimeString()}`;
  };
  const setError = (error) => {
    if (statusNode) statusNode.textContent = error instanceof Error ? error.message : String(error);
  };
  const refresh = async () => {
    if (stopped || globalThis.synapseAuthGate?.getState?.() === "locked") return [];
    try {
      const runs = await listDrawingRuns(apiOptions());
      render(runs);
      return runs;
    } catch (error) {
      setError(error);
      return [];
    }
  };
  const handleClick = async (event) => {
    const action = event.target?.closest?.("[data-drawing-run-cancel], [data-drawing-run-answer]");
    if (!action) return;
    const row = action.closest("[data-drawing-run-id]");
    const runId = row?.dataset?.drawingRunId;
    const runs = await listDrawingRuns(apiOptions()).catch(() => []);
    const run = runs.find((item) => item.runId === runId);
    if (!run) return setError(new Error("Drawing Run 已不存在或状态已更新，请刷新"));
    action.disabled = true;
    try {
      if (action.hasAttribute("data-drawing-run-cancel")) {
        if (typeof globalThis.confirm === "function" && !globalThis.confirm("确认取消这个 Drawing Run 吗？")) {
          action.disabled = false;
          return;
        }
        await cancelDrawingRun(run.runId, run.revision, apiOptions());
      } else {
        const answer = typeof globalThis.prompt === "function" ? globalThis.prompt(run.clarification?.prompt || "请输入澄清回答") : "";
        if (!answer?.trim()) {
          action.disabled = false;
          return;
        }
        await answerDrawingRunClarification(run.runId, run.revision, run.clarification?.id, answer, apiOptions());
      }
      await refresh();
    } catch (error) {
      setError(error);
      action.disabled = false;
    }
  };
  root.addEventListener("click", handleClick);
  refreshButton?.addEventListener("click", refresh);
  timer = globalThis.setInterval?.(refresh, options.pollMs || 5000);
  const destroy = () => {
    stopped = true;
    if (timer) globalThis.clearInterval?.(timer);
    root.removeEventListener("click", handleClick);
    refreshButton?.removeEventListener("click", refresh);
  };
  void refresh();
  return { refresh, destroy };
}

if (typeof document !== "undefined") {
  const mount = () => {
    const controller = mountDrawingRunStatus();
    globalThis.synapseDrawingRunStatus = controller;
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
}
