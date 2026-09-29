import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const service = readFileSync(new URL("../services/latex-compiler/server.js", import.meta.url), "utf8");

function harness(results, elapsed) {
  const budgets = [];
  let now = 0;
  let removed = false;
  const context = vm.createContext({
    process: { env: {} },
    console: { log() {} },
    Buffer,
    Date: { now: () => now },
    require(name) {
      if (name === "node:http") return { createServer: () => ({ listen() {} }) };
      if (name === "node:fs/promises") return {
        mkdtemp: async () => "/tmp/mock-tex",
        writeFile: async () => {},
        readFile: async () => Buffer.from("%PDF-mock"),
        rm: async () => { removed = true; },
      };
      return require(name);
    },
    mockEngine: async (_engine, _directory, _job, budget) => {
      budgets.push(budget);
      now += elapsed.shift() ?? 0;
      return results.shift();
    },
  });
  vm.runInContext(service + "\nrunEngine = mockEngine; globalThis.compileUnderTest = compile;", context);
  return { compile: () => context.compileUnderTest("source", "pdflatex"), budgets, cleaned: () => removed };
}

test("second TeX pass shares the total timeout budget", async () => {
  const h = harness([
    { code: 0, killed: false, output: "Rerun LaTeX" },
    { code: 0, killed: false, output: "Output written on resume.pdf (2 pages, 200 bytes)." },
  ], [25_000, 1_000]);
  const result = await h.compile();
  assert.equal(result.ok, true);
  assert.equal(result.pages, 2);
  assert.deepEqual(h.budgets, [40_000, 15_000]);
  assert.equal(h.cleaned(), true);
});

test("timeout returns 504 with diagnostics and cleans scratch files", async () => {
  const h = harness([{ code: null, killed: true, output: "loading fonts\nfont setup still running" }], [40_000]);
  const result = await h.compile();
  assert.equal(result.ok, false);
  assert.equal(result.status, 504);
  assert.match(result.log, /font setup/);
  assert.equal(h.cleaned(), true);
});

test("exhausted budget cannot start another TeX pass", async () => {
  const h = harness([{ code: 0, killed: false, output: "Rerun LaTeX" }], [40_000]);
  const result = await h.compile();
  assert.equal(result.status, 504);
  assert.deepEqual(h.budgets, [40_000]);
});
