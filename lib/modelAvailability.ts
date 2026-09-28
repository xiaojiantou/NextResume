import { FALLBACK_MODEL_ID, findModel } from "./models.ts";

const UNAVAILABLE = new Set(["MODEL_NOT_FOUND", "MODEL_NOT_AVAILABLE"]);

export function isModelUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; code?: string; reason?: string; error?: { code?: string; reason?: string } };
  // Authentication, rate limits and generic endpoint 404s are not retirements.
  if (e.status === 401 || e.status === 403 || e.status === 429) return false;
  return [e.code, e.reason, e.error?.code, e.error?.reason].some(code => !!code && UNAVAILABLE.has(code));
}

export class ModelUnavailableError extends Error {
  constructor(cause: unknown) {
    super("The analysis service is temporarily unavailable. Please try again shortly.", { cause });
    this.name = "ModelUnavailableError";
  }
}

// Novita's {reason, message} errors are otherwise discarded by the SDK,
// producing the misleading "404 status code (no body)" message.
export async function normalizeNovitaError(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body || body.error || typeof body.reason !== "string") return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify({ error: { code: body.reason, message: body.message || body.reason } }), {
    status: response.status, statusText: response.statusText, headers,
  });
}

export async function withModelFallback<T>(
  model: string,
  complete: (id: string) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  try {
    return await complete(model);
  } catch (error) {
    if (!isModelUnavailable(error)) throw error;
    const provider = findModel(model).provider;
    console.error("model_unavailable", { provider, model });
    // Keep data with the selected provider. At most one alternative per call.
    if (provider !== "novita" || model === FALLBACK_MODEL_ID) {
      throw new ModelUnavailableError(error);
    }
    signal?.throwIfAborted();
    console.warn("model_fallback", { provider, model, fallback: FALLBACK_MODEL_ID });
    try {
      return await complete(FALLBACK_MODEL_ID);
    } catch (fallbackError) {
      console.error("model_fallback_failed", { provider, model: FALLBACK_MODEL_ID });
      if (isModelUnavailable(fallbackError)) throw new ModelUnavailableError(fallbackError);
      throw fallbackError;
    }
  }
}
