// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEFAULT_MODEL_ID } from "./models";
import {
  normalizeTargetPages,
  type PdfStyle,
  type TargetPages,
} from "./pdf/config";
import {
  pruneFitVariants,
  type ResumeFitVariant,
} from "./resumeFit";
import {
  createOptimizationCacheKey,
  pruneOptimizationVariants,
  reconcileGroundedSkills,
  validateResumeStructureManifest,
} from "./resumeStructure";
import type {
  AtsCategory,
  AtsReport,
  ContentStructureMode,
  FitBrief,
  JobAnalysis,
  Optimization,
  OptimizationVariant,
  OptimizedBullet,
  PreviewBullet,
  Resume,
  ResumeStyleProfile,
  ResumeStyleSource,
} from "./types";

export const VOICE_QUOTA = 10;

type Step = "upload" | "analysis" | "checkout" | "result";
export type { PdfStyle, TargetPages } from "./pdf/config";
export type PersonalizedStatus = "idle" | "generating" | "ready" | "failed";

type State = {
  fileName: string | null;
  fileType: "pdf" | "docx" | "tex" | null;
  fileSize: number | null;
  fileFingerprint: string | null;
  /**
   * The uploaded document itself, base64, kept so the optimized wording can be
   * written back into the user's own file instead of being re-laid-out in one
   * of our templates. Deliberately excluded from localStorage: it is far
   * larger than the rest of the flow state and would risk the storage quota.
   * Losing it on reload only costs the format-preserving export, which
   * degrades to the rebuilt PDF.
   */
  sourceDocument: { kind: "docx" | "tex"; base64: string } | null;
  resume: Resume | null;
  resumeStyleSource: ResumeStyleSource | null;
  personalizedStyleProfile: ResumeStyleProfile | null;
  personalizedStatus: PersonalizedStatus;

  jobDescription: string;
  jobUrl: string;
  job: JobAnalysis | null;

  report: AtsReport | null;
  fitBrief: FitBrief | null;
  preview: PreviewBullet | null;
  optimization: Optimization | null;
  optimizationModel: string | null;
  optimizationStructureMode: ContentStructureMode | null;
  optimizationVariants: OptimizationVariant[];
  contentStructure: ContentStructureMode;

  selectedModel: string;
  pdfStyle: PdfStyle;
  /**
   * Whether the AI-written summary is part of the deliverable. null = auto:
   * include it only when the source resume already had a summary section.
   */
  includeSummary: boolean | null;
  pdfPalette: string;
  targetPages: TargetPages;
  fitVariants: ResumeFitVariant[];
  fitKeepIds: string[];
  fitPriorityIds: string[];
  lockedContentIds: string[];

  paid: boolean;
  // Proof of purchase presented to the paid API routes. Set from the Stripe
  // return, a redeemed promo code, or the ?order=&token= email link.
  orderId: string | null;
  orderToken: string | null;
  step: Step;


  voiceCount: number;
};

type Actions = {
  setFileMeta: (
    name: string,
    type: "pdf" | "docx" | "tex",
    size: number,
    fingerprint?: string | null,
  ) => void;
  setResume: (r: Resume) => void;
  setResumeStyleSource: (source: ResumeStyleSource | null) => void;
  setPersonalizedStyleProfile: (profile: ResumeStyleProfile | null) => void;
  setPersonalizedStatus: (s: PersonalizedStatus) => void;
  setSourceDocument: (
    document: { kind: "docx" | "tex"; base64: string } | null,
  ) => void;
  clearFile: () => void;

  setJobDescription: (text: string) => void;
  setJobUrl: (url: string) => void;
  setJob: (j: JobAnalysis) => void;

  setReport: (r: AtsReport) => void;
  setFitBrief: (b: FitBrief | null) => void;
  setMeasuredScore: (
    measuredAfter: number,
    measuredCategories: AtsCategory[],
  ) => void;
  setPreview: (p: PreviewBullet) => void;
  setOptimization: (
    o: Optimization,
    model: string,
    structureMode?: ContentStructureMode,
  ) => void;
  setOptimizationVariants: (variants: OptimizationVariant[]) => void;
  setContentStructure: (mode: ContentStructureMode) => void;
  clearOptimization: () => void;
  replaceOptimizedBullet: (
    roleId: string,
    bulletId: string,
    next: OptimizedBullet,
  ) => void;

  setSelectedModel: (m: string) => void;
  setPdfStyle: (s: PdfStyle) => void;
  setIncludeSummary: (v: boolean) => void;
  setPdfPalette: (paletteId: string) => void;
  setTargetPages: (pages: TargetPages) => void;
  setFitVariants: (variants: ResumeFitVariant[]) => void;
  setFitKeepIds: (contentIds: string[]) => void;
  setLockedContentIds: (contentIds: string[]) => void;
  toggleLockedContentId: (contentId: string) => void;
  upsertFitVariant: (variant: ResumeFitVariant) => void;
  toggleFitKeepId: (contentId: string) => void;
  clearFitVariants: () => void;
  clearFitVariantsForStyle: (style: PdfStyle) => void;

  incrementVoiceCount: () => void;

  markPaid: (access?: OrderAccess) => void;
  setOrderAccess: (access: OrderAccess) => void;

  setStep: (s: Step) => void;
  reset: () => void;
};

