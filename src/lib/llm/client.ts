/**
 * OpenAI 兼容 Chat Completions 客户端（流式 + 非流式）。
 * 刻意不引入 SDK：协议层只依赖 {base_url}/chat/completions 一个端点，
 * 任何兼容厂商（GLM / DeepSeek / OpenAI / 本地推理服务等）可直接切换。
 * 配置全部来自环境变量（见 .env.example），密钥不进代码库。
 */
import type { ReasoningEffort } from "@/lib/effort";

/** 多模态内容片：文本或图片（data URL 或可访问 URL）——OpenAI 兼容协议 */
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  /** 纯文本，或 text+image 片段数组（多模态；生成/追问带图时使用） */
  content: string | ChatContentPart[];
}

/** 图文消息构造：文本在前、图片 data URL 在后（识图语境：先读题面再看图） */
export function withImages(text: string, images: string[]): ChatMessage["content"] {
  if (images.length === 0) return text;
  return [
    { type: "text", text },
    ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
}

export interface RequestControl {
  signal?: AbortSignal;
  /** 每次重试前清空本次预览，避免把两次响应拼在一起。 */
  onRetry?: (attempt: number) => void;
  /** 仅通知观察到思考状态，不向调用方传递思考正文。 */
  onThinking?: () => void;
}

export interface ChatOptions extends RequestControl {
  effort?: ReasoningEffort;
  temperature?: number;
  maxTokens?: number;
  /** 请求 json_object 输出模式（要求模型输出合法 JSON） */
  jsonMode?: boolean;
  /** 覆盖默认模型；轻量操作（改造/追问）传入 fast 模型 */
  model?: string;
  /** 非流式请求的整体超时；流式请求不用（见空闲计时器） */
  timeoutMs?: number;
  idleTimeoutMs?: number;
  /** 首段有效正文的等待上限；保活和思考数据不能续期。 */
  firstContentTimeoutMs?: number;
  /** 即使正文不断到达，单次流式响应也必须有结束上限。 */
  streamTimeoutMs?: number;
}

export class LLMError extends Error {
  status?: number;
  retryable: boolean;
  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = "LLMError";
    this.status = status;
    this.retryable = retryable;
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

/** 可选：思考强度（GLM/OpenAI 兼容参数 reasoning_effort），未配置或非法值时不发送 */
function reasoningEffort(): string | null {
  const value = process.env.LLM_REASONING_EFFORT?.trim().toLowerCase();
  return value === "low" || value === "medium" || value === "high" || value === "max" ? value : null;
}

function buildBody(
  model: string,
  messages: ChatMessage[],
  options: ChatOptions,
  stream: boolean
): Record<string, unknown> {
  const effort = options.effort ?? reasoningEffort();
  return {
    model,
    messages,
    temperature: options.temperature ?? 0.4,
    ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
    ...(effort ? { reasoning_effort: effort } : {}),
    stream,
  };
}

/** 非流式调用：自修复等后台路径使用 */
export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
  const { baseUrl, apiKey, model } = llmConfigFromEnv();
  return withRetries(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(buildBody(options.model ?? model, messages, options, false)),
        signal,
      });
      return await readFullResponse(res);
    } catch (err) {
      options.signal?.throwIfAborted();
      if (controller.signal.aborted) throw new LLMError("LLM 请求超时，请重试", undefined, true);
      throw err;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }, options);
}

/** 流式调用：增量通过 onDelta 透出，返回完整文本 */
export async function streamChat(
  messages: ChatMessage[],
  options: ChatOptions,
  onDelta: (text: string) => void
): Promise<string> {
  const { baseUrl, apiKey, model } = llmConfigFromEnv();
  return withRetries(() => streamAttempt(baseUrl, apiKey, model, messages, options, onDelta), options);
}

