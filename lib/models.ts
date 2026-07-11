// Curated model registry. Routed via provider adapters in lib/ai.ts.
// To add/remove, edit this file — the picker UI reads from here automatically.

export type ModelProvider = "novita" | "openai" | "anthropic" | "gemini";

export type ModelInfo = {
  id: string; // exact provider model id (as accepted by that provider's API)
  name: string; // display name
  tagline: string; // 3-6 word vibe
  provider: ModelProvider;
  badge?: "Default" | "Fast" | "Smart" | "New";
  speed: "fast" | "balanced" | "deep";
};

export const PROVIDER_LABEL: Record<ModelProvider, string> = {
  novita: "Novita",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google",
};

export const MODELS: ModelInfo[] = [
  // --- Novita (default / cheapest tier) --------------------------------
  {
    id: "deepseek/deepseek-v3-0324",
    name: "DeepSeek V3",
    tagline: "Balanced quality + speed",
    provider: "novita",
    badge: "Default",
    speed: "balanced",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B",
    tagline: "Strong reasoning, ownership-voice prose",
    provider: "novita",
    badge: "Smart",
    speed: "deep",
  },
  {
    id: "qwen/qwen-2.5-72b-instruct",
    name: "Qwen 2.5 72B",
    tagline: "Polished, formal phrasing",
    provider: "novita",
    speed: "balanced",
  },
  {
    id: "meta-llama/llama-3.1-8b-instruct",
    name: "Llama 3.1 8B",
    tagline: "Fast drafts, lower cost",
    provider: "novita",
    badge: "Fast",
    speed: "fast",
  },

  // --- OpenAI ----------------------------------------------------------
  {
    id: "gpt-4o",
    name: "GPT-4o",
    tagline: "Flagship OpenAI reasoning",
    provider: "openai",
    badge: "Smart",
    speed: "deep",
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    tagline: "Fast, cheap OpenAI",
    provider: "openai",
    badge: "Fast",
    speed: "fast",
  },

  // --- Anthropic -------------------------------------------------------
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    tagline: "Deep, careful rewrites",
    provider: "anthropic",
    badge: "Smart",
    speed: "deep",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    tagline: "Balanced Anthropic default",
    provider: "anthropic",
    speed: "balanced",
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    tagline: "Snappy, low-latency Claude",
    provider: "anthropic",
    badge: "Fast",
    speed: "fast",
  },

  // --- Google Gemini ---------------------------------------------------
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    tagline: "Google deep reasoning",
    provider: "gemini",
    badge: "Smart",
    speed: "deep",
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    tagline: "Google fast tier",
    provider: "gemini",
    badge: "Fast",
    speed: "fast",
  },
];

export const DEFAULT_MODEL_ID = MODELS[0].id;

export function findModel(id?: string | null): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
