import { renderCurrentIRToVisio } from "./visio-client.mjs";

const $ = (selector) => document.querySelector(selector);
const state = { images: [] };

function setStatus(message) {
  $("#statusText").textContent = message;
}

// === 输入分类：自然语言 vs 代码 ===
function classifyInput(text) {
  if (/^\s*(class\s+\w+|def\s+\w+|import\s+|from\s+\w+\s+import|self\.|nn\.|torch\.|tf\.|keras)/m.test(text)) return "source";
  if (text.split("\n").length >= 3 && /[{}()[\]].*[{}()[\]]/s.test(text)) return "source";
  return "prompt";
}

// === 消息流 ===
function addMessage(role, content) {
  const welcome = $("#welcomeBlock");
  if (welcome) welcome.hidden = true;
  const bubble = document.createElement("div");
  bubble.className = `message ${role}`;
  bubble.textContent = content;
  $("#messages").appendChild(bubble);
  const stream = $("#stream");
  stream.scrollTop = stream.scrollHeight;
  return bubble;
}

// 分析过程的阶段提示（与后端真实阶段顺序一致，配合计时让用户感知在推进、非卡死）
const STAGES = [
  "正在理解网络结构……",
  "正在生成 Universal IR……",
  "正在计算特征图尺寸……",
  "正在规划版面布局……",
  "正在写入 Visio……",
  "正在回读验证……",
];

function friendlyError(result) {
  const raw = result.diagnostics?.find((d) => d.severity === "error")?.message
    || result.error || result.message || "未知错误";
  // 提取最后一段（通常是 PowerShell/COM 的底层中文错误，如「文件未找到。」）
  const lastLine = String(raw).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop() || "";
  if (/文件未找到|未找到|不存在|无法打开|无法访问|not found|does not exist|权限|拒绝|access denied/i.test(lastLine)) {
    return lastLine;
  }
  return String(raw).replace(/Visio bridge failed[^:]*:\s*/i, "").trim().slice(0, 300) || "未知错误";
}

function formatResult(result) {
  const status = result.status;
  if (status === "dry_run") return `Visio 计划已生成：${result.plan?.shapes?.length || 0} 个 Shape。`;
  if (status === "readback_failed") return `Visio 已写入，但回读未通过：缺少 ${result.readbackValidation?.missingSourceNodeIds?.length || 0} 个节点。`;
  if (status === "needs_confirmation") return `分析完成，但部分结构待确认，尚未写入 Visio。`;
  if (status === "render-failed" || status === "visio_unavailable" || status === "invalid_layout") {
    return `⚠️ 绘制失败：${friendlyError(result)}`;
  }
  if (status !== "rendered" && status !== "completed" && status !== "plan_ready") {
    return `⚠️ 状态异常：${status}`;
  }
  return `✅ 已绘制到 Visio：${result.createdShapes || 0} 个 Shape，${result.createdConnectorSegments || 0} 段连接。`;
}

// === 发送 ===
async function handleSend() {
  const input = $("#input");
  const text = input.value.trim();
  if (!text && !state.images.length) return;

  const documentPath = (localStorage.getItem("visioDocumentPath") || "").trim();
  const pageName = (localStorage.getItem("visioPage") || "Page-1").trim();

  if (!documentPath) {
    addMessage("user", text || "[图片]");
    addMessage("assistant", "⚠️ 尚未配置 Visio 文档路径。请点击左下角 ⚙ 设置，填入一个已存在的 .vsdx 文档路径。");
    openSettings();
    input.value = "";
    input.style.height = "auto";
    return;
  }

  const kind = text ? classifyInput(text) : "image";
  const userLabel = text || `[已上传 ${state.images.length} 张架构图]`;
  addMessage("user", userLabel);

  const pending = addMessage("assistant", "正在理解网络结构……（0s）");
  pending.classList.add("pending");
  setStatus("分析中");
  $("#sendButton").disabled = true;

  // 阶段动效 + 计时器：让用户感知分析在推进，而非卡死。
  const startTime = Date.now();
  let stageIndex = 0;
  const stageTimer = setInterval(() => {
    if (stageIndex < STAGES.length - 1) stageIndex += 1;
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    pending.textContent = `${STAGES[stageIndex]}（已用时 ${seconds}s）`;
  }, 1800);

  try {
    const options = { documentPath, pageName };
    if (kind === "source") options.source = text;
    else if (kind === "image") { options.images = state.images; if (text) options.prompt = text; }
    else options.prompt = text;

    const result = await renderCurrentIRToVisio(options);
    pending.classList.remove("pending");
    pending.textContent = formatResult(result);
    setStatus(result.status === "dry_run" ? "已生成计划" : "已渲染");
  } catch (error) {
    pending.classList.remove("pending");
    if (error.payload?.status === "needs_external_vision") {
      pending.textContent = "⚠️ 图像分析需要配置可用的视觉模型。请在设置里配置 LLM API Key。";
      openSettings();
    } else if (error.payload?.status === "needs_confirmation") {
      const evidence = (error.payload.diagnostics || []).find((d) => d.code === "unresolved-evidence");
      const names = evidence?.message?.match(/structure:\s*(.+?)\./)?.[1] || "";
      pending.textContent = names
        ? `⚠️ 有未识别的结构（${names}），尚未写入 Visio。`
        : "⚠️ 分析发现未解决的结构，尚未写入 Visio。";
      const confirmButton = document.createElement("button");
      confirmButton.className = "message-action";
      confirmButton.textContent = "仍然渲染（忽略未解决结构）";
      confirmButton.addEventListener("click", () => confirmAndRender(error.payload.id, pending, confirmButton));
      pending.appendChild(confirmButton);
    } else {
      pending.textContent = `⚠️ 失败：${error.message}`;
    }
    setStatus("失败");
  } finally {
    clearInterval(stageTimer);
    $("#sendButton").disabled = false;
    input.value = "";
    input.style.height = "auto";
    clearImages();
    input.focus();
  }
}

