/** SSE 阶段由服务端确认，输出停顿不代表已进入校验。 */
export type GenerationStage = "prepare" | "build" | "verify" | "repair";
