import { homedir } from "node:os";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

// 配置写到用户主目录，保证无论从何处启动（node / Electron / 双击 exe）都能读到。
const configPath = join(homedir(), ".synapse-studio", "llm-config.json");

export function loadLLMConfig() {
  const fromEnv = {
    baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "",
    model: process.env.LLM_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
  };
  // 测试/CI 可用 SYNAPSE_NO_SAVED_CONFIG=1 忽略用户持久化的配置，只用环境变量。
  if (process.env.SYNAPSE_NO_SAVED_CONFIG === "1") return fromEnv;
  try {
    if (existsSync(configPath)) {
      const saved = JSON.parse(readFileSync(configPath, "utf8"));
      // 通过 UI 保存的最新配置优先于环境变量。
      return { ...fromEnv, ...saved };
    }
  } catch {
    // 配置文件缺失或损坏时回退环境变量。
  }
  return fromEnv;
}

export function maskApiKey(key) {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export function persistLLMConfig(config) {
  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch {
    // 持久化失败不影响内存配置。
  }
}

// 从 OpenAI-compatible 端点拉取可用模型列表（配置 UI 的模型下拉用）。
// 失败时抛出带 status 字段的 Error，供 HTTP 层映射为 4xx/5xx。
export async function fetchModelList(baseUrl, apiKey) {
  const upstream = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!upstream.ok) {
    const detail = (await upstream.text()).slice(0, 300);
    throw Object.assign(new Error(`拉取模型失败：HTTP ${upstream.status} ${detail}`), { status: upstream.status });
  }
  const payload = await upstream.json();
  return (Array.isArray(payload.data) ? payload.data : [])
    .map((entry) => (typeof entry === "string" ? entry : entry?.id))
    .filter(Boolean)
    .sort();
}
