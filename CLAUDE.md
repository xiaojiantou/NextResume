# NextResume

Next.js 15 (App Router) resume optimization app. TypeScript + Tailwind, Clerk auth, Vercel Postgres, OpenAI.

## Copyright headers (required)

Every new source file (`.ts` / `.tsx` / `.js` / `.jsx` / `.css` / `.sh`) must start with:

```
// Copyright (c) 2026 HowBe LLC. All rights reserved.
```

Use the matching comment syntax per file type: `//` for TS/JS, `/* ... */` for CSS, `#` for shell scripts (placed after the shebang line). Do not add the header to auto-generated files (`next-env.d.ts`).

A PostToolUse hook in `.claude/settings.json` adds the header automatically for files created via the Write tool. If files are created another way (scripts, other tools), run the backfill:

```
node scripts/add-copyright.js --scan
```