async function streamAttempt(baseUrl: string, apiKey: string, model: string, messages: ChatMessage[], options: ChatOptions, onDelta: (text: string) => void): Promise<string> {
  const controller = new AbortController();
  const IDLE_MS = options.idleTimeoutMs ?? 60_000;
  const abortIdle = () => controller.abort(new LLMError("LLM 连接长时间未返回数据，请重试", undefined, true));
  let idleTimer = setTimeout(abortIdle, IDLE_MS);
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(abortIdle, IDLE_MS);
  };
  // 网络仍活跃不代表正文在推进：单独限制首字等待，之后只由有效正文续期。
  let contentTimer = setTimeout(() => controller.abort(new LLMError("模型等待超时，未返回正文。可降低思考强度或稍后重试", undefined, true)), options.firstContentTimeoutMs ?? 90_000);
  // 重复生成也会不断刷新空闲计时；总时限到达后直接结束，不当作网络故障反复重跑。
  const totalTimer = setTimeout(() => controller.abort(new LLMError("本次响应超过总时限，请缩小问题范围或降低思考强度后重试")), options.streamTimeoutMs ?? 180_000);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let full = "";
  let thinkingNotified = false;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildBody(options.model ?? model, messages, options, true)),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw responseError(res.status, body);
    }
    if (!res.body) throw new LLMError("LLM 服务未返回流式响应体", undefined, true);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;

    stream: for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        if (!finished) throw new LLMError("LLM 连接中断，响应尚未完成", undefined, true);
        break;
      }
      resetIdle();
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      // SSE 事件以空行分隔；逐事件消费，余量留缓冲
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          if (payload === "[DONE]") { finished = true; break stream; }
          let parsed: { choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string }; finish_reason?: string | null }[]; error?: { message?: string; code?: number } };
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          if (!parsed || typeof parsed !== "object") continue;
          if (parsed.error) throw new LLMError(parsed.error.message ?? "LLM 流式响应失败", parsed.error.code);
          const choice = parsed.choices?.[0];
          if (choice?.finish_reason) finished = true;
          const thinking = choice?.delta?.reasoning_content || choice?.delta?.reasoning;
          if (typeof thinking === "string" && thinking.trim() && !full.trim() && !thinkingNotified) {
            thinkingNotified = true;
            try { options.onThinking?.(); }
            catch (error) { throw new LLMError(error instanceof Error ? error.message : String(error)); }
          }
          const delta = choice?.delta?.content;
          if (typeof delta === "string" && delta) {
            if (delta.trim()) {
              clearTimeout(contentTimer);
              contentTimer = setTimeout(() => controller.abort(new LLMError("讲解正文长时间未继续返回，请稍后重试", undefined, true)), IDLE_MS);
            }
            full += delta;
            // 只捕获 JSON 解析异常，调用方的取消/发送异常必须向外传播。
            try { onDelta(delta); }
            catch (error) { throw new LLMError(error instanceof Error ? error.message : String(error)); }
          }
        }
      }
    }

    if (!full.trim()) throw new LLMError("LLM 返回内容为空", undefined, true);
    return full;
  } catch (err) {
    options.signal?.throwIfAborted();
    const error = controller.signal.aborted ? controller.signal.reason as LLMError : normalizeFetchError(err);
    // 无重置回调的调用方只能在尚未输出时重试。
    if (full && !options.onRetry && error instanceof LLMError) error.retryable = false;
    throw error;
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(contentTimer);
    clearTimeout(totalTimer);
    controller.abort();
  }
}

async function readFullResponse(res: Response): Promise<string> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw responseError(res.status, body);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new LLMError("LLM 返回内容为空", undefined, true);
  }
  return content;
}

function responseError(status: number, body: string): LLMError {
  return new LLMError(`LLM 服务返回 ${status}：${body.slice(0, 300)}`, status, status === 408 || status === 429 || status >= 500);
}

async function withRetries<T>(run: () => Promise<T>, options: RequestControl): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    try { return await run(); }
    catch (err) {
      options.signal?.throwIfAborted();
      const error = normalizeFetchError(err);
      if (!(error instanceof LLMError) || !error.retryable || attempt >= 2) throw error;
      options.onRetry?.(attempt + 1);
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => options.signal?.removeEventListener("abort", abort);
        const timer = setTimeout(() => { cleanup(); resolve(); }, 400 * (attempt + 1));
        const abort = () => { clearTimeout(timer); cleanup(); reject(options.signal!.reason); };
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
      });
    }
  }
}

function normalizeFetchError(err: unknown): Error {
  if (err instanceof LLMError) return err;
  return new LLMError(`LLM 请求失败：${err instanceof Error ? err.message : String(err)}`, undefined, err instanceof TypeError);
}
