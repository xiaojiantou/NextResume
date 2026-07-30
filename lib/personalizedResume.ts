// Copyright (c) 2026 HowBe LLC. All rights reserved.

import "server-only";
import { PDFDocument } from "pdf-lib";
import type { Page } from "puppeteer-core";
import { generateResumeStyleProfile } from "./ai";
import { launchBrowser } from "./browser";
import {
  getResumeSectionLabels,
  resolveResumeContent,
  type ResolvedBlock,
  type ResolvedResumeDocument,
} from "./pdf/shared";
import { partitionResumeForPages } from "./pdf/balancedPages";
import type { TargetPages } from "./pdf/config";
import {
  sanitizeResumeStyleProfile,
} from "./resumeStyle";
import type {
  Optimization,
  Resume,
  ResumeAdditionalSection,
  ResumeSectionRef,
  ResumeStyleProfile,
  ResumeStyleSource,
} from "./types";

const MAX_STYLE_ATTEMPTS = 3;
type FitPreset = {
  fontScale: number;
  spacingScale: number;
  marginScale: number;
  lineHeightScale: number;
  minimumBodyPt?: number;
  minimumMarginPt?: number;
};

const TARGET_PAGE_FILL = 0.88;
const BALANCED_PAGE_FILL = { min: 0.82, max: 0.93 };

// A style profile can itself be very dense. Try roomier variants first and
// select one whose last content lands in a visually balanced page region.
const EXPANDED_FIT_PRESETS: FitPreset[] = [
  {
    fontScale: 1.16,
    spacingScale: 1.5,
    marginScale: 1.06,
    lineHeightScale: 1.1,
  },
  {
    fontScale: 1.12,
    spacingScale: 1.36,
    marginScale: 1.04,
    lineHeightScale: 1.08,
  },
  {
    fontScale: 1.08,
    spacingScale: 1.23,
    marginScale: 1.02,
    lineHeightScale: 1.05,
  },
  {
    fontScale: 1.04,
    spacingScale: 1.11,
    marginScale: 1.01,
    lineHeightScale: 1.03,
  },
];

const BASE_FIT_PRESET: FitPreset = {
  fontScale: 1,
  spacingScale: 1,
  marginScale: 1,
  lineHeightScale: 1,
};

// If the base layout does not fit, preserve typography as long as possible:
// compact whitespace first, then reduce type modestly. If the final preset
// still spans multiple pages, keep the pages rather than dropping content.
const COMPACT_FIT_PRESETS: FitPreset[] = [
  {
    fontScale: 1,
    spacingScale: 0.9,
    marginScale: 0.94,
    lineHeightScale: 0.95,
  },
  {
    fontScale: 1,
    spacingScale: 0.82,
    marginScale: 0.9,
    lineHeightScale: 0.92,
  },
  {
    fontScale: 0.98,
    spacingScale: 0.75,
    marginScale: 0.86,
    lineHeightScale: 0.88,
  },
  {
    fontScale: 0.96,
    spacingScale: 0.68,
    marginScale: 0.82,
    lineHeightScale: 0.84,
  },
  {
    fontScale: 0.94,
    spacingScale: 0.62,
    marginScale: 0.78,
    lineHeightScale: 0.82,
  },
];

type ManifestItem = { id: string; value: string };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function contentLeaf(
  tag: string,
  id: string,
  value: string,
  className = "",
): string {
  if (!value) return "";
  return `<${tag} class="${className}" data-content-id="${escapeHtml(id)}">${escapeHtml(value)}</${tag}>`;
}

function dateRange(start: string, end: string): string {
  return [start, end].filter(Boolean).join(" — ");
}

function renderBullets(
  owner: string,
  bullets: string[],
  marker: ResumeStyleProfile["bulletMarker"],
): string {
  if (!bullets.length) return "";
  const glyph = marker === "dash" ? "–" : marker === "square" ? "▪" : "•";
  return `<ul class="bullets">${bullets
    .map(
      (bullet, index) =>
        `<li><span class="bullet-marker" aria-hidden="true">${glyph}</span>${contentLeaf(
          "span",
          `${owner}:bullet:${index}`,
          bullet,
          "bullet-text",
        )}</li>`,
    )
    .join("")}</ul>`;
}