async function confirmAndRender(runId, bubble, button) {
  button.disabled = true;
  bubble.classList.add("pending");
  bubble.textContent = "正在继续渲染……（0s）";
  setStatus("渲染中");
  const startTime = Date.now();
  const stageTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    bubble.textContent = `正在渲染……（已用时 ${seconds}s）`;
  }, 1800);
  try {
    const response = await fetch(`/api/agent-run/${encodeURIComponent(runId)}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "confirm", value: { accepted: true } }),
    });
    const payload = await response.json();
    clearInterval(stageTimer);
    bubble.classList.remove("pending");
    if (!response.ok) {
      bubble.textContent = `⚠️ 继续渲染失败：${payload.message || payload.error || "未知错误"}`;
      setStatus("失败");
    } else {
      bubble.textContent = formatResult(payload);
      setStatus(payload.status === "dry_run" ? "已生成计划" : "已渲染");
    }
  } catch (err) {
    clearInterval(stageTimer);
    bubble.classList.remove("pending");
    bubble.textContent = `⚠️ 继续渲染失败：${err.message}`;
    setStatus("失败");
  }
}

// === 图片上传 ===
function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, dataUrl: reader.result });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleImageSelect(files) {
  const list = [...files];
  if (!list.length) return;
  state.images = await Promise.all(list.map(readImage));
  const preview = $("#imagePreview");
  preview.hidden = false;
  preview.textContent = `已附加 ${state.images.length} 张图像`;
  $("#input").placeholder = "（可选）补充说明要保留的分支、连接关系……";
}

function clearImages() {
  state.images = [];
  $("#imagePreview").hidden = true;
  $("#input").placeholder = "描述网络结构，或粘贴代码……（Enter 发送，Shift+Enter 换行）";
}

// === 设置抽屉 ===
function openSettings() {
  $("#settingsDrawer").classList.add("open");
  $("#settingsDrawer").setAttribute("aria-hidden", "false");
  $("#drawerBackdrop").hidden = false;
}
function closeSettings() {
  $("#settingsDrawer").classList.remove("open");
  $("#settingsDrawer").setAttribute("aria-hidden", "true");
  $("#drawerBackdrop").hidden = true;
}

// === LLM 配置（走后端，持久化到 llm-config.json） ===
function currentModel() {
  const value = $("#llmModelSelect").value;
  if (value === "__custom__" || value === "") return $("#llmModelCustomInput").value.trim();
  return value;
}
function setModelOptions(models, current) {
  const select = $("#llmModelSelect");
  select.innerHTML = "";
  if (!models.length) {
    // 尚未拉取：显示已保存的模型（如有），否则占位
    const opt = document.createElement("option");
    opt.value = current || "";
    opt.textContent = current || "（先拉取模型列表）";
    select.appendChild(opt);
    select.dispatchEvent(new Event("change"));
    return;
  }
  // 拉取到模型：列出全部 + 末尾「自定义」
  for (const model of models) {
    const opt = document.createElement("option");
    opt.value = model;
    opt.textContent = model;
    select.appendChild(opt);
  }
  const custom = document.createElement("option");
  custom.value = "__custom__";
  custom.textContent = "✏️ 自定义模型名…";
  select.appendChild(custom);
  if (current && models.includes(current)) select.value = current;
  else select.value = models[0];
  select.dispatchEvent(new Event("change"));
}
async function loadLLMConfig() {
  const status = $("#llmStatusText");
  try {
    const response = await fetch("/api/llm-config");
    const config = await response.json();
    $("#llmBaseUrlInput").value = config.baseUrl || "";
    setModelOptions([], config.model || "");
    $("#llmApiKeyInput").placeholder = config.apiKeyConfigured ? `已配置（${config.apiKeyMasked}），留空保持不变` : "sk-...";
    status.textContent = config.apiKeyConfigured ? `已配置：${config.apiKeyMasked}` : "尚未配置 API Key（自然语言画图需要它）。";
  } catch (error) {
    status.textContent = `加载失败：${error.message}`;
  }
}
async function fetchModels() {
  const status = $("#llmStatusText"); const button = $("#llmFetchModelsButton");
  const baseUrl = $("#llmBaseUrlInput").value.trim();
  const apiKey = $("#llmApiKeyInput").value.trim();
  if (!baseUrl) { status.textContent = "请先填写 Base URL。"; return; }
  if (!apiKey) { status.textContent = "请先填写 API Key。"; return; }
  button.disabled = true; status.textContent = "正在拉取模型列表……";
  try {
    const response = await fetch("/api/llm-models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl, apiKey }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "拉取失败");
    const previous = $("#llmModelSelect").value;
    setModelOptions(payload.models || [], previous === "__custom__" ? "" : previous);
    status.textContent = `已拉取 ${payload.models?.length || 0} 个模型，请从下拉选择。`;
  } catch (error) {
    status.textContent = `拉取失败：${error.message}`;
  } finally { button.disabled = false; }
}
async function saveLLMConfig() {
  const status = $("#llmStatusText"); const button = $("#llmSaveButton");
  const body = { baseUrl: $("#llmBaseUrlInput").value.trim(), model: currentModel() };
  const apiKey = $("#llmApiKeyInput").value.trim();
  if (apiKey) body.apiKey = apiKey;
  button.disabled = true; status.textContent = "正在保存……";
  try {
    const response = await fetch("/api/llm-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const config = await response.json();
    if (!response.ok) throw new Error(config.message || "保存失败");
    $("#llmApiKeyInput").value = "";
    $("#llmApiKeyInput").placeholder = `已配置（${config.apiKeyMasked}），留空保持不变`;
    status.textContent = `已保存：${config.apiKeyMasked} · 模型 ${config.model}`;
  } catch (error) {
    status.textContent = `保存失败：${error.message}`;
  } finally { button.disabled = false; }
}

// === Visio 配置（localStorage 持久化） ===
function loadVisioConfig() {
  $("#visioDocumentPathInput").value = localStorage.getItem("visioDocumentPath") || "";
  $("#visioPageInput").value = localStorage.getItem("visioPage") || "Page-1";
}
function saveVisioConfig() {
  const status = $("#visioStatusText"); const button = $("#visioSaveButton");
  const rawPath = $("#visioDocumentPathInput").value.trim();
  const pageName = $("#visioPageInput").value.trim() || "Page-1";
  if (!rawPath) {
    status.textContent = "请先填写 Visio 文档路径（可以是目录，会自动命名 model.vsdx）。";
    return;
  }
  button.disabled = true; status.textContent = "正在准备 Visio 文档……";
  (async () => {
    try {
      const response = await fetch("/api/visio-prepare", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: rawPath }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "准备失败");
      localStorage.setItem("visioDocumentPath", data.documentPath);
      localStorage.setItem("visioPage", pageName);
      $("#visioDocumentPathInput").value = data.documentPath;
      status.textContent = data.created
        ? `已自动创建 ${data.documentPath}，并保存配置。`
        : `已保存 Visio 配置：${data.documentPath}`;
    } catch (error) {
      status.textContent = `保存失败：${error.message}`;
    } finally { button.disabled = false; }
  })();
}

// === 事件绑定 ===
$("#sendButton").addEventListener("click", handleSend);
$("#input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); handleSend(); }
});
$("#input").addEventListener("input", () => {
  const el = $("#input");
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
});
$("#attachButton").addEventListener("click", () => $("#imageInput").click());
$("#imageInput").addEventListener("change", (event) => handleImageSelect(event.target.files));
document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => {
    $("#input").value = button.dataset.prompt;
    $("#input").focus();
    $("#input").dispatchEvent(new Event("input"));
  });
});
$("#settingsToggle").addEventListener("click", openSettings);
$("#closeSettings").addEventListener("click", closeSettings);
$("#drawerBackdrop").addEventListener("click", closeSettings);
$("#llmModelSelect").addEventListener("change", () => {
  const isCustom = $("#llmModelSelect").value === "__custom__";
  $("#llmModelCustomField").hidden = !isCustom;
  if (isCustom) $("#llmModelCustomInput").focus();
});
$("#llmFetchModelsButton").addEventListener("click", fetchModels);
$("#llmSaveButton").addEventListener("click", saveLLMConfig);
$("#visioSaveButton").addEventListener("click", saveVisioConfig);

loadLLMConfig();
loadVisioConfig();
