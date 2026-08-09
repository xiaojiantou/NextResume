---
name: resume-layout-guard
description: Guard NextResume PDF template and export changes against missing content, overlap, clipping, unsafe compression, unstable page breaks, alignment drift, and ATS reading-order regressions. Use when creating or editing resume templates, palettes, typography, target-page fitting, personalized layouts, React PDF components, or PDF export validation in this project.
---

# Resume Layout Guard

Treat layout as a presentation of one canonical resume document, never as
permission to select or omit content.

## Workflow

1. Read `lib/pdf/shared.ts` and preserve `resolveResumeContent` as the single
   content source for every template.
2. Identify the template's ATS label:
   - `ATS optimized`: single reading column, standard headings, deterministic
     text order.
   - `ATS compatible`: selectable text and standard headings, but a visual
     multi-column structure may parse differently.
   - `Source-dependent`: personalized layout inherits structural ATS risk from
     the uploaded resume.
3. Render short, typical, and dense English resume fixtures.
4. Fit the requested target length using density presets in this order:
   whitespace, margins, line height, then type. Never remove content.
5. Validate the rendered PDF, not only the React tree.

## Hard constraints

- Keep body copy at 10pt or larger and content margins at 36pt or larger.
- Never overlap, clip, hide, truncate, or place content outside page bounds.
- Keep headings and entry titles left-aligned; keep dates consistently
  right-aligned without allowing either side to collide.
- Keep a section heading with following content. Keep an entry heading with
  its first bullet when a page break occurs.
- Align wrapped bullet text with the first text line, not with the marker.
- Keep contact information as selectable text in the document body.
- Use standard English section names such as Summary, Skills, Experience,
  Projects, Education, Awards, Certifications, and Publications.
- Do not encode essential meaning only through color, icons, images, bars, or
  decoration.
- Use stable unique React keys even when bullet or skill text is duplicated.
- Preserve all experience, projects, education, awards, and additional
  sections returned by `resolveResumeContent`.

## Target pages

Treat `Auto` or a user-selected 1–10 page value as a soft target.

- Try relaxed, standard, compact, then tight-safe density.
- Stop at the roomiest preset that fits within the target.
- If safe density still exceeds the target, keep every page and surface an
  overflow notice.
- If content does not naturally fill the target, keep the shorter document;
  do not invent content or create empty pages.

## Palette and typography

- Keep paragraph text near-black on white.
- Require readable contrast for accent labels and colored rails.
- Use color only for hierarchy and identity.
- Prefer PDF-embeddable, ATS-readable fonts. Provide reliable fallbacks.
- Give each template one structural signature; do not create variety only by
  swapping colors.

## Validation

- Run `npm run test:content`.
- Run `npm run build`.
- Render each fixed style with every palette at standard density.
- Verify page count, non-empty pages, selectable text, expected section order,
  and exact presence of source bullets.
- For personalized HTML, validate one visible node per manifest item, horizontal
  page bounds, and non-overlap before exporting.
- Treat any content mismatch, duplicate key warning, overflow, or unreadable
  density as a release blocker.
