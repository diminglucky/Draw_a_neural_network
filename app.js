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

function formatResult(result) {
  if (result.status === "dry_run") return `Visio 计划已生成：${result.plan?.shapes?.length || 0} 个 Shape。`;
  if (result.status === "readback_failed") return `Visio 已写入，但回读未通过：缺少 ${result.readbackValidation?.missingSourceNodeIds?.length || 0} 个节点。`;
  if (result.status === "needs_confirmation") return `分析完成，但部分结构待确认，尚未写入 Visio。`;
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
    return;
  }

  const kind = text ? classifyInput(text) : "image";
  const userLabel = text || `[已上传 ${state.images.length} 张架构图]`;
  addMessage("user", userLabel);

  const pending = addMessage("assistant", "正在分析并绘制到 Visio……");
  setStatus("分析中");
  $("#sendButton").disabled = true;

  try {
    const options = { documentPath, pageName };
    if (kind === "source") options.source = text;
    else if (kind === "image") { options.images = state.images; if (text) options.prompt = text; }
    else options.prompt = text;

    const result = await renderCurrentIRToVisio(options);
    pending.textContent = formatResult(result);
    setStatus(result.status === "dry_run" ? "已生成计划" : "已渲染");
  } catch (error) {
    if (error.payload?.status === "needs_external_vision") {
      pending.textContent = "⚠️ 图像分析需要配置可用的视觉模型。请在设置里配置 LLM API Key。";
      openSettings();
    } else if (error.payload?.status === "needs_confirmation") {
      pending.textContent = "⚠️ 部分结构待确认，尚未写入 Visio。";
    } else {
      pending.textContent = `⚠️ 失败：${error.message}`;
    }
    setStatus("失败");
  } finally {
    $("#sendButton").disabled = false;
    input.value = "";
    clearImages();
    input.focus();
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
async function loadLLMConfig() {
  const status = $("#llmStatusText");
  try {
    const response = await fetch("/api/llm-config");
    const config = await response.json();
    $("#llmBaseUrlInput").value = config.baseUrl || "";
    $("#llmModelInput").value = config.model || "";
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
    const datalist = $("#llmModelList");
    datalist.innerHTML = "";
    for (const model of payload.models || []) {
      const option = document.createElement("option");
      option.value = model;
      datalist.appendChild(option);
    }
    const current = $("#llmModelInput").value.trim();
    if (payload.models?.length && !payload.models.includes(current)) {
      $("#llmModelInput").value = payload.models[0];
    }
    status.textContent = `已拉取 ${payload.models?.length || 0} 个模型，可从下拉选择。`;
  } catch (error) {
    status.textContent = `拉取失败：${error.message}`;
  } finally { button.disabled = false; }
}

async function saveLLMConfig() {
  const status = $("#llmStatusText"); const button = $("#llmSaveButton");
  const body = { baseUrl: $("#llmBaseUrlInput").value.trim(), model: $("#llmModelInput").value.trim() };
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
  localStorage.setItem("visioDocumentPath", $("#visioDocumentPathInput").value.trim());
  localStorage.setItem("visioPage", $("#visioPageInput").value.trim() || "Page-1");
  $("#visioStatusText").textContent = "已保存 Visio 配置。";
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
$("#llmFetchModelsButton").addEventListener("click", fetchModels);
$("#llmSaveButton").addEventListener("click", saveLLMConfig);
$("#visioSaveButton").addEventListener("click", saveVisioConfig);

loadLLMConfig();
loadVisioConfig();
