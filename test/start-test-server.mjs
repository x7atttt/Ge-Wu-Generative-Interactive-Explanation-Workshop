// 独立验收端口强制使用本地模型；不读取、输出或覆盖真实密钥文件。
process.env.LLM_BASE_URL = "http://127.0.0.1:3101";
process.env.LLM_API_KEY = "local-test-only";
process.env.LLM_MODEL = "local-test";
process.env.LLM_MODEL_FAST = "local-test";
process.env.BOCHA_API_KEY = "";
process.env.MINERU_API_TOKEN = "";
process.argv = [process.argv[0], "next", "start", "--port", "3100", "--hostname", "127.0.0.1"];
await import("next/dist/bin/next");
