/**
 * 服务端 SSE 响应构造器：路由内以 send(event) 推送事件，
 * 协议见 spec/2026-09-24-iteration2-streaming-interactivity.md。
 */
export function sseResponse(produce: (send: (event: unknown) => void, signal: AbortSignal) => Promise<void>, requestSignal?: AbortSignal, onAbort?: () => void): Response {
  const encoder = new TextEncoder();
  const lifetime = new AbortController();
  let closed = false;
  const abort = () => { lifetime.abort(); onAbort?.(); };
  const cleanup = () => requestSignal?.removeEventListener("abort", abort);
  requestSignal?.addEventListener("abort", abort, { once: true });
  if (requestSignal?.aborted) abort();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: unknown) => {
        lifetime.signal.throwIfAborted();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      // start 不等待生成结束，否则底层 cancel 也会被尚未结束的 start 阻塞。
      void produce(send, lifetime.signal).catch(error => {
        if (!lifetime.signal.aborted && !closed) { closed = true; controller.error(error); }
      }).finally(() => {
        if (!closed) { closed = true; controller.close(); }
        cleanup();
      });
    },
    cancel() { closed = true; abort(); cleanup(); },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
