import OpenAI from "openai";

export const novita = new OpenAI({
  apiKey: process.env.NOVITA_API_KEY,
  baseURL: process.env.NOVITA_BASE_URL || "https://api.novita.ai/v3/openai",
});

export const MODEL =
  process.env.NOVITA_MODEL || "deepseek/deepseek-v3-0324";

export async function jsonCompletion<T>({
  system,
  user,
  maxTokens = 4000,
}: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<T> {
  const res = await novita.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: maxTokens,
  });

  const raw = res.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error("Empty completion from model");

  try {
    return JSON.parse(raw) as T;
  } catch {
    // Some models wrap JSON in fenced blocks; strip and retry.
    const stripped = raw
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    return JSON.parse(stripped) as T;
  }
}
