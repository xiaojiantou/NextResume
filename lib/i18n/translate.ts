// Copyright (c) 2026 HowBe LLC. All rights reserved.
import { zh } from './zh.ts';
import type { Locale } from './locale';
const patterns = Object.entries(zh).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => {
  const indices: string[] = [];
  const parts = key.split(/(\{\d+\})/g).map(part => {
    if (/^\{\d+\}$/.test(part)) { indices.push(part); return '(.+?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return { pattern: new RegExp(`^${parts.join('')}$`, 's'), value, indices };
});
export function translate(locale: Locale, text: string): string {
  if (locale === 'en') return text;
  if (Object.prototype.hasOwnProperty.call(zh, text)) return zh[text];
  for (const { pattern, value, indices } of patterns) {
    const match = pattern.exec(text);
    if (match) return value.replace(/\{\d+\}/g, token => match[indices.indexOf(token) + 1] ?? token);
  }
  return text;
}
