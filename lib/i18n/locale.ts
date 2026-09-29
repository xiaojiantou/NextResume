// Copyright (c) 2026 HowBe LLC. All rights reserved.
export type Locale = 'en' | 'zh';
export const LOCALE_COOKIE = 'nextresume-locale';
export function resolveLocale(saved?: string | null, accepted = ''): Locale {
  if (saved === 'zh' || saved === 'en') return saved;
  const first = accepted.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('zh') ? 'zh' : 'en';
}
