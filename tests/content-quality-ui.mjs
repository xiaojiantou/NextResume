// Run against local Next dev server: node --experimental-strip-types tests/content-quality-ui.mjs
// APIs are intercepted; this test never purchases or calls a model.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { DEFAULT_MODEL_ID } from '../lib/models.ts';
import { OPTIMIZATION_PIPELINE_VERSION } from '../lib/resumeStructure.ts';
import { refinementEvidenceLedger, normalizePriorEvidence } from '../lib/evidenceLedger.ts';
const resume = JSON.parse(readFileSync('eval/resumes/example-platform.json', 'utf8'));
const bullet = resume.experience[0].bullets[0];
const optimization = {
  pipelineVersion: OPTIMIZATION_PIPELINE_VERSION,
  title: resume.title, summary: resume.summary, skills: resume.skills,
  roles: resume.experience.map(role => ({ id: role.id, bullets: role.bullets.map(b => ({ ...b, evidence: [b.id], matchedKeywords: [], rationale: 'Original retained.', contentReview: { text: b.text, sourceText: b.text, status: 'retained', reason: 'Preserves the specific result and method.', dimensions: [], ...(b.id === bullet.id ? { question: 'Which part of this work did you personally implement?', impactMetrics: ['hours_saved'] } : {}) } })) })),
  projects: [], sectionOrder: ['summary','skills','experience','projects','education'], sectionLabels: { experience: 'Experience' }, structureMode: 'optimize',
};
const state = { resume, optimization, paid: true, selectedModel: DEFAULT_MODEL_ID, optimizationModel: DEFAULT_MODEL_ID, optimizationStructureMode: 'optimize', contentStructure: 'optimize', targetPages: 'auto', pdfStyle: 'classic', job: { title: 'Backend Engineer', requiredKeywords: [], niceToHaveKeywords: [], responsibilities: [], seniority: 'mid' }, report: { overallBefore: 70, overallAfter: 75, missingKeywords: [], presentKeywords: [], categoriesBefore: [], categoriesAfter: [] }, evidenceAnswers: {} };
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let submitted;
  let rejectNext = true;
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      if (request.url().includes('/api/order/')) {
        void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ snapshot: state, order: { status: 'paid' } }) });
      } else if (request.url().includes('/api/refine-bullet')) {
        submitted = JSON.parse(request.postData());
        if (rejectNext) {
          rejectNext = false;
          void request.respond({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'This rewrite needs a correction: Keep approximate wording. Your current bullet is unchanged.' }) });
          return;
        }
        const evidenceLedger = refinementEvidenceLedger({ source: submitted.originalBullet, prior: normalizePriorEvidence(submitted.priorEvidence), notes: submitted.confirmedEvidence.notes, estimates: submitted.confirmedEvidence.estimates, instructions: [submitted.instruction], now: '2026-09-09T12:00:00Z' });
        void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ bullet: { ...bullet, text: 'Built the routing service and its validation checks.', evidenceLedger, evidence: [bullet.id, 'voice-transcript'], matchedKeywords: [], rationale: 'Includes the confirmed contribution.' } }) });
      } else void request.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'API mocked for UI test' }) });
    } else if (request.isNavigationRequest() && new URL(request.url()).hostname === 'localhost') {
      // Keep this public-page UI test signed out; development auth handshakes
      // are unrelated to the mocked order/refinement flow under test.
      void request.continue({ headers: { ...request.headers(), 'sec-fetch-dest': 'empty' } });
    } else void request.continue();
  });
  await page.evaluateOnNewDocument(state => {
    if (!localStorage.getItem('nextresume-flow')) localStorage.setItem('nextresume-flow', JSON.stringify({ state, version: 0 }));
    // Exercise browser recognition events without recording audio or contacting a speech service.
    class MockRecognition {
      start() { window.testRecognition = this; }
      stop() { this.onend?.(); }
    }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: location.search.includes('voice=mock') ? MockRecognition : undefined });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined });
  }, state);
  const url = 'http://localhost:3000/result?order=ui-test&token=ui-test';
  await page.goto(url + '&voice=mock', { waitUntil: 'networkidle2', timeout: 60_000 });
  const clickText = async text => {
    await page.waitForFunction(text => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === text), {}, text);
    await page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text).click(), text);
  };
  await clickText('Bullet by bullet');
  await page.waitForFunction(() => document.body.innerText.includes('Content improvements'));
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Add evidence:')).click());
  const selector = `#evidence-${bullet.id}`;
  await page.waitForSelector(selector);
  await page.type(selector, 'I implemented the routing logic and validation checks.');
  await page.reload({ waitUntil: 'networkidle2' });
  await clickText('Bullet by bullet');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Add evidence:')).click());
  await page.waitForSelector(selector);
  assert.equal(await page.$eval(selector, el => el.value), 'I implemented the routing logic and validation checks.');
  await page.type(`#story-${bullet.id}`, 'Keep my supporting role. ');
  await page.click('button[title="Dictate in 中文"]');
  await clickText('Tell your story');
  assert.equal(await page.evaluate(() => window.testRecognition.lang), 'zh-CN');
  await page.evaluate(() => window.testRecognition.onresult({ resultIndex: 0, results: [{ 0: { transcript: '我检查了路由规则并编写校验；我协助负责人，没有领导整个团队。' }, isFinal: true }] }));
  await clickText('Stop recording');
  assert.match(await page.$eval(`#story-${bullet.id}`, el => el.value), /^Keep my supporting role\. 我检查了路由规则/);
  await page.evaluate(() => [...document.querySelectorAll('summary')].find(el => el.textContent.includes('Estimate impact:')).click());
  for (const [label, value] of [['Minutes per task before', '60'], ['Minutes per task after', '15'], ['Runs per month', '40']]) {
    const input = await page.evaluateHandle(label => [...document.querySelectorAll('label')].find(el => el.textContent.trim() === label).querySelector('input'), label);
    await input.asElement().type(value);
  }
  await page.waitForFunction(() => document.body.innerText.includes('Approximately 30 hours saved per month'));
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Use confirmed estimate').disabled), true);
  await page.evaluate(() => [...document.querySelectorAll('label')].find(el => el.textContent.includes('I confirm these inputs')).querySelector('input').click());
  await clickText('Use confirmed estimate');
  await clickText('Rewrite');
  await page.waitForFunction(() => document.body.innerText.includes('This rewrite needs a correction:'));
  assert.match(submitted.instruction, /我检查了路由规则/);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Use this bullet')), false);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('nextresume-flow')).state.optimization.roles[0].bullets[0].text), bullet.text);
  await clickText('Rewrite');
  await page.waitForFunction(() => document.body.innerText.includes('Includes the confirmed contribution.'));
  assert.match(submitted.confirmedEvidence.notes, /I implemented the routing logic and validation checks/);
  assert.equal(submitted.originalBulletId, bullet.id);
  assert.equal(submitted.confirmedEvidence.estimates[0].value, 30);
  assert.ok(submitted.confirmedEvidence.estimates[0].confirmedAt);
  await clickText('Use this bullet');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nextresume-flow')).state);
  const accepted = saved.optimization.roles[0].bullets[0];
  assert.equal(accepted.text, 'Built the routing service and its validation checks.');
  assert.ok(saved.lockedContentIds.includes(bullet.id));
  assert.equal(accepted.contentReview, undefined);
  assert.equal(accepted.decisionHistory.at(-1).action, 'accept');
  assert.match(saved.evidenceAnswers[bullet.id].answer, /I implemented the routing logic and validation checks/);
  assert.equal(saved.evidenceAnswers[bullet.id].estimates[0].value, 30);
  assert.ok(accepted.evidenceLedger.some(record => record.kind === 'instruction'));
  await clickText('Refine · voice or text');
  await clickText('Remove');
  await clickText('Rewrite');
  await page.waitForFunction(() => document.body.innerText.includes('Includes the confirmed contribution.'));
  assert.match(submitted.instruction, /Remove the previous/);
  assert.equal(submitted.confirmedEvidence.estimates.length, 0);
  assert.deepEqual(submitted.confirmedEvidence.removedEstimates, ['hours_saved']);
  assert.ok(submitted.priorEvidence.some(record => record.kind === 'confirmed_estimate'));

  const beforeEstimate = await page.evaluate(() => JSON.parse(localStorage.getItem('nextresume-flow')).state.optimization.roles[0].bullets[0].text);
  await clickText('Estimate monthly work volume');
  await page.evaluate(() => [...document.querySelectorAll('summary')].find(el => el.textContent.includes('Monthly work volume')).click());
  for (const [label, value] of [['Average count each time', '25'], ['Times per month', '20']]) {
    const input = await page.evaluateHandle(label => [...document.querySelectorAll('label')].find(el => el.textContent.trim() === label).querySelector('input'), label);
    await input.asElement().type(value);
  }
  assert.equal(await page.evaluate(() => document.body.innerText.includes('Draft estimate: Approximately 500')), false);
  await page.select('select[id$="-unit"]', 'shipment records');
  await page.waitForFunction(() => document.body.innerText.includes('Draft estimate: Approximately 500 shipment records per month'));
  const confirmDisabled = () => page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Use confirmed estimate').disabled);
  assert.equal(await confirmDisabled(), true);
  const confirmInputs = () => page.evaluate(() => [...document.querySelectorAll('label')].find(el => el.textContent.includes('I confirm these inputs')).querySelector('input').click());
  await confirmInputs();
  await page.select('select[id$="-unit"]', 'tickets');
  assert.equal(await confirmDisabled(), true);
  await page.select('select[id$="-unit"]', 'shipment records');
  await confirmInputs();
  await clickText('Use confirmed estimate');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('nextresume-flow')).state.optimization.roles[0].bullets[0].text), beforeEstimate);
  await clickText('Refine again');
  await page.waitForFunction(() => document.body.innerText.includes('Includes the confirmed contribution.') && !document.body.innerText.includes('Rewriting…'));
  assert.equal(submitted.confirmedEvidence.estimates[0].metric, 'monthly_workload');
  assert.equal(submitted.confirmedEvidence.estimates[0].inputs.unit, 'shipment records');
  assert.equal(submitted.confirmedEvidence.estimates[0].value, 500);
  assert.match(submitted.confirmedEvidence.estimates[0].description, /^Approximately/);

  // A missing browser capability stays visible and gives a typing fallback.
  await page.goto(url, { waitUntil: 'networkidle2' });
  await clickText('Bullet by bullet');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Refine · voice or text').click());
  await page.waitForFunction(() => document.body.innerText.includes('Voice input is unavailable in this browser.'));
  assert.equal(await page.$eval('button[aria-label="Tell your story by voice"]', b => b.disabled), true);
  await page.type(`#story-${bullet.id}`, 'I can still type my experience here.');
  await page.setViewport({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: spoken Chinese story appends to typed context, review rejection keeps current text, evidence persistence, acceptance and lock, estimate removal, workload unit/confirmation, unavailable voice typing fallback, mobile width, no runtime errors.');
} finally { await browser.close(); }
