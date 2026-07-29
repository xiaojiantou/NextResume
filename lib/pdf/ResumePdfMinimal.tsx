// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import type { Optimization, Resume } from "@/lib/types";
import type { ResumePalette } from "./config";
import { getResumeSectionLabels, resolveResumeContent } from "./shared";

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
      paddingTop: margin(42),
      paddingBottom: margin(42),
      paddingHorizontal: margin(46),
      fontSize: body(),
      lineHeight: lh(1.4),
      color: palette.text,
      backgroundColor: palette.background,
      fontFamily: "Helvetica",
    },
    headerRow: { flexDirection: "row", alignItems: "center" },
    photo: {
      width: px(54),
      height: px(54),
      borderRadius: px(27),
      marginRight: px(14),
      objectFit: "cover",
    },
    name: {
      fontSize: fs(24),
      lineHeight: lh(1.1, 1.02),
      fontFamily: "Helvetica-Bold",
      color: palette.text,
      letterSpacing: -0.4,
    },
    title: {
      fontSize: fs(11),
      color: palette.accent,
      marginTop: px(8),
      fontFamily: "Helvetica",
    },
    contact: { fontSize: fs(8.5), color: palette.muted, marginTop: px(6) },
    sectionTag: {
      fontSize: fs(7.5),
      fontFamily: "Helvetica-Bold",
      color: "#ffffff",
      backgroundColor: palette.accent,
      paddingVertical: px(3),
      paddingHorizontal: px(8),
      borderRadius: px(3),
      letterSpacing: 1,
      textTransform: "uppercase",
      alignSelf: "flex-start",
    },
    section: { marginTop: px(18) },
    summary: {
      fontSize: body(),
      color: palette.text,
      lineHeight: lh(1.55),
      marginTop: px(8),
    },
    skillWrap: { flexDirection: "row", flexWrap: "wrap", marginTop: px(8) },
    skillGroupRow: { marginTop: px(4) },
    skillGroupLabel: {
      fontSize: fs(8.5),
      fontFamily: "Helvetica-Bold",
      color: "#18181b",
      marginTop: px(4),
    },
    skillPill: {
      fontSize: fs(8.5),
      color: palette.accent,
      backgroundColor: palette.soft,
      paddingVertical: px(3),
      paddingHorizontal: px(7),
      borderRadius: px(3),
      marginRight: px(5),
      marginBottom: px(5),
    },
    roleBlock: { marginTop: px(12) },
    roleHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
    },
    roleHeadingGroup: {
      flexGrow: 1,
      flexBasis: 0,
      paddingRight: px(9),
    },
    roleHeading: {
      fontSize: fs(10),
      fontFamily: "Helvetica-Bold",
      color: palette.text,
    },
    roleSub: { fontSize: fs(9), color: palette.muted },
    roleDates: {
      flexShrink: 0,
      maxWidth: "30%",
      textAlign: "right",
      fontSize: fs(8.5),
      color: palette.muted,
      fontFamily: "Helvetica-Bold",
    },
    roleLocation: { fontSize: fs(8.5), color: palette.muted, marginTop: px(1) },
    bulletRow: { flexDirection: "row", marginTop: px(5), paddingLeft: px(2) },
    bulletDash: {
      width: px(12),
      fontSize: fs(9.5),
      color: palette.accent,
      fontFamily: "Helvetica-Bold",
    },
    bulletText: {
      flex: 1,
      fontSize: body(),
      lineHeight: lh(1.45),
      color: palette.text,
    },
    eduRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: px(6),
    },
    eduSchool: {
      fontSize: body(),
      fontFamily: "Helvetica-Bold",
      color: palette.text,
    },
    eduDetail: { fontSize: fs(9), color: palette.muted },
  });
}

