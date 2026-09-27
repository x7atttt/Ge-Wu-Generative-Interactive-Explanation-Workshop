/** asks 表访问：追问问答对（在回答完成后成对写入，失败轮次不入库） */
import { getDb } from "./index";

export type AskRole = "user" | "assistant";

export interface AskRow {
  id: number;
  role: AskRole;
  content: string;
  createdAt: string;
}

export function appendAsks(docId: number, exchanges: { role: AskRole; content: string }[]): void {
  const db = getDb();
  const statement = db.prepare("INSERT INTO asks (doc_id, role, content) VALUES (?, ?, ?)");
  // 问答成对写入：BEGIN/COMMIT 保证不出现悬空的 user 消息
  db.exec("BEGIN");
  try {
    for (const item of exchanges) statement.run(docId, item.role, item.content);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function listAsks(docId: number): AskRow[] {
  return getDb()
    .prepare("SELECT id, role, content, created_at FROM asks WHERE doc_id = ? ORDER BY id ASC")
    .all(docId) as unknown as AskRow[];
}
