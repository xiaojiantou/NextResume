// Copyright (c) 2026 HowBe LLC. All rights reserved.
'use client';
import { ClerkProvider } from '@clerk/nextjs';
import { enUS, zhCN } from '@clerk/localizations';
import { useI18n } from './LanguageProvider';
export function LocalizedAuthProvider({ children }: { children: React.ReactNode }) {
  const { locale } = useI18n();
  return <ClerkProvider localization={locale === 'zh' ? zhCN : enUS}>{children}</ClerkProvider>;
}
