import Link from "next/link";
import {
  ArrowRight,
  ShieldCheck,
  Sparkles,
  FileText,
  Target,
  Zap,
  Check,
  Lock,
} from "lucide-react";
import { Nav } from "@/components/Nav";
import { Logo } from "@/components/Logo";

export default function Landing() {
  return (
    <div className="min-h-screen">
      <Nav />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-fade pointer-events-none" />
        <div className="absolute inset-x-0 top-0 h-[520px] bg-dot-grid pointer-events-none opacity-60 mask-fade" />
        <div className="container-x relative pt-20 pb-24 text-center">
          <div className="inline-flex items-center gap-2 pill animate-rise">
            <Sparkles size={12} className="text-accent-600" />
            New · Evidence Mode keeps the AI honest
          </div>
          <h1 className="h-display mt-6 text-gradient max-w-4xl mx-auto animate-rise">
            The resume that gets you{" "}
            <span className="italic font-serif font-normal">interviewed.</span>
          </h1>
          <p className="mt-5 text-ink-500 text-lg max-w-2xl mx-auto animate-rise">
            Upload your resume, paste a job description, and get an
            ATS-optimized rewrite tailored to the role — every bullet traceable
            back to your real experience.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3 animate-rise">
            <Link href="/upload" className="btn btn-primary !px-5 !py-3">
              Optimize my resume
              <ArrowRight size={16} />
            </Link>
            <a href="#how" className="btn btn-ghost !px-4 !py-3">
              How it works
            </a>
          </div>
          <div className="mt-5 flex items-center justify-center gap-6 text-xs text-ink-400">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={13} /> Private by default
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Zap size={13} /> 30-second analysis
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Lock size={13} /> Unlock when you love it
            </span>
          </div>

          {/* Hero product preview */}
          <div className="mt-16 relative max-w-5xl mx-auto">
            <div className="absolute -inset-2 bg-gradient-to-b from-accent-200/30 to-transparent blur-2xl rounded-2xl" />
            <div className="relative card p-3 shadow-pop">
              <div className="flex items-center gap-1.5 px-2 py-2">
                <span className="w-2.5 h-2.5 rounded-full bg-ink-200" />
                <span className="w-2.5 h-2.5 rounded-full bg-ink-200" />
                <span className="w-2.5 h-2.5 rounded-full bg-ink-200" />
                <span className="ml-3 text-xs text-ink-400">
                  app.nextresume.io / analysis
                </span>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <HeroPanel
                  label="Your resume"
                  tone="muted"
                  rows={[
                    "Worked on internal dashboard tools…",
                    "Helped migrate a legacy service…",
                    "Collaborated with designers on…",
                  ]}
                />
                <HeroPanel
                  label="Optimized for: Senior Product Engineer @ Vercel"
                  tone="accent"
                  rows={[
                    "Led end-to-end delivery of React/TS dashboards used by 200+ ops users…",
                    "Migrated Rails → TypeScript serverless backend, cut p95 latency 38%…",
                    "Partnered with designers in Figma, lifting activation 11%…",
                  ]}
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 px-1 pb-1">
                <MetricCard label="ATS score" before={54} after={92} />
                <MetricCard label="Keyword match" before={41} after={96} />
                <MetricCard label="Quantified bullets" before={30} after={91} />
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4 text-xs text-ink-400">
            <span>Example targets this flow can tailor toward:</span>
            <span className="font-semibold tracking-tight">frontend platforms</span>
            <span className="font-semibold tracking-tight">product teams</span>
            <span className="font-semibold tracking-tight">design systems</span>
            <span className="font-semibold tracking-tight">AI tooling</span>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="border-t border-ink-100 bg-ink-50/40">
        <div className="container-x py-24">
          <SectionHeader
            eyebrow="How it works"
            title="From raw resume to interview-ready in under a minute."
            subtitle="Four steps. No account required for the free analysis."
          />
          <div className="grid md:grid-cols-4 gap-4 mt-12">
            {[
              {
                icon: FileText,
                step: "01",
                title: "Upload your resume",
                body: "PDF or DOCX. We parse structure and preserve your authentic experience.",
              },
              {
                icon: Target,
                step: "02",
                title: "Paste the job",
                body: "Paste any JD or import from a URL. We extract role requirements + keywords.",
              },
              {
                icon: Sparkles,
                step: "03",
                title: "Free ATS analysis",
                body: "See your gaps, missing keywords, and overall ATS score — instantly.",
              },
              {
                icon: ShieldCheck,
                step: "04",
                title: "Unlock the rewrite",
                body: "Use Stripe Checkout to unlock one tailored resume. Every claim maps to your real history.",
              },
            ].map((s, i) => (
              <div key={i} className="card p-5 relative overflow-hidden">
                <div className="text-xs font-mono text-ink-300">{s.step}</div>
                <div className="mt-3 w-9 h-9 rounded-lg bg-ink-900 text-white inline-flex items-center justify-center">
                  <s.icon size={16} />
                </div>
                <h3 className="mt-4 font-semibold text-ink-900">{s.title}</h3>
                <p className="mt-1.5 text-sm text-ink-500 leading-relaxed">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* EVIDENCE MODE */}
      <section id="evidence" className="border-t border-ink-100">
        <div className="container-x py-24 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <span className="pill !text-accent-700 !border-accent-200 !bg-accent-50">
              <Sparkles size={12} /> Evidence Mode
            </span>
            <h2 className="h-section mt-4 text-ink-900">
              Every rewritten bullet, traceable.
            </h2>
            <p className="mt-4 text-ink-500 leading-relaxed">
              We never fabricate. Hover any bullet in your optimized resume and
              we’ll highlight the exact sentences from your original experience
              that back it up — plus the JD keyword it satisfies.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "Bullet-level source mapping to your original resume",
                "Color-coded JD keyword coverage",
                "Side-by-side original and optimized views",
                "Rationale for why each rewrite is stronger",
              ].map((t) => (
                <li
                  key={t}
                  className="flex items-start gap-2.5 text-ink-700"
                >
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-ink-900 inline-flex items-center justify-center shrink-0">
                    <Check size={12} className="text-white" strokeWidth={3} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="card p-5 shadow-pop">
            <div className="text-xs text-ink-400 mb-3">
              Optimized bullet → Source
            </div>
            <div className="rounded-lg border border-accent-200 bg-accent-50/50 p-3 text-sm text-ink-900">
              “Migrated Rails service to a TypeScript/Node backend on serverless
              infra, cutting p95 latency 38%.”
              <div className="mt-2 flex flex-wrap gap-1.5">
                <KeywordChip>TypeScript</KeywordChip>
                <KeywordChip>serverless</KeywordChip>
                <KeywordChip>edge</KeywordChip>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-ink-400 text-xs">
              <div className="h-px flex-1 bg-ink-100" />
              traced to
              <div className="h-px flex-1 bg-ink-100" />
            </div>
            <div className="rounded-lg border border-ink-100 bg-white p-3 text-sm text-ink-700 mt-3">
              <span className="evidence-active px-1.5 py-0.5">
                Helped migrate a legacy Rails service to a TypeScript backend;
                reduced p95 latency.
              </span>
              <div className="text-xs text-ink-400 mt-2">
                ExampleCo · Software Engineer · Jul 2022–Present
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRODUCT GUARDRAILS */}
      <section className="border-t border-ink-100 bg-ink-50/40">
        <div className="container-x py-24">
          <SectionHeader
            eyebrow="Guardrails"
            title="Built for careful tailoring, not resume fiction."
          />
          <div className="grid md:grid-cols-3 gap-4 mt-10">
            {[
              {
                title: "No invented history",
                body: "Prompts require each rewritten bullet to cite real source bullets from your uploaded resume.",
              },
              {
                title: "Visible source mapping",
                body: "Evidence Mode highlights the original lines behind every optimized bullet.",
              },
              {
                title: "Verified unlock flow",
                body: "Stripe Checkout returns are verified server-side before the optimized result unlocks.",
              },
            ].map((t, i) => (
              <div key={i} className="card p-6">
                <div className="w-9 h-9 rounded-lg bg-ink-900 text-white inline-flex items-center justify-center">
                  <Check size={15} strokeWidth={3} />
                </div>
                <h3 className="mt-4 font-semibold text-ink-900">{t.title}</h3>
                <p className="mt-2 text-sm text-ink-500 leading-relaxed">
                  {t.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="border-t border-ink-100">
        <div className="container-x py-24">
          <SectionHeader
            eyebrow="Pricing"
            title="One resume, one price. No subscription."
            subtitle="Run the ATS analysis for free. Unlock the optimized version through Stripe Checkout."
          />
          <div className="grid md:grid-cols-2 gap-4 max-w-3xl mx-auto mt-10">
            <div className="card p-6">
              <div className="text-sm text-ink-500">Free</div>
              <div className="mt-1 text-4xl font-semibold tracking-tight">
                $0
              </div>
              <ul className="mt-5 space-y-2 text-sm text-ink-700">
                {[
                  "Resume upload + parse",
                  "Job description analysis",
                  "Full ATS score breakdown",
                  "Missing keyword report",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <Check size={14} className="mt-0.5 text-ink-400" />
                    {t}
                  </li>
                ))}
              </ul>
              <Link
                href="/upload"
                className="btn btn-outline w-full mt-6 !justify-center"
              >
                Run free analysis
              </Link>
            </div>
            <div className="card p-6 ring-1 ring-ink-900 relative shadow-pop">
              <span className="absolute -top-2 right-4 pill !bg-ink-900 !text-white !border-ink-900">
                Per resume
              </span>
              <div className="text-sm text-ink-500">Optimized resume</div>
              <div className="mt-1 text-4xl font-semibold tracking-tight">
                $9.99
              </div>
              <ul className="mt-5 space-y-2 text-sm text-ink-700">
                {[
                  "Everything in Free",
                  "Full AI rewrite tailored to the JD",
                  "Evidence Mode — bullet-level traceability",
                  "Side-by-side comparison view",
                  "Browser PDF export",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <Check
                      size={14}
                      className="mt-0.5 text-accent-600"
                      strokeWidth={3}
                    />
                    {t}
                  </li>
                ))}
              </ul>
              <Link
                href="/upload"
                className="btn btn-primary w-full mt-6 !justify-center"
              >
                Optimize my resume
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-ink-100 bg-ink-50/40">
        <div className="container-x py-24">
          <SectionHeader eyebrow="FAQ" title="Questions, answered." />
          <div className="max-w-2xl mx-auto mt-10 divide-y divide-ink-100 border border-ink-100 rounded-2xl bg-white">
            {[
              {
                q: "Will the AI invent experience I don't have?",
                a: "No. Evidence Mode forces every optimized bullet to map to a real line in your source resume. Anything inferred is flagged.",
              },
              {
                q: "Is my resume data private?",
                a: "Your resume is processed in-memory and deleted after 24 hours. We never use it to train models.",
              },
              {
                q: "Which file formats do you support?",
                a: "Upload PDF or DOCX. Export through your browser's PDF print flow.",
              },
              {
                q: "Do I need an account?",
                a: "No. The free analysis runs without an account.",
              },
            ].map((f, i) => (
              <details key={i} className="group p-5 cursor-pointer">
                <summary className="flex items-center justify-between list-none">
                  <span className="font-medium text-ink-900">{f.q}</span>
                  <span className="text-ink-300 group-open:rotate-45 transition">
                    +
                  </span>
                </summary>
                <p className="text-sm text-ink-500 mt-3 leading-relaxed">
                  {f.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-ink-100">
        <div className="container-x py-24 text-center">
          <h2 className="h-section text-gradient">
            Stop guessing what recruiters want.
          </h2>
          <p className="mt-4 text-ink-500">
            Get your free ATS analysis in 30 seconds.
          </p>
          <Link
            href="/upload"
            className="btn btn-primary !px-5 !py-3 mt-8 inline-flex"
          >
            Optimize my resume
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-ink-100">
        <div className="container-x py-10 flex items-center justify-between text-sm text-ink-400">
          <Logo />
          <span>© {new Date().getFullYear()} NextResume</span>
        </div>
      </footer>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="text-center max-w-2xl mx-auto">
      <div className="pill">{eyebrow}</div>
      <h2 className="h-section mt-4 text-ink-900">{title}</h2>
      {subtitle && <p className="text-ink-500 mt-3">{subtitle}</p>}
    </div>
  );
}

function HeroPanel({
  label,
  rows,
  tone,
}: {
  label: string;
  rows: string[];
  tone: "muted" | "accent";
}) {
  return (
    <div
      className={`rounded-xl border ${
        tone === "accent"
          ? "border-accent-200 bg-accent-50/40"
          : "border-ink-100 bg-ink-50/40"
      } p-4`}
    >
      <div className="text-xs text-ink-500 mb-2">{label}</div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div
            key={i}
            className={`text-[12px] leading-snug text-left px-2.5 py-2 rounded-md ${
              tone === "accent"
                ? "bg-white border border-accent-100 text-ink-800"
                : "bg-white border border-ink-100 text-ink-500"
            }`}
          >
            {r}
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  before,
  after,
}: {
  label: string;
  before: number;
  after: number;
}) {
  return (
    <div className="rounded-xl bg-white border border-ink-100 p-3 text-left">
      <div className="text-[11px] text-ink-400">{label}</div>
      <div className="flex items-end gap-2 mt-1">
        <span className="text-2xl font-semibold tabular-nums text-ink-900">
          {after}
        </span>
        <span className="text-xs text-emerald-600 mb-1 font-medium">
          +{after - before}
        </span>
      </div>
      <div className="mt-2 h-1.5 bg-ink-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-accent-500 to-accent-700"
          style={{ width: `${after}%` }}
        />
      </div>
    </div>
  );
}

function KeywordChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-md bg-accent-100 text-accent-700 font-medium">
      {children}
    </span>
  );
}
