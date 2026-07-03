import OpenAI from "openai";
import { DEFAULT_MODEL_ID } from "./models";

// Lazy-init: the OpenAI SDK throws in its constructor if no key is set, which
// breaks Next.js "collecting page data" step at build time on Vercel.
// Instead we construct the client on first use, when env vars ARE available.
let _novita: OpenAI | null = null;
function getNovita(): OpenAI {
  if (_novita) return _novita;
  const apiKey = process.env.NOVITA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing NOVITA_API_KEY. Set it in .env.local or Vercel env vars.",
    );
  }
  _novita = new OpenAI({
    apiKey,
    baseURL: process.env.NOVITA_BASE_URL || "https://api.novita.ai/v3/openai",
  });
  return _novita;
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
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];

  const client = getNovita();
  const call = async (useJsonMode: boolean) => {
    const res = await client.chat.completions.create({
      model: chosen,
      messages,
      ...(useJsonMode
        ? { response_format: { type: "json_object" as const } }
        : {}),
      temperature: 0.4,
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message?.content?.trim() || "";
  };

  let raw: string;
  try {
    raw = await call(true);
  } catch (err: unknown) {
    // Some Novita models reject response_format. Retry without it.
    const status =
      typeof err === "object" && err && "status" in err
        ? (err as { status: number }).status
        : 0;
    if (status === 400 || status === 422) {
      raw = await call(false);
    } else {
      throw err;
    }
  }

  if (!raw) throw new Error("Empty completion from model");
  return tryParse<T>(raw);
}
