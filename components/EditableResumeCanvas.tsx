// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import type { Resume, ResumeRole, ResumeTeam } from "@/lib/types";
import { cn } from "@/lib/cn";
import {
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Wand2,
  Lock,
  Unlock,
} from "lucide-react";
import { useState } from "react";

export function EditableResumeCanvas({
  resume,
  optimizedPreview = false,
  onResumeChange,
  onRegenerate,
  regenerating,
  keptContentIds = [],
  lockedContentIds = [],
  onToggleKeep,
}: {
  resume: Resume;
  optimizedPreview?: boolean;
  onResumeChange: (resume: Resume) => void;
  onRegenerate: () => void;
  regenerating: boolean;
  keptContentIds?: string[];
  lockedContentIds?: string[];
  onToggleKeep?: (contentId: string) => void;
}) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const keptIds = new Set(keptContentIds);
  const lockedIds = new Set(lockedContentIds);

  const skillContentId = (skill: string) =>
    `skill:${skill.trim().toLocaleLowerCase().replace(/\s+/g, " ")}`;
  const skillKey = (skill: string) =>
    skill.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  // The source's own categories are content the reader navigates by, so the
  // editor shows them the way the resume does. Skills the categories never
  // claimed (or that came from a resume without categories) follow unlabeled.
  const skillSections = (() => {
    const present = new Set(resume.skills.map(skillKey));
    const claimed = new Set<string>();
    const sections = (resume.skillGroups ?? [])
      .map((group, index) => ({
        key: `group-${index}`,
        label: group.label,
        skills: group.skills.filter((skill) => {
          const key = skillKey(skill);
          if (!present.has(key) || claimed.has(key)) return false;
          claimed.add(key);
          return true;
        }),
      }))
      .filter((section) => section.skills.length > 0);
    const unclaimed = resume.skills.filter(
      (skill) => !claimed.has(skillKey(skill)),
    );
    if (sections.length === 0) {
      return [{ key: "all", label: "", skills: resume.skills }];
    }
    return unclaimed.length > 0
      ? [...sections, { key: "unclaimed", label: "", skills: unclaimed }]
      : sections;
  })();
  const removeSkill = (skill: string) => {
    const key = skillKey(skill);
    onResumeChange({
      ...resume,
      skills: resume.skills.filter((candidate) => skillKey(candidate) !== key),
      ...(resume.skillGroups
        ? {
            skillGroups: resume.skillGroups
              .map((group) => ({
                ...group,
                skills: group.skills.filter(
                  (candidate) => skillKey(candidate) !== key,
                ),
              }))
              .filter((group) => group.skills.length > 0),
          }
        : {}),
    });
  };
  const addSkill = (skill: string, groupLabel: string) => {
    if (resume.skills.some((candidate) => skillKey(candidate) === skillKey(skill))) {
      return;
    }
    onResumeChange({
      ...resume,
      skills: [...resume.skills, skill],
      ...(groupLabel && resume.skillGroups
        ? {
            skillGroups: resume.skillGroups.map((group) =>
              group.label === groupLabel
                ? { ...group, skills: [...group.skills, skill] }
                : group,
            ),
          }
        : {}),
    });
  };

  const KeepButton = ({
    contentId,
    compact = false,
  }: {
    contentId: string;
    compact?: boolean;
  }) => {
    const locked = lockedIds.has(contentId);
    const kept = locked || keptIds.has(contentId);
    const label = locked ? "Edited" : kept ? "Kept" : "Keep";
    return (
      <button
        type="button"
        disabled={locked || !onToggleKeep}
        aria-pressed={kept}
        aria-label={
          locked
            ? "This manually edited content is locked"
            : `${kept ? "Stop keeping" : "Keep"} this content during page fitting`
        }
        title={
          locked
            ? "Manual edits are locked and will not be rewritten by Fit"
            : kept
              ? "Allow Fit to shorten or remove this content"
              : "Prevent Fit from removing this content"
        }
        onClick={() => onToggleKeep?.(contentId)}
        className={cn(
          "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 disabled:cursor-default",
          kept
            ? "border-accent-200 bg-accent-50 text-accent-800"
            : "border-ink-200 bg-white text-ink-500 hover:border-accent-300 hover:text-accent-700",
          compact && "min-w-11 px-2",
        )}
      >
        {kept ? <Lock size={13} /> : <Unlock size={13} />}
        <span className={compact ? "sr-only" : undefined}>{label}</span>
      </button>
    );
  };

  const startEdit = (field: string, value: string) => {
    setEditingField(field);
    setEditValue(value);
  };

  const saveEdit = (field: string) => {
    if (field === "name") {
      onResumeChange({ ...resume, name: editValue });
    } else if (field === "title") {
      onResumeChange({ ...resume, title: editValue });
    } else if (field === "email") {
      onResumeChange({ ...resume, email: editValue });
    } else if (field === "phone") {
      onResumeChange({ ...resume, phone: editValue });
    } else if (field === "location") {
      onResumeChange({ ...resume, location: editValue });
    } else if (field === "summary") {
      onResumeChange({ ...resume, summary: editValue });
    }
    setEditingField(null);
  };

  const updateBullet = (roleId: string, bulletId: string, newText: string) => {
    const updated = resume.experience.map((role) => {
      if (role.id === roleId) {
        return {
          ...role,
          bullets: role.bullets.map((b) =>
            b.id === bulletId ? { ...b, text: newText } : b,
          ),
        };
      }
      return role;
    });
    onResumeChange({ ...resume, experience: updated });
  };

  const addBullet = (roleId: string, teamId?: string) => {
    const bullet = { id: `bullet-${Date.now()}`, text: "New achievement" };
    const updated = resume.experience.map((role) => {
      if (role.id === roleId) {
        return {
          ...role,
          bullets: [...role.bullets, bullet],
          teams: teamId
            ? (role.teams ?? []).map((team) =>
                team.id === teamId
                  ? { ...team, bulletIds: [...team.bulletIds, bullet.id] }
                  : team,
              )
            : role.teams,
        };
      }
      return role;
    });
    onResumeChange({ ...resume, experience: updated });
  };

  const deleteBullet = (roleId: string, bulletId: string) => {
    const updated = resume.experience.map((role) => {
      if (role.id === roleId) {
        const teams = (role.teams ?? [])
          .map((team) => ({
            ...team,
            bulletIds: team.bulletIds.filter((id) => id !== bulletId),
          }))
          .filter((team) => team.bulletIds.length > 0);
        const { teams: _teams, ...roleRest } = role;
        return {
          ...roleRest,
          bullets: role.bullets.filter((b) => b.id !== bulletId),
          ...(teams.length > 0 ? { teams } : {}),
        };
      }
      return role;
    });
    onResumeChange({ ...resume, experience: updated });
  };

  const projects = resume.projects ?? [];
  const teamBulletIds = (role: ResumeRole) =>
    new Set((role.teams ?? []).flatMap((team) => team.bulletIds));
  const teamBullets = (role: ResumeRole, team: ResumeTeam) => {
    const ids = new Set(team.bulletIds);
    return role.bullets.filter((bullet) => ids.has(bullet.id));
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
          .filter((role): role is ResumeRole => Boolean(role));
        roles.forEach((role) => groupedIds.add(role.id));
        return {
          id: group.id || `experience-group-${index + 1}`,
          title: group.title,
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

  const updateProjectBullet = (
    projectId: string,
    bulletId: string,
    newText: string,
  ) => {
    const updated = projects.map((project) => {
      if (project.id === projectId) {
        return {
          ...project,
          bullets: project.bullets.map((b) =>
            b.id === bulletId ? { ...b, text: newText } : b,
          ),
        };
      }
      return project;
    });
    onResumeChange({ ...resume, projects: updated });
  };

  const addProjectBullet = (projectId: string) => {
    const updated = projects.map((project) => {
      if (project.id === projectId) {
        return {
          ...project,
          bullets: [
            ...project.bullets,
            { id: `bullet-${Date.now()}`, text: "New achievement" },
          ],
        };
      }
      return project;
    });
    onResumeChange({ ...resume, projects: updated });
  };

  const deleteProjectBullet = (projectId: string, bulletId: string) => {
    const updated = projects.map((project) => {
      if (project.id === projectId) {
        return {
          ...project,
          bullets: project.bullets.filter((b) => b.id !== bulletId),
        };
      }
      return project;
    });
    onResumeChange({ ...resume, projects: updated });
  };

  const EditableField = ({
    fieldId,
    label,
    value,
    multiline = false,
  }: {
    fieldId: string;
    label: string;
    value: string;
    multiline?: boolean;
  }) => {
    const isEditing = editingField === fieldId;
    return (
      <div className="space-y-1">
        <label className="text-[10px] uppercase tracking-widest text-ink-400 font-medium">
          {label}
        </label>
        {isEditing ? (
          <div className="flex gap-2">
            {multiline ? (
              <textarea
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="flex-1 px-3 py-2 rounded-md border border-ink-200 text-sm font-sans resize-none"
                rows={3}
              />
            ) : (
              <input
                autoFocus
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="flex-1 px-3 py-2 rounded-md border border-ink-200 text-sm font-sans"
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit(fieldId);
                  if (e.key === "Escape") setEditingField(null);
                }}
              />
            )}
            <button
              onClick={() => saveEdit(fieldId)}
              className="p-2 hover:bg-accent-50 rounded-md text-accent-600"
            >
              <Check size={16} />
            </button>
            <button
              onClick={() => setEditingField(null)}
              className="p-2 hover:bg-ink-100 rounded-md text-ink-500"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div
            onClick={() => startEdit(fieldId, value)}
            className="group px-3 py-2 rounded-md border border-ink-100 bg-white hover:bg-ink-50 cursor-pointer transition"
          >
            <div className="flex items-start justify-between gap-2">
              <div className={cn("text-sm font-sans", value ? "text-ink-900" : "text-ink-400")}>
                {value || `Add ${label.toLowerCase()}`}
              </div>
              <Edit2 size={14} className="text-ink-300 group-hover:text-ink-400 opacity-0 group-hover:opacity-100 transition" />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6 pb-6 border-b border-ink-100">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">
            {optimizedPreview ? "Edit verified source fields" : "Edit Resume"}
          </h2>
          <p className="text-sm text-ink-500 mt-1">
            {optimizedPreview
              ? "The preview uses role-optimized wording and system section headings. Source-backed edits update it in real time."
              : "Click any field to edit. Changes update in real-time."}
          </p>
        </div>
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          className="btn btn-primary flex items-center gap-2"
        >
          {regenerating ? (
            <>
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Regenerating…
            </>
          ) : (
            <>
              <Wand2 size={14} />
              Regenerate content
            </>
          )}
        </button>
      </div>

      {/* Personal Info */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-ink-900 mb-4">Personal Info</h3>
        <div className="space-y-4">
          <EditableField
            fieldId="name"
            label="Name"
            value={resume.name}
          />
          <EditableField
            fieldId="title"
            label="Professional Title"
            value={resume.title}
          />
          <div className="grid grid-cols-3 gap-4">
            <EditableField
              fieldId="email"
              label="Email"
              value={resume.email}
            />
            <EditableField
              fieldId="phone"
              label="Phone"
              value={resume.phone}
            />
            <EditableField
              fieldId="location"
              label="Location"
              value={resume.location}
            />
          </div>
          <EditableField
            fieldId="summary"
            label="Professional Summary"
            value={resume.summary}
            multiline
          />
        </div>
      </div>

      {/* Skills */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-ink-900 mb-4">Skills</h3>
        <div className="space-y-4">
          {skillSections.map((section) => (
            <div key={section.key}>
              {section.label ? (
                <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-500">
                  {section.label}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {section.skills.map((skill, idx) => (
                  <div
                    key={`${skill}-${idx}`}
                    className="inline-flex min-h-11 items-center rounded-full border border-ink-200 bg-ink-50 pl-3 text-sm font-sans text-ink-900 transition hover:border-ink-300 hover:bg-white"
                  >
                    <span className="py-2">{skill}</span>
                    <KeepButton contentId={skillContentId(skill)} compact />
                    <button
                      type="button"
                      aria-label={`Remove ${skill}`}
                      onClick={() => removeSkill(skill)}
                      className="grid min-h-11 min-w-11 place-items-center rounded-full text-ink-400 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const newSkill = prompt(
                      section.label
                        ? `Add a skill under "${section.label}":`
                        : "Add new skill:",
                    )?.trim();
                    if (newSkill) addSkill(newSkill, section.label);
                  }}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-ink-300 px-4 text-sm font-medium text-ink-600 transition hover:border-accent-400 hover:bg-accent-50 hover:text-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2"
                >
                  <Plus size={14} /> Add Skill
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Experience */}
      <div className="space-y-6">
        {experienceGroups.map((group) => (
          <div key={group.id} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-900">
                {group.title || "Experience"}
              </h3>
            </div>
            {group.roles.map((role) => (
          <div key={role.id} className="card p-6 border-l-4 border-l-accent-500">
            <div className="mb-3 flex justify-end">
              <KeepButton contentId={role.id} />
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-ink-400 font-medium">
                  Company
                </label>
                <div className="px-3 py-2 rounded-md border border-ink-100 bg-white text-sm font-sans mt-1">
                  {role.company}
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-ink-400 font-medium">
                  Job Title
                </label>
                <div className="px-3 py-2 rounded-md border border-ink-100 bg-white text-sm font-sans mt-1">
                  {role.title}
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-ink-400 font-medium">
                  Start Date
                </label>
                <div className="px-3 py-2 rounded-md border border-ink-100 bg-white text-sm font-sans mt-1">
                  {role.start}
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-ink-400 font-medium">
                  End Date
                </label>
                <div className="px-3 py-2 rounded-md border border-ink-100 bg-white text-sm font-sans mt-1">
                  {role.end}
                </div>
              </div>
            </div>

            {/* Bullets */}
            <div className="mt-4 space-y-3 pt-4 border-t border-ink-100">
              <div className="text-xs font-medium text-ink-600 uppercase tracking-widest">
                Achievements
              </div>
              {role.bullets
                .filter((bullet) => !teamBulletIds(role).has(bullet.id))
                .map((bullet, bulletIndex) => (
                <div
                  key={`${role.id}:${bullet.id}:${bulletIndex}`}
                  className="flex gap-2 items-start"
                >
                  <span className="mt-2 text-ink-400">•</span>
                  <input
                    type="text"
                    value={bullet.text}
                    onChange={(e) => updateBullet(role.id, bullet.id, e.target.value)}
                    className="flex-1 px-3 py-2 rounded-md border border-ink-100 hover:border-ink-200 text-sm font-sans resize-none"
                  />
                  <KeepButton contentId={bullet.id} compact />
                  <button
                    type="button"
                    aria-label="Delete achievement"
                    onClick={() => deleteBullet(role.id, bullet.id)}
                    className="p-2 hover:bg-rose-100 rounded text-rose-500 shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => addBullet(role.id)}
                className="ml-5 text-sm font-medium text-accent-600 hover:text-accent-700 flex items-center gap-1"
              >
                <Plus size={14} /> Add achievement
              </button>
              {role.teams?.map((team) => {
                const bullets = teamBullets(role, team);
                return (
                  <div
                    key={team.id}
                    className="ml-3 mt-4 border-l border-ink-200 pl-4"
                  >
                    <div className="mb-2 font-sans text-sm font-semibold text-ink-800">
                      {team.name}
                      {team.title ? (
                        <span className="font-normal text-ink-500">
                          {" "}
                          · {team.title}
                        </span>
                      ) : null}
                    </div>
                    {bullets.map((bullet, bulletIndex) => (
                      <div
                        key={`${role.id}:${team.id}:${bullet.id}:${bulletIndex}`}
                        className="flex gap-2 items-start"
                      >
                        <span className="mt-2 text-ink-400">•</span>
                        <input
                          type="text"
                          value={bullet.text}
                          onChange={(e) =>
                            updateBullet(role.id, bullet.id, e.target.value)
                          }
                          className="flex-1 px-3 py-2 rounded-md border border-ink-100 hover:border-ink-200 text-sm font-sans resize-none"
                        />
                        <KeepButton contentId={bullet.id} compact />
                        <button
                          type="button"
                          aria-label="Delete achievement"
                          onClick={() => deleteBullet(role.id, bullet.id)}
                          className="p-2 hover:bg-rose-100 rounded text-rose-500 shrink-0"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => addBullet(role.id, team.id)}
                      className="ml-5 mt-2 text-sm font-medium text-accent-600 hover:text-accent-700 flex items-center gap-1"
                    >
                      <Plus size={14} /> Add achievement
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
            ))}
          </div>
        ))}
      </div>

      {/* Projects */}
      {projects.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-900">Projects</h3>
          </div>
          {projects.map((project) => (
            <div
              key={project.id}
              className="card p-6 border-l-4 border-l-accent-500"
            >
              <div className="mb-3 flex justify-end">
                <KeepButton contentId={project.id} />
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-ink-400 font-medium">
                    Project Name
                  </label>
                  <div className="px-3 py-2 rounded-md border border-ink-100 bg-white text-sm font-sans mt-1">
                    {project.name}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-ink-400 font-medium">
                    Role
                  </label>
                  <div className="px-3 py-2 rounded-md border border-ink-100 bg-white text-sm font-sans mt-1">
                    {project.role}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-ink-400 font-medium">
                    Start Date
                  </label>
                  <div className="px-3 py-2 rounded-md border border-ink-100 bg-white text-sm font-sans mt-1">
                    {project.start}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-ink-400 font-medium">
                    End Date
                  </label>
                  <div className="px-3 py-2 rounded-md border border-ink-100 bg-white text-sm font-sans mt-1">
                    {project.end}
                  </div>
                </div>
              </div>

              {/* Bullets */}
              <div className="mt-4 space-y-3 pt-4 border-t border-ink-100">
                <div className="text-xs font-medium text-ink-600 uppercase tracking-widest">
                  Achievements
                </div>
                {project.bullets.map((bullet, bulletIndex) => (
                  <div
                    key={`${project.id}:${bullet.id}:${bulletIndex}`}
                    className="flex gap-2 items-start"
                  >
                    <span className="mt-2 text-ink-400">•</span>
                    <input
                      type="text"
                      value={bullet.text}
                      onChange={(e) =>
                        updateProjectBullet(project.id, bullet.id, e.target.value)
                      }
                      className="flex-1 px-3 py-2 rounded-md border border-ink-100 hover:border-ink-200 text-sm font-sans resize-none"
                    />
                    <KeepButton contentId={bullet.id} compact />
                    <button
                      type="button"
                      aria-label="Delete achievement"
                      onClick={() => deleteProjectBullet(project.id, bullet.id)}
                      className="p-2 hover:bg-rose-100 rounded text-rose-500 shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addProjectBullet(project.id)}
                  className="ml-5 text-sm font-medium text-accent-600 hover:text-accent-700 flex items-center gap-1"
                >
                  <Plus size={14} /> Add achievement
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex justify-end gap-3 pt-6 border-t border-ink-100">
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          className="btn btn-primary"
        >
          {regenerating
            ? "Regenerating content…"
            : "Regenerate content with AI"}
        </button>
      </div>
    </div>
  );
}
