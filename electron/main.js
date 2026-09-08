import { app, BrowserWindow } from "electron";
import { startServer } from "../server.js";

const DEFAULT_PORT = 4173;
const HOST = "127.0.0.1";
let server;
let mainWindow;

// 远程桌面 / 无 GPU 环境下，硬件加速会导致 renderer 崩溃，禁用之。
// 禁用 sandbox 以兼容受限的 Windows 会话（本地单机工具，风险可控）。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");

// 尝试在 4173 启动内嵌 HTTP 服务。若端口被占用：
//  1) 占用者是本应用自己的实例 → 复用；
//  2) 占用者是无关进程（例如别的 dev server）→ 换一个随机空闲端口，
//     而不是误以为「已有实例」后把窗口加载到错误的页面。
async function ensureServer() {
  try {
    server = await startServer({ port: DEFAULT_PORT, host: HOST });
    return DEFAULT_PORT;
  } catch (error) {
    if (error?.code === "EADDRINUSE") {
      if (await isSynapseStudioOn(HOST, DEFAULT_PORT)) return DEFAULT_PORT;
      server = await startServer({ port: 0, host: HOST });
      return server.address().port;
    }
    throw error;
  }
}

async function isSynapseStudioOn(host, port) {
  try {
    const response = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const html = await response.text();
    return html.includes("Synapse Studio");
  } catch {
    return false;
  }
}

async function createWindow() {
  const port = await ensureServer();
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    title: "Synapse Studio",
    autoHideMenuBar: true,
    backgroundColor: "#f3f6fb",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await mainWindow.loadURL(`http://${HOST}:${port}/`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (error) {
    console.error("Failed to start Synapse Studio:", error);
    app.quit();
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  server?.close();
});
