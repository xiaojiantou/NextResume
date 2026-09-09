// Run against local Next dev server: node --experimental-strip-types tests/content-quality-ui.mjs
// APIs are intercepted; this test never purchases or calls a model.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { DEFAULT_MODEL_ID } from '../lib/models.ts';
const resume = JSON.parse(readFileSync('eval/resumes/example-platform.json', 'utf8'));
const bullet = resume.experience[0].bullets[0];
const optimization = {
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
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      if (request.url().includes('/api/order/')) {
        void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ snapshot: state, order: { status: 'paid' } }) });
      } else if (request.url().includes('/api/refine-bullet')) {
        submitted = JSON.parse(request.postData());
        void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ bullet: { ...bullet, text: 'Built the routing service and its validation checks.', evidence: [bullet.id, 'voice-transcript'], matchedKeywords: [], rationale: 'Includes the confirmed contribution.' } }) });
      } else void request.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'API mocked for UI test' }) });
    } else void request.continue();
  });
  await page.evaluateOnNewDocument(state => {
    if (!localStorage.getItem('nextresume-flow')) localStorage.setItem('nextresume-flow', JSON.stringify({ state, version: 0 }));
  }, state);
  await page.goto('http://localhost:3000/result?order=ui-test&token=ui-test', { waitUntil: 'networkidle2', timeout: 60_000 });
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
  await page.waitForFunction(() => document.body.innerText.includes('Includes the confirmed contribution.'));
  assert.match(submitted.instruction, /I implemented the routing logic and validation checks/);
  assert.equal(submitted.originalBulletId, bullet.id);
  assert.match(submitted.instruction, /Approximately 30 hours saved per month/);
  assert.match(submitted.instruction, /do not present it as directly measured/);
  await clickText('Use this bullet');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nextresume-flow')).state);
  const accepted = saved.optimization.roles[0].bullets[0];
  assert.equal(accepted.text, 'Built the routing service and its validation checks.');
  assert.ok(saved.lockedContentIds.includes(bullet.id));
  assert.equal(accepted.contentReview, undefined);
  assert.match(saved.evidenceAnswers[bullet.id].answer, /I implemented the routing logic and validation checks/);
  assert.match(saved.evidenceAnswers[bullet.id].answer, /Approximately 30 hours saved per month/);
  await page.setViewport({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: review labels, optional question, saved answer after reload, refinement payload, acceptance and lock, mobile width, no runtime errors.');
} finally { await browser.close(); }
