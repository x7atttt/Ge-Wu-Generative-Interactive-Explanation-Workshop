"use client";

/**
 * 图片上传前的统一压缩：长边 ≤1280、jpeg 0.82（视觉 token 与请求体可控）。
 * PNG 透明图保 PNG（避免黑底）；解码失败抛错由调用方提示。
 */

const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.82;

export async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("图片无法解析，请换一张");
  });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画布初始化失败");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const keepPng = file.type === "image/png" && hasTransparency(ctx, w, h);
  return keepPng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

/** 逐像素抽点检测透明通道（步长 16 控制开销；PNG 不透明时同样转 jpeg 提体积收益） */
function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4 * 16) {
    if (data[i] < 250) return true;
  }
  return false;
}
