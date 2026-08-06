// Copyright (c) 2026 HowBe LLC. All rights reserved.

import OpenAI from "openai";
import type {
  ResumeStyleSource,
  ResumeVisualLayoutGuide,
} from "./types";
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
  signal,
}: {
  provider: Exclude<ModelProvider, "anthropic">;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<string> {
  const client = openaiCompatClient(provider);
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];

  const call = async (useJsonMode: boolean) => {
    const res = await client.chat.completions.create(
      {
        model,
        messages,
        ...(useJsonMode
          ? { response_format: { type: "json_object" as const } }
          : {}),
        temperature: 0.4,
        max_tokens: maxTokens,
      },
      signal ? { signal } : undefined,
    );
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
  signal,
}: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  signal?: AbortSignal;
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
    signal,
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

const STRUCTURE_LAYOUT_PROMPT = `Analyze only the layout and reading order of these resume page screenshots. Do not rewrite, summarize, or omit content. Return JSON:
{
  "pages": [{
    "page": number,
    "layout": "single-column" | "sidebar-left" | "sidebar-right" | "mixed",
    "regions": [{ "name": string, "headings": string[] }]
  }],
  "readingOrder": string[],
  "issues": string[]
}

Rules:
- headings must be copied verbatim from the screenshots.
- readingOrder lists section headings in the semantic order a recruiter should read them, including headings that continue on later pages.
- identify sidebars, headers, main columns, repeated headings, and cross-page continuations.
- classify a page as single-column when its sections follow one vertical stream, even if dates, scores, contact details, tables, or individual rows use left/right alignment.
- use sidebar-left or sidebar-right only when independent content regions persist vertically and contain different section groups; a right-aligned date is not a second column.
- use mixed only when a page genuinely changes between full-width and independent multi-column section regions.
- issues must describe real ambiguity only. Do not comment on visual style.`;

export async function analyzeResumeVisualLayout(
  source: ResumeStyleSource,
): Promise<ResumeVisualLayoutGuide> {
  const client = openaiCompatClient("novita");
  const res = await client.chat.completions.create({
    model: VISION_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: STRUCTURE_LAYOUT_PROMPT },
          ...source.screenshots.slice(0, 4).map((url) => ({
            type: "image_url" as const,
            image_url: { url, detail: "high" as const },
          })),
        ],
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 3000,
  });
  const parsed = tryParse<ResumeVisualLayoutGuide>(
    res.choices[0]?.message?.content?.trim() || "{}",
  );
  const layouts = new Set([
    "single-column",
    "sidebar-left",
    "sidebar-right",
    "mixed",
  ]);
  return {
    pages: (Array.isArray(parsed.pages) ? parsed.pages : []).flatMap(
      (page, index) => {
        if (!page || typeof page !== "object") return [];
        const layout = layouts.has(page.layout) ? page.layout : "mixed";
        return [
          {
            page: Number.isFinite(page.page) ? page.page : index + 1,
            layout,
            regions: (Array.isArray(page.regions) ? page.regions : []).map(
              (region) => ({
                name:
                  typeof region?.name === "string" ? region.name.trim() : "",
                headings: (Array.isArray(region?.headings)
                  ? region.headings
                  : []
                ).filter(
                  (heading): heading is string => typeof heading === "string",
                ),
              }),
            ),
          },
        ];
      },
    ),
    readingOrder: (Array.isArray(parsed.readingOrder)
      ? parsed.readingOrder
      : []
    ).filter((heading): heading is string => typeof heading === "string"),
    issues: (Array.isArray(parsed.issues) ? parsed.issues : []).filter(
      (issue): issue is string => typeof issue === "string",
    ),
  };
}

// The model describes appearance only. It never receives or creates resume
// content and cannot emit HTML/CSS, which prevents a visual decision from
// deleting a section or bullet.
const STYLE_PROFILE_PROMPT = `Study the attached resume page screenshots and describe their visual system as JSON. Do not transcribe or return any resume content.

Return ONLY one JSON object matching this exact shape:
{
  "pageLayouts": [{
    "page": number,
    "layoutBlueprint": {
      "headerPlacement": "full" | "primary" | "none",
      "primaryRegionId": string,
      "gutterPt": number,
      "regions": [{
        "id": string,
        "role": "main" | "sidebar" | "supporting",
        "widthPercent": number,
        "surface": "page" | "sidebar" | "subtle",
        "sections": ("contact" | "photo" | "summary" | "skills" | "experience" | "projects" | "education" | "additional")[]
      }]
    }
  }],
  "layoutBlueprint": {
    "headerPlacement": "full" | "primary" | "none",
    "primaryRegionId": string,
    "gutterPt": number,
    "regions": [{
      "id": string,
      "role": "main" | "sidebar" | "supporting",
      "widthPercent": number,
      "surface": "page" | "sidebar" | "subtle",
      "sections": ("contact" | "photo" | "summary" | "skills" | "experience" | "projects" | "education" | "additional")[]
    }]
  },
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

Create a safe flow-based approximation of the source, not a pixel-perfect copy. Estimate sizes in print points. Match the source's page architecture, visual hierarchy, spacing, colors, divider treatment, bullets, and photo placement.

Important layout rules:
- Return one pageLayouts item for every supplied source screenshot. Analyze each page independently; do not assume later pages share page 1's structure.
- layoutBlueprint at the root must duplicate pageLayouts[0].layoutBlueprint for backwards compatibility.
- Return 1 to 3 regions in left-to-right order. Regions are document flows, never fixed-position boxes.
- Exactly one region has role "main" and its id equals primaryRegionId.
- Region widths total approximately 100. The main region should normally be at least 42% wide.
- Put a page-wide name/title header in headerPlacement "full". Use "primary" when the header belongs only to the main column.
- Each section category may appear in at most one region. Omitted categories are safely returned to the main region by the renderer.
- Use "additional" for awards, certifications, publications, languages, volunteering, coursework, community, and unknown supplemental sections.
- A photo positioned inside a rail belongs to that region's "photo" section. Otherwise express it through header.photoPosition.
- Contact details near the name belong to the header and should be omitted from region sections. Contact details in a persistent rail use "contact".
- Use surface "sidebar" only for a visibly colored/inverted rail; use "subtle" for a lightly differentiated supporting column.
- Prefer one region when the screenshot is effectively a single reading flow. Do not create a column only because a photo or date is aligned to one side.
- Preserve the source's high-level geometry. A sidebar-left source remains sidebar-left on every page where that rail is visible; mixed source pages may return different page layouts.
- Use headerPlacement "none" on continuation pages that do not repeat the candidate name/title header.

Never output HTML, CSS, selectors, content, display rules, fixed heights, or overflow rules.`;

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
    max_tokens: 3200,
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
  signal,
}: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const chosen = model || ENV_MODEL;
  const info = findModel(chosen);

  const raw =
    info.provider === "anthropic"
      ? await anthropicJson({
          model: chosen,
          system,
          user,
          maxTokens,
          signal,
        })
      : await openaiCompatJson({
          provider: info.provider,
          model: chosen,
          system,
          user,
          maxTokens,
          signal,
        });

  if (!raw) throw new Error("Empty completion from model");
  return tryParse<T>(raw);
}
