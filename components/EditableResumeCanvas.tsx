"use client";

import type { Resume, ResumeRole, ResumeBullet } from "@/lib/types";
import { cn } from "@/lib/cn";
import {
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Wand2,
} from "lucide-react";
import { useState } from "react";

export function EditableResumeCanvas({
  resume,
  onResumeChange,
  onRegenerate,
  regenerating,
}: {
  resume: Resume;
  onResumeChange: (resume: Resume) => void;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

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

  const addBullet = (roleId: string) => {
    const updated = resume.experience.map((role) => {
      if (role.id === roleId) {
        return {
          ...role,
          bullets: [
            ...role.bullets,
            { id: `bullet-${Date.now()}`, text: "New achievement" },
          ],
        };
      }
      return role;
    });
    onResumeChange({ ...resume, experience: updated });
  };

  const deleteBullet = (roleId: string, bulletId: string) => {
    const updated = resume.experience.map((role) => {
      if (role.id === roleId) {
        return {
          ...role,
          bullets: role.bullets.filter((b) => b.id !== bulletId),
        };
      }
      return role;
    });
    onResumeChange({ ...resume, experience: updated });
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
          <h2 className="text-lg font-semibold text-ink-900">Edit Resume</h2>
          <p className="text-sm text-ink-500 mt-1">Click any field to edit. Changes update in real-time.</p>
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
              Regenerate
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
        <div className="space-y-3">
          {resume.skills.map((skill, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between px-3 py-2 rounded-md border border-ink-100 bg-white hover:bg-ink-50"
            >
              <span className="text-sm font-sans">{skill}</span>
              <button
                onClick={() => {
                  const updated = resume.skills.filter((_, i) => i !== idx);
                  onResumeChange({ ...resume, skills: updated });
                }}
                className="p-1 hover:bg-rose-100 rounded text-rose-500"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              const newSkill = prompt("Add new skill:");
              if (newSkill) {
                onResumeChange({
                  ...resume,
                  skills: [...resume.skills, newSkill],
                });
              }
            }}
            className="w-full px-3 py-2 rounded-md border-2 border-dashed border-ink-200 text-ink-500 hover:border-ink-300 hover:text-ink-600 text-sm font-medium transition"
          >
            <Plus size={14} className="inline mr-1" /> Add Skill
          </button>
        </div>
      </div>

      {/* Experience */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-900">Experience</h3>
        </div>
        {resume.experience.map((role) => (
          <div key={role.id} className="card p-6 border-l-4 border-l-accent-500">
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
              {role.bullets.map((bullet) => (
                <div key={bullet.id} className="flex gap-2 items-start">
                  <span className="mt-2 text-ink-400">•</span>
                  <input
                    type="text"
                    value={bullet.text}
                    onChange={(e) => updateBullet(role.id, bullet.id, e.target.value)}
                    className="flex-1 px-3 py-2 rounded-md border border-ink-100 hover:border-ink-200 text-sm font-sans resize-none"
                  />
                  <button
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
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-3 pt-6 border-t border-ink-100">
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          className="btn btn-primary"
        >
          {regenerating ? "Regenerating…" : "Regenerate with AI"}
        </button>
      </div>
    </div>
  );
}
