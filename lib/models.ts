// Copyright (c) 2026 HowBe LLC. All rights reserved.

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
  // --- Novita ---------------------------------------------------------
  {
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
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

// Verified on Novita: V4.1 otherwise spends small JSON-output budgets entirely
// on reasoning, leaving message.content empty even after a larger retry.
export function structuredOutputOptions(provider: ModelProvider, model: string) {
  return provider === "novita" && model === "deepseek/deepseek-v4.1-flash"
    ? { thinking: { type: "disabled" as const } }
    : {};
}
// Explicitly vetted alternative; never select replacements from the catalog.
export const FALLBACK_MODEL_ID = "meta-llama/llama-3.3-70b-instruct";

// Novita returns MODEL_NOT_FOUND for V3.2 (verified 2026-09-28).
// Migrate stale environment overrides as well as saved browser selections,
// while preserving intentional custom model IDs configured by operators.
export function resolveConfiguredModel(id?: string): string {
  return !id || id === "deepseek/deepseek-v3.2"
    ? DEFAULT_MODEL_ID
    : id;
}

export function findModel(id?: string | null): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export function resolveModelSelection(requested?: string, configured?: string): string {
  if (requested === "deepseek/deepseek-v3.2") return DEFAULT_MODEL_ID;
  return requested && MODELS.some((m) => m.id === requested)
    ? requested
    : resolveConfiguredModel(configured);
}
