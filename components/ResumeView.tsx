"use client";

import type { Optimization, Resume } from "@/lib/types";
import { cn } from "@/lib/cn";

type Mode = "original" | "optimized";

export function ResumeView({
  mode,
  resume,
  optimization,
  hoveredEvidence,
  setHoveredOptimizedId,
  hoveredOptimizedId,
  evidenceMode,
}: {
  mode: Mode;
  resume: Resume;
  optimization: Optimization | null;
  hoveredEvidence: string[];
  setHoveredOptimizedId: (id: string | null) => void;
  hoveredOptimizedId: string | null;
  evidenceMode: boolean;
}) {
  const evidenceActive = evidenceMode && hoveredEvidence.length > 0;

  const summary =
    mode === "optimized" ? optimization?.summary ?? resume.summary : resume.summary;
  const title =
    mode === "optimized" ? optimization?.title ?? resume.title : resume.title;
  const skills =
    mode === "optimized" ? optimization?.skills ?? resume.skills : resume.skills;

  return (
    <div className="paper p-10 text-[12.5px] leading-relaxed text-ink-800 font-serif">
      <header className="text-center border-b border-ink-100 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          {resume.name}
        </h1>
        <div className="text-sm text-ink-600 mt-0.5">{title}</div>
        <div className="text-[11px] text-ink-500 mt-1.5 font-sans">
          {[resume.email, resume.phone, resume.location]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </header>

      {summary && (
        <section className="mt-5">
          <SectionLabel>Summary</SectionLabel>
          <p
            className={cn(
              "mt-1.5",
              mode === "optimized" &&
                "bg-accent-50/40 border-l-2 border-accent-300 pl-3 py-1 -ml-1",
            )}
          >
            {summary}
          </p>
        </section>
      )}

      {skills.length > 0 && (
        <section className="mt-5">
          <SectionLabel>Skills</SectionLabel>
          <p className="mt-1.5 font-sans text-[11.5px] text-ink-700">
            {skills.join(" · ")}
          </p>
        </section>
      )}

      <section className="mt-5">
        <SectionLabel>Experience</SectionLabel>
        <div className="space-y-5 mt-2">
          {resume.experience.map((role) => {
            const optRole = optimization?.roles.find((o) => o.id === role.id);
            return (
              <div key={role.id}>
                <div className="flex items-baseline justify-between font-sans">
                  <div>
                    <span className="font-semibold text-ink-900">
                      {role.company}
                    </span>
                    <span className="text-ink-500"> · {role.title}</span>
                  </div>
                  <div className="text-[11px] text-ink-500">
                    {role.start} — {role.end}
                  </div>
                </div>
                {role.location && (
                  <div className="text-[11px] text-ink-400 font-sans">
                    {role.location}
                  </div>
                )}
                <ul className="mt-2 space-y-1.5 list-disc pl-5">
                  {mode === "original"
                    ? role.bullets.map((b) => {
                        const isActive = hoveredEvidence.includes(b.id);
                        return (
                          <li
                            key={b.id}
                            className={cn(
                              "transition-all rounded-md px-1 -mx-1",
                              evidenceActive && !isActive && "evidence-dim",
                              evidenceActive && isActive && "evidence-active",
                            )}
                          >
                            {b.text}
                          </li>
                        );
                      })
                    : (optRole?.bullets ?? []).map((b) => {
                        const isActive = hoveredOptimizedId === b.id;
                        return (
                          <li
                            key={b.id}
                            onMouseEnter={() => setHoveredOptimizedId(b.id)}
                            onMouseLeave={() => setHoveredOptimizedId(null)}
                            className={cn(
                              "transition-all rounded-md px-1 -mx-1 cursor-default",
                              evidenceMode && isActive && "evidence-active",
                            )}
                          >
                            {b.text}
                          </li>
                        );
                      })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {resume.projects && resume.projects.length > 0 && (
        <section className="mt-5">
          <SectionLabel>Projects</SectionLabel>
          <div className="space-y-5 mt-2">
            {resume.projects.map((project) => {
              const optProject = optimization?.projects?.find(
                (o) => o.id === project.id,
              );
              return (
                <div key={project.id}>
                  <div className="flex items-baseline justify-between font-sans">
                    <div>
                      <span className="font-semibold text-ink-900">
                        {project.name}
                      </span>
                      {project.role && (
                        <span className="text-ink-500"> · {project.role}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-ink-500">
                      {project.start} — {project.end}
                    </div>
                  </div>
                  {project.location && (
                    <div className="text-[11px] text-ink-400 font-sans">
                      {project.location}
                    </div>
                  )}
                  <ul className="mt-2 space-y-1.5 list-disc pl-5">
                    {mode === "original"
                      ? project.bullets.map((b) => {
                          const isActive = hoveredEvidence.includes(b.id);
                          return (
                            <li
                              key={b.id}
                              className={cn(
                                "transition-all rounded-md px-1 -mx-1",
                                evidenceActive && !isActive && "evidence-dim",
                                evidenceActive && isActive && "evidence-active",
                              )}
                            >
                              {b.text}
                            </li>
                          );
                        })
                      : (optProject?.bullets ?? []).map((b) => {
                          const isActive = hoveredOptimizedId === b.id;
                          return (
                            <li
                              key={b.id}
                              onMouseEnter={() => setHoveredOptimizedId(b.id)}
                              onMouseLeave={() => setHoveredOptimizedId(null)}
                              className={cn(
                                "transition-all rounded-md px-1 -mx-1 cursor-default",
                                evidenceMode && isActive && "evidence-active",
                              )}
                            >
                              {b.text}
                            </li>
                          );
                        })}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {resume.education.length > 0 && (
        <section className="mt-5">
          <SectionLabel>Education</SectionLabel>
          <div className="mt-2 space-y-1">
            {resume.education.map((e, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between font-sans text-[11.5px]"
              >
                <div>
                  <span className="font-semibold text-ink-900">
                    {e.school}
                  </span>
                  <span className="text-ink-500"> · {e.degree}</span>
                </div>
                <div className="text-ink-500">{e.year}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-sans uppercase tracking-[0.14em] text-ink-500 font-semibold">
      {children}
    </h3>
  );
}
