/**
 * 迭代24 前置验证：直连配置的 LLM 验证两点——
 * 1) 视觉能力：发一张纯红 64×64 PNG（脚本内自绘，无外部文件），问颜色；
 * 2) jsonMode 与图片输入共存：同图要求输出 {"color":"..."} JSON（生成路径依赖）。
 * 运行：node --env-file=.env.local scripts/vision-smoke.mjs
 * 不打印任何密钥；只打印状态与回答摘要。
 */
import zlib from "node:zlib";

// ---- 最小 PNG 编码器（8-bit RGB 无滤镜）----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function solidPng(w, h, [r, g, b]) {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    raw[off] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3] = r;
      raw[off + 2 + x * 3] = g;
      raw[off + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const base = (process.env.LLM_BASE_URL ?? "").replace(/\/+$/, "");
const key = process.env.LLM_API_KEY ?? "";
const model = process.env.LLM_MODEL ?? "";
if (!base || !key || !model) throw new Error("缺少 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 环境变量");

const png = solidPng(64, 64, [220, 30, 30]);
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
console.log(`模型: ${model}，测试图: 纯红 64×64 PNG（${png.length} 字节）`);

async function call(messages, jsonMode) {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_tokens: 1500,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  const content = JSON.parse(text).choices?.[0]?.message?.content ?? "";
  return { ok: true, detail: content.slice(0, 120) };
}

const imgPart = { type: "image_url", image_url: { url: dataUrl } };

const r1 = await call(
  [{ role: "user", content: [{ type: "text", text: "这张图片是什么纯色？只用一个词回答。" }, imgPart] }],
  false
);
console.log(`① 视觉直答: ${r1.ok ? "PASS?" : "FAIL"} ${r1.detail}`);

const r2 = await call(
  [
    {
      role: "user",
      content: [{ type: "text", text: '这张图片是什么纯色？只输出 JSON：{"color":"颜色名"}' }, imgPart],
    },
  ],
  true
);
console.log(`② jsonMode+图: ${r2.ok ? "PASS?" : "FAIL"} ${r2.detail}`);
