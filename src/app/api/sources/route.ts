import { NextResponse } from "next/server";
import {
  completeSource,
  failSource,
  getSource,
  insertSource,
  listSourceSummaries,
  listSources,
  setSourceProgress,
  type SourceKind,
} from "@/lib/db/sources";
import { fetchBatchResults, fetchFullMd, mineruToken, submitBatch } from "@/lib/mineru";

/** 单文件上限（MinerU 允许 200MB，这里收紧避免占住服务） */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const TEXT_KINDS = new Set<SourceKind>(["txt", "md"]);
const MINERU_KINDS = new Set<SourceKind>(["pdf", "doc", "docx"]);
const ACCEPT = new Set<string>([...TEXT_KINDS, ...MINERU_KINDS]);

function kindFromName(name: string): SourceKind | null {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return ACCEPT.has(ext as SourceKind) ? (ext as SourceKind) : null;
}

function titleFromName(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return (stem || name).slice(0, 120);
}

/** txt/md 解码：UTF-8 优先，替换符过多时回落 GBK（中文 txt 常见编码） */
function decodeText(buffer: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  const bad = (utf8.match(/\uFFFD/g) ?? []).length;
  if (bad > 0 && bad > utf8.length * 0.001) {
    try {
      return new TextDecoder("gbk").decode(buffer);
    } catch {
      // Node 未带 GBK 解码器时维持 UTF-8 结果
    }
  }
  return utf8;
}

/** 解析中的行按批次向 MinerU 懒同步（前端轮询本接口驱动，无需后台任务） */
async function syncParsingRows(): Promise<void> {
  const parsing = listSources().filter((row) => row.status === "parsing" && row.batchId);
  const batches = new Map<string, typeof parsing>();
  for (const row of parsing) {
    const rows = batches.get(row.batchId) ?? [];
    rows.push(row);
    batches.set(row.batchId, rows);
  }
  for (const [batchId, rows] of batches) {
    let results;
    try {
      results = await fetchBatchResults(batchId);
    } catch {
      continue; // 网络抖动等：本轮跳过，下轮轮询再试
    }
    for (const row of rows) {
      const item = results.find((r) => r.fileName === row.fileName);
      if (!item) continue;
      if (item.state === "done" && item.fullZipUrl) {
        try {
          completeSource(row.id, await fetchFullMd(item.fullZipUrl));
        } catch {
          // 下载/解压失败：保持 parsing，下轮重试（completeSource 幂等防重复）
        }
      } else if (item.state === "failed" || (item.state === "done" && !item.fullZipUrl)) {
        failSource(row.id, item.errMsg || "MinerU 解析失败");
      } else if (item.extractedPages !== null && item.totalPages) {
        setSourceProgress(row.id, `${Math.min(item.extractedPages, item.totalPages)}/${item.totalPages} 页`);
      }
      // waiting-file / pending / running 等中间态：保持 parsing
    }
  }
}

export async function GET() {
  try {
    await syncParsingRows();
  } catch (err) {
    console.error("[api/sources] sync", err);
  }
  return NextResponse.json({ sources: listSourceSummaries() });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求体必须是 multipart 文件表单" }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "没有收到文件" }, { status: 400 });
  }
  if (files.length > 50) {
    return NextResponse.json({ error: "单次最多导入 50 个文件" }, { status: 400 });
  }

  const created: number[] = [];
  const mineruFiles: { name: string; data: Uint8Array<ArrayBuffer> }[] = [];
  const mineruNames: string[] = [];

  for (const file of files) {
    const kind = kindFromName(file.name);
    if (!kind) {
      return NextResponse.json(
        { error: `不支持的文件类型：${file.name}（支持 txt / md / pdf / doc / docx）` },
        { status: 400 }
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `文件超过 50MB：${file.name}` }, { status: 400 });
    }
    const data = new Uint8Array(await file.arrayBuffer());
    if (TEXT_KINDS.has(kind)) {
      created.push(
        insertSource({ title: titleFromName(file.name), kind, status: "ready", mdContent: decodeText(data).trim() })
      );
    } else {
      mineruFiles.push({ name: file.name, data });
      mineruNames.push(file.name);
    }
  }

  // PDF/Word 走 MinerU；token 缺失或提交失败时逐文件落 error 行（txt/md 已成功的保留）
  if (mineruFiles.length > 0) {
    if (!mineruToken()) {
      return NextResponse.json(
        { error: "PDF/Word 解析需要在 .env.local 配置 MINERU_API_TOKEN 后重启服务" },
        { status: 400 }
      );
    }
    const failRows = (message: string) => {
      for (const name of mineruNames) {
        created.push(
          insertSource({ title: titleFromName(name), kind: kindFromName(name)!, status: "error", error: message })
        );
      }
    };
    try {
      const { batchId, files: submitted } = await submitBatch(mineruFiles);
      for (const f of submitted) {
        created.push(
          insertSource({
            title: titleFromName(f.originalName),
            kind: kindFromName(f.originalName)!,
            status: f.uploaded ? "parsing" : "error",
            error: f.uploaded ? "" : "文件上传 MinerU 失败，请重试",
            batchId,
            // 结果按批内提交名（可能去重改名过）对回
            fileName: f.submittedName,
          })
        );
      }
    } catch (err) {
      console.error("[api/sources] mineru", err);
      failRows(err instanceof Error ? err.message : "提交 MinerU 解析失败");
    }
  }

  return NextResponse.json({
    sources: created.map((id) => getSource(id)).filter((row): row is NonNullable<typeof row> => !!row),
  });
}
