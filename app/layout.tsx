// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { LocalizedAuthProvider } from "@/components/LocalizedAuthProvider";
import { cookies, headers } from "next/headers";
import { LanguageProvider } from "@/components/LanguageProvider";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/translate";
import "./globals.css";
import type { Metadata } from "next";
import { Inter, Instrument_Serif } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

async function requestLocale() {
  return resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value, (await headers()).get('accept-language') ?? '');
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
  title: translate(locale, "NextResume — AI-native resume optimization"),
  description:
    translate(locale, "Tailor your resume to any job description in seconds. ATS-optimized, evidence-backed, interview-ready."),
  icons: {
    icon: "/assets/img/nextresume-icon.svg",
    shortcut: "/assets/img/nextresume-icon.svg",
  },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await requestLocale();
  return (
    <html lang={locale === 'zh' ? 'zh-CN' : 'en'} className={`${inter.variable} ${serif.variable}`}>
      <body className="font-sans antialiased">
        <LanguageProvider initialLocale={locale}><LocalizedAuthProvider>
          {children}
        </LocalizedAuthProvider></LanguageProvider>
      </body>
    </html>
  );
}
