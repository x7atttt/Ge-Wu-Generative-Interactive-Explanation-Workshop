import { registerHooks } from "node:module";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sourceRoot = pathToFileURL(resolve("src") + "/").href;
let promptSource;
export function setPromptSource(url) { promptSource = url; }

// 独立验收直接调用生产 TypeScript 管线，不启动应用、不接触学习数据库。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/llm/prompts" && promptSource) return nextResolve(promptSource, context);
    if (specifier.startsWith("@/")) specifier = new URL(specifier.slice(2) + ".ts", sourceRoot).href;
    else if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith(".") && !extname(specifier)) specifier += ".ts";
    return nextResolve(specifier, context);
  },
});
