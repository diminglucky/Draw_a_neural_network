export const GATE_STATE = Object.freeze({
  LOCKED: "locked",
  AUTHORIZING: "authorizing",
  AUTHORIZED: "authorized",
});

const TOKEN_KEY = "synapse.accessToken";
const DEVICE_KEY = "synapse.deviceIdentity";

export function applyGateState(root, view) {
  if (!root) return;
  const authorized = view.state === GATE_STATE.AUTHORIZED;
  root.dataset.state = view.state;
  root.hidden = authorized;
  root.classList?.toggle("is-authorized", authorized);
  root.classList?.toggle("is-locked", !authorized);
  const status = root.querySelector?.("[data-gate-status]");
  if (status) status.textContent = view.message || (authorized ? "已获得在线授权" : "需要在线授权");
  const identity = root.querySelector?.("[data-gate-identity]");
  if (identity) identity.textContent = view.identity || "等待服务器确认账号与设备";
  const error = root.querySelector?.("[data-gate-error]");
  if (error) error.textContent = view.error || "";
}

export function renderAdminTable(rows, columns) {
  return rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row?.[column] ?? "")}</td>`).join("")}</tr>`).join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

function getDeviceIdentity(storage) {
  const current = getStorage(storage)?.getItem(DEVICE_KEY);
  if (current) return JSON.parse(current);
  const id = globalThis.crypto?.randomUUID?.() || `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const identity = {
    id,
    name: "Windows desktop client",
    publicKey: "browser-bootstrap-key",
    fingerprintHash: `browser-${id}`,
    clientVersion: "foundation-web-0.1.0",
    osVersion: globalThis.navigator?.userAgent || "Windows",
  };
  getStorage(storage)?.setItem(DEVICE_KEY, JSON.stringify(identity));
  return identity;
}

function gateMarkup() {
  return `
    <div class="foundation-gate-card" role="dialog" aria-labelledby="foundationGateTitle">
      <div class="foundation-gate-brand"><span class="foundation-gate-mark">S</span><span>Synapse Studio</span></div>
      <p class="eyebrow">COMMERCIAL FOUNDATION</p>
      <h2 id="foundationGateTitle">在线授权后开始使用</h2>
      <p class="foundation-gate-copy">客户端需要连接授权服务确认账号、设备和订阅状态。Agent 与 Visio 连接状态会在授权后显示。</p>
      <div class="foundation-auth-tabs">
        <button type="button" data-auth-mode="login" class="is-selected">登录</button>
        <button type="button" data-auth-mode="register">注册试用账号</button>
      </div>
      <form data-auth-form>
        <label>邮箱<input data-auth-email type="email" autocomplete="email" required placeholder="you@example.com" /></label>
        <label>密码<input data-auth-password type="password" autocomplete="current-password" required minlength="8" placeholder="至少 8 位" /></label>
        <button class="primary-button" data-auth-submit type="submit">连接并授权</button>
      </form>
      <p data-gate-status class="foundation-gate-status">等待在线授权</p>
      <p data-gate-identity class="foundation-gate-identity">未绑定设备</p>
      <p data-gate-error class="foundation-gate-error" role="alert"></p>
      <p class="foundation-gate-footnote">当前 Web 端使用本地设备标识；Windows Electron 客户端将替换为 DPAPI 保护的设备密钥。</p>
    </div>`;
}

export function createAuthGate(options = {}) {
  const root = options.root || globalThis.document?.querySelector?.("#foundationGate");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const storage = getStorage(options.storage);
  const apiBase = (options.apiBase || globalThis.SYNAPSE_API_BASE || "http://127.0.0.1:4180").replace(/\/$/, "");
  const device = options.device || getDeviceIdentity(storage);
  let mode = "login";
  let heartbeatTimer;

  function token() { return storage?.getItem(TOKEN_KEY) || ""; }
  function setToken(value) {
    if (value) storage?.setItem(TOKEN_KEY, value);
    else storage?.removeItem(TOKEN_KEY);
  }
  function setView(view) { applyGateState(root, view); }

  async function request(path, init = {}) {
    if (!fetchImpl) throw new Error("浏览器没有可用的网络请求实现");
    const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    const response = await fetchImpl(`${apiBase}${path}`, { ...init, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || `请求失败 (${response.status})`);
      error.code = payload.error?.code;
      throw error;
    }
    return payload;
  }

  function scheduleHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => heartbeat(), options.heartbeatMs || 45000);
  }

  async function heartbeat() {
    if (!token()) return false;
    try {
      const session = await request("/api/auth/session");
      await request("/api/devices/heartbeat", { method: "POST", body: JSON.stringify({ sessionId: session.session.id }) });
      return true;
    } catch (error) {
      setToken("");
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      setView({ state: GATE_STATE.LOCKED, message: "会话已失效，请重新登录", error: error.message });
      return false;
    }
  }

  async function refresh() {
    if (!token()) {
      setView({ state: GATE_STATE.LOCKED, message: "请登录并等待服务器确认授权" });
      return false;
    }
    setView({ state: GATE_STATE.AUTHORIZING, message: "正在向授权服务器确认账号与设备…" });
    try {
      const [session, license] = await Promise.all([request("/api/auth/session"), request("/api/license/status")]);
      const plan = license.subscription?.plan || "未订阅";
      setView({
        state: GATE_STATE.AUTHORIZED,
        message: `已授权 · ${plan}`,
        identity: `${session.user.email} · ${session.device.name}`,
      });
      scheduleHeartbeat();
      return true;
    } catch (error) {
      setToken("");
      setView({ state: GATE_STATE.LOCKED, message: "在线授权失败", error: error.message });
      return false;
    }
  }

  async function submit(email, password) {
    setView({ state: GATE_STATE.AUTHORIZING, message: "正在连接授权服务…" });
    try {
      if (mode === "register") {
        const registration = await request("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, device }),
        });
        storage?.setItem(DEVICE_KEY, JSON.stringify(registration.device));
      }
      const deviceId = JSON.parse(storage?.getItem(DEVICE_KEY) || "{}").id || device.id;
      const result = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, deviceId }),
      });
      setToken(result.accessToken);
      return refresh();
    } catch (error) {
      setView({ state: GATE_STATE.LOCKED, message: "在线授权失败", error: error.message });
      return false;
    }
  }

  async function logout() {
    try { if (token()) await request("/api/auth/logout", { method: "POST" }); } catch { /* the lease is already invalid */ }
    setToken("");
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    setView({ state: GATE_STATE.LOCKED, message: "已退出，请重新登录" });
  }

  function mount() {
    if (!root) return controller;
    root.innerHTML = gateMarkup();
    root.querySelectorAll?.("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => {
      mode = button.dataset.authMode;
      root.querySelectorAll("[data-auth-mode]").forEach((item) => item.classList.toggle("is-selected", item === button));
      root.querySelector("[data-auth-submit]").textContent = mode === "register" ? "注册并授权" : "连接并授权";
    }));
    root.querySelector("[data-auth-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await submit(form.querySelector("[data-auth-email]").value.trim(), form.querySelector("[data-auth-password]").value);
    });
    root.querySelector("[data-auth-logout]")?.addEventListener("click", logout);
    return controller;
  }

  const controller = { mount, refresh, heartbeat, submit, logout, getState: () => root?.dataset.state || GATE_STATE.LOCKED };
  return controller;
}

if (typeof document !== "undefined") {
  const gate = createAuthGate();
  gate.mount();
  gate.refresh();
  globalThis.synapseAuthGate = gate;
}