function renderBlocks(
  blocks: ResolvedBlock[],
  owner: "role" | "project",
  profile: ResumeStyleProfile,
): string {
  return blocks
    .map((block) => {
      const prefix = `${owner}:${block.id}`;
      return `<article class="entry">
        <div class="entry-top">
          <div class="entry-heading">
            ${contentLeaf("div", `${prefix}:heading`, block.heading, "entry-name")}
            ${contentLeaf("div", `${prefix}:subheading`, block.subheading, "entry-sub")}
          </div>
          ${contentLeaf("div", `${prefix}:dates`, dateRange(block.start, block.end), "entry-dates")}
        </div>
        ${contentLeaf("div", `${prefix}:location`, block.location, "entry-location")}
        ${renderBullets(prefix, block.bullets, profile.bulletMarker)}
      </article>`;
    })
    .join("");
}

function renderAdditionalItems(
  section: ResumeAdditionalSection,
  profile: ResumeStyleProfile,
): string {
  return section.items
    .map((item) => {
      const prefix = `additional:${section.id}:${item.id}`;
      return `<article class="entry additional-entry">
        <div class="entry-top">
          <div class="entry-heading">
            ${contentLeaf("div", `${prefix}:heading`, item.heading, "entry-name")}
            ${contentLeaf("div", `${prefix}:subheading`, item.subheading, "entry-sub")}
          </div>
          ${contentLeaf("div", `${prefix}:dates`, dateRange(item.start, item.end), "entry-dates")}
        </div>
        ${contentLeaf("div", `${prefix}:location`, item.location, "entry-location")}
        ${renderBullets(prefix, item.bullets.map((bullet) => bullet.text), profile.bulletMarker)}
      </article>`;
    })
    .join("");
}

function sectionMarkup(
  ref: ResumeSectionRef,
  content: ResolvedResumeDocument,
  profile: ResumeStyleProfile,
): string {
  const labels = getResumeSectionLabels(content.language);
  let label = "";
  let body = "";
  let headingContentId = "";

  if (ref === "summary") {
    label = labels.summary;
    body = contentLeaf("p", "summary", content.summary, "summary-text");
  } else if (ref === "skills") {
    label = labels.skills;
    // Grouped and flat markup must mirror createContentManifest exactly —
    // the integrity check requires every manifest id to render once.
    body = content.skillGroups.length
      ? content.skillGroups
          .map(
            (group, groupIndex) =>
              `<div class="skill-group">${contentLeaf(
                "span",
                `skillgroup:${groupIndex}:label`,
                group.label,
                "skill-group-label",
              )}${group.skills
                .map((skill, skillIndex) =>
                  contentLeaf(
                    "span",
                    `skillgroup:${groupIndex}:skill:${skillIndex}`,
                    skill,
                    "skill",
                  ),
                )
                .join("")}</div>`,
          )
          .join("")
      : `<div class="skills">${content.skills
          .map((skill, index) =>
            contentLeaf("span", `skill:${index}`, skill, "skill"),
          )
          .join("")}</div>`;
  } else if (ref === "experience") {
    label = labels.experience;
    body = renderBlocks(content.experience, "role", profile);
  } else if (ref === "projects") {
    label = labels.projects;
    body = renderBlocks(content.projects, "project", profile);
  } else if (ref === "education") {
    label = labels.education;
    body = content.education
      .map((item, index) => {
        const prefix = `education:${index}`;
        return `<article class="entry education-entry">
          <div class="entry-top">
            <div class="entry-heading">
              ${contentLeaf("div", `${prefix}:school`, item.school, "entry-name")}
              ${contentLeaf("div", `${prefix}:degree`, item.degree, "entry-sub")}
            </div>
            ${contentLeaf("div", `${prefix}:year`, item.year, "entry-dates")}
          </div>
        </article>`;
      })
      .join("");
  } else {
    const section = content.additionalSections.find(
      (candidate) => `additional:${candidate.id}` === ref,
    );
    if (!section) return "";
    label = section.title || labels[section.kind];
    if (section.title) {
      headingContentId = `additional:${section.id}:title`;
    }
    body = renderAdditionalItems(section, profile);
  }

  if (!body) return "";
  return `<section class="resume-section" data-section-ref="${escapeHtml(ref)}">
    <h2${headingContentId ? ` data-content-id="${escapeHtml(headingContentId)}"` : ""}>${escapeHtml(label)}</h2>
    <div class="section-body">${body}</div>
  </section>`;
}

