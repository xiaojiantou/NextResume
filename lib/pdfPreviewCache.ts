// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import type { PdfStyle, TargetPages } from "./pdf/config";
import type { ResumeFitVariant } from "./resumeFit";
import type {
  Optimization,
  Resume,
  ResumePageSpec,
  ResumeStyleProfile,
} from "./types";

const STORAGE_PREFIX = "nextresume-pdf-preview-v1:";
const INDEX_KEY = `${STORAGE_PREFIX}index`;
const MAX_SESSION_RECORDS = 4;
const MAX_SESSION_BYTES = 4 * 1024 * 1024;

export type PdfPreviewCacheEntry = {
  key: string;
  signature: string;
};

export type PdfPreviewCacheHit = {
  blob: Blob;
  approximateLayout: boolean;
};

type StoredPreview = {
  signature: string;
  dataUrl: string;
  approximateLayout: boolean;
  savedAt: string;
};

type MemoryPreview = PdfPreviewCacheHit & {
  signature: string;
  savedAt: number;
};

const memoryCache = new Map<string, MemoryPreview>();

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function smallHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

function readIndex(store: Storage): string[] {
  try {
    const parsed = JSON.parse(store.getItem(INDEX_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}

function writeIndex(store: Storage, keys: string[]) {
  try {
    store.setItem(INDEX_KEY, JSON.stringify(keys));
  } catch {
    /* best-effort cache */
  }
}

function rememberStoredKey(store: Storage, key: string) {
  const keys = [key, ...readIndex(store).filter((candidate) => candidate !== key)];
  const kept = keys.slice(0, MAX_SESSION_RECORDS);
  for (const stale of keys.slice(MAX_SESSION_RECORDS)) {
    try {
      store.removeItem(stale);
    } catch {
      /* best-effort cache */
    }
  }
  writeIndex(store, kept);
}

function pruneMemoryCache(limit = 8) {
  if (memoryCache.size <= limit) return;
  const kept = [...memoryCache.entries()]
    .sort(([, left], [, right]) => right.savedAt - left.savedAt)
    .slice(0, limit);
  memoryCache.clear();
  for (const [key, record] of kept) memoryCache.set(key, record);
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof FileReader === "undefined") {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : null);
    };
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  if (!dataUrl.startsWith("data:application/pdf")) return null;
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0 || typeof atob === "undefined") return null;
  try {
    const header = dataUrl.slice(0, commaIndex);
    const mime = /data:([^;]+)/.exec(header)?.[1] ?? "application/pdf";
    const binary = atob(dataUrl.slice(commaIndex + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

export function createPdfPreviewCacheEntry({
  resume,
  optimization,
  style,
  palette,
  targetPages,
  pageSize,
  personalizedStyleProfile,
  fitVariant,
  sourceRevision,
  includeSummary,
}: {
  resume: Resume;
  optimization: Optimization | null;
  style: PdfStyle;
  palette: string;
  targetPages: TargetPages;
  pageSize: ResumePageSpec;
  personalizedStyleProfile: ResumeStyleProfile | null;
  fitVariant?: ResumeFitVariant | null;
  sourceRevision?: string | null;
  includeSummary?: boolean;
}): PdfPreviewCacheEntry {
  const signature = JSON.stringify(
    stableValue({
      resume,
      optimization,
      style,
      palette,
      targetPages,
      pageSize,
      personalizedStyleProfile:
        style === "personalized" ? personalizedStyleProfile : null,
      fitVariant: fitVariant
        ? {
            id: fitVariant.id,
            cacheKey: fitVariant.cacheKey,
            createdAt: fitVariant.createdAt,
            lastUsedAt: fitVariant.lastUsedAt,
            actualPages: fitVariant.actualPages,
            targetPages: fitVariant.targetPages,
          }
        : null,
      sourceRevision: sourceRevision ?? null,
      includeSummary: Boolean(includeSummary),
    }),
  );
  return {
    key: `${STORAGE_PREFIX}${smallHash(signature)}`,
    signature,
  };
}

export async function loadPdfPreviewCache(
  entry: PdfPreviewCacheEntry,
): Promise<PdfPreviewCacheHit | null> {
  const memoryRecord = memoryCache.get(entry.key);
  if (memoryRecord?.signature === entry.signature) {
    memoryRecord.savedAt = Date.now();
    return {
      blob: memoryRecord.blob,
      approximateLayout: memoryRecord.approximateLayout,
    };
  }

  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(entry.key);
    if (!raw) return null;
    const record = JSON.parse(raw) as StoredPreview;
    if (record.signature !== entry.signature) return null;
    if (typeof record.dataUrl !== "string") return null;
    const blob = dataUrlToBlob(record.dataUrl);
    if (!blob) return null;
    const hit = {
      blob,
      approximateLayout: Boolean(record.approximateLayout),
    };
    memoryCache.set(entry.key, {
      ...hit,
      signature: entry.signature,
      savedAt: Date.now(),
    });
    pruneMemoryCache();
    rememberStoredKey(store, entry.key);
    return hit;
  } catch {
    try {
      store.removeItem(entry.key);
    } catch {
      /* best-effort cache */
    }
    return null;
  }
}

export async function savePdfPreviewCache(
  entry: PdfPreviewCacheEntry,
  blob: Blob,
  approximateLayout: boolean,
): Promise<void> {
  memoryCache.set(entry.key, {
    blob,
    approximateLayout,
    signature: entry.signature,
    savedAt: Date.now(),
  });
  pruneMemoryCache();

  if (blob.size > MAX_SESSION_BYTES) return;
  const store = storage();
  if (!store) return;
  const dataUrl = await blobToDataUrl(blob);
  if (!dataUrl) return;
  const record: StoredPreview = {
    signature: entry.signature,
    dataUrl,
    approximateLayout,
    savedAt: new Date().toISOString(),
  };
  try {
    store.setItem(entry.key, JSON.stringify(record));
    rememberStoredKey(store, entry.key);
  } catch {
    for (const stale of readIndex(store).slice(1)) {
      try {
        store.removeItem(stale);
      } catch {
        /* best-effort cache */
      }
    }
    try {
      store.setItem(entry.key, JSON.stringify(record));
      rememberStoredKey(store, entry.key);
    } catch {
      /* best-effort cache */
    }
  }
}
