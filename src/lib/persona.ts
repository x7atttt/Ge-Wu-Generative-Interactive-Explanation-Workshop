/**
 * 讲解/追问的语气人设：预设 + 自定义一句话。
 * 仅影响文字风格（结构要求优先）；状态存 localStorage，随请求发给服务端注入提示词。
 */

export interface Persona {
  id: string;
  label: string;
  /** 注入提示词的风格描述；默认人设为空串（不注入，保持既有行为） */
  hint: string;
}

export const PERSONAS: Persona[] = [
  { id: "default", label: "默认", hint: "" },
  {
    id: "scholar",
    label: "严谨学者",
    hint: "用语准确严谨，术语规范，逻辑链条完整，像教科书一样可靠",
  },
  {
    id: "buddy",
    label: "轻松伙伴",
    hint: "语气轻松亲切，多用生活化的类比和口语表达，鼓励式反馈",
  },
  {
    id: "feynman",
    label: "费曼·讲给小白",
    hint: "假设读者零基础，把每个术语都拆成大白话和类比，像给完全不懂的朋友讲",
  },
  {
    id: "exam",
    label: "备考冲刺",
    hint: "面向应试：突出考点、易错点与答题技巧，表达简洁直接",
  },
];

export const CUSTOM_PERSONA_ID = "custom";

export const PERSONA_STORAGE_KEY = "gewu-persona";

export interface PersonaState {
  id: string;
  custom: string;
}

/** 解析为注入提示词的风格描述；默认人设或未配置时返回 null（不注入） */
export function resolvePersonaHint(state: PersonaState): string | null {
  const trimmed = state.custom.trim();
  if (state.id === CUSTOM_PERSONA_ID) return trimmed ? trimmed.slice(0, 100) : null;
  return PERSONAS.find((p) => p.id === state.id)?.hint || null;
}