const initial: State = {
  fileName: null,
  fileType: null,
  fileSize: null,
  fileFingerprint: null,
  sourceDocument: null,
  resume: null,
  resumeStyleSource: null,
  personalizedStyleProfile: null,
  personalizedStatus: "idle",
  jobDescription: "",
  jobUrl: "",
  job: null,
  report: null,
  fitBrief: null,
  preview: null,
  optimization: null,
  optimizationModel: null,
  optimizationStructureMode: null,
  optimizationVariants: [],
  contentStructure: "optimize",
  selectedModel: DEFAULT_MODEL_ID,
  pdfStyle: "personalized",
  includeSummary: null,
  pdfPalette: "classic-ink",
  targetPages: "auto",
  fitVariants: [],
  fitKeepIds: [],
  fitPriorityIds: [],
  lockedContentIds: [],
  paid: false,
  orderId: null,
  orderToken: null,
  step: "upload",

  voiceCount: 0,
};

export const useFlow = create<State & Actions>()(
  persist(
    (set) => ({
      ...initial,
      setFileMeta: (name, type, size, fingerprint = null) =>
        set({
          fileName: name,
          fileType: type,
          fileSize: size,
          fileFingerprint: fingerprint,
        }),
      setResume: (r) =>
        set((state) => {
          if (!state.resume) return { resume: r };
          const manifestIssues = r.structureManifest?.confirmed
            ? validateResumeStructureManifest(r)
            : [];
          const nextResume: Resume = manifestIssues.length
            ? {
                ...r,
                structureConfidence: {
                  level: "low",
                  coverage: r.structureConfidence?.coverage,
                  issues: [
                    "Resume sections or entries changed after the last structure confirmation. Review the structure again.",
                    ...manifestIssues,
                  ],
                },
                structureManifest: r.structureManifest
                  ? { ...r.structureManifest, confirmed: false }
                  : r.structureManifest,
              }
            : r;
          const previous = collectResumeContent(state.resume);
          const next = collectResumeContent(nextResume);
          const added: string[] = [];
          const modified: string[] = [];
          for (const [id, text] of next) {
            if (!previous.has(id)) added.push(id);
            else if (previous.get(id) !== text) modified.push(id);
          }
          return {
            resume: nextResume,
            optimization: synchronizeManualEdits({
              previousResume: state.resume,
              nextResume,
              optimization: state.optimization,
              addedIds: added,
              modifiedIds: modified,
            }),
            fitKeepIds: unique([...state.fitKeepIds, ...added]),
            fitPriorityIds: unique([
              ...state.fitPriorityIds,
              ...added,
              ...modified,
            ]),
            lockedContentIds: unique([
              ...state.lockedContentIds,
              ...added,
              ...modified,
            ]),
            optimizationVariants: [],
            fitVariants: [],
          };
        }),
      setResumeStyleSource: (source) =>
        set({
          resumeStyleSource: source,
          personalizedStyleProfile: null,
          personalizedStatus: "idle",
        }),
      setPersonalizedStyleProfile: (profile) =>
        set({
          personalizedStyleProfile: profile,
          personalizedStatus: profile ? "ready" : "idle",
        }),
      setPersonalizedStatus: (s) => set({ personalizedStatus: s }),
      setSourceDocument: (document) => set({ sourceDocument: document }),
      clearFile: () =>
        set({
          fileName: null,
          fileType: null,
          fileSize: null,
          fileFingerprint: null,
          sourceDocument: null,
          resume: null,
          resumeStyleSource: null,
          personalizedStyleProfile: null,
          personalizedStatus: "idle",
          report: null,
          fitBrief: null,
          preview: null,
          optimization: null,
          optimizationModel: null,
          includeSummary: null,
          optimizationStructureMode: null,
          optimizationVariants: [],
          fitVariants: [],
          fitKeepIds: [],
          fitPriorityIds: [],
          lockedContentIds: [],
        }),
      setJobDescription: (text) =>
        set({
          jobDescription: text,
          job: null,
          report: null,
          fitBrief: null,
          preview: null,
          optimization: null,
          optimizationModel: null,
          optimizationStructureMode: null,
          optimizationVariants: [],
          fitVariants: [],
        }),
      setJobUrl: (url) => set({ jobUrl: url }),
      setJob: (j) => set({ job: j }),
      setReport: (r) => set({ report: r }),
      setFitBrief: (b) => set({ fitBrief: b }),
      setMeasuredScore: (measuredAfter, measuredCategories) =>
        set((s) =>
          s.report
            ? { report: { ...s.report, measuredAfter, measuredCategories } }
            : {},
        ),
      setPreview: (p) => set({ preview: p }),
      setOptimization: (o, model, structureMode) =>
        set((state) => {
          const selectedMode =
            structureMode ?? o.structureMode ?? state.contentStructure;
          const optimization = { ...o, structureMode: selectedMode };
          if (!state.resume || !state.job) {
            return {
              optimization,
              optimizationModel: model,
              optimizationStructureMode: selectedMode,
              voiceCount: 0,
              report: state.report
                ? {
                    ...state.report,
                    measuredAfter: undefined,
                    measuredCategories: undefined,
                  }
                : state.report,
            };
          }
          const now = new Date().toISOString();
          const cacheKey = createOptimizationCacheKey({
            resume: state.resume,
            job: state.job,
            modelId: model,
            structureMode: selectedMode,
          });
          return {
            optimization,
            optimizationModel: model,
            optimizationStructureMode: selectedMode,
            optimizationVariants: pruneOptimizationVariants([
              {
                cacheKey,
                structureMode: selectedMode,
                modelId: model,
                optimization,
                createdAt: now,
                lastUsedAt: now,
              },
              ...state.optimizationVariants.filter(
                (variant) => variant.cacheKey !== cacheKey,
              ),
            ]),
            voiceCount: 0,
            report: state.report
              ? {
                  ...state.report,
                  measuredAfter: undefined,
                  measuredCategories: undefined,
                }
              : state.report,
          };
        }),
      setOptimizationVariants: (variants) =>
        set({ optimizationVariants: pruneOptimizationVariants(variants) }),
      setContentStructure: (mode) => set({ contentStructure: mode }),
      clearOptimization: () =>
        set({
          optimization: null,
          optimizationModel: null,
          optimizationStructureMode: null,
        }),
      replaceOptimizedBullet: (roleId, bulletId, next) =>
        set((s) => {
          if (!s.optimization) return {};
          const inRoles = s.optimization.roles.some((r) => r.id === roleId);
          const inProjects = (s.optimization.projects ?? []).some(
            (project) => project.id === roleId,
          );
          const voiceAttested = next.evidence.includes("voice-transcript");
          const establishPreservedBaseline =
            voiceAttested && s.optimizationStructureMode === "preserve";
          const normalizedNext = establishPreservedBaseline
            ? { ...next, evidence: [bulletId] }
            : next;
          const resume =
            establishPreservedBaseline && s.resume
              ? replaceResumeBulletText(s.resume, bulletId, next.text)
              : s.resume;
          const optimization: Optimization = {
            ...s.optimization,
            roles: inRoles
              ? s.optimization.roles.map((role) =>
                  role.id !== roleId
                    ? role
                    : {
                        ...role,
                        bullets: role.bullets.map((bullet) =>
                          bullet.id === bulletId
                            ? { ...normalizedNext, id: bulletId }
                            : bullet,
                        ),
                      },
                )
              : s.optimization.roles,
            projects: (s.optimization.projects ?? []).map((project) =>
              project.id !== roleId
                ? project
                : {
                    ...project,
                    bullets: project.bullets.map((bullet) =>
                      bullet.id === bulletId
                        ? { ...normalizedNext, id: bulletId }
                        : bullet,
                    ),
                  },
            ),
            additionalSections:
              inRoles || inProjects
                ? s.optimization.additionalSections
                : (s.optimization.additionalSections ?? []).map((section) => ({
                    ...section,
                    items: section.items.map((item) =>
                      item.id !== roleId
                        ? item
                        : {
                            ...item,
                            bullets: item.bullets.map((bullet) =>
                              bullet.id === bulletId
                                ? { ...normalizedNext, id: bulletId }
                                : bullet,
                            ),
                          },
                    ),
                  })),
          };
          const optimizationVariants = establishPreservedBaseline
            ? []
            : s.optimizationVariants.map((variant) =>
                variant.structureMode === s.optimizationStructureMode &&
                variant.modelId === s.optimizationModel
                  ? {
                      ...variant,
                      optimization,
                      lastUsedAt: new Date().toISOString(),
                    }
                  : variant,
              );
          return {
            resume,
            optimization,
            optimizationVariants,
            lockedContentIds: unique([...s.lockedContentIds, bulletId]),
            fitVariants: [],
          };
        }),
      setSelectedModel: (m) => set({ selectedModel: m }),
      setPdfStyle: (s) => set({ pdfStyle: s }),
      setIncludeSummary: (v) => set({ includeSummary: v }),
      setPdfPalette: (paletteId) => set({ pdfPalette: paletteId }),
      setTargetPages: (pages) =>
        set({ targetPages: normalizeTargetPages(pages) }),
      setFitVariants: (variants) =>
        set({ fitVariants: pruneFitVariants(variants) }),
      setFitKeepIds: (contentIds) =>
        set({ fitKeepIds: unique(contentIds).slice(0, 200) }),
      setLockedContentIds: (contentIds) =>
        set({ lockedContentIds: unique(contentIds).slice(0, 500) }),
      toggleLockedContentId: (contentId) =>
        set((state) => ({
          lockedContentIds: state.lockedContentIds.includes(contentId)
            ? state.lockedContentIds.filter((id) => id !== contentId)
            : [...state.lockedContentIds, contentId],
          fitVariants: [],
        })),
      upsertFitVariant: (variant) =>
        set((state) => ({
          fitVariants: pruneFitVariants([
            variant,
            ...state.fitVariants.filter(
              (candidate) => candidate.cacheKey !== variant.cacheKey,
            ),
          ]),
        })),
      toggleFitKeepId: (contentId) =>
        set((state) => ({
          fitKeepIds: state.fitKeepIds.includes(contentId)
            ? state.fitKeepIds.filter((id) => id !== contentId)
            : [...state.fitKeepIds, contentId],
        })),
      clearFitVariants: () => set({ fitVariants: [] }),
      clearFitVariantsForStyle: (style) =>
        set((state) => ({
          fitVariants: state.fitVariants.filter(
            (variant) => variant.style !== style,
          ),
        })),
      incrementVoiceCount: () => set((s) => ({ voiceCount: s.voiceCount + 1 })),
      markPaid: (access) =>
        set(
          access
            ? { paid: true, orderId: access.orderId, orderToken: access.token }
            : { paid: true },
        ),
      setOrderAccess: (access) =>
        set({ orderId: access.orderId, orderToken: access.token }),

      setStep: (s) => set({ step: s }),
      reset: () => set(initial),
    }),
    {
      name: "nextresume-flow",
      storage: createJSONStorage(() => localStorage),
      // Everything except the raw source document, which is memory-only.
      partialize: ({ sourceDocument: _sourceDocument, ...rest }) => rest,
    },
  ),
);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function collectResumeContent(resume: Resume): Map<string, string> {
  const content = new Map<string, string>();
  content.set("title", resume.title);
  content.set("summary", resume.summary);
  for (const skill of resume.skills) {
    content.set(
      `skill:${skill.trim().toLocaleLowerCase().replace(/\s+/g, " ")}`,
      skill,
    );
  }
  for (const role of resume.experience) {
    for (const bullet of role.bullets) content.set(bullet.id, bullet.text);
  }
  for (const project of resume.projects ?? []) {
    for (const bullet of project.bullets) content.set(bullet.id, bullet.text);
  }
  for (const section of resume.additionalSections ?? []) {
    for (const item of section.items) {
      content.set(item.id, [item.heading, item.subheading].join("|"));
      for (const bullet of item.bullets) content.set(bullet.id, bullet.text);
    }
  }
  return content;
}

