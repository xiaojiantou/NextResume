// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Compiles a single LaTeX source to PDF and returns it. Deliberately tiny and
// dependency-free: this process handles untrusted input, so there is nothing
// here but the standard library.
//
// Compiling user-supplied LaTeX is arbitrary code execution unless it is
// contained. Four things do the containing:
//   1. -no-shell-escape, so \write18 cannot spawn processes.
//   2. openin_any/openout_any=p, so \input cannot read /etc/passwd and
//      nothing can be written outside the scratch directory.
//   3. A wall-clock timeout, because a macro loop is trivial to write.
//   4. A scratch directory per request, removed afterwards.
// The container adds the rest: unprivileged user, and whatever memory and CPU
// caps the platform is deployed with.
const http = require("node:http");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.COMPILE_TOKEN || "";
const TIMEOUT_MS = Number(process.env.COMPILE_TIMEOUT_MS || 20_000);
const MAX_SOURCE_BYTES = Number(process.env.MAX_SOURCE_BYTES || 2 * 1024 * 1024);
const MAX_PDF_BYTES = Number(process.env.MAX_PDF_BYTES || 20 * 1024 * 1024);
// TeX writes its own log; only the engine's stdout is captured, and only
// enough of it to explain a failure.
const MAX_LOG_CHARS = 4000;

const ENGINES = new Set(["pdflatex", "xelatex", "lualatex"]);

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Source too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function runEngine(engine, directory, jobName) {
  return new Promise((resolve) => {
    const child = spawn(
      engine,
      [
        "-no-shell-escape",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-file-line-error",
        `-jobname=${jobName}`,
        // Relative on purpose: openin_any=p forbids absolute paths, so an
        // absolute source path would be blocked by our own sandbox. The
        // scratch directory is the working directory, and output lands there.
        "resume.tex",
      ],
      {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          HOME: directory,
          TEXMFVAR: path.join(directory, "texmf-var"),
          // "p" forbids absolute paths and parent traversal.
          openin_any: "p",
          openout_any: "p",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let output = "";
    const collect = (chunk) => {
      if (output.length < MAX_LOG_CHARS * 4) output += chunk.toString();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, output: `${output}\n${error.message}`, killed: false });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, output, killed: signal === "SIGKILL" });
    });
  });
}

/**
 * The interesting part of a TeX log is the first real error, not the banner.
 * -file-line-error makes those lines greppable.
 */
function errorSummary(output) {
  const lines = output.split(/\r?\n/);
  const errors = lines.filter(
    (line) => /^.+:\d+:/.test(line) || line.startsWith("!"),
  );
  const chosen = errors.length > 0 ? errors : lines.slice(-20);
  return chosen.join("\n").slice(0, MAX_LOG_CHARS);
}

async function compile(source, engine) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "texc-"));
  try {
    await fs.writeFile(path.join(directory, "resume.tex"), source, "utf8");
    let result = await runEngine(engine, directory, "resume");

    // A second pass only when TeX says it needs one — page-count and
    // last-page macros are the usual reason, and resumes rarely go further.
    if (result.code === 0 && /Rerun to get|Rerun LaTeX/i.test(result.output)) {
      result = await runEngine(engine, directory, "resume");
    }

    if (result.killed) {
      return { ok: false, status: 422, error: "Compilation timed out." };
    }

    let pdf;
    try {
      pdf = await fs.readFile(path.join(directory, "resume.pdf"));
    } catch {
      return {
        ok: false,
        status: 422,
        error: "LaTeX could not produce a PDF.",
        log: errorSummary(result.output),
      };
    }
    if (pdf.length === 0 || pdf.length > MAX_PDF_BYTES) {
      return { ok: false, status: 422, error: "Compiled PDF was unusable." };
    }
    return { ok: true, pdf };
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.method !== "POST" || !req.url.startsWith("/compile")) {
    res.writeHead(404).end();
    return;
  }
  if (TOKEN && req.headers["x-compile-token"] !== TOKEN) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized." }));
    return;
  }

  try {
    const body = await readBody(req, MAX_SOURCE_BYTES);
    let payload;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Body must be JSON." }));
      return;
    }
    const source = typeof payload.source === "string" ? payload.source : "";
    const engine = ENGINES.has(payload.engine) ? payload.engine : "pdflatex";
    if (!source.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No LaTeX source provided." }));
      return;
    }

    const result = await compile(source, engine);
    if (!result.ok) {
      res.writeHead(result.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: result.error, log: result.log }));
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": String(result.pdf.length),
    });
    res.end(result.pdf);
  } catch (error) {
    res.writeHead(413, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error.message || "Compile failed." }));
  }
});

server.listen(PORT, () => {
  console.log(`latex-compiler listening on ${PORT}`);
});
