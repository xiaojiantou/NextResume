import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocale } from '../lib/i18n/locale.ts';
import { translate } from '../lib/i18n/translate.ts';
import { zh } from '../lib/i18n/zh.ts';

test('saved preference wins over browser language, with stable English fallback', () => {
  assert.equal(resolveLocale('en', 'zh-CN,en;q=0.9'), 'en');
  assert.equal(resolveLocale('zh', 'en-US'), 'zh');
  assert.equal(resolveLocale(undefined, 'zh-TW,en;q=0.9'), 'zh');
  assert.equal(resolveLocale('invalid', 'en-US,zh;q=0.5'), 'en');
  assert.equal(resolveLocale(), 'en');
});
test('Chinese covers core workflows while English returns exact original copy', () => {
  for (const key of ['How it works', 'Upload your resume', 'Your current ATS score', 'Unlock your optimized resume', 'Edit Resume', 'Edit with your assistant', 'Voice input', 'Download PDF', 'Retry compilation', 'Payment verification failed']) {
    assert.notEqual(translate('zh', key), key);
    assert.equal(translate('en', key), key);
  }
  assert.ok(Object.keys(zh).length > 600);
});
test('parameterized messages preserve names, metrics and keywords', () => {
  assert.equal(translate('zh', '3 pages'), '3 页');
  assert.equal(translate('zh', 'Parsed: 2 roles, 17 bullets'), '已解析：2 个职位，17 条成就');
  assert.equal(translate('zh', '1 of 15 required keywords present. Missing: React, LLMs.'), '已包含 15 个必需关键词中的 1 个。缺失：React, LLMs。');
  assert.equal(translate('zh', '3 of 8 bullets carry a number or measurable outcome (38%).'), '8 条成就中有 3 条包含数字或可衡量结果（38%）。');
});
test('unknown content and technical identifiers are not machine-translated', () => {
  for (const text of ['Built React dashboards for 200 users.', '\\documentclass{article}', 'TypeScript', 'Plaid', 'constructor', '<script>alert(1)</script>']) assert.equal(translate('zh', text), text);
});
