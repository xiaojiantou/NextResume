// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEFAULT_MODEL_ID } from "./models";
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
export type PdfStyle = "classic" | "sidebar" | "minimal" | "personalized";
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
      setResume: (r) => set({ resume: r }),
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
