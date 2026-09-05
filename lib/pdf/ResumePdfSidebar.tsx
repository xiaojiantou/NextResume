// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { Fragment } from "react";
import { Document, Link, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { contactEntries } from "./ContactLine";
import type { Optimization, Resume, ResumePageSpec } from "@/lib/types";
import type { ResumePalette } from "./config";
import {
  compactAdditionalItemLabel,
  getResumeSectionLabels,
  isCompactAdditionalSection,
  resolveResumeContent,
} from "./shared";

function createStyles(
  palette: ResumePalette,
  fontScale: number,
  spacingScale: number,
  lineHeightScale: number,
  minimumBodyPt: number,
  minimumMarginPt: number,
) {
  const px = (v: number) => v * spacingScale;
  const margin = (v: number) => Math.max(minimumMarginPt, v * spacingScale);
  const fs = (v: number) => Math.max(8, v * fontScale);
  const body = (v = 10) => Math.max(minimumBodyPt, fs(v));
  const lh = (v: number, floor = 1.1) =>
    Math.max(floor, v * lineHeightScale);
  return StyleSheet.create({
    page: {
      flexDirection: "row",
      fontSize: body(),
      lineHeight: lh(1.42),
      color: palette.text,
      backgroundColor: palette.background,
      fontFamily: "Helvetica",
    },
    sidebar: {
      width: "35%",
      minHeight: "100%",
      backgroundColor: palette.sidebarBackground,
      color: palette.sidebarText,
      paddingTop: margin(40),
      paddingHorizontal: margin(36),
      paddingBottom: margin(40),
    },
    main: {
      width: "65%",
      minHeight: "100%",
      paddingTop: margin(40),
      paddingHorizontal: margin(36),
      paddingBottom: margin(40),
    },
    photo: {
      width: px(76),
      height: px(76),
      borderRadius: px(38),
      alignSelf: "center",
      marginBottom: px(16),
      objectFit: "cover",
    },
    sideLabel: {
      fontSize: fs(8),
      fontFamily: "Helvetica-Bold",
      letterSpacing: 1.4,
      textTransform: "uppercase",
      color: palette.sidebarText,
      marginBottom: px(5),
      marginTop: px(18),
    },
    sideText: {
      fontSize: fs(9),
      color: palette.sidebarText,
      lineHeight: lh(1.5),
    },
    // A link keeps the contact line's colour: the default blue underline
    // would restyle a header the user never asked us to change.
    sideLink: { color: palette.sidebarText, textDecoration: "none" },
    skillPill: {
      fontSize: fs(8.5),
      color: palette.sidebarText,
      backgroundColor: "rgba(255,255,255,0.16)",
      paddingVertical: px(3),
      paddingHorizontal: px(7),
      borderRadius: px(3),
      marginBottom: px(4),
      marginRight: px(4),
    },
    skillWrap: { flexDirection: "row", flexWrap: "wrap" },
    skillGroupLabel: {
      fontSize: fs(8),
      fontFamily: "Helvetica-Bold",
      color: palette.sidebarText,
      marginTop: px(5),
      marginBottom: px(3),
    },
    eduBlock: { marginBottom: px(8) },
    eduSchool: {
      fontSize: fs(9),
      fontFamily: "Helvetica-Bold",
      color: palette.sidebarText,
    },
    eduDetail: {
      fontSize: fs(8.5),
      color: palette.sidebarText,
      marginTop: px(1),
    },
    name: {
      fontSize: fs(22),
      lineHeight: lh(1.1, 1.02),
      fontFamily: "Helvetica-Bold",
      color: palette.text,
      letterSpacing: -0.3,
    },
    title: {
      fontSize: fs(11),
      color: palette.accent,
      fontFamily: "Helvetica-Bold",
      marginTop: px(8),
    },
    mainSectionLabel: {
      fontSize: fs(9),
      fontFamily: "Helvetica-Bold",
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: palette.accent,
      marginTop: px(18),
      marginBottom: px(6),
    },
    summary: { fontSize: body(), color: palette.text, lineHeight: lh(1.5) },
    compactAdditional: {
      fontSize: body(),
      color: palette.text,
      lineHeight: lh(1.5),
    },
    roleHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
    },
    roleHeadingGroup: {
      flexGrow: 1,
      flexBasis: 0,
      paddingRight: px(8),
    },
    roleHeading: {
      fontSize: fs(10),
      fontFamily: "Helvetica-Bold",
      color: palette.text,
    },
    roleSub: { fontSize: fs(9), color: palette.muted, marginTop: px(1) },
    roleDates: {
      flexShrink: 0,
      maxWidth: "32%",
      textAlign: "right",
      fontSize: fs(8.5),
      color: palette.muted,
      marginTop: px(1),
    },
    roleBlock: { marginTop: px(10) },
    teamBlock: { marginTop: px(6), paddingLeft: px(10) },
    teamHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
    },
    teamHeadingGroup: {
      flexGrow: 1,
      flexBasis: 0,
      paddingRight: px(7),
    },
    teamHeading: {
      fontSize: fs(9.2),
      fontFamily: "Helvetica-Bold",
      color: palette.text,
    },
    teamSub: { fontSize: fs(8.3), color: palette.muted, marginTop: px(1) },
    teamDates: {
      flexShrink: 0,
      maxWidth: "32%",
      textAlign: "right",
      fontSize: fs(8.1),
      color: palette.muted,
      marginTop: px(1),
    },
    bulletRow: { flexDirection: "row", marginTop: px(4), paddingLeft: px(2) },
    bulletDot: { width: px(10), fontSize: body(), color: palette.accent },
    bulletText: {
      flex: 1,
      fontSize: body(),
      lineHeight: lh(1.4),
      color: palette.text,
    },
  });
}

