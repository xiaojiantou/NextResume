// Shared "what goes on the resume" resolution, reused by every PDF style
// variant so they don't each re-implement the optimization/resume merge.
import type { Optimization, Resume } from "@/lib/types";

export type ResolvedBlock = {
  id: string;
  heading: string;
  subheading: string;
  location: string;
  start: string;
  end: string;
  bullets: string[];
};

export function resolveResumeContent(
  resume: Resume,
  optimization: Optimization | null,
) {
  const summary = optimization?.summary || resume.summary;
  const title = optimization?.title || resume.title;
  const skills =
    optimization?.skills && optimization.skills.length > 0
      ? optimization.skills
      : resume.skills;

  const experience: ResolvedBlock[] = resume.experience.map((role) => {
    const opt = optimization?.roles.find((r) => r.id === role.id);
    const bullets = opt?.bullets.length
      ? opt.bullets.map((b) => b.text)
      : role.bullets.map((b) => b.text);
    return {
      id: role.id,
      heading: role.company,
      subheading: role.title,
      location: role.location,
      start: role.start,
      end: role.end,
      bullets,
    };
  });

  const projects: ResolvedBlock[] = (resume.projects ?? []).map(
    (project) => {
      const opt = optimization?.projects?.find((p) => p.id === project.id);
      const bullets = opt?.bullets.length
        ? opt.bullets.map((b) => b.text)
        : project.bullets.map((b) => b.text);
      return {
        id: project.id,
        heading: project.name,
        subheading: project.role,
        location: project.location,
        start: project.start,
        end: project.end,
        bullets,
      };
    },
  );

  return { summary, title, skills, experience, projects, education: resume.education };
}
