import type {
  Optimization,
  Resume,
  ResumeSectionRef,
} from "../types";

type ResumeBlock =
  | { kind: "summary"; weight: number }
  | { kind: "skills"; weight: number }
  | { kind: "role"; id: string; weight: number }
  | { kind: "project"; id: string; weight: number }
  | { kind: "education"; index: number; weight: number }
  | {
      kind: "additional";
      sectionId: string;
      itemId: string;
      weight: number;
    };

export type ResumePageChunk = {
  resume: Resume;
  optimization: Optimization | null;
};

function textWeight(value: string): number {
  return Math.max(0.75, value.trim().length / 110);
}

function bulletWeight(values: string[]): number {
  return values.reduce(
    (total, value) => total + Math.max(0.8, value.trim().length / 95),
    0,
  );
}

function blocksForSection(
  ref: ResumeSectionRef,
  resume: Resume,
  optimization: Optimization | null,
): ResumeBlock[] {
  if (ref === "summary") {
    const summary = optimization?.summary || resume.summary;
    return summary ? [{ kind: "summary", weight: textWeight(summary) }] : [];
  }
  if (ref === "skills") {
    const skills =
      optimization?.skills?.length ? optimization.skills : resume.skills;
    return skills.length
      ? [
          {
            kind: "skills",
            weight: Math.max(0.8, skills.join(" · ").length / 90),
          },
        ]
      : [];
  }
  if (ref === "experience") {
    return resume.experience.map((role) => {
      const optimized = optimization?.roles.find(
        (candidate) => candidate.id === role.id,
      );
      const bullets = optimized?.bullets.length
        ? optimized.bullets.map((bullet) => bullet.text)
        : role.bullets.map((bullet) => bullet.text);
      return {
        kind: "role" as const,
        id: role.id,
        weight: 1.2 + bulletWeight(bullets),
      };
    });
  }
  if (ref === "projects") {
    return (resume.projects ?? []).map((project) => {
      const optimized = optimization?.projects?.find(
        (candidate) => candidate.id === project.id,
      );
      const bullets = optimized?.bullets.length
        ? optimized.bullets.map((bullet) => bullet.text)
        : project.bullets.map((bullet) => bullet.text);
      return {
        kind: "project" as const,
        id: project.id,
        weight: 1.2 + bulletWeight(bullets),
      };
    });
  }
  if (ref === "education") {
    return (resume.education ?? []).map((education, index) => ({
      kind: "education" as const,
      index,
      weight: textWeight(
        `${education.school} ${education.degree} ${education.year}`,
      ),
    }));
  }
  if (ref.startsWith("additional:")) {
    const sectionId = ref.slice("additional:".length);
    const section = (resume.additionalSections ?? []).find(
      (candidate) => candidate.id === sectionId,
    );
    return (section?.items ?? []).map((item) => ({
      kind: "additional" as const,
      sectionId,
      itemId: item.id,
      weight:
        textWeight(
          `${item.heading} ${item.subheading} ${item.start} ${item.end}`,
        ) + bulletWeight(item.bullets.map((bullet) => bullet.text)),
    }));
  }
  return [];
}

function orderedBlocks(
  resume: Resume,
  optimization: Optimization | null,
): ResumeBlock[] {
  const additionalRefs = (resume.additionalSections ?? []).map(
    (section) => `additional:${section.id}` as const,
  );
  const fallbackOrder: ResumeSectionRef[] = [
    "summary",
    "skills",
    "experience",
    "projects",
    "education",
    ...additionalRefs,
  ];
  const seen = new Set<ResumeSectionRef>();
  const order = [...(resume.sectionOrder ?? []), ...fallbackOrder].filter(
    (ref) => {
      if (seen.has(ref)) return false;
      seen.add(ref);
      return true;
    },
  );
  return order.flatMap((ref) =>
    blocksForSection(ref, resume, optimization),
  );
}

function splitBalanced(
  blocks: ResumeBlock[],
  pageCount: number,
): ResumeBlock[][] | null {
  if (pageCount < 2 || blocks.length < pageCount) return null;
  const groups: ResumeBlock[][] = [];
  let cursor = 0;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const remainingPages = pageCount - pageIndex;
    if (remainingPages === 1) {
      groups.push(blocks.slice(cursor));
      break;
    }
    const remaining = blocks.slice(cursor);
    const remainingWeight = remaining.reduce(
      (total, block) => total + block.weight,
      0,
    );
    const targetWeight = remainingWeight / remainingPages;
    const maximumEnd = blocks.length - (remainingPages - 1);
    const group: ResumeBlock[] = [];
    let groupWeight = 0;
    while (cursor < maximumEnd) {
      const next = blocks[cursor];
      if (
        group.length > 0 &&
        groupWeight >= targetWeight &&
        cursor < maximumEnd
      ) {
        break;
      }
      group.push(next);
      groupWeight += next.weight;
      cursor += 1;
    }
    groups.push(group);
  }
  return groups.length === pageCount && groups.every((group) => group.length)
    ? groups
    : null;
}

function chunkDocuments(
  blocks: ResumeBlock[],
  resume: Resume,
  optimization: Optimization | null,
): ResumePageChunk {
  const hasSummary = blocks.some((block) => block.kind === "summary");
  const hasSkills = blocks.some((block) => block.kind === "skills");
  const roleIds = new Set(
    blocks
      .filter((block): block is Extract<ResumeBlock, { kind: "role" }> =>
        block.kind === "role",
      )
      .map((block) => block.id),
  );
  const projectIds = new Set(
    blocks
      .filter((block): block is Extract<ResumeBlock, { kind: "project" }> =>
        block.kind === "project",
      )
      .map((block) => block.id),
  );
  const educationIndexes = new Set(
    blocks
      .filter(
        (block): block is Extract<ResumeBlock, { kind: "education" }> =>
          block.kind === "education",
      )
      .map((block) => block.index),
  );
  const additionalIds = new Set(
    blocks
      .filter(
        (block): block is Extract<ResumeBlock, { kind: "additional" }> =>
          block.kind === "additional",
      )
      .map((block) => `${block.sectionId}:${block.itemId}`),
  );

  const chunkResume: Resume = {
    ...resume,
    summary: hasSummary ? resume.summary : "",
    skills: hasSkills ? [...resume.skills] : [],
    experience: resume.experience.filter((role) => roleIds.has(role.id)),
    projects: (resume.projects ?? []).filter((project) =>
      projectIds.has(project.id),
    ),
    education: (resume.education ?? []).filter((_, index) =>
      educationIndexes.has(index),
    ),
    additionalSections: (resume.additionalSections ?? [])
      .map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          additionalIds.has(`${section.id}:${item.id}`),
        ),
      }))
      .filter((section) => section.items.length > 0),
  };
  const chunkOptimization: Optimization | null = optimization
    ? {
        ...optimization,
        summary: hasSummary ? optimization.summary : "",
        skills: hasSkills ? [...optimization.skills] : [],
        roles: optimization.roles.filter((role) => roleIds.has(role.id)),
        projects: (optimization.projects ?? []).filter((project) =>
          projectIds.has(project.id),
        ),
      }
    : null;
  return { resume: chunkResume, optimization: chunkOptimization };
}

export function partitionResumeForPages({
  resume,
  optimization,
  pageCount,
}: {
  resume: Resume;
  optimization: Optimization | null;
  pageCount: number;
}): ResumePageChunk[] | null {
  const groups = splitBalanced(
    orderedBlocks(resume, optimization),
    pageCount,
  );
  return groups?.map((blocks) =>
    chunkDocuments(blocks, resume, optimization),
  ) ?? null;
}