export function ResumePdfSidebar({
  palette,
  resume,
  optimization,
  includeSummary,
  fontScale = 1,
  spacingScale = 1,
  lineHeightScale = 1,
  minimumBodyPt = 10,
  minimumMarginPt = 36,
  pageSize,
}: {
  palette: ResumePalette;
  resume: Resume;
  optimization: Optimization | null;
  includeSummary?: boolean;
  fontScale?: number;
  spacingScale?: number;
  lineHeightScale?: number;
  minimumBodyPt?: number;
  minimumMarginPt?: number;
  pageSize?: ResumePageSpec;
}) {
  const styles = createStyles(
    palette,
    fontScale,
    spacingScale,
    lineHeightScale,
    minimumBodyPt,
    minimumMarginPt,
  );
  const {
    summary,
    title,
    skills,
    skillGroups,
    experience,
    experienceGroups,
    projects,
    education,
    additionalSections,
    language,
    sectionLabels,
    sectionOrder,
  } =
    resolveResumeContent(resume, optimization, { includeSummary });
  const labels = getResumeSectionLabels(language, sectionLabels);
  const sidebarOrder = sectionOrder.filter(
    (ref) => ref === "skills" || ref === "education",
  );
  const mainOrder = sectionOrder.filter(
    (ref) => ref !== "skills" && ref !== "education",
  );
  const renderBullet = (text: string, key: string) => (
    <View key={key} style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
  const renderTeam = (
    team: NonNullable<(typeof experience)[number]["teams"]>[number],
  ) => (
    <View key={team.id} style={styles.teamBlock}>
      <View wrap={false} minPresenceAhead={28}>
        <View style={styles.teamHeader}>
          <View style={styles.teamHeadingGroup}>
            <Text style={styles.teamHeading}>{team.heading}</Text>
            {team.subheading ? (
              <Text style={styles.teamSub}>{team.subheading}</Text>
            ) : null}
          </View>
          {team.start || team.end ? (
            <Text style={styles.teamDates}>
              {[team.start, team.end].filter(Boolean).join(" — ")}
            </Text>
          ) : null}
        </View>
        {team.location ? (
          <Text style={styles.teamSub}>{team.location}</Text>
        ) : null}
        {team.bullets[0]
          ? renderBullet(team.bullets[0], `${team.id}-bullet-0`)
          : null}
      </View>
      {team.bullets
        .slice(1)
        .map((text, index) =>
          renderBullet(text, `${team.id}-bullet-${index + 1}`),
        )}
    </View>
  );
  const renderSidebarSection = (ref: (typeof sectionOrder)[number]) => {
    if (ref === "skills" && (skills.length > 0 || skillGroups.length > 0)) {
      return (
        <View key={ref}>
          <Text style={styles.sideLabel}>{labels.skills}</Text>
          {skillGroups.length > 0 ? (
            skillGroups.map((group, index) => (
              <View key={group.label || `ungrouped-${index}`}>
                {group.label ? (
                  <Text style={styles.skillGroupLabel}>{group.label}</Text>
                ) : null}
                <View style={styles.skillWrap}>
                  {group.skills.map((skill) => (
                    <Text key={skill} style={styles.skillPill}>{skill}</Text>
                  ))}
                </View>
              </View>
            ))
          ) : (
            <View style={styles.skillWrap}>
              {skills.map((skill, index) => (
                <Text key={`${skill}-${index}`} style={styles.skillPill}>
                  {skill}
                </Text>
              ))}
            </View>
          )}
        </View>
      );
    }
    if (ref === "education" && education.length > 0) {
      return (
        <View key={ref}>
          <Text style={styles.sideLabel}>{labels.education}</Text>
          {education.map((entry, index) => (
            <View key={index} style={styles.eduBlock}>
              <Text style={styles.eduSchool}>{entry.school}</Text>
              {entry.degree ? (
                <Text style={styles.eduDetail}>{entry.degree}</Text>
              ) : null}
              {entry.year ? (
                <Text style={styles.eduDetail}>{entry.year}</Text>
              ) : null}
            </View>
          ))}
        </View>
      );
    }
    return null;
  };
  const renderBlocks = (blocks: typeof experience) =>
    blocks.map((block) => (
      <View key={block.id} style={styles.roleBlock}>
        <View wrap={false} minPresenceAhead={36}>
          <View style={styles.roleHeader}>
            <View style={styles.roleHeadingGroup}>
              <Text style={styles.roleHeading}>{block.heading}</Text>
              <Text style={styles.roleSub}>
                {[block.subheading, block.location].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <Text style={styles.roleDates}>
              {block.start} — {block.end}
            </Text>
          </View>
          {block.bullets[0] ? (
            renderBullet(block.bullets[0], `${block.id}-bullet-0`)
          ) : null}
        </View>
        {block.bullets.slice(1).map((text, index) => (
          renderBullet(text, `${block.id}-bullet-${index + 1}`)
        ))}
        {block.teams?.map(renderTeam)}
      </View>
    ));
  // Each source employment heading ("Professional Experience", "Earlier
  // Experience") is a peer section, not a sub-label inside one.
  const experienceSections =
    experienceGroups.length > 0
      ? experienceGroups.map((group) => ({
          key: group.id,
          label: group.title || labels.experience,
          blocks: group.blocks,
        }))
      : [{ key: "experience", label: labels.experience, blocks: experience }];
  const renderMainSection = (ref: (typeof sectionOrder)[number]) => {
    if (ref === "summary") {
      return summary ? (
        <View key={ref}>
          <Text style={styles.mainSectionLabel} minPresenceAhead={48}>{labels.summary}</Text>
          <Text style={styles.summary}>{summary}</Text>
        </View>
      ) : null;
    }
    if (ref === "experience" || ref === "projects") {
      const sections =
        ref === "experience"
          ? experienceSections
          : [{ key: ref, label: labels.projects, blocks: projects }];
      return sections.some((section) => section.blocks.length > 0) ? (
        <Fragment key={ref}>
          {sections.map((section) => (
            <View key={section.key}>
              <Text style={styles.mainSectionLabel} minPresenceAhead={48}>
                {section.label}
              </Text>
              {renderBlocks(section.blocks)}
            </View>
          ))}
        </Fragment>
      ) : null;
    }
    const id = ref.slice("additional:".length);
    const section = additionalSections.find((candidate) => candidate.id === id);
    return section?.items.length ? (
      <View key={ref}>
        <Text style={styles.mainSectionLabel} minPresenceAhead={48}>
          {section.title || labels[section.kind]}
        </Text>
        {isCompactAdditionalSection(section) ? (
          <Text style={styles.compactAdditional}>
            {section.items.map(compactAdditionalItemLabel).join("  ·  ")}
          </Text>
        ) : section.items.map((item) => (
          <View key={item.id} style={styles.roleBlock}>
            <View wrap={false} minPresenceAhead={36}>
              <Text style={styles.roleHeading}>{item.heading}</Text>
              {item.subheading || item.location ? (
                <Text style={styles.roleSub}>
                  {[item.subheading, item.location].filter(Boolean).join(" · ")}
                </Text>
              ) : null}
              {item.start || item.end ? (
                <Text style={styles.roleDates}>
                  {[item.start, item.end].filter(Boolean).join(" — ")}
                </Text>
              ) : null}
            </View>
            {item.bullets.map((bullet) => (
              <View key={bullet.id} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText}>{bullet.text}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    ) : null;
  };

  return (
    <Document
      title={`${resume.name} — Resume`}
      author={resume.name}
      creator="NextResume"
      producer="NextResume"
    >
      <Page
        size={
          pageSize
            ? { width: pageSize.widthPt, height: pageSize.heightPt }
            : "LETTER"
        }
        style={styles.page}
      >
        <View style={styles.sidebar}>
          {resume.photo ? <Image src={resume.photo} style={styles.photo} /> : null}

          {contactEntries(
            [resume.email, resume.phone, resume.location],
            resume.links,
          ).length > 0 ? (
            <>
              <Text style={styles.sideLabel}>Contact</Text>
              {contactEntries(
                [resume.email, resume.phone, resume.location],
                resume.links,
              ).map((entry) => (
                <Text key={entry.key} style={styles.sideText}>
                  {entry.url ? (
                    <Link src={entry.url} style={styles.sideLink}>
                      {entry.label}
                    </Link>
                  ) : (
                    entry.label
                  )}
                </Text>
              ))}
            </>
          ) : null}

          {sidebarOrder.map(renderSidebarSection)}
        </View>

        <View style={styles.main}>
          <Text style={styles.name}>{resume.name}</Text>
          {title ? <Text style={styles.title}>{title}</Text> : null}

          {mainOrder.map(renderMainSection)}
        </View>
      </Page>
    </Document>
  );
}
