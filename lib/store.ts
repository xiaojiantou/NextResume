"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  AtsReport,
  JobAnalysis,
  Optimization,
  Resume,
} from "./types";

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
  optimization: Optimization | null;

  paid: boolean;
  step: Step;
};

type Actions = {
  setFileMeta: (name: string, type: "pdf" | "docx", size: number) => void;
  setResume: (r: Resume) => void;
  clearFile: () => void;

  setJobDescription: (text: string) => void;
  setJobUrl: (url: string) => void;
  setJob: (j: JobAnalysis) => void;

  setReport: (r: AtsReport) => void;
  setOptimization: (o: Optimization) => void;

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
  optimization: null,
  paid: false,
  step: "upload",
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
          optimization: null,
        }),
      setJobDescription: (text) =>
        set({
          jobDescription: text,
          job: null,
          report: null,
          optimization: null,
        }),
      setJobUrl: (url) => set({ jobUrl: url }),
      setJob: (j) => set({ job: j }),
      setReport: (r) => set({ report: r }),
      setOptimization: (o) => set({ optimization: o }),
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
