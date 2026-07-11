import OpenAI from "openai";
import {
  DEFAULT_MODEL_ID,
  findModel,
  type ModelProvider,
} from "./models";

// Lazy-init: SDK constructors throw without a key, which breaks Next.js
// "collecting page data" at build time on Vercel. Construct on first use.
const clients: Partial<Record<Exclude<ModelProvider, "anthropic">, OpenAI>> = {};

function openaiCompatClient(provider: Exclude<ModelProvider, "anthropic">): OpenAI {
  if (clients[provider]) return clients[provider]!;

  let apiKey: string | undefined;
  let baseURL: string | undefined;

  switch (provider) {
    case "novita":
      apiKey = process.env.NOVITA_API_KEY;
      baseURL =
        process.env.NOVITA_BASE_URL || "https://api.novita.ai/v3/openai";
      if (!apiKey) {
        throw new Error(
          "Missing NOVITA_API_KEY. Set it in .env.local or your host's env vars.",
        );
      }
      break;
    case "openai":
      apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "Missing OPENAI_API_KEY. Set it in .env.local or your host's env vars.",
        );
      }
      break;
    case "gemini":
      // Google's OpenAI-compatible endpoint.
      apiKey = process.env.GEMINI_API_KEY;
      baseURL = "https://generativelanguage.googleapis.com/v1beta/openai/";
      if (!apiKey) {
        throw new Error(
          "Missing GEMINI_API_KEY. Set it in .env.local or your host's env vars.",
        );
      }
      break;
  }

  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  clients[provider] = client;
  return client;
}

export const ENV_MODEL = process.env.NOVITA_MODEL || DEFAULT_MODEL_ID;

function tryParse<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Strip fenced blocks
    const cleaned = raw
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    // If still wrapped in prose, extract the first {...} balanced block.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    return JSON.parse(cleaned) as T;
  }
}

async function openaiCompatJson({
  provider,
  model,
  system,
  user,
  maxTokens,
}: {
  provider: Exclude<ModelProvider, "anthropic">;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}): Promise<string> {
  const client = openaiCompatClient(provider);
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];

  const call = async (useJsonMode: boolean) => {
    const res = await client.chat.completions.create({
      model,
      messages,
      ...(useJsonMode
        ? { response_format: { type: "json_object" as const } }
        : {}),
      temperature: 0.4,
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message?.content?.trim() || "";
  };

  try {
    return await call(true);
  } catch (err: unknown) {
    // Some models reject response_format. Retry without it.
    const status =
      typeof err === "object" && err && "status" in err
        ? (err as { status: number }).status
        : 0;
    if (status === 400 || status === 422) {
      return call(false);
    }
    throw err;
  }
}

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
};

async function anthropicJson({
  model,
  system,
  user,
  maxTokens,
}: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY. Set it in .env.local or your host's env vars.",
    );
  }

  // Anthropic's Messages API has no response_format equivalent, so we lean on
  // the system prompt to enforce JSON. Callers already ask for JSON; we add a
  // belt-and-braces reminder.
  const jsonSystem = `${system}\n\nRespond with ONLY the JSON payload — no prose, no markdown fences.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.4,
      system: jsonSystem,
      messages: [{ role: "user", content: user }],
    }),
  });

  const data = (await res.json()) as AnthropicResponse;
  if (!res.ok) {
    throw new Error(data.error?.message || `Anthropic error (HTTP ${res.status})`);
  }

  const text = data.content?.find((b) => b.type === "text")?.text?.trim() || "";
  return text;
}

export async function jsonCompletion<T>({
  system,
  user,
  model,
  maxTokens = 4000,
}: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}): Promise<T> {
  const chosen = model || ENV_MODEL;
  const info = findModel(chosen);

  const raw =
    info.provider === "anthropic"
      ? await anthropicJson({ model: chosen, system, user, maxTokens })
      : await openaiCompatJson({
          provider: info.provider,
          model: chosen,
          system,
          user,
          maxTokens,
        });

  if (!raw) throw new Error("Empty completion from model");
  return tryParse<T>(raw);
}
