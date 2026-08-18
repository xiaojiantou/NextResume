// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Client for the LaTeX compile service in services/latex-compiler.
//
// It runs as its own container because a TeX distribution cannot fit in a
// serverless function, and because compiling user-supplied LaTeX is arbitrary
// code execution that belongs behind a hard isolation boundary rather than
// inside the app process.
import "server-only";

export type CompileFailure = {
  ok: false;
  status: number;
  error: string;
  log?: string;
};

export type CompileSuccess = {
  ok: true;
  pdf: Buffer;
};

export function isLatexCompilerConfigured(): boolean {
  return Boolean(process.env.LATEX_COMPILER_URL);
}

export async function compileLatex(
  source: string,
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Promise<CompileSuccess | CompileFailure> {
  const base = process.env.LATEX_COMPILER_URL;
  if (!base) {
    return {
      ok: false,
      status: 501,
      error: "PDF compilation is not enabled for this deployment.",
    };
  }

  // The service enforces its own wall-clock limit; this one exists so a
  // hung network call cannot hold the request open until the platform kills
  // it with no explanation for the user.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/compile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.LATEX_COMPILER_TOKEN
          ? { "X-Compile-Token": process.env.LATEX_COMPILER_TOKEN }
          : {}),
      },
      body: JSON.stringify({ source }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        log?: string;
      };
      return {
        ok: false,
        // A LaTeX error is the user's document, not a server fault, so it is
        // surfaced as 422 rather than dressed up as a 500.
        status: res.status === 422 ? 422 : 502,
        error: data.error || `Compile service returned ${res.status}.`,
        log: data.log,
      };
    }

    return { ok: true, pdf: Buffer.from(await res.arrayBuffer()) };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: aborted ? 504 : 502,
      error: aborted
        ? "Compiling took too long. Download the .tex and build it in Overleaf."
        : "Could not reach the compile service.",
    };
  } finally {
    clearTimeout(timer);
  }
}
