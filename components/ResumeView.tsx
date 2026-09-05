// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import { useEffect, useRef } from "react";
import type { Optimization, OptimizedBullet, Resume } from "@/lib/types";
import { cn } from "@/lib/cn";
import { normalizeResumeLinks } from "@/lib/resumeLinks";
import {
  detectResumeLanguage,
  getResumeSectionLabels,
  resolveOptimizedBulletSourceIds,
} from "@/lib/pdf/shared";

type Mode = "original" | "optimized";

// Mirrors the exported PDF: recovered targets are real links on screen too,
// so what the user previews is what they download.
function ContactLine({ resume }: { resume: Resume }) {
  const entries = [
    ...[resume.email, resume.phone, resume.location]
      .filter(Boolean)
      .map((label) => ({ key: `v:${label}`, label, url: undefined })),
    ...normalizeResumeLinks(resume.links).map((link) => ({
      key: `l:${link.label}`,
      label: link.label,
      url: link.url,
    })),
  ];
  return (
    <>
      {entries.map((entry, index) => (
        <span key={entry.key}>
          {index > 0 ? " · " : ""}
          {entry.url ? (
            <a
              href={entry.url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-ink-300 underline-offset-2 hover:text-ink-700"
            >
              {entry.label}
            </a>
          ) : (
            entry.label
          )}
        </span>
      ))}
    </>
  );
}

function normalizedHeading(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function ResumeView({
  mode,
  resume,
  optimization,
  hoveredEvidence,
  setHoveredOptimizedId,
  hoveredOptimizedId,
  evidenceMode,
  includeSummary = true,
  focusedBulletId = null,
}: {
  mode: Mode;
  resume: Resume;
  optimization: Optimization | null;
  hoveredEvidence: string[];
  setHoveredOptimizedId: (id: string | null) => void;
  hoveredOptimizedId: string | null;
  evidenceMode: boolean;
  includeSummary?: boolean;
  /**
   * Bullet the reader is currently working on elsewhere on the page. Unlike
   * hover, this highlights without evidenceMode and scrolls itself into view,
   * so a refine panel can keep the preview pointed at the right line.
   */
  focusedBulletId?: string | null;
}) {
  const evidenceActive = evidenceMode && hoveredEvidence.length > 0;
  const focusedRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (!focusedBulletId) return;
    focusedRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusedBulletId]);

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
  const labels = getResumeSectionLabels(
    detectResumeLanguage(resume),
    mode === "optimized"
      ? optimization?.sectionLabels ?? resume.sectionLabels
      : resume.sectionLabels,
  );
  const activeSectionOrder =
    mode === "optimized"
      ? optimization?.sectionOrder ?? resume.sectionOrder
      : resume.sectionOrder;
  const sectionRank = (ref: string, fallback: number) => {
    const index = activeSectionOrder?.indexOf(ref as never) ?? -1;
    return index >= 0 ? index + 1 : fallback;
  };
  const roleTeamBulletIds = (role: Resume["experience"][number]) =>
    new Set((role.teams ?? []).flatMap((team) => team.bulletIds));
  const sourceTeamBullets = (
    role: Resume["experience"][number],
    team: NonNullable<Resume["experience"][number]["teams"]>[number],
  ) => {
    const ids = new Set(team.bulletIds);
    return role.bullets.filter((bullet) => ids.has(bullet.id));
  };
  // Same one-to-one mapping the exported PDF uses, so a rewrite that cites a
  // team's bullet as supporting evidence stays with the entry it rewrites.
  const optimizedBulletsBySource = (
    role: Resume["experience"][number],
    optRole: Optimization["roles"][number] | undefined,
  ) => {
    const bullets = optRole?.bullets ?? [];
    const sourceIds = resolveOptimizedBulletSourceIds(role, bullets);
    const bySourceId = new Map<string, OptimizedBullet>();
    const unmapped: OptimizedBullet[] = [];
    bullets.forEach((bullet, index) => {
      const sourceId = sourceIds[index];
      if (sourceId) bySourceId.set(sourceId, bullet);
      else unmapped.push(bullet);
    });
    return { bySourceId, unmapped };
  };
  const optimizedTeamBullets = (
    role: Resume["experience"][number],
    optRole: Optimization["roles"][number] | undefined,
    team: NonNullable<Resume["experience"][number]["teams"]>[number],
  ) => {
    const { bySourceId } = optimizedBulletsBySource(role, optRole);
    return team.bulletIds
      .map((id) => bySourceId.get(id))
      .filter((bullet): bullet is OptimizedBullet => Boolean(bullet));
  };
  const optimizedDirectBullets = (
    role: Resume["experience"][number],
    optRole: Optimization["roles"][number] | undefined,
  ) => {
    const teamIds = roleTeamBulletIds(role);
    const { bySourceId, unmapped } = optimizedBulletsBySource(role, optRole);
    return [
      ...role.bullets
        .filter((bullet) => !teamIds.has(bullet.id))
        .map((bullet) => bySourceId.get(bullet.id))
        .filter((bullet): bullet is OptimizedBullet => Boolean(bullet)),
      ...unmapped,
    ];
  };
  const experienceGroups = (() => {
    if (!resume.experienceGroups?.length) {
      return [{ id: "experience-all", title: "", roles: resume.experience }];
    }
    const rolesById = new Map(resume.experience.map((role) => [role.id, role]));
    const groupedIds = new Set<string>();
    const groups = resume.experienceGroups
      .map((group, index) => {
        const roles = group.roleIds
          .map((id) => rolesById.get(id))
          .filter((role): role is Resume["experience"][number] =>
            Boolean(role),
          );
        roles.forEach((role) => groupedIds.add(role.id));
        return {
          id: group.id || `experience-group-${index + 1}`,
          title:
            index === 0 &&
            normalizedHeading(group.title) === normalizedHeading(labels.experience)
              ? ""
              : group.title,
          roles,
        };
      })
      .filter((group) => group.roles.length > 0);
    const ungrouped = resume.experience.filter(
      (role) => !groupedIds.has(role.id),
    );
    if (ungrouped.length > 0) {
      groups.push({ id: "experience-ungrouped", title: "", roles: ungrouped });
    }
    return groups.length > 0
      ? groups
      : [{ id: "experience-all", title: "", roles: resume.experience }];
  })();

  return (
    <div className="paper flex flex-col p-10 text-[12.5px] leading-relaxed text-ink-800 font-serif">
      {resume.photo ? (
        <header className="order-0 flex items-center gap-4 border-b border-ink-100 pb-4">
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
              <ContactLine resume={resume} />
            </div>
          </div>
        </header>
      ) : (
        <header className="order-0 text-center border-b border-ink-100 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            {resume.name}
          </h1>
          <div className="text-sm text-ink-600 mt-0.5">{title}</div>
          <div className="text-[11px] text-ink-500 mt-1.5 font-sans">
            <ContactLine resume={resume} />
          </div>
        </header>
      )}

      {summary && (
        <section className="mt-5" style={{ order: sectionRank("summary", 10) }}>
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
        <section className="mt-5" style={{ order: sectionRank("skills", 20) }}>
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
      <section className="mt-5" style={{ order: sectionRank("experience", 30) }}>
        <SectionLabel>{labels.experience}</SectionLabel>
        <div className="space-y-5 mt-2">
          {experienceGroups.map((group) => (
            <div key={group.id} className="space-y-5">
              {group.title ? (
                <div className="font-sans text-[11px] font-semibold uppercase tracking-widest text-accent-700">
                  {group.title}
                </div>
              ) : null}
              {group.roles.map((role) => {
            const optRole = optimization?.roles.find((o) => o.id === role.id);
            const directSourceBullets = role.bullets.filter(
              (bullet) => !roleTeamBulletIds(role).has(bullet.id),
            );
            const directOptimizedBullets = optimizedDirectBullets(
              role,
              optRole,
            );
            const renderOriginalBullet = (
              b: Resume["experience"][number]["bullets"][number],
              key: string,
            ) => {
              const isActive = hoveredEvidence.includes(b.id);
              return (
                <li
                  key={key}
                  className={cn(
                    "transition-all rounded-md px-1 -mx-1",
                    evidenceActive && !isActive && "evidence-dim",
                    evidenceActive && isActive && "evidence-active",
                  )}
                >
                  {b.text}
                </li>
              );
            };
            const renderOptimizedBullet = (
              b: OptimizedBullet,
              key: string,
            ) => {
              const isActive = hoveredOptimizedId === b.id;
              const isFocused = focusedBulletId === b.id;
              return (
                <li
                  key={key}
                  ref={isFocused ? focusedRef : undefined}
                  onMouseEnter={() => setHoveredOptimizedId(b.id)}
                  onMouseLeave={() => setHoveredOptimizedId(null)}
                  className={cn(
                    "transition-all rounded-md px-1 -mx-1 cursor-default",
                    (isFocused || (evidenceMode && isActive)) &&
                      "evidence-active",
                  )}
                >
                  {b.text}
                </li>
              );
            };
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
                {(mode === "original"
                  ? directSourceBullets.length
                  : directOptimizedBullets.length) > 0 ? (
                  <ul className="mt-2 space-y-1.5 list-disc pl-5">
                    {mode === "original"
                      ? directSourceBullets.map((b, index) =>
                          renderOriginalBullet(
                            b,
                            `${role.id}:${b.id}:${index}`,
                          ),
                        )
                      : directOptimizedBullets.map((b, index) =>
                          renderOptimizedBullet(
                            b,
                            `${role.id}:${b.id}:${index}`,
                          ),
                        )}
                  </ul>
                ) : null}
                {role.teams?.map((team) => {
                  const bullets =
                    mode === "original"
                      ? sourceTeamBullets(role, team)
                      : optimizedTeamBullets(role, optRole, team);
                  if (bullets.length === 0) return null;
                  return (
                    <div key={team.id} className="mt-2 pl-4 font-sans">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="text-[11px] font-semibold text-ink-700">
                          {team.name}
                          {team.title ? (
                            <span className="font-normal text-ink-500">
                              {" "}
                              · {team.title}
                            </span>
                          ) : null}
                        </div>
                        {team.start || team.end ? (
                          <div className="shrink-0 text-[11px] text-ink-500">
                            {[team.start, team.end].filter(Boolean).join(" — ")}
                          </div>
                        ) : null}
                      </div>
                      {team.location ? (
                        <div className="text-[11px] text-ink-400">
                          {team.location}
                        </div>
                      ) : null}
                      <ul className="mt-1 space-y-1.5 list-disc pl-5 font-serif text-[12.5px] leading-relaxed">
                        {mode === "original"
                          ? bullets.map((b, index) =>
                              renderOriginalBullet(
                                b as Resume["experience"][number]["bullets"][number],
                                `${role.id}:${team.id}:${b.id}:${index}`,
                              ),
                            )
                          : bullets.map((b, index) =>
                              renderOptimizedBullet(
                                b as OptimizedBullet,
                                `${role.id}:${team.id}:${b.id}:${index}`,
                              ),
                            )}
                      </ul>
                    </div>
                  );
                })}
              </div>
            );
          })}
            </div>
          ))}
        </div>
      </section>
      )}

      {resume.projects && resume.projects.length > 0 && (
        <section className="mt-5" style={{ order: sectionRank("projects", 40) }}>
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
                      ? project.bullets.map((b, index) => {
                          const isActive = hoveredEvidence.includes(b.id);
                          return (
                            <li
                              key={`${project.id}:${b.id}:${index}`}
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
                      : (optProject?.bullets ?? []).map((b, index) => {
                          const isActive = hoveredOptimizedId === b.id;
                          const isFocused = focusedBulletId === b.id;
                          return (
                            <li
                              key={`${project.id}:${b.id}:${index}`}
                              ref={isFocused ? focusedRef : undefined}
                              onMouseEnter={() => setHoveredOptimizedId(b.id)}
                              onMouseLeave={() => setHoveredOptimizedId(null)}
                              className={cn(
                                "transition-all rounded-md px-1 -mx-1 cursor-default",
                                (isFocused || (evidenceMode && isActive)) &&
                                  "evidence-active",
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
        <section className="mt-5" style={{ order: sectionRank("education", 50) }}>
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
          <section
            key={section.id}
            className="mt-5"
            style={{
              order: sectionRank(`additional:${section.id}`, 60),
            }}
          >
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
                      {(mode === "optimized"
                        ? optimization?.additionalSections
                            ?.find((candidate) => candidate.id === section.id)
                            ?.items.find(
                              (candidate) => candidate.id === item.id,
                            )?.bullets ?? item.bullets
                        : item.bullets
                      ).map((bullet, index) => (
                        <li key={`${item.id}:${bullet.id}:${index}`}>
                          {bullet.text}
                        </li>
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
