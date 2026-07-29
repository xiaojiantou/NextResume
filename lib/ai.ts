// Copyright (c) 2026 HowBe LLC. All rights reserved.

import OpenAI from "openai";
import type { ResumeStyleSource } from "./types";
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

// Novita hosts vision-capable models on the same OpenAI-compatible endpoint,
// so image uploads can be transcribed with the existing NOVITA_API_KEY — no
// separate vision provider/key needed. Docs: https://novita.ai/docs/guides/llm-vision
// Note: the model id in Novita's own docs (qwen/qwen2.5-vl-72b-instruct) came
// back "model not available" on this account; verified against GET /models
// that qwen3-vl-235b-a22b-instruct is actually servable.
const VISION_MODEL = "qwen/qwen3-vl-235b-a22b-instruct";

export async function transcribeImage({
  base64,
  mimeType,
}: {
  base64: string;
  mimeType: string;
}): Promise<string> {
  const client = openaiCompatClient("novita");
  const res = await client.chat.completions.create({
    model: VISION_MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Transcribe every piece of text visible in this image, verbatim, in reading order. Preserve line breaks between sections and bullet points. Output plain text only — no commentary, no markdown.",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
              detail: "high",
            },
          },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 4000,
  });
  return res.choices[0]?.message?.content?.trim() || "";
}

// The model describes appearance only. It never receives or creates resume
// content and cannot emit HTML/CSS, which prevents a visual decision from
// deleting a section or bullet.
const STYLE_PROFILE_PROMPT = `Study the attached resume page screenshots and describe their visual system as JSON. Do not transcribe or return any resume content.

Return ONLY one JSON object matching this exact shape:
{
  "layout": "single-column" | "sidebar-left" | "sidebar-right",
  "sidebarWidthPercent": number,
  "sidebarSections": ("contact" | "summary" | "skills" | "education" | "additional")[],
  "fontFamily": "Arial" | "Helvetica" | "Verdana" | "Georgia" | "Times New Roman",
  "headingFontFamily": "Arial" | "Helvetica" | "Verdana" | "Georgia" | "Times New Roman",
  "colors": {
    "text": "#rrggbb",
    "muted": "#rrggbb",
    "accent": "#rrggbb",
    "background": "#rrggbb",
    "sidebarBackground": "#rrggbb",
    "sidebarText": "#rrggbb"
  },
  "marginsPt": { "top": number, "right": number, "bottom": number, "left": number },
  "typography": {
    "bodyPt": number,
    "lineHeight": number,
    "namePt": number,
    "titlePt": number,
    "sectionPt": number,
    "metaPt": number
  },
  "spacing": { "sectionPt": number, "entryPt": number, "bulletPt": number },
  "header": {
    "alignment": "left" | "center",
    "divider": boolean,
    "photoPosition": "none" | "left" | "right",
    "photoShape": "circle" | "square" | "rounded",
    "photoSizePt": number
  },
  "sectionHeading": {
    "uppercase": boolean,
    "divider": boolean,
    "filled": boolean,
    "alignment": "left" | "center"
  },
  "bulletMarker": "disc" | "dash" | "square"
}

Choose the closest supported layout. Estimate sizes in print points. Match the source's visual hierarchy, spacing, colors, divider treatment, bullets, sidebar, and photo placement. Never output HTML, CSS, selectors, content, display rules, fixed heights, or overflow rules.`;

export async function generateResumeStyleProfile({
  source,
}: {
  source: ResumeStyleSource;
}): Promise<unknown> {
  const client = openaiCompatClient("novita");
  const res = await client.chat.completions.create({
    model: VISION_MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${STYLE_PROFILE_PROMPT}\n\nMeasured source page: ${source.page.widthPt.toFixed(1)}pt × ${source.page.heightPt.toFixed(1)}pt, ${source.page.orientation}. Screenshots: ${source.screenshots.length} of ${source.pageCount} page(s).`,
          },
          ...source.screenshots.slice(0, 3).map((url) => ({
            type: "image_url" as const,
            image_url: { url, detail: "high" as const },
          })),
        ],
      },
    ],
    temperature: 0.2,
    max_tokens: 2200,
  });

  const raw = res.choices[0]?.message?.content?.trim() || "";
  if (!raw) throw new Error("Empty style profile from vision model");
  return tryParse<unknown>(raw);
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
