import { renderCurrentIRToVisio } from "./visio-client.mjs";

const $ = (selector) => document.querySelector(selector);
const state = { images: [], modelWorkspace: undefined };

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

function shapeText(shape) {
  const output = Array.isArray(shape?.output) ? shape.output : [];
  return output.length ? `[${output.join(", ")}]` : "";
}

function renderWorkspacePanel(bubble, workspace) {
  if (!workspace) return;
  state.modelWorkspace = workspace;
  const panel = document.createElement("div");
  panel.className = "workspace-panel";
  bubble.appendChild(panel);

  const render = (current) => {
    panel.innerHTML = "";
    const head = document.createElement("div");
    head.className = "workspace-head";
    const title = document.createElement("strong");
    title.textContent = `模型工作区 · ${current.nodes?.length || 0} 层 / ${current.edges?.length || 0} 连接`;
    const revision = document.createElement("span");
    revision.textContent = `rev ${current.revision || 1}`;
    const replan = document.createElement("button");
    replan.type = "button";
    replan.className = "workspace-small-button";
    replan.textContent = "重新规划";
    replan.addEventListener("click", async () => {
      await planCurrentWorkspace(render);
    });
    const writeVisio = document.createElement("button");
    writeVisio.type = "button";
    writeVisio.className = "workspace-small-button";
    writeVisio.textContent = "写入 Visio";
    writeVisio.addEventListener("click", async () => {
      await renderCurrentWorkspaceToVisio(render);
    });
    const headRight = document.createElement("span");
    headRight.className = "workspace-head-actions";
    headRight.append(revision, replan, writeVisio);
    head.append(title, headRight);

    const list = document.createElement("div");
    list.className = "workspace-list";
    for (const node of current.nodes || []) {
      const row = document.createElement("div");
      row.className = "workspace-node";
      const label = document.createElement("button");
      label.className = "workspace-node-name";
      label.type = "button";
      label.title = "重命名节点";
      label.textContent = node.label || node.id;
      label.disabled = node.locked === true;
      label.addEventListener("click", async () => {
        const nextLabel = window.prompt("节点名称", node.label || node.id);
        if (!nextLabel || nextLabel === node.label) return;
        await applyWorkspaceOperation({ type: "rename-node", nodeId: node.id, label: nextLabel }, render);
      });

      const meta = document.createElement("span");
      meta.className = "workspace-node-meta";
      meta.textContent = [node.family, shapeText(node.shape)].filter(Boolean).join(" · ");

      const toggle = document.createElement("button");
      toggle.className = "workspace-toggle";
      toggle.type = "button";
      toggle.title = node.visible === false ? "显示节点" : "隐藏节点";
      toggle.textContent = node.visible === false ? "○" : "●";
      toggle.addEventListener("click", async () => {
        await applyWorkspaceOperation({ type: "set-node-visibility", nodeId: node.id, visible: node.visible === false }, render);
      });

      const edit = document.createElement("button");
      edit.className = "workspace-small-button";
      edit.type = "button";
      edit.textContent = "参数";
      edit.title = "编辑 shape 参数";
      edit.addEventListener("click", async () => {
        const raw = window.prompt("Shape JSON，例如 [1,64,64] 或 { output: [1,64,64] }", JSON.stringify(node.shape?.output || node.shape || []));
        if (!raw) return;
        let shape;
        try {
          shape = JSON.parse(raw);
        } catch {
          setStatus("参数不是合法 JSON");
          return;
        }
        await applyWorkspaceOperation({ type: "update-node", nodeId: node.id, patch: { shape } }, render);
      });

      row.append(label, meta, edit, toggle);
      list.appendChild(row);
    }

    panel.append(head, renderWorkspaceQa(current), renderWorkspaceGraph(current, render), renderWorkspaceEdges(current, render), list);
  };
  render(workspace);
}

