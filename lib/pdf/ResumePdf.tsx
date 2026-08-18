// Copyright (c) 2026 HowBe LLC. All rights reserved.

import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import { ContactText, contactEntries } from "./ContactLine";
import type { Optimization, Resume, ResumePageSpec } from "@/lib/types";
import type { ResumePalette } from "./config";
import {
  compactAdditionalItemLabel,
  getResumeSectionLabels,
  isCompactAdditionalSection,
  resolveResumeContent,
} from "./shared";

// Font size, whitespace, and leading are controlled independently so the
// export route can compact layout before it reduces text size.
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
    // A link keeps the contact line's colour: the default blue underline
    // would restyle a header the user never asked us to change.
    contactLink: { color: palette.muted, textDecoration: "none" },
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
      color: palette.text,
    },
    compactAdditional: {
      fontSize: body(),
      color: palette.text,
      fontFamily: "Helvetica",
      lineHeight: lh(1.6, 1.22),
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
    sectionLabels,
    sectionOrder,
  } = resolveResumeContent(resume, optimization, { includeSummary });
  const styles = createStyles(
    palette,
    fontScale,
    spacingScale,
    lineHeightScale,
    minimumBodyPt,
    minimumMarginPt,
  );
  const labels = getResumeSectionLabels(language, sectionLabels);
  const renderSection = (ref: (typeof sectionOrder)[number]) => {
    if (ref === "summary") {
      return summary ? (
        <View key={ref} style={styles.section}>
          <Text style={styles.sectionLabel} minPresenceAhead={48}>{labels.summary}</Text>
          <Text style={styles.summary}>{summary}</Text>
        </View>
      ) : null;
    }
    if (ref === "skills") {
      return skills.length > 0 || skillGroups.length > 0 ? (
        <View key={ref} style={styles.section}>
          <Text style={styles.sectionLabel} minPresenceAhead={48}>
            {labels.skills}
          </Text>
          {skillGroups.length > 0 ? (
            skillGroups.map((group) => (
              <Text key={group.label} style={styles.skills}>
                <Text style={styles.skillGroupLabel}>{group.label}: </Text>
                {group.skills.join(", ")}
              </Text>
            ))
          ) : (
            <Text style={styles.skills}>{skills.join("  ·  ")}</Text>
          )}
        </View>
      ) : null;
    }
    if (ref === "experience") {
      return experience.length > 0 ? (
        <View key={ref} style={styles.section}>
          <Text style={styles.sectionLabel} minPresenceAhead={48}>{labels.experience}</Text>
          {experience.map((role) => (
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
              {role.bullets.slice(1).map((text, index) => (
                <View key={index} style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>{text}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null;
    }
    if (ref === "projects") {
      return projects.length > 0 ? (
        <View key={ref} style={styles.section}>
          <Text style={styles.sectionLabel} minPresenceAhead={48}>{labels.projects}</Text>
          {projects.map((project) => (
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
                    <Text style={styles.bulletText}>{project.bullets[0]}</Text>
                  </View>
                ) : null}
              </View>
              {project.bullets.slice(1).map((text, index) => (
                <View key={index} style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>{text}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null;
    }
    if (ref === "education") {
      return education.length > 0 ? (
        <View key={ref} style={styles.section}>
          <Text style={styles.sectionLabel} minPresenceAhead={48}>{labels.education}</Text>
          {education.map((entry, index) => (
            <View key={index} style={styles.eduRow}>
              <Text>
                <Text style={styles.eduSchool}>{entry.school}</Text>
                {entry.degree ? (
                  <Text style={{ color: palette.muted }}>
                    {"  ·  "}
                    {entry.degree}
                  </Text>
                ) : null}
              </Text>
              <Text style={{ color: palette.muted }}>{entry.year}</Text>
            </View>
          ))}
        </View>
      ) : null;
    }
    const id = ref.slice("additional:".length);
    const section = additionalSections.find((candidate) => candidate.id === id);
    return section?.items.length ? (
      <View key={ref} style={styles.section}>
        <Text style={styles.sectionLabel} minPresenceAhead={48}>
          {section.title || labels[section.kind]}
        </Text>
        {isCompactAdditionalSection(section) ? (
          <Text style={styles.compactAdditional}>
            {section.items.map(compactAdditionalItemLabel).join("  ·  ")}
          </Text>
        ) : section.items.map((item) => (
          <View key={item.id}>
            <View style={styles.roleHeader} wrap={false} minPresenceAhead={36}>
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
            {item.bullets.map((bullet, index) => (
              <View key={bullet.id || index} style={styles.bulletRow}>
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
        {resume.photo ? (
          <View style={styles.headerWithPhoto}>
            <Image src={resume.photo} style={styles.photo} />
            <View style={styles.headerTextBlock}>
              <Text style={styles.name}>{resume.name}</Text>
              {title ? <Text style={styles.title}>{title}</Text> : null}
              <ContactText
                entries={contactEntries(
                  [resume.email, resume.phone, resume.location],
                  resume.links,
                )}
                separator="  ·  "
                style={styles.contact}
                linkStyle={styles.contactLink}
              />
            </View>
          </View>
        ) : (
          <View style={styles.header}>
            <Text style={styles.name}>{resume.name}</Text>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            <ContactText
              entries={contactEntries(
                [resume.email, resume.phone, resume.location],
                resume.links,
              )}
              separator="  ·  "
              style={styles.contact}
              linkStyle={styles.contactLink}
            />
          </View>
        )}

        {sectionOrder.map(renderSection)}
      </Page>
    </Document>
  );
}
