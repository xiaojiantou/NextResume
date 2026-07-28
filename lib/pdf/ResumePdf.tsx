import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import type { Optimization, Resume } from "@/lib/types";

// Matches the web app's accent-600 (tailwind.config.ts) — used sparingly for
// a few branded touches (header rule, job title, bullet markers, section
// underlines), not as a wholesale color scheme. Resumes need to stay
// print-friendly and scannable, not look like a marketing page.
const ACCENT = "#4f46e5";

// Scales font sizes and spacing (not line-height multipliers, letter-spacing,
// or hairline border widths) so the export route can shrink the whole
// template a notch at a time until the resume fits on one page.
function createStyles(scale: number) {
  const px = (v: number) => v * scale;
  return StyleSheet.create({
    page: {
      paddingTop: px(44),
      paddingBottom: px(44),
      paddingHorizontal: px(52),
      fontSize: px(10),
      lineHeight: 1.42,
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
      fontSize: px(23),
      lineHeight: 1.1,
      fontFamily: "Times-Bold",
      letterSpacing: -0.3,
      color: "#18181b",
    },
    title: {
      fontSize: px(11),
      color: ACCENT,
      marginTop: px(8),
      fontFamily: "Helvetica-Bold",
    },
    contact: {
      fontSize: px(9),
      color: "#71717a",
      marginTop: px(5),
      fontFamily: "Helvetica",
    },
    sectionLabel: {
      fontSize: px(8.5),
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
    summary: { fontSize: px(10), color: "#27272a", lineHeight: 1.5 },
    skills: {
      fontSize: px(9.5),
      color: "#3f3f46",
      fontFamily: "Helvetica",
      lineHeight: 1.6,
    },
    roleHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: px(9),
      fontFamily: "Helvetica",
    },
    roleTitle: {
      fontSize: px(10.5),
      fontFamily: "Helvetica-Bold",
      color: "#18181b",
    },
    roleTitleMuted: { fontSize: px(10.5), color: "#52525b" },
    roleDates: {
      fontSize: px(9),
      color: "#3f3f46",
      fontFamily: "Helvetica-Bold",
    },
    roleLocation: { fontSize: px(9), color: "#a1a1aa", fontFamily: "Helvetica" },
    bulletRow: {
      flexDirection: "row",
      marginTop: px(4),
      paddingLeft: px(4),
    },
    bulletDot: {
      width: px(10),
      fontSize: px(10),
      color: ACCENT,
    },
    bulletText: {
      flex: 1,
      fontSize: px(10),
      lineHeight: 1.45,
    },
    eduRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: px(4),
      fontFamily: "Helvetica",
      fontSize: px(9.5),
    },
    eduSchool: { fontFamily: "Helvetica-Bold", color: "#18181b" },
  });
}

export function ResumePdf({
  resume,
  optimization,
  scale = 1,
}: {
  resume: Resume;
  optimization: Optimization | null;
  scale?: number;
}) {
  const styles = createStyles(scale);
  const summary = optimization?.summary || resume.summary;
  const title = optimization?.title || resume.title;
  const skills =
    optimization?.skills && optimization.skills.length > 0
      ? optimization.skills
      : resume.skills;

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
            <Text style={styles.sectionLabel}>Summary</Text>
            <Text style={styles.summary}>{summary}</Text>
          </View>
        ) : null}

        {skills.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Skills</Text>
            <Text style={styles.skills}>{skills.join("  ·  ")}</Text>
          </View>
        ) : null}

        {resume.experience.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Experience</Text>
            {resume.experience.map((role) => {
              const opt = optimization?.roles.find((r) => r.id === role.id);
              const bullets = opt?.bullets.length
                ? opt.bullets.map((b) => b.text)
                : role.bullets.map((b) => b.text);
              return (
                <View key={role.id} wrap={false}>
                  <View style={styles.roleHeader}>
                    <Text>
                      <Text style={styles.roleTitle}>{role.company}</Text>
                      {role.title ? (
                        <Text style={styles.roleTitleMuted}>
                          {"  ·  "}
                          {role.title}
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
                  {bullets.map((text, i) => (
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

        {resume.projects && resume.projects.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Projects</Text>
            {resume.projects.map((project) => {
              const opt = optimization?.projects?.find(
                (p) => p.id === project.id,
              );
              const bullets = opt?.bullets.length
                ? opt.bullets.map((b) => b.text)
                : project.bullets.map((b) => b.text);
              return (
                <View key={project.id} wrap={false}>
                  <View style={styles.roleHeader}>
                    <Text>
                      <Text style={styles.roleTitle}>{project.name}</Text>
                      {project.role ? (
                        <Text style={styles.roleTitleMuted}>
                          {"  ·  "}
                          {project.role}
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
                  {bullets.map((text, i) => (
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

        {resume.education.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Education</Text>
            {resume.education.map((e, i) => (
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
      </Page>
    </Document>
  );
}
