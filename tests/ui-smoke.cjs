// Developer-only browser regression. Uses synthetic empty data, never user files.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
let bound = true;
let data = { writings: [], speaking: [], mistakes: [] };
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/data') {
      if (req.method === 'PUT') {
        let body = ''; for await (const chunk of req) body += chunk;
        data = JSON.parse(body).data;
      }
      res.end(JSON.stringify({ data, storage: { bound, ready: bound, fileExists: false } }));
    } else if (req.url === '/api/ai/status') res.end(JSON.stringify({ connected: false }));
    else { res.statusCode = 404; res.end('{}'); }
    return;
  }
  const file = path.join(root, 'app', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!file.startsWith(path.join(root, 'app') + path.sep)) { res.statusCode = 403; res.end(); return; }
  try {
    res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.statusCode = 404; res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base);
    await page.locator('#storageOnboarding.hidden').waitFor({state:'attached'});
    assert.equal(await page.locator('[data-route="listening"], [data-route="reading"]').count(), 0);
    await page.screenshot({path:path.join(root, 'docs/images/home.png'), fullPage:true, animations:'disabled'});
    await page.locator('.nav-item[data-route="writing"]').click();
    assert.equal(await page.locator('#saveWriting').count(), 0);
    await page.locator('#writingType').selectOption('Task 1 Academic');
    assert.equal(await page.locator('#writingMinutes').inputValue(), '20');
    assert.equal(await page.locator('#writingTimer').textContent(), '20:00');
    await page.screenshot({path:path.join(root, 'docs/images/writing.png'), fullPage:true, animations:'disabled'});
    await page.locator('#writingType').selectOption('Task 2');
    assert.equal(await page.locator('#writingMinutes').inputValue(), '40');
    await page.locator('#writingType').selectOption('自由写作');
    assert.equal(await page.locator('#writingMinutes').inputValue(), '0');
    assert.equal(await page.locator('#writingTimer').textContent(), '00:00');
    await page.locator('#toggleTimer').click();
    await page.waitForTimeout(1100);
    assert.notEqual(await page.locator('#writingTimer').textContent(), '00:00', 'no-limit mode must count upward');
    await page.locator('#toggleTimer').click();
    await page.locator('.nav-item[data-route="speaking"]').click();
    assert.equal(await page.locator('#saveSpeaking').count(), 0);
    assert.equal(await page.locator('#browserTranscribe').count(), 0);
    assert.equal(await page.locator('#transcriptionEngine').count(), 0);
    assert.equal(await page.locator('#recordButton').textContent(), '开始录音并转写');
    await page.screenshot({path:path.join(root, 'docs/images/speaking.png'), fullPage:true, animations:'disabled'});
    await page.locator('.nav-item[data-route="plan"]').click();
    assert.equal(await page.locator('#manualListening, #manualReading').count(), 0);
    assert.equal(await page.locator('.manual-targets input').count(), 7);
    assert.equal(await page.locator('#manualWriting').getAttribute('max'), '1');
    assert.equal(await page.locator('#manualSpeaking').getAttribute('max'), '2');
    await page.screenshot({path:path.join(root, 'docs/images/plan.png'), fullPage:true, animations:'disabled'});
    await page.locator('.nav-item[data-route="mistakes"]').click();
    assert.equal(await page.locator('select#mistakeModule').count(), 0);
    assert.deepEqual(await page.locator('[data-mistake-module]').evaluateAll(buttons => buttons.map(b => b.dataset.mistakeModule)), ['writing','speaking','vocabulary']);
    for (const module of ['speaking','vocabulary','writing']) {
      const before = (data.mistakes || []).length;
      await page.locator(`[data-mistake-module="${module}"]`).click();
      assert.equal(await page.locator('#mistakeModule').inputValue(), module);
      assert.equal(await page.locator('[data-mistake-module][aria-pressed="true"]').count(), 1);
      assert.equal(await page.locator(`[data-mistake-module="${module}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal((data.mistakes || []).length, before, 'category buttons must not submit the form');
      await page.locator('#mistakeTitle').fill('UI test');
      await page.locator('#mistakeText').fill('Synthetic note');
      await page.locator('#mistakeForm button[type="submit"]').click();
      await page.waitForFunction(count => document.querySelector('#mistakeCount').textContent === String(count), before + 1);
      assert.equal(data.mistakes.at(-1).module, module);
    }
    for (const width of [1440, 780, 390]) {
      await page.setViewportSize({width, height:1050});
      const card = page.locator('.mistake-entry').first();
      const box = await card.boundingBox();
      const button = await card.locator('[data-delete-mistake]').boundingBox();
      assert.ok(button.height <= 32 && button.width <= 50, 'notebook delete must remain compact');
      assert.ok(button.x > box.x && button.x + button.width < box.x + box.width, 'delete stays inside card');
      assert.ok(button.y >= box.y && button.y - box.y < 24, 'delete stays at top-right');
    }
    await page.screenshot({path:path.join(root, 'dist/notebook-delete-check.png'), fullPage:true, animations:'disabled'});
    await page.setViewportSize({width:1440,height:1050});
    bound = false;
    await page.reload();
    await page.locator('#storageOnboarding').waitFor({state:'visible'});
    await page.screenshot({path:path.join(root, 'docs/images/storage.png'), fullPage:true, animations:'disabled'});
    assert.deepEqual(errors, []);
    console.log('UI regression passed; refreshed screenshots contain no user records or paths.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
