// Copyright (c) 2026 HowBe LLC. All rights reserved.

import "server-only";
import { PDFDocument } from "pdf-lib";
import type { Page } from "puppeteer-core";
import { generateResumeStyleProfile } from "./ai";
import { launchBrowser } from "./browser";
import {
  getResumeSectionLabels,
  isCompactAdditionalSection,
  resolveResumeContent,
  type ResolvedBlock,
  type ResolvedResumeDocument,
} from "./pdf/shared";
import { partitionResumeForPages } from "./pdf/balancedPages";
import type { TargetPages } from "./pdf/config";
import {
  approximateResumeStyleProfile,
  sanitizeResumeStyleProfile,
} from "./resumeStyle";
import type {
  Optimization,
  Resume,
  ResumeAdditionalSection,
  ResumeLayoutSection,
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
  const compactItems = isCompactAdditionalSection(section)
    ? section.items
    : [];
  const compactIds = new Set(compactItems.map((item) => item.id));
  const compactMarkup = compactItems.length
      ? `<div class="additional-inline">${compactItems
        .map((item) => {
          const prefix = `additional:${section.id}:${item.id}`;
          const heading = contentLeaf(
            "span",
            `${prefix}:heading`,
            item.heading,
          );
          const subheading = item.subheading
            ? ` · ${contentLeaf("span", `${prefix}:subheading`, item.subheading)}`
            : "";
          return `<span class="additional-inline-item">${heading}${subheading}</span>`;
        })
        .join("")}</div>`
    : "";
  const detailedMarkup = section.items
    .filter((item) => !compactIds.has(item.id))
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
  return `${compactMarkup}${detailedMarkup}`;
}

