// Copyright (c) 2026 HowBe LLC. All rights reserved.
// Run with a local dev server. Model/order APIs are mocked; no purchase or generation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { DEFAULT_MODEL_ID } from '../lib/models.ts';
import { OPTIMIZATION_PIPELINE_VERSION } from '../lib/resumeStructure.ts';
const resume = JSON.parse(readFileSync('eval/resumes/example-platform.json', 'utf8'));
const optimization = { pipelineVersion: OPTIMIZATION_PIPELINE_VERSION, title: resume.title, summary: resume.summary, skills: resume.skills, roles: resume.experience.map(r => ({ id: r.id, bullets: r.bullets.map(b => ({ ...b, evidence: [b.id], matchedKeywords: [], rationale: 'Original retained.' })) })), projects: [], structureMode: 'optimize' };
const state = { resume, optimization, paid: true, selectedModel: DEFAULT_MODEL_ID, optimizationModel: DEFAULT_MODEL_ID, optimizationStructureMode: 'optimize', contentStructure: 'optimize', targetPages: 'auto', pdfStyle: 'classic', job: { title: 'Backend Engineer', company: 'Example', requiredKeywords: ['React'], niceToHaveKeywords: [], responsibilities: [], seniority: 'mid' }, report: { overallBefore: 70, overallAfter: 75, missingKeywords: ['React'], presentKeywords: [], categoriesBefore: [], categoriesAfter: [] }, fitBrief: { verdict: 'good', headline: 'Good fit', whatTheyWant: 'Build services.', strengths: [], gaps: [], workflow: [], yourStory: 'Engineering.', quickZh: { headline: '较为匹配', employerNeeds: '构建后端服务', strengths: ['有后端开发经验'], gaps: [], actions: ['突出相关项目'] } } };
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      const body = request.url().includes('/api/order/') ? { snapshot: state, order: { status: 'paid' } } : request.url().includes('/api/analyze') ? { report: state.report } : { error: 'Mocked API' };
      void request.respond({ status: 'error' in body ? 503 : 200, contentType: 'application/json', body: JSON.stringify(body) });
    } else void request.continue(request.isNavigationRequest() ? { headers: { ...request.headers(), 'sec-fetch-dest': 'empty' } } : undefined);
  });
  const language = 'select[aria-label="Language / 语言"]';
  await page.goto('http://localhost:3000/upload', { waitUntil: 'networkidle2', timeout: 90_000 });
  await page.select(language, 'en');
  const draft = 'Keep React and PostgreSQL exactly as written.';
  await page.type('textarea', draft);
  await page.select(language, 'zh');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  assert.equal(await page.$eval('textarea', e => e.value), draft);
  assert.match(await page.evaluate(() => document.body.innerText), /你的简历与目标岗位/);
  await page.reload({ waitUntil: 'networkidle2' });
  assert.equal(await page.$eval(language, e => e.value), 'zh');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'zh-CN');
  await page.setViewport({ width: 375, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: '/tmp/nextresume-zh-mobile.png', fullPage: true });
  await page.evaluate(state => localStorage.setItem('nextresume-flow', JSON.stringify({ state, version: 0 })), state);
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto('http://localhost:3000/result?order=ui-test&token=ui-test', { waitUntil: 'networkidle2', timeout: 90_000 });
  await page.waitForSelector('#resume-agent-request', { timeout: 60_000 });
  await page.type('#resume-agent-request', '保留原来的语气，精简描述。');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('nextresume-flow')).state.optimization);
  await page.select(language, 'en');
  await page.waitForFunction(() => document.body.innerText.includes('Edit with your assistant'));
  assert.equal(await page.$eval('#resume-agent-request', e => e.value), '保留原来的语气，精简描述。');
  await page.select(language, 'zh');
  await page.waitForFunction(() => document.body.innerText.includes('和助手一起修改'));
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('nextresume-flow')).state.optimization), before);
  await page.screenshot({ path: '/tmp/nextresume-zh-result.png', fullPage: true });
  await page.goto('http://localhost:3000/analysis', { waitUntil: 'networkidle2', timeout: 90_000 });
  await page.waitForFunction(() => document.body.innerText.includes('构建后端服务'));
  await page.select(language, 'en');
  await page.waitForFunction(() => document.body.innerText.includes('Build services.'));
  assert.deepEqual(errors, []);
  console.log('PASS: Chinese/English pages, cookie persistence, mobile width, draft preservation, unchanged resume content, analysis language; no browser errors.');
} finally { await browser.close(); }