export function ResumePdfMinimal({
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
  const styles = createStyles(
    palette,
    fontScale,
    spacingScale,
    lineHeightScale,
  );
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
  } =
    resolveResumeContent(resume, optimization, { includeSummary });
  const labels = getResumeSectionLabels(language);

  return (
    <Document
      title={`${resume.name} — Resume`}
      author={resume.name}
      creator="NextResume"
      producer="NextResume"
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          {resume.photo ? <Image src={resume.photo} style={styles.photo} /> : null}
          <View>
            <Text style={styles.name}>{resume.name}</Text>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            <Text style={styles.contact}>
              {[resume.email, resume.phone, resume.location, ...(resume.links ?? [])]
                .filter(Boolean)
                .join("   ·   ")}
            </Text>
          </View>
        </View>

        {summary ? (
          <View style={styles.section}>
            <Text style={styles.sectionTag}>{labels.summary}</Text>
            <Text style={styles.summary}>{summary}</Text>
          </View>
        ) : null}

        {skills.length > 0 || skillGroups.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTag}>{labels.skills}</Text>
            {skillGroups.length > 0 ? (
              skillGroups.map((group) => (
                <View key={group.label} style={styles.skillGroupRow}>
                  <Text style={styles.skillGroupLabel}>{group.label}</Text>
                  <View style={styles.skillWrap}>
                    {group.skills.map((s) => (
                      <Text key={s} style={styles.skillPill}>
                        {s}
                      </Text>
                    ))}
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.skillWrap}>
                {skills.map((s) => (
                  <Text key={s} style={styles.skillPill}>
                    {s}
                  </Text>
                ))}
              </View>
            )}
          </View>
        ) : null}

        {experience.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTag} minPresenceAhead={48}>
              {labels.experience}
            </Text>
            {experience.map((block) => (
              <View key={block.id} style={styles.roleBlock}>
                <View wrap={false} minPresenceAhead={36}>
                  <View style={styles.roleHeader}>
                    <View style={styles.roleHeadingGroup}>
                      <Text style={styles.roleHeading}>{block.heading}</Text>
                      <Text style={styles.roleSub}>{block.subheading}</Text>
                    </View>
                    <Text style={styles.roleDates}>
                      {block.start} — {block.end}
                    </Text>
                  </View>
                  {block.location ? (
                    <Text style={styles.roleLocation}>{block.location}</Text>
                  ) : null}
                  {block.bullets[0] ? (
                    <View style={styles.bulletRow}>
                      <Text style={styles.bulletDash}>–</Text>
                      <Text style={styles.bulletText}>{block.bullets[0]}</Text>
                    </View>
                  ) : null}
                </View>
                {block.bullets.slice(1).map((text, i) => (
                  <View key={i} style={styles.bulletRow}>
                    <Text style={styles.bulletDash}>–</Text>
                    <Text style={styles.bulletText}>{text}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {projects.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTag} minPresenceAhead={48}>
              {labels.projects}
            </Text>
            {projects.map((block) => (
              <View key={block.id} style={styles.roleBlock}>
                <View wrap={false} minPresenceAhead={36}>
                  <View style={styles.roleHeader}>
                    <View style={styles.roleHeadingGroup}>
                      <Text style={styles.roleHeading}>{block.heading}</Text>
                      <Text style={styles.roleSub}>{block.subheading}</Text>
                    </View>
                    <Text style={styles.roleDates}>
                      {block.start} — {block.end}
                    </Text>
                  </View>
                  {block.location ? (
                    <Text style={styles.roleLocation}>{block.location}</Text>
                  ) : null}
                  {block.bullets[0] ? (
                    <View style={styles.bulletRow}>
                      <Text style={styles.bulletDash}>–</Text>
                      <Text style={styles.bulletText}>{block.bullets[0]}</Text>
                    </View>
                  ) : null}
                </View>
                {block.bullets.slice(1).map((text, i) => (
                  <View key={i} style={styles.bulletRow}>
                    <Text style={styles.bulletDash}>–</Text>
                    <Text style={styles.bulletText}>{text}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {education.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTag} minPresenceAhead={48}>
              {labels.education}
            </Text>
            {education.map((e, i) => (
              <View key={i} style={styles.eduRow}>
                <View>
                  <Text style={styles.eduSchool}>{e.school}</Text>
                  {e.degree ? <Text style={styles.eduDetail}>{e.degree}</Text> : null}
                </View>
                <Text style={styles.eduDetail}>{e.year}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {additionalSections.map((section) =>
          section.items.length > 0 ? (
            <View key={section.id} style={styles.section}>
              <Text style={styles.sectionTag} minPresenceAhead={48}>
                {section.title || labels[section.kind]}
              </Text>
              {section.items.map((item) => (
                <View key={item.id} style={styles.roleBlock}>
                  <View
                    style={styles.roleHeader}
                    wrap={false}
                    minPresenceAhead={36}
                  >
                    <View style={styles.roleHeadingGroup}>
                      <Text style={styles.roleHeading}>{item.heading}</Text>
                      {item.subheading ? (
                        <Text style={styles.roleSub}>{item.subheading}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.roleDates}>
                      {[item.start, item.end].filter(Boolean).join(" — ")}
                    </Text>
                  </View>
                  {item.location ? (
                    <Text style={styles.roleLocation}>{item.location}</Text>
                  ) : null}
                  {item.bullets.map((bullet) => (
                    <View key={bullet.id} style={styles.bulletRow}>
                      <Text style={styles.bulletDash}>–</Text>
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
