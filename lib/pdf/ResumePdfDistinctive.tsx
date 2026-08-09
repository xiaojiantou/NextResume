import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { Optimization, Resume, ResumePageSpec } from "@/lib/types";
import type { FixedPdfStyle, ResumePalette } from "./config";
import {
  compactAdditionalItemLabel,
  getResumeSectionLabels,
  isCompactAdditionalSection,
  resolveResumeContent,
} from "./shared";

type DistinctiveStyle = Extract<
  FixedPdfStyle,
  "academic" | "executive" | "tech" | "elegant"
>;

function createStyles(
  variant: DistinctiveStyle,
  palette: ResumePalette,
  fontScale: number,
  spacingScale: number,
  lineHeightScale: number,
  minimumBodyPt: number,
  minimumMarginPt: number,
) {
  const px = (value: number) => value * spacingScale;
  const margin = (value: number) =>
    Math.max(minimumMarginPt, value * spacingScale);
  const fs = (value: number) => Math.max(8, value * fontScale);
  const body = (value = 10) => Math.max(minimumBodyPt, fs(value));
  const lh = (value: number, floor = 1.1) =>
    Math.max(floor, value * lineHeightScale);
  const isAcademic = variant === "academic";
  const isExecutive = variant === "executive";
  const isTech = variant === "tech";
  const isElegant = variant === "elegant";
  const bodyFont = isAcademic
    ? "Times-Roman"
    : isExecutive
      ? "Times-Roman"
      : "Helvetica";
  const headingFont = isTech
    ? "Helvetica-Bold"
    : isElegant || isAcademic
      ? "Times-Bold"
      : "Helvetica-Bold";
  const metaFont = isTech ? "Courier" : "Helvetica";
  const baseHorizontal = isExecutive ? 48 : isAcademic ? 50 : 46;

  return StyleSheet.create({
    page: {
      paddingTop: margin(isElegant ? 48 : 42),
      paddingBottom: margin(42),
      paddingHorizontal: margin(baseHorizontal),
      color: palette.text,
      backgroundColor: palette.background,
      fontFamily: bodyFont,
      fontSize: body(),
      lineHeight: lh(1.42),
    },
    header: {
      position: "relative",
      paddingLeft: isExecutive ? px(15) : 0,
      paddingBottom: px(isElegant ? 15 : 12),
      borderBottomWidth: isAcademic || isTech ? 1 : isElegant ? 0.75 : 0,
      borderBottomColor: palette.accent,
    },
    executiveBar: {
      position: "absolute",
      left: 0,
      top: 1,
      bottom: px(12),
      width: 4,
      backgroundColor: palette.accent,
    },
    elegantRule: {
      width: "36%",
      height: 1,
      backgroundColor: palette.accent,
      marginTop: px(11),
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    identity: {
      flexGrow: 1,
      flexBasis: 0,
      paddingRight: px(12),
    },
    photo: {
      width: px(56),
      height: px(56),
      borderRadius: isAcademic || isExecutive ? 2 : px(28),
      objectFit: "cover",
    },
    name: {
      color: palette.text,
      fontFamily: headingFont,
      fontSize: fs(isExecutive ? 25 : isElegant ? 27 : isAcademic ? 24 : 23),
      lineHeight: lh(1.08, 1.02),
      letterSpacing: isTech ? -0.2 : isElegant ? 0.1 : -0.3,
    },
    title: {
      marginTop: px(6),
      color: palette.accent,
      fontFamily: isElegant ? "Times-Italic" : metaFont,
      fontSize: fs(10.5),
      lineHeight: lh(1.25),
    },
    contact: {
      marginTop: px(6),
      color: palette.muted,
      fontFamily: metaFont,
      fontSize: fs(8.7),
      lineHeight: lh(1.3),
    },
    section: {
      marginTop: px(isExecutive ? 17 : isElegant ? 19 : 16),
    },
    sectionLabel: {
      color: palette.accent,
      fontFamily: isTech ? "Courier-Bold" : "Helvetica-Bold",
      fontSize: fs(isAcademic ? 9 : 8.5),
      letterSpacing: isTech ? 0.7 : 1.3,
      textTransform: "uppercase",
      paddingBottom: px(4),
      paddingLeft: isExecutive ? px(8) : 0,
      borderBottomWidth: isAcademic || isElegant ? 0.75 : 0,
      borderBottomColor: palette.border,
      borderLeftWidth: isExecutive ? 3 : 0,
      borderLeftColor: palette.accent,
      backgroundColor: isExecutive ? palette.soft : palette.background,
    },
    summary: {
      marginTop: px(7),
      color: palette.text,
      fontSize: body(),
      lineHeight: lh(isElegant ? 1.52 : 1.46),
    },
    skillsBand: {
      marginTop: px(7),
      paddingVertical: px(isTech ? 7 : 0),
      paddingHorizontal: px(isTech ? 9 : 0),
      backgroundColor: isTech ? palette.soft : palette.background,
      borderLeftWidth: isTech ? 2 : 0,
      borderLeftColor: palette.accent,
    },
    skills: {
      color: palette.text,
      fontFamily: isTech ? "Courier" : metaFont,
      fontSize: body(),
      lineHeight: lh(1.45),
    },
    compactAdditional: {
      marginTop: px(7),
      color: palette.text,
      fontFamily: isTech ? "Courier" : metaFont,
      fontSize: body(),
      lineHeight: lh(1.45),
    },
    entry: {
      marginTop: px(isAcademic ? 9 : 10),
    },
    entryHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
    },
    entryHeadingGroup: {
      flexGrow: 1,
      flexBasis: 0,
      paddingRight: px(10),
    },
    entryHeading: {
      color: palette.text,
      fontFamily: isAcademic ? "Times-Bold" : "Helvetica-Bold",
      fontSize: body(isExecutive ? 10.5 : 10),
      lineHeight: lh(1.25),
    },
    entrySubheading: {
      marginTop: px(1),
      color: palette.muted,
      fontFamily: isElegant ? "Times-Italic" : metaFont,
      fontSize: fs(9),
      lineHeight: lh(1.28),
    },
    entryDates: {
      flexShrink: 0,
      maxWidth: "30%",
      textAlign: "right",
      color: palette.muted,
      fontFamily: isTech ? "Courier-Bold" : "Helvetica-Bold",
      fontSize: fs(8.5),
      lineHeight: lh(1.25),
    },
    location: {
      marginTop: px(1),
      color: palette.muted,
      fontFamily: metaFont,
      fontSize: fs(8.5),
    },
    bulletRow: {
      flexDirection: "row",
      marginTop: px(4),
      paddingLeft: px(2),
    },
    bulletMarker: {
      width: px(11),
      color: palette.accent,
      fontFamily: isTech ? "Courier-Bold" : "Helvetica-Bold",
      fontSize: body(),
    },
    bulletText: {
      flexGrow: 1,
      flexBasis: 0,
      color: palette.text,
      fontSize: body(),
      lineHeight: lh(1.42),
    },
    educationRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      marginTop: px(7),
    },
    educationMain: {
      flexGrow: 1,
      flexBasis: 0,
      paddingRight: px(10),
    },
    educationSchool: {
      color: palette.text,
      fontFamily: "Helvetica-Bold",
      fontSize: body(),
    },
    educationDegree: {
      marginTop: px(1),
      color: palette.muted,
      fontSize: fs(9),
    },
  });
}

