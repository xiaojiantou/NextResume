// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import type { Optimization, Resume } from "@/lib/types";
import { getResumeSectionLabels, resolveResumeContent } from "./shared";

const ACCENT = "#4338ca"; // accent-700 — darker so white text stays readable

function createStyles(
  fontScale: number,
  spacingScale: number,
  lineHeightScale: number,
) {
  const px = (v: number) => v * spacingScale;
  const fs = (v: number) => v * fontScale;
  const lh = (v: number, floor = 1.18) =>
    Math.max(floor, v * lineHeightScale);
  return StyleSheet.create({
    page: {
      flexDirection: "row",
      fontSize: fs(9.5),
      lineHeight: lh(1.42),
      color: "#18181b",
      fontFamily: "Helvetica",
    },
    sidebar: {
      width: "34%",
      minHeight: "100%",
      backgroundColor: ACCENT,
      color: "#ffffff",
      paddingTop: px(40),
      paddingHorizontal: px(20),
      paddingBottom: px(40),
    },
    main: {
      width: "66%",
      minHeight: "100%",
      paddingTop: px(40),
      paddingHorizontal: px(26),
      paddingBottom: px(40),
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
      color: "#c7d2fe",
      marginBottom: px(5),
      marginTop: px(18),
    },
    sideText: {
      fontSize: fs(9),
      color: "#ffffff",
      lineHeight: lh(1.5),
    },
    skillPill: {
      fontSize: fs(8.5),
      color: "#ffffff",
      backgroundColor: "rgba(255,255,255,0.16)",
      paddingVertical: px(3),
      paddingHorizontal: px(7),
      borderRadius: px(3),
      marginBottom: px(4),
      marginRight: px(4),
    },
    skillWrap: { flexDirection: "row", flexWrap: "wrap" },
    eduBlock: { marginBottom: px(8) },
    eduSchool: {
      fontSize: fs(9),
      fontFamily: "Helvetica-Bold",
      color: "#ffffff",
    },
    eduDetail: { fontSize: fs(8.5), color: "#e0e7ff", marginTop: px(1) },
    name: {
      fontSize: fs(22),
      lineHeight: lh(1.1, 1.02),
      fontFamily: "Helvetica-Bold",
      color: "#18181b",
      letterSpacing: -0.3,
    },
    title: {
      fontSize: fs(11),
      color: ACCENT,
      fontFamily: "Helvetica-Bold",
      marginTop: px(8),
    },
    mainSectionLabel: {
      fontSize: fs(9),
      fontFamily: "Helvetica-Bold",
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: ACCENT,
      marginTop: px(18),
      marginBottom: px(6),
    },
    summary: { fontSize: fs(9.5), color: "#3f3f46", lineHeight: lh(1.5) },
    roleHeading: {
      fontSize: fs(10),
      fontFamily: "Helvetica-Bold",
      color: "#18181b",
    },
    roleSub: { fontSize: fs(9), color: "#52525b", marginTop: px(1) },
    roleDates: { fontSize: fs(8.5), color: "#71717a", marginTop: px(1) },
    roleBlock: { marginTop: px(10) },
    bulletRow: { flexDirection: "row", marginTop: px(4), paddingLeft: px(2) },
    bulletDot: { width: px(10), fontSize: fs(9.5), color: ACCENT },
    bulletText: {
      flex: 1,
      fontSize: fs(9.5),
      lineHeight: lh(1.4),
      color: "#27272a",
    },
  });
}

export function ResumePdfSidebar({
  resume,
  optimization,
  fontScale = 1,
  spacingScale = 1,
  lineHeightScale = 1,
}: {
  resume: Resume;
  optimization: Optimization | null;
  fontScale?: number;
  spacingScale?: number;
  lineHeightScale?: number;
}) {
  const styles = createStyles(fontScale, spacingScale, lineHeightScale);
  const {
    summary,
    title,
    skills,
    experience,
    projects,
    education,
    additionalSections,
    language,
  } =
    resolveResumeContent(resume, optimization);
  const labels = getResumeSectionLabels(language);

  return (
    <Document
      title={`${resume.name} — Resume`}
      author={resume.name}
      creator="NextResume"
      producer="NextResume"
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.sidebar}>
          {resume.photo ? <Image src={resume.photo} style={styles.photo} /> : null}

          {[resume.email, resume.phone, resume.location].filter(Boolean)
            .length > 0 ? (
            <>
              <Text style={styles.sideLabel}>Contact</Text>
              {[resume.email, resume.phone, resume.location]
                .filter(Boolean)
                .map((line) => (
                  <Text key={line} style={styles.sideText}>
                    {line}
                  </Text>
                ))}
            </>
          ) : null}

          {skills.length > 0 ? (
            <>
              <Text style={styles.sideLabel}>{labels.skills}</Text>
              <View style={styles.skillWrap}>
                {skills.map((s) => (
                  <Text key={s} style={styles.skillPill}>
                    {s}
                  </Text>
                ))}
              </View>
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
              <Text style={styles.mainSectionLabel}>{labels.experience}</Text>
              {experience.map((block) => (
                <View key={block.id} style={styles.roleBlock}>
                  <View wrap={false}>
                    <Text style={styles.roleHeading}>{block.heading}</Text>
                    <Text style={styles.roleSub}>
                      {[block.subheading, block.location].filter(Boolean).join(" · ")}
                    </Text>
                    <Text style={styles.roleDates}>
                      {block.start} — {block.end}
                    </Text>
                  </View>
                  {block.bullets.map((text, i) => (
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
              <Text style={styles.mainSectionLabel}>{labels.projects}</Text>
              {projects.map((block) => (
                <View key={block.id} style={styles.roleBlock}>
                  <View wrap={false}>
                    <Text style={styles.roleHeading}>{block.heading}</Text>
                    <Text style={styles.roleSub}>
                      {[block.subheading, block.location].filter(Boolean).join(" · ")}
                    </Text>
                    <Text style={styles.roleDates}>
                      {block.start} — {block.end}
                    </Text>
                  </View>
                  {block.bullets.map((text, i) => (
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
                <Text style={styles.mainSectionLabel}>
                  {section.title || labels[section.kind]}
                </Text>
                {section.items.map((item) => (
                  <View key={item.id} style={styles.roleBlock}>
                    <View wrap={false}>
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
