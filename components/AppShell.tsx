// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import { LanguageSwitch, useI18n } from "@/components/LanguageProvider";
import { AuthStatus } from "./AuthStatus";
import { Logo } from "./Logo";
import Link from "next/link";
import { Stepper } from "./Stepper";

export function AppShell({
  step,
  children,
}: {
  step: "upload" | "analysis" | "checkout" | "result";
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-ink-100 bg-white">
        <div className="container-x flex min-h-14 flex-wrap items-center justify-between gap-2 py-2">
          <Logo />
          <div className="flex items-center gap-3 text-sm text-ink-500">
            <span className="hidden sm:inline">{t("Need help?")}</span>
            <LanguageSwitch />
            <AuthStatus />
            <Link
              href="/"
              className="btn btn-ghost !py-1.5 !px-2 text-ink-500"
            >
              {t("Exit")}</Link>
          </div>
        </div>
      </header>
      <div className="border-b border-ink-100 bg-ink-50/40">
        <div className="container-x">
          <Stepper current={step} />
        </div>
      </div>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-ink-100 mt-12">
        <div className="container-x py-6 flex flex-wrap gap-3 items-center justify-between text-xs text-ink-400">
          <span>{t("© NextResume · Built with privacy in mind")}</span>
          <span className="flex items-center gap-4">
            <a href="#" className="hover:text-ink-700">
              {t("Privacy")}</a>
            <a href="#" className="hover:text-ink-700">
              {t("Terms")}</a>
            <a href="#" className="hover:text-ink-700">
              {t("Status")}</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