export function ResumePdfDistinctive({
  variant,
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
  variant: DistinctiveStyle;
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
    variant,
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
    experience,
    projects,
    education,
    additionalSections,
    language,
    sectionLabels,
    sectionOrder,
  } = resolveResumeContent(resume, optimization, { includeSummary });
  const labels = getResumeSectionLabels(language, sectionLabels);
  const sectionLabel = (label: string) =>
    variant === "tech" ? `[ ${label} ]` : label;
  const bulletMarker = variant === "tech" ? "›" : variant === "elegant" ? "—" : "•";

  const renderBullet = (text: string, key: string) => (
    <View key={key} style={styles.bulletRow}>
      <Text style={styles.bulletMarker}>{bulletMarker}</Text>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
  const renderEntries = (entries: typeof experience) =>
    entries.map((entry) => (
      <View key={entry.id} style={styles.entry}>
        <View wrap={false}>
          <View style={styles.entryHeader}>
            <View style={styles.entryHeadingGroup}>
              <Text style={styles.entryHeading}>{entry.heading}</Text>
              {entry.subheading ? (
                <Text style={styles.entrySubheading}>{entry.subheading}</Text>
              ) : null}
            </View>
            <Text style={styles.entryDates}>
              {[entry.start, entry.end].filter(Boolean).join(" — ")}
            </Text>
          </View>
          {entry.location ? (
            <Text style={styles.location}>{entry.location}</Text>
          ) : null}
          {entry.bullets[0]
            ? renderBullet(entry.bullets[0], `${entry.id}-bullet-0`)
            : null}
        </View>
        {entry.bullets
          .slice(1)
          .map((text, index) =>
            renderBullet(text, `${entry.id}-bullet-${index + 1}`),
          )}
      </View>
    ));
  const renderSection = (ref: (typeof sectionOrder)[number]) => {
    if (ref === "summary") {
      return summary ? (
        <View key={ref} style={styles.section}>
          <Text style={styles.sectionLabel}>
            {sectionLabel(labels.summary)}
          </Text>
          <Text style={styles.summary}>{summary}</Text>
        </View>
      ) : null;
    }
    if (ref === "skills") {
      return skills.length > 0 ? (
        <View key={ref} style={styles.section}>
          <Text style={styles.sectionLabel}>{sectionLabel(labels.skills)}</Text>
          <View style={styles.skillsBand}>
            <Text style={styles.skills}>{skills.join("  ·  ")}</Text>
          </View>
        </View>
      ) : null;
    }
    if (ref === "experience" || ref === "projects") {
      const entries = ref === "experience" ? experience : projects;
      return entries.length > 0 ? (
        <View key={ref} style={styles.section}>
          <Text style={styles.sectionLabel}>{sectionLabel(labels[ref])}</Text>
          {renderEntries(entries)}
        </View>
      ) : null;
    }
    if (ref === "education") {
      return education.length > 0 ? (
        <View key={ref} style={styles.section}>
          <Text style={styles.sectionLabel}>
            {sectionLabel(labels.education)}
          </Text>
          {education.map((item, index) => (
            <View key={`${item.school}-${index}`} style={styles.educationRow}>
              <View style={styles.educationMain}>
                <Text style={styles.educationSchool}>{item.school}</Text>
                {item.degree ? (
                  <Text style={styles.educationDegree}>{item.degree}</Text>
                ) : null}
              </View>
              <Text style={styles.entryDates}>{item.year}</Text>
            </View>
          ))}
        </View>
      ) : null;
    }
    const id = ref.slice("additional:".length);
    const section = additionalSections.find((candidate) => candidate.id === id);
    return section?.items.length ? (
      <View key={ref} style={styles.section}>
        <Text style={styles.sectionLabel}>
          {sectionLabel(section.title || labels[section.kind])}
        </Text>
        {isCompactAdditionalSection(section) ? (
          <Text style={styles.compactAdditional}>
            {section.items.map(compactAdditionalItemLabel).join("  ·  ")}
          </Text>
        ) : section.items.map((entry) => (
          <View key={entry.id} style={styles.entry}>
            <View wrap={false}>
              <View style={styles.entryHeader}>
                <View style={styles.entryHeadingGroup}>
                  <Text style={styles.entryHeading}>{entry.heading}</Text>
                  {entry.subheading ? (
                    <Text style={styles.entrySubheading}>
                      {entry.subheading}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.entryDates}>
                  {[entry.start, entry.end].filter(Boolean).join(" — ")}
                </Text>
              </View>
              {entry.location ? (
                <Text style={styles.location}>{entry.location}</Text>
              ) : null}
              {entry.bullets[0]
                ? renderBullet(entry.bullets[0].text, `${entry.id}-bullet-0`)
                : null}
            </View>
            {entry.bullets
              .slice(1)
              .map((bullet, index) =>
                renderBullet(
                  bullet.text,
                  `${entry.id}-bullet-${index + 1}`,
                ),
              )}
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
        <View style={styles.header}>
          {variant === "executive" ? (
            <View style={styles.executiveBar} />
          ) : null}
          <View style={styles.headerRow}>
            <View style={styles.identity}>
              <Text style={styles.name}>{resume.name}</Text>
              {title ? <Text style={styles.title}>{title}</Text> : null}
              <Text style={styles.contact}>
                {[resume.email, resume.phone, resume.location]
                  .filter(Boolean)
                  .join("  ·  ")}
              </Text>
            </View>
            {resume.photo ? <Image src={resume.photo} style={styles.photo} /> : null}
          </View>
          {variant === "elegant" ? <View style={styles.elegantRule} /> : null}
        </View>

        {sectionOrder.map(renderSection)}
      </Page>
    </Document>
  );
}