function sectionMarkup(
  ref: ResumeSectionRef,
  content: ResolvedResumeDocument,
  profile: ResumeStyleProfile,
): string {
  const labels = getResumeSectionLabels(
    content.language,
    content.sectionLabels,
  );
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

function sectionCategory(ref: ResumeSectionRef): ResumeLayoutSection {
  return ref.startsWith("additional:")
    ? "additional"
    : (ref as ResumeLayoutSection);
}

function regionForSection(
  ref: ResumeSectionRef,
  profile: ResumeStyleProfile,
): string {
  const category = sectionCategory(ref);
  return (
    profile.layoutBlueprint.regions.find((region) =>
      region.sections.includes(category),
    )?.id ?? profile.layoutBlueprint.primaryRegionId
  );
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
  const blueprint = profile.layoutBlueprint;
  const contact = [
    content.email,
    content.phone,
    content.location,
    ...content.links,
  ]
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
  const contactRegionId = blueprint.regions.find((region) =>
    region.sections.includes("contact"),
  )?.id;
  const photoRegionId = blueprint.regions.find((region) =>
    region.sections.includes("photo"),
  )?.id;
  const headerPhoto = photoRegionId ? "" : photo;
  const headerContact = contactRegionId
    ? ""
    : contentLeaf("div", "contact", contact, "contact");

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
  const gridColumns = blueprint.regions
    .map((region) => `${region.widthPercent}fr`)
    .join(" ");
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
  const renderHeader = (scope: "full" | "primary") => `<header class="${headerClass} header-${scope}">
      ${headerPhoto}
      ${contentLeaf("div", "name", content.name, "name")}
      ${contentLeaf("div", "title", content.title, "title")}
      ${headerContact}
    </header>`;
  const fullHeader =
    blueprint.headerPlacement === "full" ? renderHeader("full") : "";
  const regionRules = blueprint.regions
    .map((region, index) => {
      const isFirst = index === 0;
      const isLast = index === blueprint.regions.length - 1;
      const innerPadding =
        region.role === "main"
          ? Math.max(14, margins.left * 0.45)
          : Math.max(12, margins.left * 0.34);
      const left = isFirst ? margins.left : innerPadding;
      const right = isLast ? margins.right : innerPadding;
      const top =
        blueprint.headerPlacement === "full"
          ? Math.max(8, profile.spacing.sectionPt * fit.spacingScale * 0.55)
          : margins.top;
      return `.region-${escapeHtml(region.id)} { grid-column: ${index + 1}; grid-row: 1; padding: ${top}pt ${right}pt ${margins.bottom}pt ${left}pt; }`;
    })
    .join("\n");
  // Keep the primary narrative first in DOM/PDF extraction order while CSS
  // places every region in the visual left-to-right column requested by AI.
  const renderOrder = [...blueprint.regions].sort((left, right) => {
    if (left.id === blueprint.primaryRegionId) return -1;
    if (right.id === blueprint.primaryRegionId) return 1;
    return (
      blueprint.regions.findIndex((region) => region.id === left.id) -
      blueprint.regions.findIndex((region) => region.id === right.id)
    );
  });
  const regionMarkup = renderOrder
    .map((region) => {
      const sections = content.sectionOrder
        .filter((ref) => regionForSection(ref, profile) === region.id)
        .map((ref) => sectionMarkup(ref, content, profile))
        .join("");
      const regionContact =
        contactRegionId === region.id && contact
          ? `<section class="resume-section contact-section"><h2>Contact</h2>${contentLeaf("div", "contact", contact, "region-contact")}</section>`
          : "";
      const regionPhoto = photoRegionId === region.id ? photo : "";
      const primaryHeader =
        blueprint.headerPlacement === "primary" &&
        region.id === blueprint.primaryRegionId
          ? renderHeader("primary")
          : "";
      const tag = region.id === blueprint.primaryRegionId ? "main" : "aside";
      return `<${tag} class="layout-region region-${escapeHtml(region.id)} role-${region.role} surface-${region.surface}" data-layout-region="${escapeHtml(region.id)}">
        ${regionPhoto}
        ${primaryHeader}
        ${regionContact}
        ${sections}
      </${tag}>`;
    })
    .join("");

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
    display: flex;
    flex-direction: column;
  }
  .blueprint-grid {
    display: grid;
    grid-template-columns: ${gridColumns};
    column-gap: ${blueprint.gutterPt * fit.spacingScale}pt;
    align-items: stretch;
    flex: 1;
  }
  .layout-region { min-width: 0; }
  .surface-sidebar {
    background: ${profile.colors.sidebarBackground};
    color: ${profile.colors.sidebarText};
  }
  .surface-subtle { background: color-mix(in srgb, ${profile.colors.background} 92%, ${profile.colors.accent} 8%); }
  .header-full { margin: ${margins.top}pt ${margins.right}pt 0 ${margins.left}pt; }
  ${regionRules}
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
  .contact, .region-contact {
    margin-top: ${4 * fit.spacingScale}pt;
    color: ${profile.colors.muted};
    font-size: ${metaPt}pt;
  }
  .surface-sidebar .region-contact { color: ${profile.colors.sidebarText}; overflow-wrap: anywhere; }
  .photo {
    width: ${profile.header.photoSizePt}pt;
    height: ${profile.header.photoSizePt}pt;
    object-fit: cover;
    border-radius: ${radius};
  }
  .header .photo { position: absolute; top: 0; }
  .header .photo-left { left: 0; }
  .header .photo-right { right: 0; }
  .layout-region > .photo { display: block; margin: 0 auto ${10 * fit.spacingScale}pt; }
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
  .surface-sidebar .resume-section h2 {
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
  .additional-inline { display: flex; flex-wrap: wrap; gap: ${3 * fit.spacingScale}pt ${6 * fit.spacingScale}pt; }
  .additional-inline-item { display: inline-block; }
  .additional-inline-item:not(:last-child)::after { content: " ·"; color: ${profile.colors.muted}; }
  .surface-sidebar .skill { padding: 2pt 5pt; border: .5pt solid currentColor; border-radius: 2pt; }
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
  .surface-sidebar .entry-sub, .surface-sidebar .entry-location, .surface-sidebar .entry-dates { color: ${profile.colors.sidebarText}; opacity: .86; }
  .bullets { list-style: none; margin: ${profile.spacing.bulletPt * fit.spacingScale}pt 0 0; padding: 0; }
  .bullets li {
    display: flex;
    align-items: flex-start;
    gap: 5pt;
    margin-top: ${profile.spacing.bulletPt * fit.spacingScale}pt;
  }
  .bullet-marker { flex: 0 0 7pt; color: ${markerColor}; font-weight: 700; }
  .surface-sidebar .bullet-marker { color: ${profile.colors.sidebarText}; }
  .bullet-text { flex: 1; min-width: 0; }
</style>
</head>
<body>
  <div class="resume blueprint-layout">
    ${fullHeader}
    <div class="blueprint-grid">${regionMarkup}</div>
  </div>
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

async function assertPdfTextIntegrity(
  buffer: Buffer,
  manifest: ManifestItem[],
): Promise<void> {
  // DOM validation cannot see Chromium print fragmentation. Verify the final
  // PDF text layer as well so narrow AI-generated rails cannot split normal
  // words into ATS-hostile fragments or silently drop a region at a page edge.
  // @ts-expect-error pdf-parse's internal CommonJS entry has no declarations.
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (
    value: Buffer,
  ) => Promise<{ text: string }>;
  const parsed = await pdfParse(buffer);
  const normalize = (value: string) =>
    value
      .normalize("NFKC")
      .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  // PDF text engines may normalize curly quotes, dashes, or punctuation around
  // a wrapped phrase even though every word is present. Compare a word-token
  // representation as a fallback, while retaining the strict DOM assertion
  // above to guarantee that each expected field was rendered exactly once.
  const wordTokens = (value: string) =>
    normalize(value)
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const extracted = normalize(parsed.text);
  const extractedCompact = extracted.replace(/\s+/g, "");
  const extractedWords = wordTokens(extracted);
  const extractedWordSet = new Set(extractedWords.split(" ").filter(Boolean));
  const hasStrongTokenCoverage = (value: string) => {
    const significant = [
      ...new Set(
        wordTokens(value)
          .split(" ")
          .filter((token) => token.length >= 3 || /\d/.test(token)),
      ),
    ];
    if (significant.length < 4) return false;
    const matched = significant.filter((token) =>
      extractedWordSet.has(token),
    ).length;
    return matched / significant.length >= 0.9;
  };
  const missing = manifest
    .filter((item) => item.value)
    .filter((item) => {
      const expected = normalize(item.value);
      if (item.id === "contact") {
        // Email addresses and phone numbers may wrap inside a faithful narrow
        // contact rail. Whitespace-only fragmentation is harmless here, while
        // every body field below must remain contiguous in the PDF text layer.
        return !extractedCompact.includes(expected.replace(/\s+/g, ""));
      }
      return (
        !extracted.includes(expected) &&
        !extractedWords.includes(wordTokens(expected)) &&
        !hasStrongTokenCoverage(expected)
      );
    })
    .map((item) => item.id);
  if (missing.length) {
    throw new Error(
      `Personalized PDF text integrity failed: ${missing.slice(0, 8).join(", ")}`,
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
  return approximateResumeStyleProfile(source);
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
    pageCount: Math.max(1, styleProfile.pageLayouts?.length ?? 1),
  };
  const requestedProfile = sanitizeResumeStyleProfile(styleProfile, source);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    type Rendered = {
      buffer: Buffer;
      fill: number;
      pageCount: number;
    };
    const profileForPage = (index: number): ResumeStyleProfile => {
      const template =
        requestedProfile.pageLayouts[index] ??
        requestedProfile.pageLayouts[requestedProfile.pageLayouts.length - 1];
      return {
        ...requestedProfile,
        layout: template.layout,
        layoutBlueprint: template.layoutBlueprint,
      };
    };
    const renderFit = async (
      fit: FitPreset,
      candidateContent: ResolvedResumeDocument,
      candidateManifest: ManifestItem[],
      candidateProfile: ResumeStyleProfile,
    ): Promise<Rendered> => {
      const safeFit = allowMinimumTypography
        ? {
            ...fit,
            minimumBodyPt: 9,
            minimumMarginPt: 28.8,
          }
        : fit;
      const html = buildPersonalizedHtml({
        content: candidateContent,
        profile: candidateProfile,
        fit: safeFit,
      });
      await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
      await assertContentIntegrity(page, candidateManifest);
      const fill = await measurePageFill(
        page,
        candidateProfile.page.heightPt,
      );
      const pdf = await page.pdf({
        width: `${candidateProfile.page.widthPt / 72}in`,
        height: `${candidateProfile.page.heightPt / 72}in`,
        preferCSSPageSize: true,
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      const buffer = Buffer.from(pdf);
      await assertPdfTextIntegrity(buffer, candidateManifest);
      const pageCount = (await PDFDocument.load(buffer)).getPageCount();
      return { buffer, fill, pageCount };
    };
    const renderChunk = async (
      chunk: { resume: Resume; optimization: Optimization | null },
      pageIndex: number,
    ): Promise<Buffer | null> => {
      const candidateProfile = profileForPage(pageIndex);
      const candidateContent = resolveResumeContent(
        chunk.resume,
        chunk.optimization,
        { includeSummary },
      );
      const candidateManifest = createContentManifest(
        candidateContent,
        candidateProfile,
      );
      const base = await renderFit(
        BASE_FIT_PRESET,
        candidateContent,
        candidateManifest,
        candidateProfile,
      );
      const exact: Rendered[] = base.pageCount === 1 ? [base] : [];
      if (
        base.pageCount === 1 &&
        base.fill >= BALANCED_PAGE_FILL.min &&
        base.fill <= BALANCED_PAGE_FILL.max
      ) {
        return base.buffer;
      }
      const presets =
        base.pageCount > 1
          ? COMPACT_FIT_PRESETS
          : [...EXPANDED_FIT_PRESETS].reverse();
      for (const fit of presets) {
        const rendered = await renderFit(
          fit,
          candidateContent,
          candidateManifest,
          candidateProfile,
        );
        if (rendered.pageCount !== 1) continue;
        exact.push(rendered);
        if (
          rendered.fill >= BALANCED_PAGE_FILL.min &&
          rendered.fill <= BALANCED_PAGE_FILL.max
        ) {
          return rendered.buffer;
        }
      }
      return (
        exact.sort(
          (left, right) =>
            Math.abs(left.fill - TARGET_PAGE_FILL) -
            Math.abs(right.fill - TARGET_PAGE_FILL),
        )[0]?.buffer ?? null
      );
    };
    const mergePages = async (buffers: Buffer[]): Promise<Buffer> => {
      const merged = await PDFDocument.create();
      merged.setTitle(`${resume.name} — Resume`);
      merged.setAuthor(resume.name);
      merged.setCreator("NextResume");
      merged.setProducer("NextResume");
      for (const buffer of buffers) {
        const sourcePdf = await PDFDocument.load(buffer);
        const [copied] = await merged.copyPages(sourcePdf, [0]);
        merged.addPage(copied);
      }
      return Buffer.from(await merged.save());
    };
    const renderAtPageCount = async (
      desiredPages: number,
    ): Promise<Buffer | null> => {
      const chunks = partitionResumeForPages({
        resume,
        optimization,
        pageCount: desiredPages,
      });
      const pageChunks =
        desiredPages === 1
          ? [{ resume, optimization }]
          : chunks;
      if (!pageChunks || pageChunks.length !== desiredPages) return null;
      const buffers: Buffer[] = [];
      for (let index = 0; index < pageChunks.length; index += 1) {
        const buffer = await renderChunk(pageChunks[index], index);
        if (!buffer) return null;
        buffers.push(buffer);
      }
      return mergePages(buffers);
    };

    if (targetPages !== "auto") {
      const exact = await renderAtPageCount(targetPages);
      if (exact) return exact;
      for (let count = targetPages + 1; count <= 10; count += 1) {
        const overflow = await renderAtPageCount(count);
        if (overflow) return overflow;
      }
    } else {
      const preferred = Math.max(
        1,
        Math.min(10, requestedProfile.pageLayouts.length),
      );
      for (let count = preferred; count <= 10; count += 1) {
        const candidate = await renderAtPageCount(count);
        if (candidate) return candidate;
      }
      for (let count = preferred - 1; count >= 1; count -= 1) {
        const candidate = await renderAtPageCount(count);
        if (candidate) return candidate;
      }
    }
    throw new Error(
      "Original-inspired V2 could not paginate this content safely.",
    );
  } finally {
    await browser.close();
  }
}
