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
import {
  getResumeSectionLabels,
  resolveResumeContent,
} from "./shared";

// Matches the web app's accent-600 (tailwind.config.ts) — used sparingly for
// a few branded touches (header rule, job title, bullet markers, section
// underlines), not as a wholesale color scheme. Resumes need to stay
// print-friendly and scannable, not look like a marketing page.
const ACCENT = "#4f46e5";

// Font size, whitespace, and leading are controlled independently so the
// export route can compact layout before it reduces text size.
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
      paddingTop: px(44),
      paddingBottom: px(44),
      paddingHorizontal: px(52),
      fontSize: fs(10),
      lineHeight: lh(1.42),
      color: "#18181b",
      fontFamily: "Times-Roman",
    },
    header: {
      textAlign: "center",
      borderBottomWidth: 2,
      borderBottomColor: ACCENT,
      paddingBottom: px(12),
    },
    headerWithPhoto: {
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 2,
      borderBottomColor: ACCENT,
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
      color: "#18181b",
    },
    title: {
      fontSize: fs(11),
      color: ACCENT,
      marginTop: px(8),
      fontFamily: "Helvetica-Bold",
    },
    contact: {
      fontSize: fs(9),
      color: "#71717a",
      marginTop: px(5),
      fontFamily: "Helvetica",
    },
    sectionLabel: {
      fontSize: fs(8.5),
      fontFamily: "Helvetica-Bold",
      letterSpacing: 1.6,
      color: ACCENT,
      textTransform: "uppercase",
      marginBottom: px(6),
      paddingBottom: px(3),
      borderBottomWidth: 0.75,
      borderBottomColor: "#e4e4e7",
    },
    section: { marginTop: px(16) },
    summary: { fontSize: fs(10), color: "#27272a", lineHeight: lh(1.5) },
    skills: {
      fontSize: fs(9.5),
      color: "#3f3f46",
      fontFamily: "Helvetica",
      lineHeight: lh(1.6, 1.22),
    },
    roleHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: px(9),
      fontFamily: "Helvetica",
    },
    roleTitle: {
      fontSize: fs(10.5),
      fontFamily: "Helvetica-Bold",
      color: "#18181b",
    },
    roleTitleMuted: { fontSize: fs(10.5), color: "#52525b" },
    roleDates: {
      fontSize: fs(9),
      color: "#3f3f46",
      fontFamily: "Helvetica-Bold",
    },
    roleLocation: {
      fontSize: fs(9),
      color: "#a1a1aa",
      fontFamily: "Helvetica",
    },
    bulletRow: {
      flexDirection: "row",
      marginTop: px(4),
      paddingLeft: px(4),
    },
    bulletDot: {
      width: px(10),
      fontSize: fs(10),
      color: ACCENT,
    },
    bulletText: {
      flex: 1,
      fontSize: fs(10),
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
      color: "#18181b",
    },
  });
}

export function ResumePdf({
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
  const {
    summary,
    title,
    skills,
    experience,
    projects,
    education,
    additionalSections,
    language,
  } = resolveResumeContent(resume, optimization);
  const styles = createStyles(fontScale, spacingScale, lineHeightScale);
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
                {[resume.email, resume.phone, resume.location]
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
              {[resume.email, resume.phone, resume.location]
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

        {skills.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{labels.skills}</Text>
            <Text style={styles.skills}>{skills.join("  ·  ")}</Text>
          </View>
        ) : null}

        {experience.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{labels.experience}</Text>
            {experience.map((role) => {
              return (
                <View key={role.id}>
                  <View style={styles.roleHeader} wrap={false}>
                    <Text>
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
                  {role.bullets.map((text, i) => (
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
            <Text style={styles.sectionLabel}>{labels.projects}</Text>
            {projects.map((project) => {
              return (
                <View key={project.id}>
                  <View style={styles.roleHeader} wrap={false}>
                    <Text>
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
                  {project.bullets.map((text, i) => (
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
            <Text style={styles.sectionLabel}>{labels.education}</Text>
            {education.map((e, i) => (
              <View key={i} style={styles.eduRow}>
                <Text>
                  <Text style={styles.eduSchool}>{e.school}</Text>
                  {e.degree ? (
                    <Text style={{ color: "#52525b" }}>
                      {"  ·  "}
                      {e.degree}
                    </Text>
                  ) : null}
                </Text>
                <Text style={{ color: "#71717a" }}>{e.year}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {additionalSections.map((section) =>
          section.items.length > 0 ? (
            <View key={section.id} style={styles.section}>
              <Text style={styles.sectionLabel}>
                {section.title || labels[section.kind]}
              </Text>
              {section.items.map((item) => (
                <View key={item.id}>
                  <View style={styles.roleHeader} wrap={false}>
                    <Text>
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
