// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Adds the HowBe LLC copyright header to source files.
//
// Two modes:
//   1. Hook mode (default): reads a Claude Code PostToolUse JSON payload from
//      stdin, extracts tool_input.file_path, and prepends the header if missing.
//      Wired up in .claude/settings.json.
//   2. Scan mode: `node scripts/add-copyright.js --scan` walks the repo and
//      fixes every source file missing the header. Run manually or in CI.

const fs = require("fs");
const path = require("path");

const HEADER_TEXT = "Copyright (c) 2026 HowBe LLC. All rights reserved.";
const MARKER = "HowBe LLC";
const SOURCE_DIRS = ["app", "components", "lib", "scripts"];
const ROOT_FILES = [
  "middleware.ts",
  "next.config.js",
  "postcss.config.js",
  "tailwind.config.ts",
  "deploy.sh",
];
const SKIP_BASENAMES = new Set(["next-env.d.ts"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

function headerFor(ext) {
  if (ext === ".css") return `/* ${HEADER_TEXT} */\n\n`;
  if (ext === ".sh") return `# ${HEADER_TEXT}\n`;
  return `// ${HEADER_TEXT}\n\n`; // .ts / .tsx / .js / .jsx
}

function addHeader(filePath) {
  const ext = path.extname(filePath);
  if (![".ts", ".tsx", ".js", ".jsx", ".css", ".sh"].includes(ext)) return false;
  if (SKIP_BASENAMES.has(path.basename(filePath))) return false;
  if (!fs.existsSync(filePath)) return false;

  const content = fs.readFileSync(filePath, "utf8");
  const firstLines = content.split("\n", 3).join("\n");
  if (firstLines.includes(MARKER)) return false;

  let updated;
  if (ext === ".sh" && content.startsWith("#!")) {
    const nl = content.indexOf("\n");
    updated = content.slice(0, nl + 1) + headerFor(ext) + content.slice(nl + 1);
  } else {
    updated = headerFor(ext) + content;
  }
  fs.writeFileSync(filePath, updated);
  return true;
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
}

if (process.argv.includes("--scan")) {
  const root = path.resolve(__dirname, "..");
  const files = [];
  for (const d of SOURCE_DIRS) {
    const abs = path.join(root, d);
    if (fs.existsSync(abs)) walk(abs, files);
  }
  for (const f of ROOT_FILES) files.push(path.join(root, f));
  const fixed = files.filter(addHeader);
  console.log(
    fixed.length
      ? `Added copyright header to ${fixed.length} file(s):\n  ${fixed.join("\n  ")}`
      : "All source files already have the copyright header."
  );
} else {
  // Hook mode: parse the PostToolUse payload from stdin.
  let input = "";
  process.stdin.on("data", (c) => (input += c));
  process.stdin.on("end", () => {
    try {
      const payload = JSON.parse(input);
      const filePath = payload?.tool_input?.file_path;
      if (filePath) addHeader(filePath);
    } catch {
      // Never fail the hook — a bad payload just means nothing to do.
    }
    process.exit(0);
  });
}
