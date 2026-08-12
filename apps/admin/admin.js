import { FIXED_FOUNDATION_API_URL } from "../client/api-base.js";

const API_BASE = FIXED_FOUNDATION_API_URL;
const TOKEN_KEY = "synapse.adminAccessToken";
const tokenStore = globalThis.localStorage;
const state = {
  token: tokenStore?.getItem(TOKEN_KEY) || "",
  users: [],
  devices: [],
};

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function rows(items, columns) {
  return items.map((item) => `<tr>${columns.map((column) => `<td>${escapeHtml(column(item))}</td>`).join("")}</tr>`).join("");
}

function filterRows(items, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => [item.id, item.email, item.name, item.status, item.userId, item.deviceId]
    .some((value) => String(value ?? "").toLowerCase().includes(needle)));
}

function statusAction(item, kind) {
  const next = item.status === "active" ? "disabled" : item.status === "disabled" ? "active" : "";
  if (!next) return "-";
  const label = next === "disabled" ? "禁用" : "启用";
  return `<button class="status-button ${next === "disabled" ? "status-disable" : "status-enable"}" data-status-kind="${escapeHtml(kind)}" data-status-target="${escapeHtml(item.id)}" data-status-next="${next}">${label}</button>`;
}

function apiError(response, payload) {
  const error = new Error(payload.error?.message || `请求失败 (${response.status})`);
  error.status = response.status;
  error.code = payload.error?.code || "";
  return error;
}

async function api(path, init = {}) {
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, payload);
  return payload;
}

function setLoggedIn(admin) {
  const login = document.querySelector("#adminLogin");
  const application = document.querySelector("#adminApp");
  login?.classList.toggle("is-hidden", Boolean(admin));
  application?.classList.toggle("is-hidden", !admin);
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

async function load(path, render) {
  const data = await api(path);
  render(data);
}

function renderDashboard(data) {
  const labels = { users: "用户", devices: "设备", activeDevices: "活跃设备", activeSessions: "在线会话", jobs: "Job 总数", failedJobs: "失败 Job", auditRecords: "审计记录" };
  document.querySelector("#dashboardCards").innerHTML = Object.entries(labels).map(([key, label]) => `<div class="metric"><strong>${escapeHtml(data[key])}</strong><span>${label}</span></div>`).join("");
}

function renderUsers(data) {
  state.users = data.users;
  renderFilteredUsers();
}

function renderDevices(data) {
  state.devices = data.devices;
  renderFilteredDevices();
}

function renderFilteredUsers() {
  const query = document.querySelector("#usersSearch")?.value || "";
  const status = document.querySelector("#usersStatusFilter")?.value || "";
  const filtered = filterRows(state.users, query).filter((item) => !status || item.status === status);
  document.querySelector("#usersTable").innerHTML = filtered.map((x) => `<tr><td>${escapeHtml(x.email)}</td><td>${escapeHtml(x.status)}</td><td>${escapeHtml(x.createdAt)}</td><td>${statusAction(x, "user")}</td></tr>`).join("");
}

function renderFilteredDevices() {
  const query = document.querySelector("#devicesSearch")?.value || "";
  const status = document.querySelector("#devicesStatusFilter")?.value || "";
  const filtered = filterRows(state.devices, query).filter((item) => !status || item.status === status);
  document.querySelector("#devicesTable").innerHTML = filtered.map((x) => `<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.userId)}</td><td>${escapeHtml(x.status)}</td><td>${escapeHtml(x.lastSeenAt)}</td><td>${statusAction(x, "device")}</td></tr>`).join("");
}

async function refreshAll() {
  try {
    await Promise.all([
      load("/api/admin/dashboard", renderDashboard),
      load("/api/admin/users", renderUsers),
      load("/api/admin/devices", renderDevices),
      load("/api/admin/sessions", (data) => { document.querySelector("#sessionsTable").innerHTML = data.sessions.map((x) => `<tr><td>${escapeHtml(x.id.slice(0, 8))}</td><td>${escapeHtml(x.userId)}</td><td>${escapeHtml(x.deviceId)}</td><td>${escapeHtml(x.status)}</td><td>${escapeHtml(x.leaseExpiresAt)}</td><td>${x.status === "active" ? `<button class="revoke-button" data-revoke-session="${escapeHtml(x.id)}">强制下线</button>` : "-"}</td></tr>`).join(""); }),
      load("/api/admin/jobs", (data) => { document.querySelector("#jobsTable").innerHTML = rows(data.jobs, [(x) => x.type, (x) => x.status, (x) => x.createdAt]); }),
      load("/api/admin/audit-logs", (data) => { document.querySelector("#auditTable").innerHTML = rows(data.records, [(x) => x.action, (x) => `${x.targetType}:${x.targetId}`, (x) => x.reason, (x) => x.createdAt]); }),
    ]);
    document.querySelector("#adminStatus").textContent = `已更新 · ${new Date().toLocaleString()}`;
  } catch (error) {
    if (error.status === 401 || error.status === 403) logout();
    document.querySelector("#adminStatus").textContent = error.message;
  }
}

async function revokeSession(sessionId) {
  const reason = globalThis.prompt("请输入强制下线原因：", "管理员操作");
  if (!reason?.trim()) return;
  await api(`/api/admin/sessions/${encodeURIComponent(sessionId)}/revoke`, { method: "POST", body: JSON.stringify({ reason }) });
  await refreshAll();
}

async function changeStatus(kind, id, nextStatus) {
  const reason = globalThis.prompt(`请输入${nextStatus === "disabled" ? "禁用" : "启用"}原因：`, "管理员操作");
  if (!reason?.trim()) return;
  await api(`/api/admin/${kind === "user" ? "users" : "devices"}/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status: nextStatus, reason }) });
  await refreshAll();
}

function handleAdminError(error) {
  if (error.status === 401 || error.status === 403) logout();
  document.querySelector("#adminStatus").textContent = error.message;
}

function logout() {
  state.token = "";
  tokenStore?.removeItem(TOKEN_KEY);
  setLoggedIn(null);
}

if (typeof document !== "undefined") {
  document.querySelector("#adminLoginForm")?.addEventListener("submit", login);
  document.querySelector("#adminLogout")?.addEventListener("click", logout);
  document.querySelector("#usersSearch")?.addEventListener("input", renderFilteredUsers);
  document.querySelector("#usersStatusFilter")?.addEventListener("change", renderFilteredUsers);
  document.querySelector("#devicesSearch")?.addEventListener("input", renderFilteredDevices);
  document.querySelector("#devicesStatusFilter")?.addEventListener("change", renderFilteredDevices);
  document.addEventListener("click", (event) => {
    const statusButton = event.target.closest?.("[data-status-target]");
    if (statusButton) changeStatus(statusButton.dataset.statusKind, statusButton.dataset.statusTarget, statusButton.dataset.statusNext).catch(handleAdminError);
    const revokeButton = event.target.closest?.("[data-revoke-session]");
    if (revokeButton) revokeSession(revokeButton.dataset.revokeSession).catch(handleAdminError);
    const refresh = event.target.closest?.("[data-refresh]");
    if (refresh) refreshAll();
  });
  if (state.token) { setLoggedIn({ email: "已登录管理员" }); refreshAll(); }
}

export { escapeHtml, filterRows, rows, statusAction };