function sectionRegion(
  ref: ResumeSectionRef,
  profile: ResumeStyleProfile,
): "sidebar" | "main" {
  if (profile.layout === "single-column") return "main";
  if (ref === "summary" && profile.sidebarSections.includes("summary")) {
    return "sidebar";
  }
  if (ref === "skills" && profile.sidebarSections.includes("skills")) {
    return "sidebar";
  }
  if (ref === "education" && profile.sidebarSections.includes("education")) {
    return "sidebar";
  }
  if (
    ref.startsWith("additional:") &&
    profile.sidebarSections.includes("additional")
  ) {
    return "sidebar";
  }
  return "main";
}

function fontSize(base: number, scale: number, floor: number): number {
  return Math.max(floor, base * scale);
}

export function buildPersonalizedHtml({
  content,
  profile,
  fit,
}: {
  content: ResolvedResumeDocument;
  profile: ResumeStyleProfile;
  fit: FitPreset;
}): string {
  const { widthPt, heightPt } = profile.page;
  const bodyPt = fontSize(
    profile.typography.bodyPt,
    fit.fontScale,
    fit.minimumBodyPt ?? 10,
  );
  const metaPt = fontSize(
    profile.typography.metaPt,
    fit.fontScale,
    8,
  );
  const mainSections = content.sectionOrder
    .filter((ref) => sectionRegion(ref, profile) === "main")
    .map((ref) => sectionMarkup(ref, content, profile))
    .join("");
  const sidebarSections = content.sectionOrder
    .filter((ref) => sectionRegion(ref, profile) === "sidebar")
    .map((ref) => sectionMarkup(ref, content, profile))
    .join("");

  const hasSidebar = profile.layout !== "single-column";
  const contact = [content.email, content.phone, content.location, ...content.links]
    .filter(Boolean)
    .join(" · ");
  const photoPosition =
    content.photo && profile.header.photoPosition === "none"
      ? "right"
      : profile.header.photoPosition;
  const photo =
    content.photo && photoPosition !== "none"
      ? `<img class="photo photo-${photoPosition}" data-content-id="photo" src="${escapeHtml(content.photo)}" alt="">`
      : "";
  const mainContact =
    !hasSidebar || !profile.sidebarSections.includes("contact")
      ? contentLeaf("div", "contact", contact, "contact")
      : "";
  const sidebarContact =
    hasSidebar && profile.sidebarSections.includes("contact") && contact
      ? `<section class="resume-section contact-section"><h2>Contact</h2>${contentLeaf("div", "contact", contact, "sidebar-contact")}</section>`
      : "";
  const sidebarPhoto =
    hasSidebar && content.photo && photoPosition !== "none" ? photo : "";
  const headerPhoto = sidebarPhoto ? "" : photo;

  const margins = {
    top: Math.max(
      fit.minimumMarginPt ?? 36,
      profile.marginsPt.top * fit.marginScale,
    ),
    right: Math.max(
      fit.minimumMarginPt ?? 36,
      profile.marginsPt.right * fit.marginScale,
    ),
    bottom: Math.max(
      fit.minimumMarginPt ?? 36,
      profile.marginsPt.bottom * fit.marginScale,
    ),
    left: Math.max(
      fit.minimumMarginPt ?? 36,
      profile.marginsPt.left * fit.marginScale,
    ),
  };
  const sidebarFirst = profile.layout === "sidebar-left";
  const sidebarWidth = profile.sidebarWidthPercent;
  const mainWidth = 100 - sidebarWidth;
  const gridColumns = sidebarFirst
    ? `${sidebarWidth}% ${mainWidth}%`
    : `${mainWidth}% ${sidebarWidth}%`;
  const headerClass = `header align-${profile.header.alignment} photo-${photoPosition}`;
  const radius =
    profile.header.photoShape === "circle"
      ? "50%"
      : profile.header.photoShape === "rounded"
        ? "10%"
        : "0";
  const sectionTransform = profile.sectionHeading.uppercase
    ? "uppercase"
    : "none";
  const markerColor = profile.colors.accent;
  const lineHeight = Math.max(
    fit.minimumBodyPt === 9 ? 1.1 : 1.18,
    profile.typography.lineHeight * fit.lineHeightScale,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @page { size: ${widthPt}pt ${heightPt}pt; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: ${profile.colors.background}; }
  body {
    color: ${profile.colors.text};
    font-family: "${profile.fontFamily}", sans-serif;
    font-size: ${bodyPt}pt;
    line-height: ${lineHeight};
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .resume {
    width: 100%;
    min-height: ${heightPt}pt;
    background: ${profile.colors.background};
  }
  .single { padding: ${margins.top}pt ${margins.right}pt ${margins.bottom}pt ${margins.left}pt; }
  .with-sidebar {
    display: grid;
    grid-template-columns: ${gridColumns};
    align-items: stretch;
  }
  .main {
    padding: ${margins.top}pt ${margins.right}pt ${margins.bottom}pt ${margins.left}pt;
    ${sidebarFirst ? "grid-column: 2;" : "grid-column: 1;"}
  }
  .sidebar {
    padding: ${margins.top}pt ${Math.max(18, margins.right * 0.7)}pt ${margins.bottom}pt ${Math.max(18, margins.left * 0.7)}pt;
    background: ${profile.colors.sidebarBackground};
    color: ${profile.colors.sidebarText};
    ${sidebarFirst ? "grid-column: 1; grid-row: 1;" : "grid-column: 2; grid-row: 1;"}
  }
  .header {
    position: relative;
    min-height: ${content.photo && headerPhoto ? profile.header.photoSizePt : 0}pt;
    ${profile.header.divider ? `border-bottom: 1.2pt solid ${profile.colors.accent}; padding-bottom: ${8 * fit.spacingScale}pt;` : ""}
  }
  .header.align-center { text-align: center; }
  .header.align-left { text-align: left; }
  .header.photo-left { padding-left: ${profile.header.photoSizePt + 13}pt; }
  .header.photo-right { padding-right: ${profile.header.photoSizePt + 13}pt; }
  .name {
    font-family: "${profile.headingFontFamily}", sans-serif;
    font-size: ${fontSize(profile.typography.namePt, fit.fontScale, 17)}pt;
    font-weight: 700;
    line-height: 1.08;
  }
  .title {
    margin-top: ${4 * fit.spacingScale}pt;
    color: ${profile.colors.accent};
    font-size: ${fontSize(profile.typography.titlePt, fit.fontScale, 9)}pt;
    font-weight: 600;
  }
  .contact, .sidebar-contact {
    margin-top: ${4 * fit.spacingScale}pt;
    color: ${profile.colors.muted};
    font-size: ${metaPt}pt;
  }
  .sidebar-contact { color: ${profile.colors.sidebarText}; overflow-wrap: anywhere; }
  .photo {
    width: ${profile.header.photoSizePt}pt;
    height: ${profile.header.photoSizePt}pt;
    object-fit: cover;
    border-radius: ${radius};
  }
  .header .photo { position: absolute; top: 0; }
  .header .photo-left { left: 0; }
  .header .photo-right { right: 0; }
  .sidebar > .photo { display: block; margin: 0 auto ${10 * fit.spacingScale}pt; }
  .resume-section { margin-top: ${profile.spacing.sectionPt * fit.spacingScale}pt; }
  .resume-section h2 {
    /* Never leave a section heading orphaned at a page bottom while its
       entries jump to the next page. */
    break-after: avoid;
    page-break-after: avoid;
    margin: 0 0 ${Math.max(3, 5 * fit.spacingScale)}pt;
    padding: ${profile.sectionHeading.filled ? `${3 * fit.spacingScale}pt ${6 * fit.spacingScale}pt` : `0 0 ${profile.sectionHeading.divider ? 2.5 * fit.spacingScale : 0}pt`};
    color: ${profile.sectionHeading.filled ? profile.colors.background : profile.colors.accent};
    background: ${profile.sectionHeading.filled ? profile.colors.accent : "transparent"};
    border-bottom: ${profile.sectionHeading.divider && !profile.sectionHeading.filled ? `0.75pt solid ${profile.colors.accent}` : "0"};
    font-family: "${profile.headingFontFamily}", sans-serif;
    font-size: ${fontSize(profile.typography.sectionPt, fit.fontScale, 8)}pt;
    font-weight: 700;
    letter-spacing: 0.06em;
    line-height: 1.2;
    text-align: ${profile.sectionHeading.alignment};
    text-transform: ${sectionTransform};
  }
  .sidebar .resume-section h2 {
    color: ${profile.colors.sidebarText};
    border-color: ${profile.colors.sidebarText};
    background: ${profile.sectionHeading.filled ? "rgba(255,255,255,.14)" : "transparent"};
  }
  .summary-text { margin: 0; }
  .skills { display: flex; flex-wrap: wrap; gap: ${3 * fit.spacingScale}pt ${6 * fit.spacingScale}pt; }
  .skill { display: inline-block; }
  .sidebar .skill { padding: 2pt 5pt; border: .5pt solid currentColor; border-radius: 2pt; }
  .skill-group { margin-top: ${2 * fit.spacingScale}pt; }
  .skill-group:first-child { margin-top: 0; }
  .skill-group-label { font-weight: 700; }
  /* Trailing spaces in pseudo-content collapse at inline-block boundaries,
     so the visual gap after "," and ":" comes from margin instead. */
  .skill-group .skill:not(:last-child)::after { content: ","; }
  .skill-group .skill:not(:last-child) { margin-right: ${3 * fit.spacingScale}pt; }
  .skill-group .skill-group-label::after { content: ":"; }
  .skill-group .skill-group-label { margin-right: ${3 * fit.spacingScale}pt; }
  .entry {
    margin-top: ${profile.spacing.entryPt * fit.spacingScale}pt;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .entry:first-child { margin-top: 0; }
  .entry-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10pt; }
  .entry-heading { min-width: 0; }
  .entry-name { font-weight: 700; }
  .entry-sub, .entry-location { color: ${profile.colors.muted}; font-size: ${metaPt}pt; }
  .entry-dates { flex: none; color: ${profile.colors.muted}; font-size: ${metaPt}pt; font-weight: 600; }
  .sidebar .entry-sub, .sidebar .entry-location, .sidebar .entry-dates { color: ${profile.colors.sidebarText}; opacity: .86; }
  .bullets { list-style: none; margin: ${profile.spacing.bulletPt * fit.spacingScale}pt 0 0; padding: 0; }
  .bullets li {
    display: flex;
    align-items: flex-start;
    gap: 5pt;
    margin-top: ${profile.spacing.bulletPt * fit.spacingScale}pt;
  }
  .bullet-marker { flex: 0 0 7pt; color: ${markerColor}; font-weight: 700; }
  .sidebar .bullet-marker { color: ${profile.colors.sidebarText}; }
  .bullet-text { flex: 1; min-width: 0; }
</style>
</head>
<body>
  ${
    hasSidebar
      ? `<div class="resume with-sidebar">
          <main class="main">
            <header class="${headerClass}">
              ${headerPhoto}
              ${contentLeaf("div", "name", content.name, "name")}
              ${contentLeaf("div", "title", content.title, "title")}
              ${mainContact}
            </header>
            ${mainSections}
          </main>
          <aside class="sidebar">
            ${sidebarPhoto}
            ${sidebarContact}
            ${sidebarSections}
          </aside>
        </div>`
      : `<main class="resume single">
          <header class="${headerClass}">
            ${headerPhoto}
            ${contentLeaf("div", "name", content.name, "name")}
            ${contentLeaf("div", "title", content.title, "title")}
            ${mainContact}
          </header>
          ${mainSections}
        </main>`
  }
</body>
</html>`;
}

function createContentManifest(
  content: ResolvedResumeDocument,
  profile: ResumeStyleProfile,
): ManifestItem[] {
  const items: ManifestItem[] = [{ id: "name", value: content.name }];
  if (content.title) items.push({ id: "title", value: content.title });
  const contact = [content.email, content.phone, content.location, ...content.links]
    .filter(Boolean)
    .join(" · ");
  if (contact) items.push({ id: "contact", value: contact });
  if (content.photo && profile.header.photoPosition !== "none") {
    items.push({ id: "photo", value: "" });
  } else if (content.photo) {
    // The renderer forces a visible photo even if vision missed it.
    items.push({ id: "photo", value: "" });
  }
  if (content.summary) items.push({ id: "summary", value: content.summary });
  if (content.skillGroups.length > 0) {
    content.skillGroups.forEach((group, groupIndex) => {
      items.push({
        id: `skillgroup:${groupIndex}:label`,
        value: group.label,
      });
      group.skills.forEach((skill, skillIndex) =>
        items.push({
          id: `skillgroup:${groupIndex}:skill:${skillIndex}`,
          value: skill,
        }),
      );
    });
  } else {
    content.skills.forEach((skill, index) =>
      items.push({ id: `skill:${index}`, value: skill }),
    );
  }
  const addBlocks = (blocks: ResolvedBlock[], owner: "role" | "project") => {
    for (const block of blocks) {
      const prefix = `${owner}:${block.id}`;
      if (block.heading) {
        items.push({ id: `${prefix}:heading`, value: block.heading });
      }
      if (block.subheading) {
        items.push({ id: `${prefix}:subheading`, value: block.subheading });
      }
      const dates = dateRange(block.start, block.end);
      if (dates) items.push({ id: `${prefix}:dates`, value: dates });
      if (block.location) {
        items.push({ id: `${prefix}:location`, value: block.location });
      }
      block.bullets.forEach((bullet, index) =>
        items.push({ id: `${prefix}:bullet:${index}`, value: bullet }),
      );
    }
  };
  addBlocks(content.experience, "role");
  addBlocks(content.projects, "project");
  content.education.forEach((item, index) => {
    const prefix = `education:${index}`;
    if (item.school) items.push({ id: `${prefix}:school`, value: item.school });
    if (item.degree) items.push({ id: `${prefix}:degree`, value: item.degree });
    if (item.year) items.push({ id: `${prefix}:year`, value: item.year });
  });
  content.additionalSections.forEach((section) => {
    if (section.title) {
      items.push({
        id: `additional:${section.id}:title`,
        value: section.title,
      });
    }
    section.items.forEach((item) => {
      const prefix = `additional:${section.id}:${item.id}`;
      if (item.heading) {
        items.push({ id: `${prefix}:heading`, value: item.heading });
      }
      if (item.subheading) {
        items.push({ id: `${prefix}:subheading`, value: item.subheading });
      }
      const dates = dateRange(item.start, item.end);
      if (dates) items.push({ id: `${prefix}:dates`, value: dates });
      if (item.location) {
        items.push({ id: `${prefix}:location`, value: item.location });
      }
      item.bullets.forEach((bullet, index) =>
        items.push({
          id: `${prefix}:bullet:${index}`,
          value: bullet.text,
        }),
      );
    });
  });
  return items;
}

async function assertContentIntegrity(
  page: Page,
  manifest: ManifestItem[],
): Promise<void> {
  const failures = await page.evaluate((expected) => {
    const normalize = (value: string | null | undefined) =>
      (value || "").replace(/\s+/g, " ").trim();
    const problems: string[] = [];
    const visibleNodes: Array<{ id: string; element: HTMLElement; rect: DOMRect }> = [];
    const root = document.querySelector(".resume") as HTMLElement | null;
    const rootRect = root?.getBoundingClientRect() ?? null;
    for (const item of expected) {
      const nodes = document.querySelectorAll(
        `[data-content-id="${CSS.escape(item.id)}"]`,
      );
      if (nodes.length !== 1) {
        problems.push(`${item.id}: expected once, found ${nodes.length}`);
        continue;
      }
      const element = nodes[0] as HTMLElement;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        problems.push(`${item.id}: not visible`);
        continue;
      }
      if (item.value && normalize(element.textContent) !== normalize(item.value)) {
        problems.push(`${item.id}: text mismatch`);
      }
      if (
        rootRect &&
        (rect.left < rootRect.left - 1 || rect.right > rootRect.right + 1)
      ) {
        problems.push(`${item.id}: outside horizontal page bounds`);
      }
      visibleNodes.push({ id: item.id, element, rect });
    }
    for (let i = 0; i < visibleNodes.length; i++) {
      const first = visibleNodes[i];
      for (let j = i + 1; j < visibleNodes.length; j++) {
        const second = visibleNodes[j];
        if (
          first.element.contains(second.element) ||
          second.element.contains(first.element)
        ) {
          continue;
        }
        const overlapWidth =
          Math.min(first.rect.right, second.rect.right) -
          Math.max(first.rect.left, second.rect.left);
        const overlapHeight =
          Math.min(first.rect.bottom, second.rect.bottom) -
          Math.max(first.rect.top, second.rect.top);
        if (overlapWidth > 2 && overlapHeight > 2) {
          problems.push(`${first.id} overlaps ${second.id}`);
        }
        if (problems.length >= 16) break;
      }
      if (problems.length >= 16) break;
    }
    return problems;
  }, manifest);

  if (failures.length) {
    throw new Error(
      `Personalized content integrity failed: ${failures.slice(0, 8).join("; ")}`,
    );
  }
}

async function measurePageFill(
  page: Page,
  pageHeightPt: number,
): Promise<number> {
  return page.evaluate((heightPt) => {
    const root = document.querySelector(".resume");
    if (!root) return 1;
    const rootTop = root.getBoundingClientRect().top;
    const nodes = root.querySelectorAll(
      "[data-content-id], .resume-section h2",
    );
    let contentBottom = rootTop;
    for (const node of nodes) {
      const element = node as HTMLElement;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      contentBottom = Math.max(
        contentBottom,
        element.getBoundingClientRect().bottom,
      );
    }
    // Chromium uses 96 CSS px per inch; PDF points use 72 per inch.
    const pageHeightPx = heightPt * (96 / 72);
    return Math.max(0, (contentBottom - rootTop) / pageHeightPx);
  }, pageHeightPt);
}

export async function generateValidatedStyleProfile(
  source: ResumeStyleSource,
): Promise<ResumeStyleProfile | null> {
  if (!source.screenshots.length) return null;
  for (let attempt = 0; attempt < MAX_STYLE_ATTEMPTS; attempt++) {
    try {
      const candidate = await generateResumeStyleProfile({ source });
      return sanitizeResumeStyleProfile(candidate, source);
    } catch (error) {
      console.warn(
        `[personalizedResume] style profile attempt ${attempt + 1} failed`,
        error,
      );
    }
  }
  return null;
}

export async function renderPersonalizedPdf({
  styleProfile,
  resume,
  optimization,
  includeSummary,
  targetPages = "auto",
  allowMinimumTypography = false,
}: {
  styleProfile: ResumeStyleProfile;
  resume: Resume;
  optimization: Optimization | null;
  includeSummary?: boolean;
  targetPages?: TargetPages;
  allowMinimumTypography?: boolean;
}): Promise<Buffer> {
  const source: ResumeStyleSource = {
    screenshots: [],
    page: styleProfile.page,
    pageCount: 1,
  };
  const profile = sanitizeResumeStyleProfile(styleProfile, source);
  const content = resolveResumeContent(resume, optimization, {
    includeSummary,
  });
  const manifest = createContentManifest(content, profile);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const renderedCandidates: Array<{
      buffer: Buffer;
      fill: number;
      pageCount: number;
    }> = [];
    const renderFit = async (
      fit: FitPreset,
      candidateContent = content,
      candidateManifest = manifest,
      trackCandidate = true,
    ) => {
      const safeFit = allowMinimumTypography
        ? {
            ...fit,
            minimumBodyPt: 9,
            minimumMarginPt: 28.8,
          }
        : fit;
      const html = buildPersonalizedHtml({
        content: candidateContent,
        profile,
        fit: safeFit,
      });
      await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
      await assertContentIntegrity(page, candidateManifest);
      const fill = await measurePageFill(page, profile.page.heightPt);
      const pdf = await page.pdf({
        width: `${profile.page.widthPt / 72}in`,
        height: `${profile.page.heightPt / 72}in`,
        preferCSSPageSize: true,
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      const buffer = Buffer.from(pdf);
      const pageCount = (await PDFDocument.load(buffer)).getPageCount();
      const rendered = { buffer, fill, pageCount };
      if (trackCandidate) renderedCandidates.push(rendered);
      return rendered;
    };

    const baseline = await renderFit(BASE_FIT_PRESET);
    const desiredPages =
      targetPages === "auto"
        ? Math.min(10, Math.max(1, baseline.pageCount))
        : targetPages;
    const fitPresets = [
      ...EXPANDED_FIT_PRESETS,
      BASE_FIT_PRESET,
      ...COMPACT_FIT_PRESETS,
    ];
    for (const fit of fitPresets) {
      const rendered = await renderFit(fit);
      if (rendered.pageCount === desiredPages) return rendered.buffer;
    }
    const maximumObserved = Math.max(
      ...renderedCandidates.map((candidate) => candidate.pageCount),
    );
    if (
      typeof desiredPages === "number" &&
      desiredPages > maximumObserved
    ) {
      const chunks = partitionResumeForPages({
        resume,
        optimization,
        pageCount: desiredPages,
      });
      if (chunks) {
        const chunkBuffers: Buffer[] = [];
        for (const chunk of chunks) {
          const chunkContent = resolveResumeContent(
            chunk.resume,
            chunk.optimization,
          );
          const chunkManifest = createContentManifest(chunkContent, profile);
          let selected: Buffer | null = null;
          for (const fit of fitPresets) {
            const rendered = await renderFit(
              fit,
              chunkContent,
              chunkManifest,
              false,
            );
            if (rendered.pageCount === 1) {
              selected = rendered.buffer;
              break;
            }
          }
          if (!selected) {
            chunkBuffers.length = 0;
            break;
          }
          chunkBuffers.push(selected);
        }
        if (chunkBuffers.length === desiredPages) {
          const merged = await PDFDocument.create();
          merged.setTitle(`${resume.name} — Resume`);
          merged.setAuthor(resume.name);
          merged.setCreator("NextResume");
          merged.setProducer("NextResume");
          for (const chunkBuffer of chunkBuffers) {
            const sourcePdf = await PDFDocument.load(chunkBuffer);
            const [copied] = await merged.copyPages(sourcePdf, [0]);
            merged.addPage(copied);
          }
          return Buffer.from(await merged.save());
        }
      }
    }
    const closest = renderedCandidates.sort((left, right) => {
      const distance =
        Math.abs(left.pageCount - desiredPages) -
        Math.abs(right.pageCount - desiredPages);
      if (distance !== 0) return distance;
      return right.fill - left.fill;
    })[0];
    return closest?.buffer ?? baseline.buffer;
  } finally {
    await browser.close();
  }
}
