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

// 尝试在 4173 启动内嵌 HTTP 服务。若端口被占用（例如已有实例在跑），
// 直接复用那个实例，而不是报错退出。
async function ensureServer() {
  try {
    server = await startServer({ port: DEFAULT_PORT, host: HOST });
  } catch (error) {
    if (error?.code === "EADDRINUSE") {
      // 复用已经运行的服务实例。
      return;
    }
    throw error;
  }
}

async function createWindow() {
  await ensureServer();
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
  await mainWindow.loadURL(`http://${HOST}:${DEFAULT_PORT}/`);
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
