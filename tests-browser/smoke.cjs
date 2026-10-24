// Browser smoke test: drives the real app like a person would (setup, sale, expense, reports,
// offline, second business). Optional: it needs Playwright, which the normal tests do not.
//
//   npm install --no-save playwright && npx playwright install chromium
//   node tests-browser/smoke.cjs
//
// Set PLAYWRIGHT_MODULE=/path/to/node_modules/playwright if Playwright is installed elsewhere,
// and SHOTS=/some/folder to save screenshots.

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const PORT = Number(process.env.PORT) || 8081;
const BASE = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const problems = [];
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) problems.push(msg);
};

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('The local server did not start.');
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'tools', 'serve.js'), String(PORT)], { stdio: 'ignore' });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 400, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
    const shot = (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
    // Words that mean something went wrong when they appear as visible text.
    const cleanScreen = async (label) => {
      const text = await page.locator('body').innerText();
      const bad = text.match(/\b(null|undefined|NaN|\[object Object\])\b/);
      ok(!bad, `${label}: no stray "${bad ? bad[0] : 'null'}" text`);
    };

    await page.goto(BASE);
    await page.waitForSelector('form');
    ok((await page.locator('h1').innerText()) === 'Simple POS', 'setup wizard shows on first run');
    await cleanScreen('setup');

    await page.fill('input[required][maxlength="60"]', 'Test Cafe');
    await page.selectOption('select >> nth=0', 'food');
    await page.check('input[type=checkbox] >> nth=0');
    await page.fill('input[type=number]', '10');
    await page.click('button:has-text("Create business")');
    await page.waitForSelector('.tiles .tile');
    ok((await page.locator('.tile').count()) === 3, 'sample menu items appear');
    ok((await page.locator('.biz-name').innerText()) === 'Test Cafe', 'business name in header');
    await cleanScreen('sell (empty)');
    await shot('1-sell-empty.png');

    await page.click('.tile:has-text("Coffee")');
    await page.click('.tile:has-text("Coffee")');
    await page.click('.tile:has-text("Sandwich")');
    ok((await page.locator('.cart-line').count()) === 2, 'identical items merge into one cart line');
    await page.click('.cart .chip:has-text("10%")');
    const grand = await page.locator('.trow.grand span').last().innerText();
    ok(grand === '$12.38', `total is right: 2x3.00 + 6.50, 10% off, 10% tax = $12.38 (got ${grand})`);
    await cleanScreen('sell (cart)');
    await shot('2-sell-cart.png');

    await page.click('button:has-text("Charge")');
    await page.waitForSelector('dialog[open]');
    await page.click('dialog .chip:has-text("Exact")');
    await page.click('dialog button:has-text("Complete sale")');
    await page.waitForSelector('pre.receipt');
    const receipt = await page.locator('pre.receipt').innerText();
    ok(/Test Cafe/.test(receipt) && /TOTAL/.test(receipt) && /Order discount/.test(receipt), 'receipt shows business, discount and total');
    ok(/R\d{6}-0001/.test(receipt), 'receipt number issued');
    await shot('3-receipt.png');
    await page.click('dialog button:has-text("New order")');
    ok((await page.locator('.cart-line').count()) === 0, 'cart cleared after the sale');

    await page.click('.tab:has-text("Expenses")');
    await page.fill('input[placeholder="0.00"] >> nth=0', '40.50');
    await page.selectOption('form select >> nth=0', { index: 2 });
    await page.fill('input[placeholder="Who was paid?"]', 'Market');
    await page.click('button:has-text("Save expense")');
    await page.waitForSelector('.list-row');
    ok((await page.locator('.list-row').count()) === 1, 'expense saved and listed');
    await cleanScreen('expenses');
    await shot('4-expenses.png');

    await page.click('.tab:has-text("Reports")');
    await page.waitForSelector('.stats');
    const stats = await page.locator('.stat').allInnerTexts();
    ok(stats.some((s) => /expenses/i.test(s) && /\$40\.50/.test(s)), 'expenses show in the report');
    ok(stats.some((s) => /takings/i.test(s) && /\$12\.38/.test(s) && /1 sale/.test(s)), 'takings show the sale');
    ok(stats.some((s) => /net sales/i.test(s) && /\$11\.25/.test(s)), 'net sales exclude tax');
    ok(stats.some((s) => /profit/i.test(s) && /-\$29\.25/.test(s)), 'profit = net sales - expenses');
    await cleanScreen('reports');
    await shot('5-reports.png');

    await page.click('.tab:has-text("Menu")');
    await page.waitForSelector('.list-row');
    ok((await page.locator('.list-row').count()) === 3, 'menu tab lists items');
    await cleanScreen('menu');
    await page.click('.tab:has-text("Settings")');
    await page.waitForSelector('.settings');
    await cleanScreen('settings');
    await shot('6-settings.png');

    await page.waitForTimeout(1200);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForSelector('.tiles .tile');
    await page.click('.tab:has-text("Reports")');
    await page.waitForSelector('.stats');
    ok((await page.locator('.stat').allInnerTexts()).some((s) => /1 sale/.test(s)), 'data persisted after reload');

    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('.tiles .tile', { timeout: 8000 });
    ok(true, 'app opens while offline');
    await page.click('.tile:has-text("Cake slice")');
    await page.click('button:has-text("Charge")');
    await page.click('dialog button:has-text("Complete sale")');
    await page.waitForSelector('pre.receipt');
    ok(true, 'a sale can be completed offline');
    await page.click('dialog button:has-text("New order")');
    ok(/Offline/.test(await page.locator('#badge').innerText()), 'status badge says offline');
    await context.setOffline(false);

    // Past sales: view a receipt again, then void the newest sale and check the books update.
    await page.click('.tab:has-text("Reports")');
    await page.waitForSelector('.list-row');
    ok((await page.locator('.list-row').count()) === 2, 'sales history lists both sales');
    await page.locator('.list-row').first().locator('button:has-text("View")').click();
    await page.waitForSelector('pre.receipt');
    ok(/R\d{6}-0002/.test(await page.locator('pre.receipt').innerText()), 'newest sale is listed first and its receipt reopens');
    await page.click('dialog button:has-text("Close")');
    await page.locator('.list-row').first().locator('button:has-text("Void")').click();
    await page.fill('dialog input', 'tested');
    await page.click('dialog button:has-text("Void sale")');
    await page.waitForSelector('text=voided sale(s) are not counted');
    const after = await page.locator('.stat').allInnerTexts();
    ok(after.some((s) => /takings/i.test(s) && /1 sale/.test(s) && /\$12\.38/.test(s)), 'voided sale no longer counts in takings');
    ok((await page.locator('.list-row.inactive').count()) === 1, 'voided sale stays in the history, greyed out');
    await cleanScreen('reports (after void)');

    await page.click('.tab:has-text("Settings")');
    await page.click('button:has-text("Add another business")');
    await page.waitForSelector('form');
    await page.fill('input[required][maxlength="60"]', 'Second Shop');
    await page.selectOption('select >> nth=0', 'retail');
    await page.click('button:has-text("Create business")');
    await page.waitForSelector('.tiles .tile');
    ok((await page.locator('select.switcher').count()) === 1, 'business switcher appears');
    await page.click('.tab:has-text("Reports")');
    await page.waitForSelector('.stats');
    ok((await page.locator('.stat').allInnerTexts()).some((s) => /takings/i.test(s) && /0 sale/.test(s)), 'second business starts with empty books');
    await cleanScreen('reports (second business)');

    ok(errors.length === 0, `no browser errors${errors.length ? ': ' + errors.join(' || ') : ''}`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
  console.log(problems.length ? `\n${problems.length} problem(s)` : '\nALL CHECKS PASSED');
  process.exit(problems.length ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR', e);
  process.exit(2);
});
