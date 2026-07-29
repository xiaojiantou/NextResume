// Copyright (c) 2026 HowBe LLC. All rights reserved.

import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import type { Optimization, Resume } from "@/lib/types";
import type { ResumePalette } from "./config";
import {
  getResumeSectionLabels,
  resolveResumeContent,
} from "./shared";

// Font size, whitespace, and leading are controlled independently so the
// export route can compact layout before it reduces text size.
function createStyles(
  palette: ResumePalette,
  fontScale: number,
  spacingScale: number,
  lineHeightScale: number,
) {
  const px = (v: number) => v * spacingScale;
  const margin = (v: number) => Math.max(36, v * spacingScale);
  const fs = (v: number) => v * fontScale;
  const body = (v = 10) => Math.max(10, fs(v));
  const lh = (v: number, floor = 1.18) =>
    Math.max(floor, v * lineHeightScale);
  return StyleSheet.create({
    page: {
      paddingTop: margin(44),
      paddingBottom: margin(44),
      paddingHorizontal: margin(52),
      fontSize: body(),
      lineHeight: lh(1.42),
      color: palette.text,
      backgroundColor: palette.background,
      fontFamily: "Times-Roman",
    },
    header: {
      textAlign: "center",
      borderBottomWidth: 2,
      borderBottomColor: palette.accent,
      paddingBottom: px(12),
    },
    headerWithPhoto: {
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 2,
      borderBottomColor: palette.accent,
      paddingBottom: px(12),
    },
    photo: {
      width: px(60),
      height: px(60),
      borderRadius: px(30),
      marginRight: px(16),
      objectFit: "cover",
    },
    headerTextBlock: {
      flex: 1,
      textAlign: "left",
    },
    name: {
      fontSize: fs(23),
      lineHeight: lh(1.1, 1.02),
      fontFamily: "Times-Bold",
      letterSpacing: -0.3,
      color: palette.text,
    },
    title: {
      fontSize: fs(11),
      color: palette.accent,
      marginTop: px(8),
      fontFamily: "Helvetica-Bold",
    },
    contact: {
      fontSize: fs(9),
      color: palette.muted,
      marginTop: px(5),
      fontFamily: "Helvetica",
    },
    sectionLabel: {
      fontSize: fs(8.5),
      fontFamily: "Helvetica-Bold",
      letterSpacing: 1.6,
      color: palette.accent,
      textTransform: "uppercase",
      marginBottom: px(6),
      paddingBottom: px(3),
      borderBottomWidth: 0.75,
      borderBottomColor: palette.border,
    },
    section: { marginTop: px(16) },
    summary: { fontSize: body(), color: palette.text, lineHeight: lh(1.5) },
    skills: {
      fontSize: body(),
      color: palette.text,
      fontFamily: "Helvetica",
      lineHeight: lh(1.6, 1.22),
    },
    skillGroupLabel: {
      fontFamily: "Helvetica-Bold",
      color: "#18181b",
    },
    roleHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginTop: px(9),
      fontFamily: "Helvetica",
    },
    roleTitleGroup: {
      flexGrow: 1,
      flexBasis: 0,
      paddingRight: px(9),
    },
    roleTitle: {
      fontSize: fs(10.5),
      fontFamily: "Helvetica-Bold",
      color: palette.text,
    },
    roleTitleMuted: { fontSize: fs(10.5), color: palette.muted },
    roleDates: {
      flexShrink: 0,
      maxWidth: "30%",
      textAlign: "right",
      fontSize: fs(9),
      color: palette.muted,
      fontFamily: "Helvetica-Bold",
    },
    roleLocation: {
      fontSize: fs(9),
      color: palette.muted,
      fontFamily: "Helvetica",
    },
    bulletRow: {
      flexDirection: "row",
      marginTop: px(4),
      paddingLeft: px(4),
    },
    bulletDot: {
      width: px(10),
      fontSize: body(),
      color: palette.accent,
    },
    bulletText: {
      flex: 1,
      fontSize: body(),
      lineHeight: lh(1.45),
    },
    eduRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: px(4),
      fontFamily: "Helvetica",
      fontSize: fs(9.5),
    },
    eduSchool: {
      fontFamily: "Helvetica-Bold",
      color: palette.text,
    },
  });
}

