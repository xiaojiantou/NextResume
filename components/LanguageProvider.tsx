// Copyright (c) 2026 HowBe LLC. All rights reserved.
'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LOCALE_COOKIE, type Locale } from '@/lib/i18n/locale';
import { translate } from '@/lib/i18n/translate';
const LanguageContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({ locale: 'en', setLocale: () => {} });
export function LanguageProvider({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
  const [locale, updateLocale] = useState(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    updateLocale(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    try { localStorage.setItem(LOCALE_COOKIE, next); } catch { /* Cookie still persists the preference. */ }
  }, []);
  useEffect(() => { document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'; }, [locale]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === LOCALE_COOKIE && (event.newValue === 'en' || event.newValue === 'zh')) updateLocale(event.newValue);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export function useI18n() {
  const context = useContext(LanguageContext);
  const t = useCallback((text: string | null | undefined) => translate(context.locale, text ?? ""), [context.locale]);
  return { ...context, t };
}
export function LanguageSwitch() {
  const { locale, setLocale } = useI18n();
  return <label className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-500">
    <span className="sr-only">Language / 语言</span>
    <select aria-label="Language / 语言" value={locale} onChange={event => setLocale(event.target.value as Locale)} className="rounded-md border border-ink-200 bg-white px-2 py-1.5 text-sm text-ink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500">
      <option value="en">English</option><option value="zh">中文</option>
    </select>
  </label>;
}
