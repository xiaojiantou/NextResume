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
import type {
  AtsCategory,
  AtsReport,
  JobAnalysis,
  Optimization,
  OptimizedBullet,
  PreviewBullet,
  Resume,
  ResumeStyleProfile,
  ResumeStyleSource,
} from "./types";

export const VOICE_QUOTA = 10;

type Step = "upload" | "job" | "analysis" | "checkout" | "result";
export type { PdfStyle, TargetPages } from "./pdf/config";
export type PersonalizedStatus = "idle" | "generating" | "ready" | "failed";

type State = {
  fileName: string | null;
  fileType: "pdf" | "docx" | null;
  fileSize: number | null;
  resume: Resume | null;
  resumeStyleSource: ResumeStyleSource | null;
  personalizedStyleProfile: ResumeStyleProfile | null;
  personalizedStatus: PersonalizedStatus;

  jobDescription: string;
  jobUrl: string;
  job: JobAnalysis | null;

  report: AtsReport | null;
  preview: PreviewBullet | null;
  optimization: Optimization | null;
  optimizationModel: string | null;

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

  paid: boolean;
  step: Step;

  voiceCount: number;
};

type Actions = {
  setFileMeta: (name: string, type: "pdf" | "docx", size: number) => void;
  setResume: (r: Resume) => void;
  setResumeStyleSource: (source: ResumeStyleSource | null) => void;
  setPersonalizedStyleProfile: (profile: ResumeStyleProfile | null) => void;
  setPersonalizedStatus: (s: PersonalizedStatus) => void;
  clearFile: () => void;

  setJobDescription: (text: string) => void;
  setJobUrl: (url: string) => void;
  setJob: (j: JobAnalysis) => void;

  setReport: (r: AtsReport) => void;
  setMeasuredScore: (
    measuredAfter: number,
    measuredCategories: AtsCategory[],
  ) => void;
  setPreview: (p: PreviewBullet) => void;
  setOptimization: (o: Optimization, model: string) => void;
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
  upsertFitVariant: (variant: ResumeFitVariant) => void;
  toggleFitKeepId: (contentId: string) => void;
  clearFitVariants: () => void;
  clearFitVariantsForStyle: (style: PdfStyle) => void;

  incrementVoiceCount: () => void;

  markPaid: () => void;
  setStep: (s: Step) => void;
  reset: () => void;
};

const initial: State = {
  fileName: null,
  fileType: null,
  fileSize: null,
  resume: null,
  resumeStyleSource: null,
  personalizedStyleProfile: null,
  personalizedStatus: "idle",
  jobDescription: "",
  jobUrl: "",
  job: null,
  report: null,
  preview: null,
  optimization: null,
  optimizationModel: null,
  selectedModel: DEFAULT_MODEL_ID,
  pdfStyle: "personalized",
  includeSummary: null,
  pdfPalette: "classic-ink",
  targetPages: "auto",
  fitVariants: [],
  fitKeepIds: [],
  fitPriorityIds: [],
  paid: false,
  step: "upload",
  voiceCount: 0,
};

export const useFlow = create<State & Actions>()(
  persist(
    (set) => ({
      ...initial,
      setFileMeta: (name, type, size) =>
        set({ fileName: name, fileType: type, fileSize: size }),
      setResume: (r) =>
        set((state) => {
          if (!state.resume) return { resume: r };
          const previous = collectResumeContent(state.resume);
          const next = collectResumeContent(r);
          const added: string[] = [];
          const modified: string[] = [];
          for (const [id, text] of next) {
            if (!previous.has(id)) added.push(id);
            else if (previous.get(id) !== text) modified.push(id);
          }
          return {
            resume: r,
            optimization: synchronizeManualEdits({
              previousResume: state.resume,
              nextResume: r,
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
      clearFile: () =>
        set({
          fileName: null,
          fileType: null,
          fileSize: null,
          resume: null,
          resumeStyleSource: null,
          personalizedStyleProfile: null,
          personalizedStatus: "idle",
          report: null,
          preview: null,
          optimization: null,
          optimizationModel: null,
          includeSummary: null,
          fitVariants: [],
          fitKeepIds: [],
          fitPriorityIds: [],
        }),
      setJobDescription: (text) =>
        set({
          jobDescription: text,
          job: null,
          report: null,
          preview: null,
          optimization: null,
          optimizationModel: null,
        }),
      setJobUrl: (url) => set({ jobUrl: url }),
      setJob: (j) => set({ job: j }),
      setReport: (r) => set({ report: r }),
      setMeasuredScore: (measuredAfter, measuredCategories) =>
        set((s) =>
          s.report
            ? { report: { ...s.report, measuredAfter, measuredCategories } }
            : {},
        ),
      setPreview: (p) => set({ preview: p }),
      setOptimization: (o, model) =>
        set((s) => ({
          optimization: o,
          optimizationModel: model,
          voiceCount: 0,
          // A new rewrite invalidates any score measured on the previous one.
          report: s.report
            ? {
                ...s.report,
                measuredAfter: undefined,
                measuredCategories: undefined,
              }
            : s.report,
        })),
      clearOptimization: () =>
        set({ optimization: null, optimizationModel: null }),
      replaceOptimizedBullet: (roleId, bulletId, next) =>
        set((s) => {
          if (!s.optimization) return {};
          const inRoles = s.optimization.roles.some((r) => r.id === roleId);
          return {
            optimization: {
              ...s.optimization,
              roles: inRoles
                ? s.optimization.roles.map((r) =>
                    r.id !== roleId
                      ? r
                      : {
                          ...r,
                          bullets: r.bullets.map((b) =>
                            b.id === bulletId ? { ...next, id: bulletId } : b,
                          ),
                        },
                  )
                : s.optimization.roles,
              projects: (s.optimization.projects ?? []).map((p) =>
                p.id !== roleId
                  ? p
                  : {
                      ...p,
                      bullets: p.bullets.map((b) =>
                        b.id === bulletId ? { ...next, id: bulletId } : b,
                      ),
                    },
              ),
            },
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
      markPaid: () => set({ paid: true }),
      setStep: (s) => set({ step: s }),
      reset: () => set(initial),
    }),
    {
      name: "nextresume-flow",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function collectResumeContent(resume: Resume): Map<string, string> {
  const content = new Map<string, string>();
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
    { id: string; text: string; ownerId: string; owner: "role" | "project" }
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
  const modified = new Set(modifiedIds);
  const added = new Set(addedIds);

  const syncBullets = (
    ownerId: string,
    owner: "role" | "project",
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
          owner: "role" | "project";
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
    skills:
      JSON.stringify(previousResume.skills) !==
      JSON.stringify(nextResume.skills)
        ? [...nextResume.skills]
        : optimization.skills,
    roles: optimization.roles.map((role) => ({
      ...role,
      bullets: syncBullets(role.id, "role", role.bullets),
    })),
    projects: (optimization.projects ?? []).map((project) => ({
      ...project,
      bullets: syncBullets(project.id, "project", project.bullets),
    })),
  };
}
