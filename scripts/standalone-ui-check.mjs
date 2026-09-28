import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import puppeteer from 'puppeteer';
import launcher from '../standalone/server.cjs';

// Exercise the real, key-free UI. No provider traffic or synthetic result DOM.
const artifacts = resolve('.artifacts/ui');
await mkdir(artifacts, { recursive: true });
const server = launcher.createLocalServer({ fetchImpl: async () => { throw new Error('Provider calls are forbidden in UI checks'); } });
let browser;
const failures = [];
const reports = [];
try {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const widths = (process.env.UI_CHECK_WIDTHS || '360,390,768,1440').split(',').map(Number);
  for (const width of widths) {
    for (const theme of ['dark', 'light']) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      const name = `${theme}-${width}`;
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewport({ width, height: width < 740 ? 844 : 1000, deviceScaleFactor: 1 });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(value => localStorage.setItem('ezq.theme', value), theme);
      const click = async selector => {
        await page.waitForSelector(selector, { visible: true });
        await page.$eval(selector, node => node.scrollIntoView({ block: 'center' }));
        await page.click(selector);
      };
      const snapshot = async state => {
        await page.screenshot({ path: join(artifacts, `${name}-${state}.png`), fullPage: state !== 'settings' && state !== 'generation' });
      };
      const layout = async state => {
        const metrics = await page.evaluate(() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
        }));
        reports.push({ name, state, ...metrics });
        assert.ok(metrics.document <= width + 1 && metrics.body <= width + 1, `${state}: horizontal overflow ${JSON.stringify(metrics)}`);
      };
      try {
        await page.goto(origin, { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => window.EZQ?.standalone && document.querySelector('#learningStatus')?.textContent);
        await snapshot('builder');
        await layout('builder');
        const builder = await page.evaluate(() => {
          const box = id => document.getElementById(id).getBoundingClientRect();
          const tools = document.querySelector('.starter-tools').getBoundingClientRect();
          const statusVisible = !!document.getElementById('status').getClientRects().length;
          return {
            retiredEditorHidden: !document.getElementById('legacyQuizTools').getClientRects().length,
            statusGap: statusVisible ? box('status').top - tools.bottom : null,
            learningGap: box('learningStatus').top - (statusVisible ? box('status').bottom : tools.bottom),
            padding: parseFloat(getComputedStyle(document.getElementById('generatorCard')).paddingLeft),
          };
        });
        assert.ok(builder.retiredEditorHidden, 'Retired editor is visible');
        assert.ok((builder.statusGap === null || builder.statusGap >= 12) && builder.learningGap >= 8, `Crowded builder status: ${JSON.stringify(builder)}`);
        assert.ok(builder.padding >= 18, 'Builder padding is too narrow');
        await click('#optionsBtn');
        await snapshot('options');
        await layout('options');
        await click('#optionsBtn');
        await click('#settingsBtn');
        await snapshot('settings');
        const modal = await page.evaluate(() => {
          const root = document.getElementById('settingsModal');
          const dialog = root.querySelector('.modal__dialog').getBoundingClientRect();
          const top = document.elementFromPoint(innerWidth - 20, innerHeight - 20);
          return {
            contained: dialog.left >= 0 && dialog.right <= innerWidth + 1 && dialog.top >= 0 && dialog.bottom <= innerHeight + 1,
            backdropAboveFab: root.contains(top),
            bodyOverflow: root.querySelector('.modal__body').scrollWidth > root.querySelector('.modal__body').clientWidth + 1,
            mode: document.getElementById('generationMode').value,
            cap: document.getElementById('promptLimitEnabled').checked,
          };
        });
        assert.ok(modal.contained && modal.backdropAboveFab && !modal.bodyOverflow, `Modal geometry: ${JSON.stringify(modal)}`);
        assert.equal(modal.mode, 'full');
        assert.equal(modal.cap, false);
        await page.$eval('#generationMode', node => node.scrollIntoView({ block: 'center' }));
        await snapshot('generation');
        await page.select('#generationMode', 'lite');
        await click('#promptLimitEnabled');
        await page.select('#promptLimitChars', '60000');
        await click('#settingsClose');
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ezq.settings')));
        assert.equal(saved.generationMode, 'lite');
        assert.equal(saved.promptLimitEnabled, true);
        assert.equal(saved.promptLimitChars, 60000);
        await click('#quickDemoBtn');
        await snapshot('ready');
        await layout('ready');
        await click('#startToolbarBtn');
        await page.waitForSelector('#quizView:not(.is-hidden)');
        await snapshot('quiz');
        await layout('quiz');
        const count = await page.evaluate(() => window.EZQ.quiz.questions.length);
        for (let i = 1; i < count; i++) await click('#nextBtn');
        await click('#finishBtn');
        await page.waitForSelector('#resultsView:not(.is-hidden)');
        await snapshot('results');
        await layout('results');
        const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('ezq.learning')));
        assert.equal(profile.attempts, 1);
        assert.equal(profile.questions, count);
        assert.ok(profile.recentMisses.length > 0);
        await click('#backToMenuBtn');
        await page.reload({ waitUntil: 'networkidle0' });
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ezq.learning')).attempts), 1);
        await click('#settingsBtn');
        await click('#clearLearningBtn');
        assert.equal(await page.evaluate(() => localStorage.getItem('ezq.learning')), null);
        assert.deepEqual(errors, [], 'Browser runtime errors');
        process.stdout.write(`${name}: builder, options, settings, quiz, results, persistence passed\n`);
      } catch (error) {
        failures.push({ name, message: error.message, errors });
        await snapshot('failure').catch(() => {});
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
await writeFile(join(artifacts, 'report.json'), JSON.stringify({ reports, failures }, null, 2));
if (failures.length) {
  process.stderr.write(JSON.stringify(failures, null, 2) + '\n');
  process.exitCode = 1;
}
