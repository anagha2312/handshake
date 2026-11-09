// End-to-end run of the full Handshake flow in a real browser against the PayPal sandbox.
// Usage: npm run dev (in another terminal), then `node scripts/e2e.mjs [--headed]`
// Needs SANDBOX_CLIENT_EMAIL / SANDBOX_CLIENT_PASSWORD / SANDBOX_FREELANCER_EMAIL in .env.
import { chromium } from 'playwright';
try { process.loadEnvFile('.env'); } catch {}

const BASE = process.env.APP_URL || 'http://localhost:3000';
const headed = process.argv.includes('--headed');
const { SANDBOX_CLIENT_EMAIL: email, SANDBOX_CLIENT_PASSWORD: password } = process.env;
if (!email || !password) { console.error('Set SANDBOX_CLIENT_EMAIL and SANDBOX_CLIENT_PASSWORD in .env'); process.exit(1); }

const step = (s) => console.log(`\n▶ ${s}`);
const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 150 : 0 });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on('pageerror', (e) => console.log('  page error:', e.message));

async function payWithPayPal(testid) {
  await page.click(`[data-testid="${testid}"]`);
  await page.waitForURL(/sandbox\.paypal\.com/, { timeout: 30000 });
  const emailBox = page.locator('#email');
  if (await emailBox.isVisible({ timeout: 15000 }).catch(() => false)) {
    await emailBox.fill(email);
    const next = page.locator('#btnNext');
    if (await next.isVisible().catch(() => false)) await next.click();
    await page.locator('#password').fill(password);
    await page.locator('#btnLogin').click();
  }
  const pay = page.locator('#payment-submit-btn, button:has-text("Pay Now"), button:has-text("Complete Purchase"), button:has-text("Continue")').first();
  await pay.waitFor({ timeout: 45000 });
  await pay.click();
  await page.waitForURL((u) => u.href.startsWith(BASE), { timeout: 60000 });
}

const waitStatus = (i, text, timeout = 90000) =>
  page.waitForFunction(([i, t]) => document.querySelector(`[data-testid="status-${i}"]`)?.textContent?.includes(t), [i, text], { timeout });

try {
  step('Draft agreement from a chat with the AI');
  await page.goto(`${BASE}/new`);
  await page.click('text=Try: Logo design');
  await page.click('[data-testid="draft-btn"]');
  await page.waitForSelector('[data-testid="create-btn"]', { timeout: 120000 });
  const fe = page.locator('[data-testid="freelancer-email"]');
  if (!(await fe.inputValue())) await fe.fill(process.env.SANDBOX_FREELANCER_EMAIL || 'freelancer@example.com');
  await page.click('[data-testid="create-btn"]');
  await page.waitForURL(/\/deal\//);

  step('Client signs');
  await page.click('[data-testid="switch-role"]');
  await page.click('[data-testid="sign-btn"]');
  await waitStatus(0, 'Awaiting funding');

  step('Client funds milestone 1 through PayPal checkout');
  await payWithPayPal('fund-0');
  await waitStatus(0, 'In escrow');

  step('Freelancer submits work, AI verifies');
  await page.click('[data-testid="switch-role"]');
  await page.fill('[data-testid="submit-note"]', 'Here are the 3 concepts: sunrise wheat badge, hand-lettered wordmark, and croissant sun icon. All in warm orange/brown, hand-drawn style.');
  await page.click('[data-testid="submit-btn"]');
  await page.waitForSelector('[data-testid="verification"]', { timeout: 120000 });

  step('Client disputes, AI mediates, both accept');
  await page.click('[data-testid="switch-role"]');
  await page.click('[data-testid="dispute-open"]');
  await page.fill('[data-testid="dispute-text"]', 'I only received a text description, no actual image files of the concepts.');
  await page.click('[data-testid="dispute-submit"]');
  await page.click('[data-testid="mediate-btn"]');
  await page.waitForSelector('[data-testid="accept-proposal"]', { timeout: 120000 });
  await page.click('[data-testid="accept-proposal"]');
  await page.click('[data-testid="switch-role"]');
  await page.click('[data-testid="accept-proposal"]');
  await waitStatus(0, 'Settled');

  step('Client funds milestone 2 and releases it');
  await page.click('[data-testid="switch-role"]');
  await payWithPayPal('fund-1');
  await waitStatus(1, 'In escrow');
  console.log('\n✅ Full flow passed:', page.url());
} catch (e) {
  await page.screenshot({ path: 'e2e-failure.png', fullPage: true });
  console.error('\n❌ Failed:', e.message, '\nScreenshot: e2e-failure.png');
  process.exitCode = 1;
} finally {
  await browser.close();
}
