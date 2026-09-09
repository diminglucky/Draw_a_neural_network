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
