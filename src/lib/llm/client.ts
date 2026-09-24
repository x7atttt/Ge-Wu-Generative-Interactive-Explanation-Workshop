/**
 * OpenAI 兼容 Chat Completions 客户端。
 * 刻意不引入 SDK：协议层只依赖 {base_url}/chat/completions 一个端点，
 * 任何兼容厂商（GLM / DeepSeek / OpenAI / 本地推理服务等）可直接切换。
 * 配置全部来自环境变量（见 .env.example），密钥不进代码库。
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** 请求 json_object 输出模式（要求模型输出合法 JSON） */
  jsonMode?: boolean;
  timeoutMs?: number;
}

export class LLMError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "LLMError";
    this.status = status;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new LLMError(
      `服务端缺少环境变量 ${name}：请在 app 目录 .env.local 中配置（模板见 .env.example），然后重启 pnpm dev`
    );
  }
  return value;
}

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function llmConfigFromEnv(): LLMConfig {
  return {
    baseUrl: requireEnv("LLM_BASE_URL").replace(/\/+$/, ""),
    apiKey: requireEnv("LLM_API_KEY"),
    model: requireEnv("LLM_MODEL"),
  };
}

export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
  const { baseUrl, apiKey, model } = llmConfigFromEnv();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.4,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LLMError(`LLM 服务返回 ${res.status}：${body.slice(0, 300)}`, res.status);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new LLMError("LLM 返回内容为空");
    }
    return content;
  } catch (err) {
    if (err instanceof LLMError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new LLMError("LLM 请求超时，请稍后重试");
    }
    throw new LLMError(`LLM 请求失败：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}
