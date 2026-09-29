// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import { LanguageSwitch, useI18n } from "@/components/LanguageProvider";
import Link from "next/link";
import { UserButton, useUser, useClerk } from "@clerk/nextjs";
import { Logo } from "./Logo";

export function Nav({ minimal = false }: { minimal?: boolean }) {
  const { t } = useI18n();
  const { user } = useUser();
  const { openSignIn, openSignUp } = useClerk();

  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-white/70 border-b border-ink-100">
      <div className="container-x flex min-h-14 flex-wrap items-center justify-between gap-2 py-2">
        <Logo />
        {!minimal && (
          <nav className="hidden md:flex items-center gap-7 text-sm text-ink-600">
            <a href="#how" className="hover:text-ink-900 transition">
              {t("How it works")}</a>
            <a href="#evidence" className="hover:text-ink-900 transition">
              {t("Evidence Mode")}</a>
            <a href="#pricing" className="hover:text-ink-900 transition">
              {t("Pricing")}</a>
            <a href="#faq" className="hover:text-ink-900 transition">
              {t("FAQ")}</a>
          </nav>
        )}
        <div className="flex items-center gap-2">
          <LanguageSwitch />
          {user ? (
            <>
              <Link href="/upload" className="btn btn-ghost text-sm">
                {t("Go to app")}</Link>
              <UserButton />
            </>
          ) : (
            <>
              <button
                onClick={() => openSignIn()}
                className="btn btn-ghost"
              >
                {t("Sign in")}</button>
              <button
                onClick={() => openSignUp()}
                className="btn btn-primary"
              >
                {t("Get started")}</button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
