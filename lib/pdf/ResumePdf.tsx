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
    experienceGroup: { marginTop: px(9) },
    experienceGroupLabel: {
      fontSize: fs(8.7),
      fontFamily: "Helvetica-Bold",
      color: palette.accent,
      textTransform: "uppercase",
      marginBottom: px(2),
    },
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
    teamBlock: {
      marginTop: px(6),
      paddingLeft: px(12),
    },
    teamHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
    },
    teamTitleGroup: {
      flexGrow: 1,
      flexBasis: 0,
      paddingRight: px(8),
    },
    teamTitle: {
      fontSize: fs(9.4),
      fontFamily: "Helvetica-Bold",
      color: palette.text,
    },
    teamMeta: {
      fontSize: fs(8.6),
      color: palette.muted,
      fontFamily: "Helvetica",
    },
    teamDates: {
      flexShrink: 0,
      maxWidth: "30%",
      textAlign: "right",
      fontSize: fs(8.4),
      color: palette.muted,
      fontFamily: "Helvetica-Bold",
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
    experienceGroups,
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
          <Text style={styles.teamTitleGroup}>
            <Text style={styles.teamTitle}>{team.heading}</Text>
            {team.subheading ? (
              <Text style={styles.teamMeta}>{"  ·  "}{team.subheading}</Text>
            ) : null}
          </Text>
          {team.start || team.end ? (
            <Text style={styles.teamDates}>
              {[team.start, team.end].filter(Boolean).join(" — ")}
            </Text>
          ) : null}
        </View>
        {team.location ? (
          <Text style={styles.teamMeta}>{team.location}</Text>
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
  const renderExperienceRole = (role: (typeof experience)[number]) => (
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
          renderBullet(role.bullets[0], `${role.id}-bullet-0`)
        ) : null}
      </View>
      {role.bullets.slice(1).map((text, index) => (
        renderBullet(text, `${role.id}-bullet-${index + 1}`)
      ))}
      {role.teams?.map(renderTeam)}
    </View>
  );
  const renderExperienceContent = () =>
    experienceGroups.length > 0
      ? experienceGroups.map((group) => (
          <View key={group.id} style={styles.experienceGroup}>
            {group.title ? (
              <Text
                style={styles.experienceGroupLabel}
                wrap={false}
                minPresenceAhead={48}
              >
                {group.title}
              </Text>
            ) : null}
            {group.blocks.map(renderExperienceRole)}
          </View>
        ))
      : experience.map(renderExperienceRole);
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
            // The trailing group carries skills the rewrite added, which no
            // source category claims; it runs on without a label rather than
            // borrowing one.
            skillGroups.map((group, index) => (
              <Text key={group.label || `ungrouped-${index}`} style={styles.skills}>
                {group.label ? (
                  <Text style={styles.skillGroupLabel}>{group.label}: </Text>
                ) : null}
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
          {renderExperienceContent()}
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
