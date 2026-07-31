// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import type { Optimization, Resume } from "@/lib/types";
import { cn } from "@/lib/cn";
import {
  detectResumeLanguage,
  getResumeSectionLabels,
} from "@/lib/pdf/shared";

type Mode = "original" | "optimized";

export function ResumeView({
  mode,
  resume,
  optimization,
  hoveredEvidence,
  setHoveredOptimizedId,
  hoveredOptimizedId,
  evidenceMode,
  includeSummary = true,
}: {
  mode: Mode;
  resume: Resume;
  optimization: Optimization | null;
  hoveredEvidence: string[];
  setHoveredOptimizedId: (id: string | null) => void;
  hoveredOptimizedId: string | null;
  evidenceMode: boolean;
  includeSummary?: boolean;
}) {
  const evidenceActive = evidenceMode && hoveredEvidence.length > 0;

  const summary =
    mode === "optimized"
      ? includeSummary
        ? optimization?.summary ?? resume.summary
        : resume.summary
      : resume.summary;
  const title =
    mode === "optimized" ? optimization?.title ?? resume.title : resume.title;
  const skills =
    mode === "optimized" ? optimization?.skills ?? resume.skills : resume.skills;
  const labels = getResumeSectionLabels(detectResumeLanguage(resume));

  return (
    <div className="paper p-10 text-[12.5px] leading-relaxed text-ink-800 font-serif">
      {resume.photo ? (
        <header className="flex items-center gap-4 border-b border-ink-100 pb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resume.photo}
            alt=""
            className="w-14 h-14 rounded-full object-cover shrink-0"
          />
          <div className="text-left">
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
              {resume.name}
            </h1>
            <div className="text-sm text-ink-600 mt-0.5">{title}</div>
            <div className="text-[11px] text-ink-500 mt-1.5 font-sans">
              {[resume.email, resume.phone, resume.location, ...(resume.links ?? [])]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        </header>
      ) : (
        <header className="text-center border-b border-ink-100 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            {resume.name}
          </h1>
          <div className="text-sm text-ink-600 mt-0.5">{title}</div>
          <div className="text-[11px] text-ink-500 mt-1.5 font-sans">
            {[resume.email, resume.phone, resume.location, ...(resume.links ?? [])]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </header>
      )}

      {summary && (
        <section className="mt-5">
          <SectionLabel>{labels.summary}</SectionLabel>
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

      {(skills.length > 0 || (resume.skillGroups?.length ?? 0) > 0) && (
        <section className="mt-5">
          <SectionLabel>{labels.skills}</SectionLabel>
          {resume.skillGroups?.length ? (
            <div className="mt-1.5 font-sans text-[11.5px] text-ink-700 space-y-0.5">
              {resume.skillGroups.map((group) => (
                <p key={group.label}>
                  <span className="font-semibold text-ink-900">
                    {group.label}:
                  </span>{" "}
                  {group.skills.join(", ")}
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-1.5 font-sans text-[11.5px] text-ink-700">
              {skills.join(" · ")}
            </p>
          )}
        </section>
      )}

      {resume.experience.length > 0 && (
      <section className="mt-5">
        <SectionLabel>{labels.experience}</SectionLabel>
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
                    <span className="text-ink-500">
                      {" "}
                      · {role.title}
                      {role.techStack ? ` | ${role.techStack}` : ""}
                    </span>
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
      )}

      {resume.projects && resume.projects.length > 0 && (
        <section className="mt-5">
          <SectionLabel>{labels.projects}</SectionLabel>
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
          <SectionLabel>{labels.education}</SectionLabel>
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

      {(resume.additionalSections ?? []).map((section) =>
        section.items.length > 0 ? (
          <section key={section.id} className="mt-5">
            <SectionLabel>
              {section.title || labels[section.kind]}
            </SectionLabel>
            <div className="space-y-4 mt-2">
              {section.items.map((item) => (
                <div key={item.id}>
                  <div className="flex items-baseline justify-between gap-4 font-sans">
                    <div>
                      <span className="font-semibold text-ink-900">
                        {item.heading}
                      </span>
                      {item.subheading ? (
                        <span className="text-ink-500">
                          {" · "}
                          {item.subheading}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-ink-500">
                      {[item.start, item.end].filter(Boolean).join(" — ")}
                    </div>
                  </div>
                  {item.location ? (
                    <div className="text-[11px] text-ink-400 font-sans">
                      {item.location}
                    </div>
                  ) : null}
                  {item.bullets.length > 0 ? (
                    <ul className="mt-2 space-y-1.5 list-disc pl-5">
                      {item.bullets.map((bullet) => (
                        <li key={bullet.id}>{bullet.text}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null,
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
