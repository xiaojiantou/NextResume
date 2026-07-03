"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEFAULT_MODEL_ID } from "./models";
import type {
  AtsReport,
  JobAnalysis,
  Optimization,
  OptimizedBullet,
  PreviewBullet,
  Resume,
} from "./types";

export const VOICE_QUOTA = 10;

type Step = "upload" | "job" | "analysis" | "checkout" | "result";

type State = {
  fileName: string | null;
  fileType: "pdf" | "docx" | null;
  fileSize: number | null;
  resume: Resume | null;

  jobDescription: string;
  jobUrl: string;
  job: JobAnalysis | null;

  report: AtsReport | null;
  preview: PreviewBullet | null;
  optimization: Optimization | null;
  optimizationModel: string | null;

  selectedModel: string;

  paid: boolean;
  step: Step;

  voiceCount: number;
};

type Actions = {
  setFileMeta: (name: string, type: "pdf" | "docx", size: number) => void;
  setResume: (r: Resume) => void;
  clearFile: () => void;

  setJobDescription: (text: string) => void;
  setJobUrl: (url: string) => void;
  setJob: (j: JobAnalysis) => void;

  setReport: (r: AtsReport) => void;
  setPreview: (p: PreviewBullet) => void;
  setOptimization: (o: Optimization, model: string) => void;
  clearOptimization: () => void;
  replaceOptimizedBullet: (
    roleId: string,
    bulletId: string,
    next: OptimizedBullet,
  ) => void;

  setSelectedModel: (m: string) => void;

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
  jobDescription: "",
  jobUrl: "",
  job: null,
  report: null,
  preview: null,
  optimization: null,
  optimizationModel: null,
  selectedModel: DEFAULT_MODEL_ID,
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
      clearFile: () =>
        set({
          fileName: null,
          fileType: null,
          fileSize: null,
          resume: null,
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
      setPreview: (p) => set({ preview: p }),
      setOptimization: (o, model) =>
        set({ optimization: o, optimizationModel: model, voiceCount: 0 }),
      clearOptimization: () =>
        set({ optimization: null, optimizationModel: null }),
      replaceOptimizedBullet: (roleId, bulletId, next) =>
        set((s) => {
          if (!s.optimization) return {};
          return {
            optimization: {
              ...s.optimization,
              roles: s.optimization.roles.map((r) =>
                r.id !== roleId
                  ? r
                  : {
                      ...r,
                      bullets: r.bullets.map((b) =>
                        b.id === bulletId ? { ...next, id: bulletId } : b,
                      ),
                    },
              ),
            },
          };
        }),
      setSelectedModel: (m) => set({ selectedModel: m }),
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
