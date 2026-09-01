// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

// Keeps the uploaded .docx / .tex alive across a full page load.
//
// Paying by card leaves the app entirely — Stripe is a top-level navigation,
// not a route change — so anything held only in memory is gone by the time
// the buyer lands back on /result. That is exactly the file the
// format-preserving export needs, which made "Download Word" / "Download .tex"
// unreachable for every card payment.
//
// IndexedDB rather than localStorage because a resume base64s to well past
// the 5MB localStorage quota, and rather than the server because the upload
// page promises the document is processed in-memory and never stored: keeping
// it on the user's own device is the only version of durable that keeps that
// promise.

export type StoredSourceDocument = {
  kind: "docx" | "tex";
  base64: string;
};

type StoredRecord = StoredSourceDocument & {
  /** Guards against handing back a file from a previous, unrelated upload. */
  fingerprint: string;
  savedAt: string;
};

const DATABASE = "nextresume";
const STORE = "source-documents";
// One upload is live at a time, so the record is simply overwritten.
const KEY = "current";

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    // Private-browsing modes and older embedded webviews expose no usable
    // IndexedDB. Losing durability there is survivable; throwing is not.
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  const database = await openDatabase();
  if (!database) return null;
  try {
    return await new Promise<T | null>((resolve) => {
      const transaction = database.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    database.close();
  }
}

/** Best-effort: a storage failure must never break an upload. */
export async function saveSourceDocument(
  fingerprint: string,
  document: StoredSourceDocument,
): Promise<void> {
  const record: StoredRecord = {
    ...document,
    fingerprint,
    savedAt: new Date().toISOString(),
  };
  await withStore("readwrite", (store) => store.put(record, KEY));
}

/**
 * Returns the stored file only when it belongs to the resume currently in the
 * flow. A stale record — the user uploaded something else in another tab — is
 * discarded rather than exported over the wrong resume.
 */
export async function loadSourceDocument(
  fingerprint: string,
): Promise<StoredSourceDocument | null> {
  const record = await withStore<StoredRecord>("readonly", (store) =>
    store.get(KEY),
  );
  if (!record || record.fingerprint !== fingerprint) return null;
  if (record.kind !== "docx" && record.kind !== "tex") return null;
  if (typeof record.base64 !== "string" || !record.base64) return null;
  return { kind: record.kind, base64: record.base64 };
}

export async function deleteSourceDocument(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(KEY));
}
