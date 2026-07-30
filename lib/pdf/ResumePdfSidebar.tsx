// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import type { Optimization, Resume, ResumePageSpec } from "@/lib/types";
import type { ResumePalette } from "./config";
import { getResumeSectionLabels, resolveResumeContent } from "./shared";

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
      color: "#e0e7ff",
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

          {[resume.email, resume.phone, resume.location, ...(resume.links ?? [])]
            .filter(Boolean).length > 0 ? (
            <>
              <Text style={styles.sideLabel}>Contact</Text>
              {[resume.email, resume.phone, resume.location, ...(resume.links ?? [])]
                .filter(Boolean)
                .map((line) => (
                  <Text key={line} style={styles.sideText}>
                    {line}
                  </Text>
                ))}
            </>
          ) : null}

          {skills.length > 0 || skillGroups.length > 0 ? (
            <>
              <Text style={styles.sideLabel}>{labels.skills}</Text>
              {skillGroups.length > 0 ? (
                skillGroups.map((group) => (
                  <View key={group.label}>
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
            </>
          ) : null}

          {education.length > 0 ? (
            <>
              <Text style={styles.sideLabel}>{labels.education}</Text>
              {education.map((e, i) => (
                <View key={i} style={styles.eduBlock}>
                  <Text style={styles.eduSchool}>{e.school}</Text>
                  {e.degree ? <Text style={styles.eduDetail}>{e.degree}</Text> : null}
                  {e.year ? <Text style={styles.eduDetail}>{e.year}</Text> : null}
                </View>
              ))}
            </>
          ) : null}
        </View>

        <View style={styles.main}>
          <Text style={styles.name}>{resume.name}</Text>
          {title ? <Text style={styles.title}>{title}</Text> : null}

          {summary ? (
            <>
              <Text style={styles.mainSectionLabel}>{labels.summary}</Text>
              <Text style={styles.summary}>{summary}</Text>
            </>
          ) : null}

          {experience.length > 0 ? (
            <>
              <Text style={styles.mainSectionLabel} minPresenceAhead={48}>
                {labels.experience}
              </Text>
              {experience.map((block) => (
                <View key={block.id} style={styles.roleBlock}>
                  <View wrap={false} minPresenceAhead={36}>
                    <View style={styles.roleHeader}>
                      <View style={styles.roleHeadingGroup}>
                        <Text style={styles.roleHeading}>{block.heading}</Text>
                        <Text style={styles.roleSub}>
                          {[block.subheading, block.location]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </View>
                      <Text style={styles.roleDates}>
                        {block.start} — {block.end}
                      </Text>
                    </View>
                    {block.bullets[0] ? (
                      <View style={styles.bulletRow}>
                        <Text style={styles.bulletDot}>•</Text>
                        <Text style={styles.bulletText}>{block.bullets[0]}</Text>
                      </View>
                    ) : null}
                  </View>
                  {block.bullets.slice(1).map((text, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <Text style={styles.bulletDot}>•</Text>
                      <Text style={styles.bulletText}>{text}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </>
          ) : null}

          {projects.length > 0 ? (
            <>
              <Text style={styles.mainSectionLabel} minPresenceAhead={48}>
                {labels.projects}
              </Text>
              {projects.map((block) => (
                <View key={block.id} style={styles.roleBlock}>
                  <View wrap={false} minPresenceAhead={36}>
                    <View style={styles.roleHeader}>
                      <View style={styles.roleHeadingGroup}>
                        <Text style={styles.roleHeading}>{block.heading}</Text>
                        <Text style={styles.roleSub}>
                          {[block.subheading, block.location]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </View>
                      <Text style={styles.roleDates}>
                        {block.start} — {block.end}
                      </Text>
                    </View>
                    {block.bullets[0] ? (
                      <View style={styles.bulletRow}>
                        <Text style={styles.bulletDot}>•</Text>
                        <Text style={styles.bulletText}>{block.bullets[0]}</Text>
                      </View>
                    ) : null}
                  </View>
                  {block.bullets.slice(1).map((text, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <Text style={styles.bulletDot}>•</Text>
                      <Text style={styles.bulletText}>{text}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </>
          ) : null}

          {additionalSections.map((section) =>
            section.items.length > 0 ? (
              <View key={section.id}>
                <Text style={styles.mainSectionLabel} minPresenceAhead={48}>
                  {section.title || labels[section.kind]}
                </Text>
                {section.items.map((item) => (
                  <View key={item.id} style={styles.roleBlock}>
                    <View wrap={false} minPresenceAhead={36}>
                      <Text style={styles.roleHeading}>{item.heading}</Text>
                      {item.subheading || item.location ? (
                        <Text style={styles.roleSub}>
                          {[item.subheading, item.location]
                            .filter(Boolean)
                            .join(" · ")}
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
            ) : null,
          )}
        </View>
      </Page>
    </Document>
  );
}
