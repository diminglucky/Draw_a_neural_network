// 测试预加载：在任何被测模块（尤其 server.js）加载之前运行，
// 隔离用户持久化的 LLM 配置（~/.synapse-studio/llm-config.json），
// 避免测试被真实 API key 污染而触发意外的网络调用。
process.env.SYNAPSE_NO_SAVED_CONFIG = "1";
