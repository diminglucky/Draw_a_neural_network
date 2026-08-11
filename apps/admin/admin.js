const API_BASE = (globalThis.SYNAPSE_API_BASE || "http://127.0.0.1:4180").replace(/\/$/, "");
const TOKEN_KEY = "synapse.adminAccessToken";
const tokenStore = globalThis.localStorage;
const state = { token: tokenStore?.getItem(TOKEN_KEY) || "" };

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function rows(items, columns) {
  return items.map((item) => `<tr>${columns.map((column) => `<td>${escapeHtml(column(item))}</td>`).join("")}</tr>`).join("");
}

async function api(path, init = {}) {
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `请求失败 (${response.status})`);
  return payload;
}

function setLoggedIn(admin) {
  document.querySelector("#adminLogin").classList.toggle("is-hidden", Boolean(admin));
  document.querySelector("#adminApp").classList.toggle("is-hidden", !admin);
  if (admin) document.querySelector("#adminIdentity").textContent = admin.email;
}

async function login(event) {
  event.preventDefault();
  const error = document.querySelector("#adminLoginError");
  error.textContent = "";
  try {
    const result = await api("/api/admin/auth/login", { method: "POST", body: JSON.stringify({ email: document.querySelector("#adminEmail").value, password: document.querySelector("#adminPassword").value }) });
    state.token = result.accessToken;
    tokenStore?.setItem(TOKEN_KEY, state.token);
    setLoggedIn(result.admin);
    await refreshAll();
  } catch (requestError) { error.textContent = requestError.message; }
}

async function load(path, render) { const data = await api(path); render(data); }

function renderDashboard(data) {
  const labels = { users: "用户", devices: "设备", activeDevices: "活跃设备", activeSessions: "在线会话", jobs: "Job 总数", failedJobs: "失败 Job", auditRecords: "审计记录" };
  document.querySelector("#dashboardCards").innerHTML = Object.entries(labels).map(([key, label]) => `<div class="metric"><strong>${escapeHtml(data[key])}</strong><span>${label}</span></div>`).join("");
}

async function refreshAll() {
  try {
    await Promise.all([
      load("/api/admin/dashboard", renderDashboard),
      load("/api/admin/users", (data) => { document.querySelector("#usersTable").innerHTML = rows(data.users, [(x) => x.email, (x) => x.status, (x) => x.createdAt]); }),
      load("/api/admin/devices", (data) => { document.querySelector("#devicesTable").innerHTML = rows(data.devices, [(x) => x.name, (x) => x.userId, (x) => x.status, (x) => x.lastSeenAt]); }),
      load("/api/admin/sessions", (data) => { document.querySelector("#sessionsTable").innerHTML = data.sessions.map((x) => `<tr><td>${escapeHtml(x.id.slice(0, 8))}</td><td>${escapeHtml(x.userId)}</td><td>${escapeHtml(x.deviceId)}</td><td>${escapeHtml(x.status)}</td><td>${escapeHtml(x.leaseExpiresAt)}</td><td>${x.status === "active" ? `<button class="revoke-button" data-revoke-session="${escapeHtml(x.id)}">强制下线</button>` : "-"}</td></tr>`).join(""); }),
      load("/api/admin/jobs", (data) => { document.querySelector("#jobsTable").innerHTML = rows(data.jobs, [(x) => x.type, (x) => x.status, (x) => x.createdAt]); }),
      load("/api/admin/audit-logs", (data) => { document.querySelector("#auditTable").innerHTML = rows(data.records, [(x) => x.action, (x) => `${x.targetType}:${x.targetId}`, (x) => x.reason, (x) => x.createdAt]); }),
    ]);
    document.querySelector("#adminStatus").textContent = `已更新 · ${new Date().toLocaleString()}`;
  } catch (error) {
    if (/401|403|授权|Administrator/i.test(error.message)) logout();
    document.querySelector("#adminStatus").textContent = error.message;
  }
}

async function revokeSession(sessionId) {
  const reason = globalThis.prompt("请输入强制下线原因：", "管理员操作");
  if (!reason?.trim()) return;
  await api(`/api/admin/sessions/${encodeURIComponent(sessionId)}/revoke`, { method: "POST", body: JSON.stringify({ reason }) });
  await refreshAll();
}

function logout() {
  state.token = "";
  tokenStore?.removeItem(TOKEN_KEY);
  setLoggedIn(null);
}

document.querySelector("#adminLoginForm")?.addEventListener("submit", login);
document.querySelector("#adminLogout")?.addEventListener("click", logout);
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-revoke-session]");
  if (button) revokeSession(button.dataset.revokeSession).catch((error) => { document.querySelector("#adminStatus").textContent = error.message; });
  const refresh = event.target.closest?.("[data-refresh]");
  if (refresh) refreshAll();
});

if (state.token) { setLoggedIn({ email: "已登录管理员" }); refreshAll(); }

export { escapeHtml, rows };