export function ResumePdf({
  palette,
  resume,
  optimization,
  includeSummary,
  fontScale = 1,
  spacingScale = 1,
  lineHeightScale = 1,
}: {
  palette: ResumePalette;
  resume: Resume;
  optimization: Optimization | null;
  includeSummary?: boolean;
  fontScale?: number;
  spacingScale?: number;
  lineHeightScale?: number;
}) {
  const {
    summary,
    title,
    skills,
    skillGroups,
    experience,
    projects,
    education,
    additionalSections,
    language,
  } = resolveResumeContent(resume, optimization, { includeSummary });
  const styles = createStyles(
    palette,
    fontScale,
    spacingScale,
    lineHeightScale,
  );
  const labels = getResumeSectionLabels(language);

  return (
    <Document
      title={`${resume.name} — Resume`}
      author={resume.name}
      creator="NextResume"
      producer="NextResume"
    >
      <Page size="LETTER" style={styles.page}>
        {resume.photo ? (
          <View style={styles.headerWithPhoto}>
            <Image src={resume.photo} style={styles.photo} />
            <View style={styles.headerTextBlock}>
              <Text style={styles.name}>{resume.name}</Text>
              {title ? <Text style={styles.title}>{title}</Text> : null}
              <Text style={styles.contact}>
                {[resume.email, resume.phone, resume.location, ...(resume.links ?? [])]
                  .filter(Boolean)
                  .join("  ·  ")}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.header}>
            <Text style={styles.name}>{resume.name}</Text>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            <Text style={styles.contact}>
              {[resume.email, resume.phone, resume.location, ...(resume.links ?? [])]
                .filter(Boolean)
                .join("  ·  ")}
            </Text>
          </View>
        )}

        {summary ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{labels.summary}</Text>
            <Text style={styles.summary}>{summary}</Text>
          </View>
        ) : null}

        {skills.length > 0 || skillGroups.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{labels.skills}</Text>
            {skillGroups.length > 0 ? (
              skillGroups.map((group) => (
                <Text key={group.label} style={styles.skills}>
                  <Text style={styles.skillGroupLabel}>
                    {group.label}:{" "}
                  </Text>
                  {group.skills.join(", ")}
                </Text>
              ))
            ) : (
              <Text style={styles.skills}>{skills.join("  ·  ")}</Text>
            )}
          </View>
        ) : null}

        {experience.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel} minPresenceAhead={48}>
              {labels.experience}
            </Text>
            {experience.map((role) => {
              return (
                <View key={role.id}>
                  <View wrap={false} minPresenceAhead={36}>
                    <View style={styles.roleHeader}>
                      <Text style={styles.roleTitleGroup}>
                        <Text style={styles.roleTitle}>{role.heading}</Text>
                        {role.subheading ? (
                          <Text style={styles.roleTitleMuted}>
                            {"  ·  "}
                            {role.subheading}
                          </Text>
                        ) : null}
                      </Text>
                      <Text style={styles.roleDates}>
                        {role.start} — {role.end}
                      </Text>
                    </View>
                    {role.location ? (
                      <Text style={styles.roleLocation}>{role.location}</Text>
                    ) : null}
                    {role.bullets[0] ? (
                      <View style={styles.bulletRow}>
                        <Text style={styles.bulletDot}>•</Text>
                        <Text style={styles.bulletText}>{role.bullets[0]}</Text>
                      </View>
                    ) : null}
                  </View>
                  {role.bullets.slice(1).map((text, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <Text style={styles.bulletDot}>•</Text>
                      <Text style={styles.bulletText}>{text}</Text>
                    </View>
                  ))}
                </View>
              );
            })}
          </View>
        ) : null}

        {projects.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel} minPresenceAhead={48}>
              {labels.projects}
            </Text>
            {projects.map((project) => {
              return (
                <View key={project.id}>
                  <View wrap={false} minPresenceAhead={36}>
                    <View style={styles.roleHeader}>
                      <Text style={styles.roleTitleGroup}>
                        <Text style={styles.roleTitle}>{project.heading}</Text>
                        {project.subheading ? (
                          <Text style={styles.roleTitleMuted}>
                            {"  ·  "}
                            {project.subheading}
                          </Text>
                        ) : null}
                      </Text>
                      <Text style={styles.roleDates}>
                        {project.start} — {project.end}
                      </Text>
                    </View>
                    {project.location ? (
                      <Text style={styles.roleLocation}>{project.location}</Text>
                    ) : null}
                    {project.bullets[0] ? (
                      <View style={styles.bulletRow}>
                        <Text style={styles.bulletDot}>•</Text>
                        <Text style={styles.bulletText}>
                          {project.bullets[0]}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {project.bullets.slice(1).map((text, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <Text style={styles.bulletDot}>•</Text>
                      <Text style={styles.bulletText}>{text}</Text>
                    </View>
                  ))}
                </View>
              );
            })}
          </View>
        ) : null}

        {education.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel} minPresenceAhead={48}>
              {labels.education}
            </Text>
            {education.map((e, i) => (
              <View key={i} style={styles.eduRow}>
                <Text>
                  <Text style={styles.eduSchool}>{e.school}</Text>
                  {e.degree ? (
                    <Text style={{ color: palette.muted }}>
                      {"  ·  "}
                      {e.degree}
                    </Text>
                  ) : null}
                </Text>
                <Text style={{ color: palette.muted }}>{e.year}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {additionalSections.map((section) =>
          section.items.length > 0 ? (
            <View key={section.id} style={styles.section}>
              <Text style={styles.sectionLabel} minPresenceAhead={48}>
                {section.title || labels[section.kind]}
              </Text>
              {section.items.map((item) => (
                <View key={item.id}>
                  <View
                    style={styles.roleHeader}
                    wrap={false}
                    minPresenceAhead={36}
                  >
                    <Text style={styles.roleTitleGroup}>
                      <Text style={styles.roleTitle}>{item.heading}</Text>
                      {item.subheading ? (
                        <Text style={styles.roleTitleMuted}>
                          {"  ·  "}
                          {item.subheading}
                        </Text>
                      ) : null}
                    </Text>
                    <Text style={styles.roleDates}>
                      {[item.start, item.end].filter(Boolean).join(" — ")}
                    </Text>
                  </View>
                  {item.location ? (
                    <Text style={styles.roleLocation}>{item.location}</Text>
                  ) : null}
                  {item.bullets.map((bullet, i) => (
                    <View key={bullet.id || i} style={styles.bulletRow}>
                      <Text style={styles.bulletDot}>•</Text>
                      <Text style={styles.bulletText}>{bullet.text}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ) : null,
        )}
      </Page>
    </Document>
  );
}