function replaceResumeBulletText(
  resume: Resume,
  bulletId: string,
  text: string,
): Resume {
  return {
    ...resume,
    experience: resume.experience.map((role) => ({
      ...role,
      bullets: role.bullets.map((bullet) =>
        bullet.id === bulletId ? { ...bullet, text } : bullet,
      ),
    })),
    projects: (resume.projects ?? []).map((project) => ({
      ...project,
      bullets: project.bullets.map((bullet) =>
        bullet.id === bulletId ? { ...bullet, text } : bullet,
      ),
    })),
    additionalSections: (resume.additionalSections ?? []).map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        bullets: item.bullets.map((bullet) =>
          bullet.id === bulletId ? { ...bullet, text } : bullet,
        ),
      })),
    })),
  };
}

function synchronizeManualEdits({
  previousResume,
  nextResume,
  optimization,
  addedIds,
  modifiedIds,
}: {
  previousResume: Resume;
  nextResume: Resume;
  optimization: Optimization | null;
  addedIds: string[];
  modifiedIds: string[];
}): Optimization | null {
  if (!optimization) return null;
  const nextBullets = new Map<
    string,
    {
      id: string;
      text: string;
      ownerId: string;
      owner: "role" | "project" | "additional";
    }
  >();
  for (const role of nextResume.experience) {
    for (const bullet of role.bullets) {
      nextBullets.set(bullet.id, {
        ...bullet,
        ownerId: role.id,
        owner: "role",
      });
    }
  }
  for (const project of nextResume.projects ?? []) {
    for (const bullet of project.bullets) {
      nextBullets.set(bullet.id, {
        ...bullet,
        ownerId: project.id,
        owner: "project",
      });
    }
  }
  for (const section of nextResume.additionalSections ?? []) {
    for (const item of section.items) {
      for (const bullet of item.bullets) {
        nextBullets.set(bullet.id, {
          ...bullet,
          ownerId: item.id,
          owner: "additional",
        });
      }
    }
  }
  const modified = new Set(modifiedIds);
  const added = new Set(addedIds);
  const skillsChanged =
    JSON.stringify(previousResume.skills) !== JSON.stringify(nextResume.skills);
  const manuallyGroundedSkills = skillsChanged
    ? reconcileGroundedSkills(nextResume, nextResume.skills)
    : null;

  const syncBullets = (
    ownerId: string,
    owner: "role" | "project" | "additional",
    bullets: OptimizedBullet[],
  ) => {
    const retained = bullets.flatMap((bullet) => {
      if (bullet.evidence.some((id) => !nextBullets.has(id))) return [];
      const editedEvidence = bullet.evidence.find((id) => modified.has(id));
      if (!editedEvidence) return [bullet];
      const source = nextBullets.get(editedEvidence);
      if (!source) return [];
      return [
        {
          ...bullet,
          text: source.text,
          evidence: [source.id],
          matchedKeywords: [],
          rationale: "Manually edited by the user.",
        },
      ];
    });
    const additions = [...added]
      .map((id) => nextBullets.get(id))
      .filter(
        (
          bullet,
        ): bullet is {
          id: string;
          text: string;
          ownerId: string;
          owner: "role" | "project" | "additional";
        } =>
          Boolean(
            bullet &&
              bullet.ownerId === ownerId &&
              bullet.owner === owner,
          ),
      )
      .map((bullet) => ({
        id: bullet.id,
        text: bullet.text,
        evidence: [bullet.id],
        matchedKeywords: [],
        rationale: "Added manually by the user.",
      }));
    return [...retained, ...additions];
  };

  return {
    ...optimization,
    title:
      previousResume.title !== nextResume.title
        ? nextResume.title
        : optimization.title,
    summary:
      previousResume.summary !== nextResume.summary
        ? nextResume.summary
        : optimization.summary,
    skills: manuallyGroundedSkills?.skills ?? optimization.skills,
    skillEvidence:
      manuallyGroundedSkills?.skillEvidence ?? optimization.skillEvidence,
    roles: optimization.roles.map((role) => ({
      ...role,
      bullets: syncBullets(role.id, "role", role.bullets),
    })),
    projects: (optimization.projects ?? []).map((project) => ({
      ...project,
      bullets: syncBullets(project.id, "project", project.bullets),
    })),
    additionalSections: (optimization.additionalSections ?? []).map(
      (section) => ({
        ...section,
        items: section.items.map((item) => ({
          ...item,
          bullets: syncBullets(item.id, "additional", item.bullets),
        })),
      }),
    ),
  };
}

export type OrderAccess = { orderId: string; token: string };

// Headers every paid endpoint expects. Reading straight from the store keeps
// the credentials out of component props — the email-link flow writes the
// pair into the store on hydration, so both entry paths look the same here.
export function orderAuthHeaders(): Record<string, string> {
  const { orderId, orderToken } = useFlow.getState();
  if (!orderId || !orderToken) return {};
  return {
    "X-NextResume-Order": orderId,
    "X-NextResume-Token": orderToken,
  };
}