function renderWorkspaceQa(workspace) {
  const qa = workspace.figureQa;
  const wrap = document.createElement("div");
  wrap.className = `workspace-qa ${qa?.ok === false ? "error" : "ok"}`;
  if (!qa) {
    wrap.textContent = "QA：未运行";
    return wrap;
  }
  const errors = (qa.issues || []).filter((issue) => issue.severity === "error");
  wrap.textContent = qa.ok ? "QA：通过" : `QA：${errors.length} 个问题`;
  if (errors.length) {
    const list = document.createElement("div");
    list.className = "workspace-qa-list";
    for (const issue of errors.slice(0, 4)) {
      const row = document.createElement("span");
      row.textContent = issue.nodeId ? `${issue.nodeId}: ${issue.code}` : issue.code;
      list.appendChild(row);
    }
    wrap.appendChild(list);
  }
  return wrap;
}

function renderWorkspaceEdges(workspace, rerender) {
  const wrap = document.createElement("div");
  wrap.className = "workspace-edges";
  const head = document.createElement("div");
  head.className = "workspace-section-head";
  const title = document.createElement("span");
  title.textContent = `连接 ${workspace.edges?.length || 0}`;
  const add = document.createElement("button");
  add.type = "button";
  add.className = "workspace-small-button";
  add.textContent = "新增连接";
  add.addEventListener("click", async () => {
    const source = window.prompt("Source node id");
    if (!source) return;
    const target = window.prompt("Target node id");
    if (!target) return;
    const type = window.prompt("Connection type: signal / skip / residual / output", "signal") || "signal";
    await applyWorkspaceOperation({ type: "add-edge", edge: { source, target, type } }, rerender);
  });
  head.append(title, add);
  wrap.appendChild(head);
  const list = document.createElement("div");
  list.className = "workspace-edge-list";
  for (const edge of workspace.edges || []) {
    const row = document.createElement("div");
    row.className = "workspace-edge-row";
    const text = document.createElement("span");
    text.textContent = `${edge.source} → ${edge.target}`;
    const type = document.createElement("span");
    type.className = "workspace-edge-type";
    type.textContent = edge.type || "signal";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "workspace-small-button danger";
    remove.textContent = "删除";
    remove.addEventListener("click", async () => {
      await applyWorkspaceOperation({ type: "remove-edge", edgeId: edge.id }, rerender);
    });
    row.append(text, type, remove);
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

function renderWorkspaceGraph(workspace, rerender) {
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.classList.add("workspace-graph");
  const nodes = (workspace.nodes || []).filter((node) => node.visible !== false);
  if (!nodes.length) return svg;
  const positioned = nodes.map((node, index) => {
    const ui = node.ui || {};
    return {
      node,
      x: Number.isFinite(Number(ui.x)) ? Number(ui.x) : index * 130,
      y: Number.isFinite(Number(ui.y)) ? Number(ui.y) : 0,
      w: Number.isFinite(Number(ui.w)) ? Math.max(36, Number(ui.w)) : 90,
      h: Number.isFinite(Number(ui.h)) ? Math.max(30, Number(ui.h)) : 54,
    };
  });
  const minX = Math.min(...positioned.map((item) => item.x));
  const minY = Math.min(...positioned.map((item) => item.y));
  const maxX = Math.max(...positioned.map((item) => item.x + item.w));
  const maxY = Math.max(...positioned.map((item) => item.y + item.h));
  const pad = 34;
  svg.setAttribute("viewBox", `${minX - pad} ${minY - pad} ${Math.max(1, maxX - minX + pad * 2)} ${Math.max(1, maxY - minY + pad * 2)}`);
  const byId = new Map(positioned.map((item) => [String(item.node.id), item]));
  const qaNodeIds = new Set();
  for (const issue of workspace.figureQa?.issues || []) {
    if (issue.nodeId) qaNodeIds.add(String(issue.nodeId));
    for (const id of issue.overlaps || []) qaNodeIds.add(String(id));
    for (const id of issue.obstacleNodeIds || []) qaNodeIds.add(String(id));
  }
  for (const edge of workspace.edges || []) {
    if (edge.visible === false) continue;
    const source = byId.get(String(edge.source));
    const target = byId.get(String(edge.target));
    if (!source || !target) continue;
    const line = document.createElementNS(svgNs, "line");
    line.setAttribute("x1", source.x + source.w);
    line.setAttribute("y1", source.y + source.h / 2);
    line.setAttribute("x2", target.x);
    line.setAttribute("y2", target.y + target.h / 2);
    line.setAttribute("class", `workspace-edge ${/skip|residual|bypass/i.test(edge.type) ? "skip" : ""}`);
    svg.appendChild(line);
  }
  for (const item of positioned) {
    const group = document.createElementNS(svgNs, "g");
    group.setAttribute("class", "workspace-shape");
    group.setAttribute("transform", `translate(${item.x} ${item.y})`);
    const rect = document.createElementNS(svgNs, "rect");
    rect.setAttribute("width", item.w);
    rect.setAttribute("height", item.h);
    rect.setAttribute("rx", "6");
    rect.setAttribute("class", `workspace-rect ${item.node.family || "custom"} ${qaNodeIds.has(String(item.node.id)) ? "qa-error" : ""}`);
    const text = document.createElementNS(svgNs, "text");
    text.setAttribute("x", item.w / 2);
    text.setAttribute("y", item.h / 2);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.textContent = item.node.label || item.node.id;
    group.append(rect, text);
    makeWorkspaceNodeDraggable(group, item, svg, rerender);
    svg.appendChild(group);
  }
  return svg;
}

function makeWorkspaceNodeDraggable(group, item, svg, rerender) {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  const scale = () => {
    const box = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    return {
      x: box.width ? viewBox.width / box.width : 1,
      y: box.height ? viewBox.height / box.height : 1,
    };
  };
  group.addEventListener("pointerdown", (event) => {
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    originX = item.x;
    originY = item.y;
    group.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  group.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const ratio = scale();
    item.x = Math.round(originX + (event.clientX - startX) * ratio.x);
    item.y = Math.round(originY + (event.clientY - startY) * ratio.y);
    group.setAttribute("transform", `translate(${item.x} ${item.y})`);
  });
  group.addEventListener("pointerup", async (event) => {
    if (!dragging) return;
    dragging = false;
    try { group.releasePointerCapture(event.pointerId); } catch {}
    await applyWorkspaceOperation({
      type: "move-node",
      nodeId: item.node.id,
      ui: { x: item.x, y: item.y, w: item.w, h: item.h },
    }, rerender);
  });
}

async function applyWorkspaceOperation(operation, rerender) {
  if (!state.modelWorkspace) return;
  const response = await fetch("/api/model-workspace/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace: state.modelWorkspace, operation }),
  });
  const payload = await response.json();
  if (!response.ok || payload.diagnostics?.length) {
    setStatus("模型编辑失败");
    return;
  }
  state.modelWorkspace = payload.workspace;
  setStatus("模型已更新");
  rerender(payload.workspace);
}

async function planCurrentWorkspace(rerender) {
  if (!state.modelWorkspace) return;
  setStatus("正在重新规划");
  const response = await fetch("/api/model-workspace/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace: state.modelWorkspace }),
  });
  const payload = await response.json();
  if (!response.ok || payload.status === "invalid_workspace") {
    setStatus("重新规划失败");
    return;
  }
  state.modelWorkspace = payload.workspace;
  setStatus(payload.status === "planned" ? "重新规划完成" : "重新规划有问题");
  rerender(payload.workspace);
}

