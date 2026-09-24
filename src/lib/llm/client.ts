/**
 * OpenAI 兼容 Chat Completions 客户端（流式 + 非流式）。
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
  /** 覆盖默认模型；轻量操作（改造/追问）传入 fast 模型 */
  model?: string;
  /** 非流式请求的整体超时；流式请求不用（见空闲计时器） */
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
  /** 轻量操作用快速模型；未配置 LLM_MODEL_FAST 时回落主模型 */
  fastModel: string;
}

export function llmConfigFromEnv(): LLMConfig {
  return {
    baseUrl: requireEnv("LLM_BASE_URL").replace(/\/+$/, ""),
    apiKey: requireEnv("LLM_API_KEY"),
    model: requireEnv("LLM_MODEL"),
    fastModel: process.env.LLM_MODEL_FAST?.trim() || requireEnv("LLM_MODEL"),
  };
}

function buildBody(
  model: string,
  messages: ChatMessage[],
  options: ChatOptions,
  stream: boolean
): Record<string, unknown> {
  return {
    model,
    messages,
    temperature: options.temperature ?? 0.4,
    ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
    stream,
  };
}

/** 非流式调用：自修复等后台路径使用 */
export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
  const { baseUrl, apiKey, model } = llmConfigFromEnv();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildBody(options.model ?? model, messages, options, false)),
      signal: controller.signal,
    });
    return await readFullResponse(res);
  } catch (err) {
    throw normalizeFetchError(err);
  } finally {
    clearTimeout(timer);
  }
}

/** 流式调用：增量通过 onDelta 透出，返回完整文本 */
export async function streamChat(
  messages: ChatMessage[],
  options: ChatOptions,
  onDelta: (text: string) => void
): Promise<string> {
  const { baseUrl, apiKey, model } = llmConfigFromEnv();
  const controller = new AbortController();
  // 流式不设整体超时：60 秒无输出视为挂死
  const IDLE_MS = 60_000;
  let idleTimer = setTimeout(() => controller.abort(), IDLE_MS);
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), IDLE_MS);
  };

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildBody(options.model ?? model, messages, options, true)),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LLMError(`LLM 服务返回 ${res.status}：${body.slice(0, 300)}`, res.status);
    }
    if (!res.body) throw new LLMError("LLM 服务未返回流式响应体");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      buffer += decoder.decode(value, { stream: true });
      // SSE 事件以空行分隔；逐事件消费，余量留缓冲
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const delta = (JSON.parse(payload) as {
              choices?: { delta?: { content?: string } }[];
            }).choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              full += delta;
              onDelta(delta);
            }
          } catch {
            // 单个事件解析失败不中断整体流
          }
        }
      }
    }

    if (!full.trim()) throw new LLMError("LLM 返回内容为空");
    return full;
  } catch (err) {
    throw normalizeFetchError(err);
  } finally {
    clearTimeout(idleTimer);
  }
}

async function readFullResponse(res: Response): Promise<string> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LLMError(`LLM 服务返回 ${res.status}：${body.slice(0, 300)}`, res.status);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new LLMError("LLM 返回内容为空");
  }
  return content;
}

function normalizeFetchError(err: unknown): Error {
  if (err instanceof LLMError) return err;
  if (err instanceof Error && err.name === "AbortError") {
    return new LLMError("LLM 请求超时或被取消，请重试");
  }
  return new LLMError(`LLM 请求失败：${err instanceof Error ? err.message : String(err)}`);
}
