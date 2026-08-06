import type {
  Optimization,
  Resume,
  ResumeSectionRef,
} from "../types";

type ResumeBlock =
  | { kind: "summary"; weight: number }
  | { kind: "skills"; weight: number }
  | { kind: "role"; id: string; bulletIds: string[]; weight: number }
  | { kind: "project"; id: string; bulletIds: string[]; weight: number }
  | { kind: "education"; index: number; weight: number }
  | {
      kind: "additional";
      sectionId: string;
      itemId: string;
      bulletIds: string[];
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
    const summary = optimization ? optimization.summary : resume.summary;
    return summary ? [{ kind: "summary", weight: textWeight(summary) }] : [];
  }
  if (ref === "skills") {
    const skills = optimization ? optimization.skills : resume.skills;
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
    return resume.experience.flatMap((role) => {
      const optimized = optimization?.roles.find(
        (candidate) => candidate.id === role.id,
      );
      const bullets = optimized ? optimized.bullets : role.bullets;
      if (bullets.length === 0) {
        return [{ kind: "role" as const, id: role.id, bulletIds: [], weight: 1.2 }];
      }
      return bullets.map((bullet, index) => ({
        kind: "role" as const,
        id: role.id,
        bulletIds: [bullet.id],
        weight: (index === 0 ? 1.2 : 0.2) + bulletWeight([bullet.text]),
      }));
    });
  }
  if (ref === "projects") {
    return (resume.projects ?? []).flatMap((project) => {
      const optimized = optimization?.projects?.find(
        (candidate) => candidate.id === project.id,
      );
      const bullets = optimized ? optimized.bullets : project.bullets;
      if (bullets.length === 0) {
        return [{ kind: "project" as const, id: project.id, bulletIds: [], weight: 1.2 }];
      }
      return bullets.map((bullet, index) => ({
        kind: "project" as const,
        id: project.id,
        bulletIds: [bullet.id],
        weight: (index === 0 ? 1.2 : 0.2) + bulletWeight([bullet.text]),
      }));
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
    const optimizedSection = optimization?.additionalSections?.find(
      (candidate) => candidate.id === sectionId,
    );
    return (section?.items ?? []).flatMap((item) => {
      const optimizedItem = optimizedSection?.items.find(
        (candidate) => candidate.id === item.id,
      );
      const bullets = optimizedItem ? optimizedItem.bullets : item.bullets;
      const headingWeight = textWeight(
        `${item.heading} ${item.subheading} ${item.start} ${item.end}`,
      );
      if (bullets.length === 0) {
        return [{
          kind: "additional" as const,
          sectionId,
          itemId: item.id,
          bulletIds: [],
          weight: headingWeight,
        }];
      }
      return bullets.map((bullet, index) => ({
        kind: "additional" as const,
        sectionId,
        itemId: item.id,
        bulletIds: [bullet.id],
        weight:
          (index === 0 ? headingWeight : 0.2) + bulletWeight([bullet.text]),
      }));
    });
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
  const order = [
    ...(optimization?.sectionOrder ?? resume.sectionOrder ?? []),
    ...fallbackOrder,
  ].filter(
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
  const roleBlocks = blocks.filter(
    (block): block is Extract<ResumeBlock, { kind: "role" }> =>
      block.kind === "role",
  );
  const projectBlocks = blocks.filter(
    (block): block is Extract<ResumeBlock, { kind: "project" }> =>
      block.kind === "project",
  );
  const roleIds = new Set(roleBlocks.map((block) => block.id));
  const projectIds = new Set(projectBlocks.map((block) => block.id));
  const roleBulletIds = new Map<string, Set<string>>();
  const projectBulletIds = new Map<string, Set<string>>();
  for (const block of roleBlocks) {
    const ids = roleBulletIds.get(block.id) ?? new Set<string>();
    block.bulletIds.forEach((id) => ids.add(id));
    roleBulletIds.set(block.id, ids);
  }
  for (const block of projectBlocks) {
    const ids = projectBulletIds.get(block.id) ?? new Set<string>();
    block.bulletIds.forEach((id) => ids.add(id));
    projectBulletIds.set(block.id, ids);
  }
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
  const additionalBulletIds = new Map<string, Set<string>>();
  for (const block of blocks) {
    if (block.kind !== "additional") continue;
    const key = `${block.sectionId}:${block.itemId}`;
    const ids = additionalBulletIds.get(key) ?? new Set<string>();
    block.bulletIds.forEach((id) => ids.add(id));
    additionalBulletIds.set(key, ids);
  }

  const chunkResume: Resume = {
    ...resume,
    summary: hasSummary ? resume.summary : "",
    skills: hasSkills ? [...resume.skills] : [],
    experience: resume.experience
      .filter((role) => roleIds.has(role.id))
      .map((role) => ({
        ...role,
        bullets: role.bullets.filter((bullet) =>
          roleBulletIds.get(role.id)?.has(bullet.id),
        ),
      })),
    projects: (resume.projects ?? [])
      .filter((project) => projectIds.has(project.id))
      .map((project) => ({
        ...project,
        bullets: project.bullets.filter((bullet) =>
          projectBulletIds.get(project.id)?.has(bullet.id),
        ),
      })),
    education: (resume.education ?? []).filter((_, index) =>
      educationIndexes.has(index),
    ),
    additionalSections: (resume.additionalSections ?? [])
      .map((section) => ({
        ...section,
        items: section.items
          .filter((item) =>
            additionalIds.has(`${section.id}:${item.id}`),
          )
          .map((item) => ({
            ...item,
            bullets: item.bullets.filter((bullet) =>
              additionalBulletIds
                .get(`${section.id}:${item.id}`)
                ?.has(bullet.id),
            ),
          })),
      }))
      .filter((section) => section.items.length > 0),
  };
  const chunkOptimization: Optimization | null = optimization
    ? {
        ...optimization,
        summary: hasSummary ? optimization.summary : "",
        skills: hasSkills ? [...optimization.skills] : [],
        skillEvidence: hasSkills ? optimization.skillEvidence : [],
        roles: optimization.roles
          .filter((role) => roleIds.has(role.id))
          .map((role) => ({
            ...role,
            bullets: role.bullets.filter((bullet) =>
              roleBulletIds.get(role.id)?.has(bullet.id),
            ),
          })),
        projects: (optimization.projects ?? [])
          .filter((project) => projectIds.has(project.id))
          .map((project) => ({
            ...project,
            bullets: project.bullets.filter((bullet) =>
              projectBulletIds.get(project.id)?.has(bullet.id),
            ),
          })),
        additionalSections: (optimization.additionalSections ?? [])
          .map((section) => ({
            ...section,
            items: section.items
              .filter((item) =>
                additionalIds.has(`${section.id}:${item.id}`),
              )
              .map((item) => ({
                ...item,
                bullets: item.bullets.filter((bullet) =>
                  additionalBulletIds
                    .get(`${section.id}:${item.id}`)
                    ?.has(bullet.id),
                ),
              })),
          }))
          .filter((section) => section.items.length > 0),
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
  if (!groups) return null;
  const seenRoles = new Set<string>();
  const seenProjects = new Set<string>();
  const seenAdditionalItems = new Set<string>();
  return groups.map((blocks) => {
    const chunk = chunkDocuments(blocks, resume, optimization);
    chunk.resume = {
      ...chunk.resume,
      experience: chunk.resume.experience.map((role) => {
        const continued = seenRoles.has(role.id);
        seenRoles.add(role.id);
        return continued
          ? { ...role, title: `${role.title} (continued)` }
          : role;
      }),
      projects: (chunk.resume.projects ?? []).map((project) => {
        const continued = seenProjects.has(project.id);
        seenProjects.add(project.id);
        return continued
          ? { ...project, name: `${project.name} (continued)` }
          : project;
      }),
      additionalSections: (chunk.resume.additionalSections ?? []).map(
        (section) => ({
          ...section,
          items: section.items.map((item) => {
            const key = `${section.id}:${item.id}`;
            const continued = seenAdditionalItems.has(key);
            seenAdditionalItems.add(key);
            return continued
              ? { ...item, heading: `${item.heading} (continued)` }
              : item;
          }),
        }),
      ),
    };
    return chunk;
  });
}