async function renderCurrentWorkspaceToVisio(rerender) {
  if (!state.modelWorkspace) return;
  const documentPath = (localStorage.getItem("visioDocumentPath") || "").trim();
  const pageName = (localStorage.getItem("visioPage") || "Page-1").trim();
  if (!documentPath) {
    addMessage("assistant", "⚠️ 尚未配置 Visio 文档路径。请点击左下角 ⚙ 设置，填入 .vsdx 路径。");
    openSettings();
    return;
  }
  setStatus("正在写入 Visio");
  const response = await fetch("/api/render-visio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace: state.modelWorkspace, documentPath, pageName }),
  });
  const payload = await response.json();
  if (!response.ok) {
    setStatus("写入 Visio 失败");
    addMessage("assistant", `⚠️ 写入 Visio 失败：${friendlyError(payload)}`);
    return;
  }
  setStatus(payload.status === "dry_run" ? "已生成计划" : "已写入 Visio");
  addMessage("assistant", formatResult(payload));
  if (payload.modelWorkspace) {
    state.modelWorkspace = payload.modelWorkspace;
    rerender(payload.modelWorkspace);
  }
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
    renderWorkspacePanel(pending, result.modelWorkspace);
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
      renderWorkspacePanel(bubble, payload.modelWorkspace);
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
