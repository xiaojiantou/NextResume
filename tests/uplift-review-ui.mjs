// Offline only: no server, model requests, or human review results are created.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
import { renderUpliftReview } from '../scripts/lib/uplift-review-html.mjs';

const hostile = '</script><script>window.__injected = true</script><img src="https://example.invalid/x" onerror="window.__injected = true">';
const packet = {
  version: 1, packetId: 'browser-smoke-packet', title: 'Which version makes the stronger case?',
  criteria: [
    { id: 'impact', label: 'Impact', description: 'Makes the value of the work clear.' },
    { id: 'specificity', label: 'Specificity', description: 'Shows what the person did and how.' },
  ],
  items: [
    {
      id: 'case-platform', target: { title: 'Platform Engineer', seniority: 'Mid-level', responsibilities: ['Improve operational tooling.', 'Make routine incident recovery easier.'] },
      sourceFacts: ['Maintained recovery runbooks for scheduled jobs.', hostile],
      A: ['Documented recovery steps for scheduled jobs, giving on-call engineers a shared incident reference.', 'Updated runbooks after recurring job failures.'],
      B: ['Was responsible for maintaining recovery runbooks.', 'Helped with job failures.'],
    },
    {
      id: '__proto__', target: { title: 'Customer Success Manager', seniority: 'Senior', responsibilities: ['Improve account handoffs.'] },
      sourceFacts: ['Created a handoff checklist with the sales team.'],
      A: ['Created a handoff checklist with sales to clarify account context.'],
      B: ['Prepared a checklist for account handoffs with sales.'],
    },
  ],
  privateMapping: 'must-not-appear-in-rendered-document',
};
const directory = await mkdtemp(join(tmpdir(), 'nextresume-uplift-ui-'));
const file = join(directory, 'review.html');
const html = renderUpliftReview(packet);
assert.equal(html.includes(packet.privateMapping), false);
await writeFile(file, html);
let browser;
try {
  browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  const remoteRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); });
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });

  assert.equal(await page.$eval('#download-review', button => button.disabled), true);
  assert.equal(await page.$$eval('[data-preference]:checked', inputs => inputs.length), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('nextresume:uplift-review:v1:browser-smoke-packet')), null);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.equal(await page.$$eval('img', images => images.length), 0);
  assert.equal(await page.$$eval('script', scripts => scripts.length), 2);
  assert.ok(await page.evaluate(text => document.body.innerText.includes(text), hostile));
  assert.equal(await page.$$eval('#comparison-0 .version:first-child li', items => items.length), 2);
  assert.equal(await page.$eval('#comparison-0 .version', element => getComputedStyle(element).backgroundColor), await page.$eval('#comparison-0 .version:last-child', element => getComputedStyle(element).backgroundColor));

  // Keyboard selection is explicit. Attestation alone never creates a vote.
  await page.click('#attestation');
  assert.equal(await page.$eval('#download-review', button => button.disabled), true);
  const firstChoice = '#comparison-0 [data-preference][value="A"]';
  await page.keyboard.press('Tab');
  await page.focus(firstChoice);
  assert.equal(await page.$eval(firstChoice, input => getComputedStyle(input).outlineStyle), 'solid');
  await page.keyboard.press('Space');
  assert.equal(await page.$eval('#download-review', button => button.disabled), true);
  assert.match(await page.$eval('#readiness-link', element => element.textContent), /reviewer code/);
  assert.equal(await page.$eval('#reviewer', input => input.maxLength), 80);
  await page.click('#comparison-0 [data-concern][value="B"]');
  await page.click('#comparison-0 [data-criterion][value="impact"]');
  await page.type('#comparison-0 [data-reason]', 'A explains the use of the runbooks without adding numbers.');
  await page.type('#reviewer', 'reviewer-smoke');
  assert.equal(await page.$eval('#download-review', button => button.disabled), false);
  assert.match(await page.$eval('#export-note', element => element.textContent), /Partial review: 1 answered; 1 unanswered/);
  assert.match(await page.$eval('#download-review', element => element.textContent), /partial review \(1\)/);

  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { window.__downloadText = blob.text(); return create(blob); };
    document.addEventListener('click', event => { if (event.target instanceof HTMLAnchorElement && event.target.download) event.preventDefault(); });
  });
  await page.click('#download-review');
  const downloaded = await page.evaluate(async () => JSON.parse(await window.__downloadText));
  assert.deepEqual(downloaded, {
    version: 1, packetId: packet.packetId, reviewer: 'reviewer-smoke', attested: true,
    ratings: [{ itemId: 'case-platform', preference: 'A', factualConcerns: ['B'], criteria: ['impact'], reason: 'A explains the use of the runbooks without adding numbers.' }],
  });

  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.$eval(firstChoice, input => input.checked), true);
  assert.equal(await page.$eval('#reviewer', input => input.value), 'reviewer-smoke');
  assert.equal(await page.$eval('#attestation', input => input.checked), true);
  assert.equal(await page.$$eval('#comparison-1 [data-preference]:checked', inputs => inputs.length), 0);
  await page.click('#comparison-1 [data-preference][value="tie"]');
  assert.match(await page.$eval('#review-progress', element => element.textContent), /2 of 2/);
  await page.click('#comparison-1 [data-clear]');
  assert.equal(await page.$$eval('#comparison-1 [data-preference]:checked', inputs => inputs.length), 0);

  // Reusing the same file for another packet must not borrow old preferences.
  await writeFile(file, renderUpliftReview({ ...packet, packetId: 'different-packet' }));
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.$$eval('[data-preference]:checked', inputs => inputs.length), 0);
  assert.equal(await page.$eval('#attestation', input => input.checked), false);
  assert.equal(await page.$eval('#download-review', button => button.disabled), true);
  await writeFile(file, html);
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.$eval(firstChoice, input => input.checked), true);

  await page.setViewport({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.UPLIFT_REVIEW_SCREENSHOT) await page.screenshot({ path: process.env.UPLIFT_REVIEW_SCREENSHOT, fullPage: true });

  const noStorage = await browser.newPage();
  noStorage.on('pageerror', error => errors.push(error.message));
  await noStorage.evaluateOnNewDocument(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage disabled'); };
    Storage.prototype.setItem = () => { throw new Error('Storage disabled'); };
  });
  await noStorage.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await noStorage.click(firstChoice);
  await noStorage.click('#attestation');
  await noStorage.type('#reviewer', 'storage-fallback-reviewer');
  assert.equal(await noStorage.$eval('#download-review', button => button.disabled), false);
  assert.match(await noStorage.$eval('#save-status', element => element.textContent), /Local saving is unavailable/);
  const identical = structuredClone(packet);
  identical.packetId = 'identical-packet';
  identical.items[0].B = identical.items[0].A;
  await writeFile(file, renderUpliftReview(identical));
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.$eval('#comparison-0 [data-preference][value="A"]', input => input.disabled), true);
  assert.equal(await page.$eval('#comparison-0 [data-preference][value="B"]', input => input.disabled), true);
  assert.equal(await page.$$eval('#comparison-0 [data-preference]:checked', inputs => inputs.length), 0);
  await page.click('#comparison-0 [data-preference][value="tie"]');
  assert.equal(await page.$eval('#comparison-0 [data-preference][value="tie"]', input => input.checked), true);
  assert.deepEqual(errors, []);
  assert.deepEqual(remoteRequests, []);
  console.log('PASS: explicit blind votes, reviewer-code requirement, attested partial export schema, draft persistence, packet isolation, clear choice, hostile content, keyboard focus, mobile width, offline operation, storage fallback.');
} finally {
  if (browser) await browser.close();
  await rm(directory, { recursive: true, force: true });
}
