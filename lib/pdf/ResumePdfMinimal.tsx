import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import type { Optimization, Resume } from "@/lib/types";
import { resolveResumeContent } from "./shared";

const ACCENT = "#4f46e5";

function createStyles(scale: number) {
  const px = (v: number) => v * scale;
  return StyleSheet.create({
    page: {
      paddingTop: px(42),
      paddingBottom: px(42),
      paddingHorizontal: px(46),
      fontSize: px(9.5),
      lineHeight: 1.4,
      color: "#18181b",
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
      fontSize: px(24),
      lineHeight: 1.1,
      fontFamily: "Helvetica-Bold",
      color: "#18181b",
      letterSpacing: -0.4,
    },
    title: {
      fontSize: px(11),
      color: ACCENT,
      marginTop: px(8),
      fontFamily: "Helvetica",
    },
    contact: { fontSize: px(8.5), color: "#71717a", marginTop: px(6) },
    sectionTag: {
      fontSize: px(7.5),
      fontFamily: "Helvetica-Bold",
      color: "#ffffff",
      backgroundColor: ACCENT,
      paddingVertical: px(3),
      paddingHorizontal: px(8),
      borderRadius: px(3),
      letterSpacing: 1,
      textTransform: "uppercase",
      alignSelf: "flex-start",
    },
    section: { marginTop: px(18) },
    summary: {
      fontSize: px(9.5),
      color: "#3f3f46",
      lineHeight: 1.55,
      marginTop: px(8),
    },
    skillWrap: { flexDirection: "row", flexWrap: "wrap", marginTop: px(8) },
    skillPill: {
      fontSize: px(8.5),
      color: ACCENT,
      backgroundColor: "#eef2ff",
      paddingVertical: px(3),
      paddingHorizontal: px(7),
      borderRadius: px(3),
      marginRight: px(5),
      marginBottom: px(5),
    },
    roleBlock: { marginTop: px(12) },
    roleHeader: { flexDirection: "row", justifyContent: "space-between" },
    roleHeading: {
      fontSize: px(10),
      fontFamily: "Helvetica-Bold",
      color: "#18181b",
    },
    roleSub: { fontSize: px(9), color: "#52525b" },
    roleDates: {
      fontSize: px(8.5),
      color: "#71717a",
      fontFamily: "Helvetica-Bold",
    },
    roleLocation: { fontSize: px(8.5), color: "#a1a1aa", marginTop: px(1) },
    bulletRow: { flexDirection: "row", marginTop: px(5), paddingLeft: px(2) },
    bulletDash: {
      width: px(12),
      fontSize: px(9.5),
      color: ACCENT,
      fontFamily: "Helvetica-Bold",
    },
    bulletText: {
      flex: 1,
      fontSize: px(9.5),
      lineHeight: 1.45,
      color: "#27272a",
    },
    eduRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: px(6),
    },
    eduSchool: {
      fontSize: px(9.5),
      fontFamily: "Helvetica-Bold",
      color: "#18181b",
    },
    eduDetail: { fontSize: px(9), color: "#52525b" },
  });
}

export function ResumePdfMinimal({
  resume,
  optimization,
  scale = 1,
}: {
  resume: Resume;
  optimization: Optimization | null;
  scale?: number;
}) {
  const styles = createStyles(scale);
  const { summary, title, skills, experience, projects, education } =
    resolveResumeContent(resume, optimization);

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
              {[resume.email, resume.phone, resume.location]
                .filter(Boolean)
                .join("   ·   ")}
            </Text>
          </View>
        </View>

        {summary ? (
          <View style={styles.section}>
            <Text style={styles.sectionTag}>Summary</Text>
            <Text style={styles.summary}>{summary}</Text>
          </View>
        ) : null}

        {skills.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTag}>Skills</Text>
            <View style={styles.skillWrap}>
              {skills.map((s) => (
                <Text key={s} style={styles.skillPill}>
                  {s}
                </Text>
              ))}
            </View>
          </View>
        ) : null}

        {experience.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTag}>Experience</Text>
            {experience.map((block) => (
              <View key={block.id} style={styles.roleBlock} wrap={false}>
                <View style={styles.roleHeader}>
                  <View>
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
                {block.bullets.map((text, i) => (
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
            <Text style={styles.sectionTag}>Projects</Text>
            {projects.map((block) => (
              <View key={block.id} style={styles.roleBlock} wrap={false}>
                <View style={styles.roleHeader}>
                  <View>
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
                {block.bullets.map((text, i) => (
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
            <Text style={styles.sectionTag}>Education</Text>
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
      </Page>
    </Document>
  );
}
