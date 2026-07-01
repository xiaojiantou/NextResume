// Curated model registry. All routed through Novita (OpenAI-compatible).
// To add/remove, edit this file — the picker UI reads from here automatically.

export type ModelInfo = {
  id: string; // exact provider model id
  name: string; // display name
  tagline: string; // 3-5 word vibe
  badge?: "Default" | "Fast" | "Smart";
  speed: "fast" | "balanced" | "deep";
};

export const MODELS: ModelInfo[] = [
  {
    id: "deepseek/deepseek-v3-0324",
    name: "DeepSeek V3",
    tagline: "Balanced quality + speed",
    badge: "Default",
    speed: "balanced",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B",
    tagline: "Strong reasoning, ownership-voice prose",
    badge: "Smart",
    speed: "deep",
  },
  {
    id: "qwen/qwen-2.5-72b-instruct",
    name: "Qwen 2.5 72B",
    tagline: "Polished, formal phrasing",
    speed: "balanced",
  },
  {
    id: "meta-llama/llama-3.1-8b-instruct",
    name: "Llama 3.1 8B",
    tagline: "Fast drafts, lower cost",
    badge: "Fast",
    speed: "fast",
  },
];

export const DEFAULT_MODEL_ID = MODELS[0].id;

export function findModel(id?: string | null): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
