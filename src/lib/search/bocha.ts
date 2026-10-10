/**
 * 博查（Bocha）Web Search 客户端：生成讲解前检索全网资料补充事实依据。
 * 服务端专用；BOCHA_API_KEY 未配置时静默跳过（功能关闭），
 * 检索失败/超时只记日志并返回空数组——增强路径永不阻断生成主流程。
 * 响应契约依据 2026-10-10 实测（Bing 风格 data.webPages.value，含 AI 摘要 summary）。
 */

export interface SearchRef {
  title: string;
  siteName: string | null;
  /** 归一化主机名（去 www./m. 前缀），同站去重用；解析失败为 null */
  host: string | null;
  /** datePublished 的 YYYY-MM-DD 部分 */
  date: string | null;
  /** AI 摘要优先，回落 snippet；截断以控制提示词体积 */
  summary: string;
}

const ENDPOINT = "https://api.bocha.cn/v1/web-search";
const TIMEOUT_MS = 8_000;
const REQUEST_COUNT = 8;
const MAX_REFS = 6;
const MAX_PER_SITE = 2;
const SUMMARY_MAX = 320;

/** 归一化主机名：去掉 www./m./mobile. 前缀，合并移动端与桌面端同站结果 */
function normalizedHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^(www|m|mobile)\./, "");
  } catch {
    return null;
  }
}

/** 从响应 JSON 提取注入条目：字段清洗 → 同站/同标题去重 → 截取上限（纯函数，可用真实响应样本做回归） */
export function toRefs(data: unknown): SearchRef[] {
  const value = (
    data as { data?: { webPages?: { value?: unknown[] } } } | null
  )?.data?.webPages?.value;
  if (!Array.isArray(value)) return [];
  const refs: SearchRef[] = [];
  for (const item of value) {
    const page = item as {
      name?: unknown;
      url?: unknown;
      snippet?: unknown;
      summary?: unknown;
      siteName?: unknown;
      datePublished?: unknown;
    };
    const title = typeof page.name === "string" ? page.name.trim() : "";
    const raw =
      typeof page.summary === "string" && page.summary.trim() ? page.summary : page.snippet;
    const summary = typeof raw === "string" ? raw.trim().slice(0, SUMMARY_MAX) : "";
    if (!title || !summary) continue;
    refs.push({
      title,
      siteName:
        typeof page.siteName === "string" && page.siteName.trim()
          ? page.siteName.trim()
          : null,
      host: typeof page.url === "string" ? normalizedHost(page.url) : null,
      date:
        typeof page.datePublished === "string" && /^\d{4}-\d{2}-\d{2}/.test(page.datePublished)
          ? page.datePublished.slice(0, 10)
          : null,
      summary,
    });
  }
  return capRefs(refs);
}

/** 同站去重（每站点最多 2 条，按归一化主机名）+ 跨站同标题去重 + 截取前 6 条注入 */
function capRefs(refs: SearchRef[]): SearchRef[] {
  const perSite = new Map<string, number>();
  const seenTitles = new Set<string>();
  const out: SearchRef[] = [];
  for (const ref of refs) {
    if (seenTitles.has(ref.title)) continue;
    if (ref.host) {
      const n = perSite.get(ref.host) ?? 0;
      if (n >= MAX_PER_SITE) continue;
      perSite.set(ref.host, n + 1);
    }
    seenTitles.add(ref.title);
    out.push(ref);
    if (out.length >= MAX_REFS) break;
  }
  return out;
}

/** 检索网络资料；未配置密钥或任何失败时返回空数组 */
export async function webSearch(query: string): Promise<SearchRef[]> {
  const apiKey = process.env.BOCHA_API_KEY?.trim();
  if (!apiKey) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, summary: true, freshness: "noLimit", count: REQUEST_COUNT }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[bocha] 检索返回 ${res.status}，跳过网络资料`);
      return [];
    }
    return toRefs(await res.json());
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn("[bocha] 检索超时，跳过网络资料");
    } else {
      console.warn(`[bocha] 检索失败：${err instanceof Error ? err.message : String(err)}`);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}
