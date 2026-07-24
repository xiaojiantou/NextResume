import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { Optimization, Resume } from "@/lib/types";

const styles = StyleSheet.create({
  page: {
    paddingTop: 44,
    paddingBottom: 44,
    paddingHorizontal: 52,
    fontSize: 10,
    lineHeight: 1.42,
    color: "#18181b",
    fontFamily: "Times-Roman",
  },
  header: {
    textAlign: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
    paddingBottom: 10,
  },
  name: {
    fontSize: 22,
    fontFamily: "Times-Bold",
    letterSpacing: -0.3,
  },
  title: {
    fontSize: 11,
    color: "#3f3f46",
    marginTop: 2,
  },
  contact: {
    fontSize: 9,
    color: "#71717a",
    marginTop: 4,
    fontFamily: "Helvetica",
  },
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.4,
    color: "#71717a",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  section: { marginTop: 14 },
  summary: { fontSize: 10, color: "#27272a" },
  skills: {
    fontSize: 9.5,
    color: "#3f3f46",
    fontFamily: "Helvetica",
  },
  roleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    fontFamily: "Helvetica",
  },
  roleTitle: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: "#18181b" },
  roleTitleMuted: { fontSize: 10.5, color: "#52525b" },
  roleDates: { fontSize: 9, color: "#71717a" },
  roleLocation: { fontSize: 9, color: "#a1a1aa", fontFamily: "Helvetica" },
  bulletRow: {
    flexDirection: "row",
    marginTop: 3,
    paddingLeft: 4,
  },
  bulletDot: {
    width: 10,
    fontSize: 10,
    color: "#3f3f46",
  },
  bulletText: {
    flex: 1,
    fontSize: 10,
  },
  eduRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 3,
    fontFamily: "Helvetica",
    fontSize: 9.5,
  },
  eduSchool: { fontFamily: "Helvetica-Bold", color: "#18181b" },
});

export function ResumePdf({
  resume,
  optimization,
}: {
  resume: Resume;
  optimization: Optimization | null;
}) {
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
        <View style={styles.header}>
          <Text style={styles.name}>{resume.name}</Text>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          <Text style={styles.contact}>
            {[resume.email, resume.phone, resume.location]
              .filter(Boolean)
              .join("  ·  ")}
          </Text>
        </View>

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
