/**
 * 破坏性测试·API 边界轰炸（迭代 25 破坏性测试沉淀，可复跑回归）。
 * ⚠️ 注意：generate/ask 是 SSE 端点——返回 200 只代表"流已开始"，
 *    携带合法 concept 的用例会触发真实 LLM 调用并落库（跑完检查 docs 并清理）。
 * 判定：4xx = 拒绝（PASS），5xx = 崩溃（BUG），2xx = 视语义判断（标注 REVIEW）。
 */
const BASE = "http://localhost:3000";
const findings = [];
async function hit(label, method, path, body, raw) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      ...(raw
        ? { body: raw, headers: { "Content-Type": "text/plain" } }
        : body !== undefined
          ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }
          : {}),
    });
  } catch (e) {
    findings.push(`BUG ${label}: 请求异常 ${e.message}`);
    return;
  }
  const cls = res.status >= 500 ? "BUG" : res.status < 400 ? "PASS" : "REVIEW";
  // SSE 端点 200 只代表"流开始"：立即断开（F7 机制会让服务端中止，不烧 token 不落库）
  if (res.ok && (res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    await res.body?.cancel().catch(() => {});
    findings.push(`PASS ${label}: HTTP 200（SSE 立即断开）`);
    return;
  }
  if (cls === "BUG" || cls === "REVIEW") {
    const text = (await res.text()).slice(0, 120);
    findings.push(`${cls} ${label}: HTTP ${res.status} ${text}`);
  } else {
    findings.push(`PASS ${label}: HTTP ${res.status}`);
  }
}

// --- cards ---
await hit("cards 非数字 spaceId", "GET", "/api/cards?spaceId=abc");
await hit("cards 注入 spaceId", "GET", "/api/cards?spaceId=1%20OR%201%3D1");
await hit("cards 负 spaceId", "GET", "/api/cards?spaceId=-5");
await hit("cards all 非法", "GET", "/api/cards?spaceId=4&all=yes");
await hit("exam count 100 边界", "GET", "/api/cards/exam?spaceId=4&count=100");
await hit("exam count 101", "GET", "/api/cards/exam?spaceId=4&count=101");
await hit("exam spaceId 溢出数字", "GET", "/api/cards/exam?spaceId=99999999999999999999");
await hit("review 非法 grade", "POST", "/api/cards/1/review", { grade: "super" });
await hit("review grade 数组", "POST", "/api/cards/1/review", { grade: ["again"] });
await hit("review id 0", "POST", "/api/cards/0/review", { grade: "easy" });
await hit("review id 负", "POST", "/api/cards/-1/review", { grade: "easy" });
await hit("PATCH card 空体", "PATCH", "/api/cards/1", {});
await hit("PATCH card concept 数组", "PATCH", "/api/cards/1", { concept: ["x"] });
await hit("POST card front 3000字", "POST", "/api/cards", { spaceId: 4, front: "a".repeat(3000), back: "b" });
await hit("POST card body 是数组", "POST", "/api/cards", [1, 2]);
await hit("POST card NaN spaceId", "POST", "/api/cards", { spaceId: NaN, front: "a", back: "b" });

// --- spaces ---
await hit("spaces PATCH 不存在", "PATCH", "/api/spaces/99999", { note: "x" });
await hit("spaces PATCH name 超长", "PATCH", "/api/spaces/4", { name: "x".repeat(500) });
await hit("spaces PATCH 非法日期", "PATCH", "/api/spaces/4", { examDate: "2026-02-30" });
await hit("spaces PATCH 日期带时间", "PATCH", "/api/spaces/4", { examDate: "2026-12-01T00:00:00" });
await hit("spaces DELETE 不存在", "DELETE", "/api/spaces/99999");
await hit("space map id 0", "GET", "/api/spaces/0/map");
await hit("roadmap 不存在空间", "POST", "/api/spaces/99999/roadmap");

// --- docs / stats ---
await hit("doc id 非数字", "GET", "/api/docs/abc");
await hit("doc id 负", "GET", "/api/docs/-3");
await hit("doc DELETE 不存在", "DELETE", "/api/docs/99999");
await hit("stats 非法 spaceId", "GET", "/api/stats?spaceId=drop%20table");

// --- generate / ask 校验层 ---
// 注意：generate 用例一律带 webSearch:false——既省搜索配额，也避免把"流已开始"误判为校验通过
await hit("generate body 是字符串", "POST", "/api/generate", undefined, "{bad json");
await hit("generate concept 数组", "POST", "/api/generate", { concept: ["x"], webSearch: false });
await hit("generate sourceIds 混入字符串", "POST", "/api/generate", { concept: "边界测试概念勿生成", webSearch: false, sourceIds: ["a", 9, null, true] });
await hit("generate images 非数组", "POST", "/api/generate", { concept: "边界测试概念勿生成", webSearch: false, images: "data:image/png;base64,AAAA" });
await hit("generate images 混入非法项", "POST", "/api/generate", { concept: "边界测试概念勿生成", webSearch: false, images: ["javascript:alert(1)", 42] });
await hit("generate images 单张 2.6MB", "POST", "/api/generate", { concept: "边界测试概念勿生成", webSearch: false, images: ["data:image/png;base64," + "A".repeat(2_600_000)] });
await hit("ask docId 字符串", "POST", "/api/ask", { docId: "49", question: "x" });
await hit("ask 问题 301 字", "POST", "/api/ask", { docId: 49, question: "x".repeat(301) });
await hit("ask images 空 png 内容 2.4MB", "POST", "/api/ask", { docId: 49, question: "x", images: ["data:image/png;base64," + "A".repeat(2_400_000), "data:image/png;base64," + "A".repeat(2_400_000)] });

console.log(findings.join("\n"));
const bugs = findings.filter((f) => f.startsWith("BUG")).length;
const review = findings.filter((f) => f.startsWith("REVIEW")).length;
console.log(`\nPASS ${findings.length - bugs - review} | REVIEW ${review} | BUG ${bugs}`);
