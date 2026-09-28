/**
 * Markdown 渲染前预处理：数学定界符归一 + 未知伪标签防御。
 * 全部只处理已闭合结构，流式安全（半截定界符原样显示，闭合即转）。
 */

/** 掩码占位符：\u0000 转义字符不会出现在正常文本中 */
const PLACEHOLDER_RE = /\u0000([MP])(\d+)\u0000/g;

function createMask() {
  const spans: string[] = [];
  return {
    mask(value: string): string {
      spans.push(value);
      return `\u0000M${spans.length - 1}\u0000`;
    },
    unmask(content: string): string {
      return content.replace(PLACEHOLDER_RE, (_match, _kind: string, index: string) => {
        return spans[Number(index)] ?? "";
      });
    },
  };
}

// ---------- 数学定界符 ----------

/** 块级 $$…$$ 与 \[…\]（闭合对）→ ```math 围栏块 */
const BLOCK_DOLLAR_RE = /\$\$([\s\S]*?)\$\$/g;
const BLOCK_SQUARE_RE = /\\\[([\s\S]*?)\\\]/g;
/** 行内 \(…\)（闭合对） */
const INLINE_PAREN_RE = /\\\(([\s\S]*?)\\\)/g;
/** 保守行内 $…$：开后非空白非 $、内容无换行、闭前非空白（避开货币金额） */
const INLINE_DOLLAR_RE = /\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<!\s)\$/g;

/** 单向探测：任一数学定界符出现即 true（流式追加不会使其消失，杜绝渲染器间闪烁） */
const INLINE_DOLLAR_TEST_RE = /\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<!\s)\$/;

export function hasMath(content: string): boolean {
  return content.includes("\\(") || content.includes("\\[") || content.includes("$$") || INLINE_DOLLAR_TEST_RE.test(content);
}

function stripBackticks(value: string): string {
  return value.replace(/`/g, "'");
}

export function preprocessMath(content: string): string {
  const { mask, unmask } = createMask();
  // 块级先转并掩码，防止后续行内规则误伤表达式内部的 $
  let result = content
    .replace(BLOCK_DOLLAR_RE, (_m, expr: string) => mask(`\n\`\`\`math\n${expr}\n\`\`\`\n`))
    .replace(BLOCK_SQUARE_RE, (_m, expr: string) => mask(`\n\`\`\`math\n${expr}\n\`\`\`\n`));
  result = result
    .replace(INLINE_PAREN_RE, (_m, expr: string) => ` \`math:${stripBackticks(expr.trim())}\` `)
    .replace(INLINE_DOLLAR_RE, (_m, expr: string) => ` \`math:${stripBackticks(expr)}\` `);
  return unmask(result);
}

// ---------- 未知伪标签防御 ----------

/** 行内码与围栏码先掩码保护，内部 <tag> 不处理 */
const BACKTICK_SPAN_RE = /```[\s\S]*?```|`[^`\n]*`/g;
/** <tag> 形态 token（含属性与自闭合） */
const TAG_RE = /<\/?([A-Za-z][A-Za-z0-9_-]*)\b[^<>]*?\/?>/g;
/** 允许保持原样的常见行内标签；其余（如模型输出的 <think>）包成行内码展示 */
const ALLOWED_TAGS = new Set(["b", "i", "em", "strong", "code", "br"]);

export function escapeUnknownTags(content: string): string {
  if (!content.includes("<")) return content;
  const { mask, unmask } = createMask();
  const masked = content.replace(BACKTICK_SPAN_RE, (match) => mask(match));
  const escaped = masked.replace(TAG_RE, (match, name: string) => {
    return ALLOWED_TAGS.has(name.toLowerCase()) ? match : `\`${match}\``;
  });
  return unmask(escaped);
}

/** MarkdownView 的统一入口 */
export function preprocessMarkdown(content: string): string {
  const escaped = escapeUnknownTags(content);
  return hasMath(escaped) ? preprocessMath(escaped) : escaped;
}
