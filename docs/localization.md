# Interface languages

The app supports English (`en`) and Simplified Chinese (`zh`). The header language selector updates React context without remounting the editor. A one-year `nextresume-locale` cookie persists the choice across routes and reloads. The initial server render uses that cookie, then the browser's preferred language, then English. Other open tabs receive preference changes through a storage event.

Use `useI18n().t(englishCopy)` for interface labels, placeholders, accessible names, validation messages and display-only menu metadata. Add Chinese copy to `lib/i18n/zh.ts`. English copy is the catalog key and the fallback. Parameterized display strings can use numbered placeholders such as `Parsed: {0} roles, {1} bullets`; substitution preserves the original values. Do not translate values before saving them.

Do not apply the UI translator to user-entered resume fields, job descriptions, LaTeX source, keyword identifiers, or PDF/Word content. English sample resume excerpts on the landing page intentionally demonstrate an English deliverable. The analysis view selects the existing Chinese brief for Chinese readers and the full English brief for English readers; its own selector can override that choice. Model-generated resume prose and evidence remain in their original language. Unknown provider diagnostics fall back to their original text.

Clerk account and authentication dialogs use the official English/Chinese localization resources. External payment pages and browser-owned PDF/permission dialogs use the respective provider/browser's language settings.

Validation:

- `npm test` includes locale selection, catalog and interpolation checks.
- With `npm run dev` running, `node --experimental-strip-types tests/i18n-ui.mjs` checks both languages, reload persistence, mobile width, in-progress drafts and unchanged stored resume data. API calls are mocked.
