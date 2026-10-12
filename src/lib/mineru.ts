/**
 * MinerU 精准解析 API v4 客户端（服务端专用）。
 * 官方文档：https://mineru.net/apiManage/docs
 * 流程：POST /file-urls/batch 申请批量上传链接 → PUT 二进制（不能带 Content-Type）
 *      → 系统自动解析 → GET /extract-results/batch/{batch_id} 轮询 → 下载 full_zip_url 解压取 full.md。
 * 单文件 ≤200MB/200 页，单次批量 ≤50 个文件，每天 1000 页最高优先级额度。
 */
import { unzipSync, strFromU8 } from "fflate";

const API_BASE = "https://mineru.net/api/v4";
/** vlm 档：表格/公式识别更强，契合讲解中的 formula 块 */
const MODEL_VERSION = "vlm";

export class MinerUError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MinerUError";
  }
}

export function mineruToken(): string | null {
  const token = process.env.MINERU_API_TOKEN?.trim();
  return token ? token : null;
}

async function apiFetch(path: string, init: RequestInit, timeoutMs = 20_000): Promise<Response> {
  const token = mineruToken();
  if (!token) throw new MinerUError("未配置 MINERU_API_TOKEN，无法解析 PDF/Word");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        // PUT 预签名 URL 直传 OSS 不走这里；这里只包 JSON API
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new MinerUError("MinerU 请求超时，请稍后重试");
    }
    throw new MinerUError(`MinerU 请求失败：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** code !== 0 的业务错误统一抛 MinerUError */
async function readJson(res: Response): Promise<{ code: number; msg?: string; data?: unknown }> {
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new MinerUError(`MinerU 服务返回 ${res.status}：${text.slice(0, 200)}`);
  try {
    const data = JSON.parse(text) as { code: number; msg?: string; data?: unknown };
    if (data.code !== 0) throw new MinerUError(`MinerU 业务错误 ${data.code}：${data.msg ?? "未知"}`);
    return data;
  } catch (err) {
    if (err instanceof MinerUError) throw err;
    throw new MinerUError("MinerU 返回的不是合法 JSON");
  }
}

/** 提交结果：submittedName 是批内去重后的名字（结果按它对回），uploaded=false 表示该文件 PUT 失败 */
export interface SubmittedFile {
  originalName: string;
  submittedName: string;
  uploaded: boolean;
}

/** 批量提交本地文件：申请上传链接并逐个 PUT；返回追踪用的批次号与逐文件状态 */
export async function submitBatch(files: { name: string; data: Uint8Array<ArrayBuffer> }[]): Promise<{
  batchId: string;
  files: SubmittedFile[];
}> {
  if (files.length === 0) throw new MinerUError("没有待解析的文件");
  if (files.length > 50) throw new MinerUError("单次最多批量解析 50 个文件");

  // 同批次内文件名去重：结果按 file_name 对回，重名会歧义
  const used = new Set<string>();
  const entries = files.map((file, i) => {
    let name = file.name;
    if (used.has(name)) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      name = `${stem}-${i + 1}${ext}`;
    }
    used.add(name);
    return { originalName: file.name, data: file.data, name };
  });

  const res = await apiFetch("/file-urls/batch", {
    method: "POST",
    body: JSON.stringify({
      files: entries.map((e) => ({ name: e.name, data_id: e.name })),
      model_version: MODEL_VERSION,
    }),
  });
  const json = await readJson(res);
  const { batch_id: batchId, file_urls: urls } = (json.data ?? {}) as {
    batch_id?: string;
    file_urls?: string[];
  };
  if (!batchId || !Array.isArray(urls) || urls.length !== entries.length) {
    throw new MinerUError("MinerU 未返回有效的批次上传链接");
  }

  const submitted = await Promise.all(
    entries.map(async (entry, i): Promise<SubmittedFile> => {
      try {
        // 官方要求：PUT 直传 OSS，不设置 Content-Type，body 为文件二进制
        const put = await fetch(urls[i], {
          method: "PUT",
          body: entry.data,
          signal: AbortSignal.timeout(60_000),
        });
        return { originalName: entry.originalName, submittedName: entry.name, uploaded: put.ok };
      } catch {
        return { originalName: entry.originalName, submittedName: entry.name, uploaded: false };
      }
    })
  );
  if (submitted.every((f) => !f.uploaded)) {
    throw new MinerUError("全部文件上传 MinerU 失败，请检查网络后重试");
  }
  return { batchId, files: submitted };
}

/** 批量结果条目（extract_result[] 逐文件） */
export interface BatchResultItem {
  fileName: string;
  state: string;
  errMsg: string;
  fullZipUrl: string | null;
  extractedPages: number | null;
  totalPages: number | null;
}

/** 轮询批次结果：由调用方决定 done/failed 之外的行保持 parsing */
export async function fetchBatchResults(batchId: string): Promise<BatchResultItem[]> {
  const res = await apiFetch(`/extract-results/batch/${encodeURIComponent(batchId)}`, { method: "GET" });
  const json = await readJson(res);
  const { extract_result } = (json.data ?? {}) as {
    extract_result?: {
      file_name?: string;
      state?: string;
      err_msg?: string;
      full_zip_url?: string;
      extract_progress?: { extracted_pages?: number; total_pages?: number };
    }[];
  };
  if (!Array.isArray(extract_result)) return [];
  return extract_result.map((item) => ({
    fileName: item.file_name ?? "",
    state: item.state ?? "",
    errMsg: item.err_msg ?? "",
    fullZipUrl: typeof item.full_zip_url === "string" && item.full_zip_url ? item.full_zip_url : null,
    extractedPages: item.extract_progress?.extracted_pages ?? null,
    totalPages: item.extract_progress?.total_pages ?? null,
  }));
}

/** 从结果 ZIP 提取 full.md 并清洗（图片指向 zip 内部路径，对我们是死链） */
export function mdFromZipBuffer(buffer: Uint8Array): string {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buffer);
  } catch {
    throw new MinerUError("MinerU 结果 ZIP 解压失败");
  }
  const key =
    Object.keys(entries).find((k) => k === "full.md") ??
    Object.keys(entries).find((k) => k.endsWith("/full.md"));
  if (!key) throw new MinerUError("MinerU 结果 ZIP 中未找到 full.md");
  return cleanMineruMd(strFromU8(entries[key]));
}

export async function fetchFullMd(zipUrl: string): Promise<string> {
  let buffer: ArrayBuffer;
  try {
    const res = await fetch(zipUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buffer = await res.arrayBuffer();
  } catch (err) {
    throw new MinerUError(`下载 MinerU 解析结果失败：${err instanceof Error ? err.message : String(err)}`);
  }
  return mdFromZipBuffer(new Uint8Array(buffer));
}

/** 清洗 MinerU 输出的 md：去死链图片、压多余空行 */
export function cleanMineruMd(md: string): string {
  return md
    .replace(/<img[^>]*>/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
