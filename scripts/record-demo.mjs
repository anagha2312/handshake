// Records the silent, captioned demo video against the running app + real PayPal sandbox.
// Usage: npm run dev (other terminal), then `node scripts/record-demo.mjs`, then `node scripts/edit-demo.mjs`.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
try { process.loadEnvFile('.env'); } catch {}

const BASE = process.env.APP_URL || 'http://localhost:3000';
const OUT = resolve('recordings');
mkdirSync(join(OUT, 'assets'), { recursive: true });
const W = 1280, H = 800;
let t0 = Date.now();
const marks = []; // [startSec, endSec] ranges to speed up in the edit
const now = () => (Date.now() - t0) / 1000;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });

// ---------- sample deliverables for the AI Verifier (generated, original artwork)
async function makeAssets() {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 800 } });
  const p = await ctx.newPage();
  const sun = (inner) => `<html><body style="margin:0;display:grid;place-items:center;height:800px;background:#fff7ec;font-family:Georgia,serif">${inner}</body></html>`;
  const concepts = [
    sun(`<svg width="640" height="640" viewBox="0 0 200 200"><circle cx="100" cy="110" r="46" fill="#f59e0b"/>${Array.from({ length: 12 }, (_, i) => `<line x1="100" y1="110" x2="${100 + 75 * Math.cos(i * Math.PI / 6)}" y2="${110 + 75 * Math.sin(i * Math.PI / 6)}" stroke="#f59e0b" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 6"/>`).join('')}<path d="M40 150 Q100 120 160 150" stroke="#7c2d12" stroke-width="5" fill="none"/><text x="100" y="185" text-anchor="middle" font-size="18" fill="#7c2d12" font-style="italic">Sunrise Bakery</text><text x="100" y="22" text-anchor="middle" font-size="9" fill="#9a3412">CONCEPT 1: SUN BADGE</text></svg>`),
    sun(`<svg width="640" height="640" viewBox="0 0 200 200"><text x="100" y="95" text-anchor="middle" font-size="34" fill="#9a3412" font-style="italic" style="font-family:'Brush Script MT',cursive">Sunrise</text><text x="100" y="125" text-anchor="middle" font-size="14" letter-spacing="6" fill="#7c2d12">BAKERY</text><path d="M55 140 Q100 155 145 140" stroke="#f59e0b" stroke-width="3" fill="none"/><text x="100" y="22" text-anchor="middle" font-size="9" fill="#9a3412">CONCEPT 2: HAND-LETTERED WORDMARK</text></svg>`),
    sun(`<svg width="640" height="640" viewBox="0 0 200 200"><path d="M50 120 Q100 40 150 120 Q100 100 50 120Z" fill="#fbbf24" stroke="#92400e" stroke-width="4"/><path d="M70 112 Q100 70 130 112" stroke="#92400e" stroke-width="3" fill="none"/><path d="M85 108 Q100 85 115 108" stroke="#92400e" stroke-width="3" fill="none"/><circle cx="100" cy="62" r="10" fill="#f97316"/><text x="100" y="160" text-anchor="middle" font-size="16" fill="#7c2d12" font-style="italic">Sunrise Bakery</text><text x="100" y="22" text-anchor="middle" font-size="9" fill="#9a3412">CONCEPT 3: CROISSANT SUN</text></svg>`),
  ];
  for (let i = 0; i < concepts.length; i++) {
    await p.setContent(concepts[i]);
    await p.screenshot({ path: join(OUT, 'assets', `concept-${i + 1}.png`) });
  }
  await p.setContent(sun(`<svg width="640" height="640" viewBox="0 0 200 200"><circle cx="100" cy="110" r="46" fill="#f59e0b"/><path d="M40 150 Q100 120 160 150" stroke="#7c2d12" stroke-width="5" fill="none"/><text x="100" y="185" text-anchor="middle" font-size="18" fill="#7c2d12" font-style="italic">Sunrise Bakery</text><text x="100" y="22" text-anchor="middle" font-size="9" fill="#9a3412">FINAL LOGO (PNG EXPORT)</text></svg>`));
  await p.screenshot({ path: join(OUT, 'assets', 'final-logo.png') });
  await ctx.close();
}
await makeAssets();

// ---------- recording context
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
const page = await ctx.newPage();
t0 = Date.now(); // video time zero
let current = '';

async function paintCaption() {
  await page.evaluate((text) => {
    let el = document.getElementById('__cap');
    if (!text) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div'); el.id = '__cap';
      Object.assign(el.style, { position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', zIndex: 2147483647, maxWidth: '920px',
        background: 'rgba(11,18,32,.92)', color: '#fff', padding: '14px 22px', borderRadius: '14px', font: '600 19px/1.4 Inter,system-ui,sans-serif',
        textAlign: 'center', boxShadow: '0 10px 30px rgba(0,0,0,.25)', pointerEvents: 'none' });
      document.body.appendChild(el);
    }
    el.textContent = text;
  }, current).catch(() => {});
}
page.on('load', () => paintCaption());
const caption = async (text, hold = 0) => { current = text; await paintCaption(); if (hold) await pause(hold); };

async function card(title, lines, ms = 6000) {
  current = '';
  await page.setContent(`<html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0b1220;color:#fff;font-family:Inter,system-ui,sans-serif">
  <div style="max-width:900px;padding:40px"><div style="display:flex;align-items:center;gap:12px;color:#34d399;font-weight:700;font-size:20px">
  <span style="background:#059669;color:#fff;border-radius:10px;width:40px;height:40px;display:grid;place-items:center">🤝</span>Handshake</div>
  <h1 style="font-size:46px;line-height:1.15;margin:22px 0">${title}</h1>${lines.map((l) => `<p style="font-size:22px;color:#cbd5e1;margin:10px 0">${l}</p>`).join('')}</div></body></html>`);
  await pause(ms);
}
const slowType = (sel, text) => page.locator(sel).pressSequentially(text, { delay: 12 });
async function waitFast(fn) { const s = now(); await fn(); marks.push([s, now()]); }
const switchRole = async () => { await page.click('[data-testid="switch-role"]'); await page.waitForLoadState('networkidle'); await pause(1200); };
const scrollTo = (sel) => page.locator(sel).first().scrollIntoViewIfNeeded();

async function payWithPayPal(testid) {
  await page.click(`[data-testid="${testid}"]`);
  await page.waitForURL(/sandbox\.paypal\.com|simulated-paypal/, { timeout: 30000 });
  await caption('Real PayPal sandbox checkout: the client logs in and approves. Money goes to escrow, not to the freelancer.');
  const email = page.locator('#email');
  if (await email.isVisible({ timeout: 15000 }).catch(() => false)) {
    await email.fill(process.env.SANDBOX_CLIENT_EMAIL);
    const next = page.locator('#btnNext'); if (await next.isVisible().catch(() => false)) await next.click();
    await page.locator('#password').fill(process.env.SANDBOX_CLIENT_PASSWORD);
    await pause(600);
    await page.locator('#btnLogin').click();
  }
  const pay = page.locator('#payment-submit-btn, button:has-text("Pay Now"), button:has-text("Complete Purchase")').first();
  await waitFast(() => pay.waitFor({ timeout: 60000 }));
  await pause(1800);
  await pay.click();
  await waitFast(() => page.waitForURL((u) => u.href.startsWith(BASE + '/deal'), { timeout: 60000 }));
  await pause(800);
}

try {
  // ---- 1. problem
  await card('Millions of jobs are agreed in a chat.<br/>Nothing protects the money.', [
    'Freelancers deliver and never get paid. Clients pay upfront and get nothing.',
    'Marketplaces only protect deals made inside them. Escrow is built for houses, not $400 logos.',
  ], 7000);
  await card('Handshake turns any chat into a protected deal.', ['AI writes the agreement · PayPal holds the money · AI checks the work · PayPal pays out'], 5000);

  // ---- 2. draft from chat
  await page.goto(`${BASE}/new`);
  await caption('Maria, a freelance designer, agreed a $400 logo job with Tom\'s bakery over WhatsApp. She pastes the chat.', 2500);
  await page.click('text=Try: Logo design'); await pause(2500);
  await caption('Gemini reads the conversation and drafts a milestone agreement.');
  await page.click('[data-testid="draft-btn"]');
  await waitFast(() => page.waitForSelector('[data-testid="create-btn"]', { timeout: 180000 }));
  await caption('Milestones that match how they agreed to pay, with acceptance criteria the AI can actually check later.', 4500);
  await page.mouse.wheel(0, 380); await pause(2500);
  await caption('It also flags the gaps that usually end in a fight, like no revision limit. One click adds the fix as a term.', 1500);
  await page.locator('text=+ Add as a term').first().click(); await pause(2500);
  await page.mouse.wheel(0, -2000); await pause(800);
  await caption('Maria signs and sends Tom his private link. Tom needs no account, just the link.', 1500);
  await page.click('[data-testid="create-btn"]');
  await page.waitForURL(/\/deal\//); await pause(2500);

  // ---- 3. client signs and funds
  await switchRole();
  await caption('Tom reviews the same agreement and signs.', 1500);
  await page.click('[data-testid="sign-btn"]'); await pause(2000);
  await caption('Tom funds the first milestone through PayPal.', 1800);
  await payWithPayPal('fund-0');
  await caption('Captured by PayPal. $200 is now held in escrow, and every PayPal ID is recorded in the ledger.', 4500);

  // ---- 4. freelancer delivers, AI verifies
  await switchRole();
  await caption('Maria can see the money is really there, so she starts. She delivers three concepts.', 1500);
  await slowType('[data-testid="submit-note"]', 'Here are the 3 concepts: a sun badge, a hand-lettered wordmark and a croissant-sun mark. Warm, hand-drawn style as discussed.');
  await page.setInputFiles('[data-testid="submit-files"]', [1, 2, 3].map((i) => join(OUT, 'assets', `concept-${i}.png`)));
  await pause(1500);
  await page.click('[data-testid="submit-btn"]');
  await caption('The AI Verifier inspects the images against every acceptance criterion before anyone pays.');
  await waitFast(() => page.waitForSelector('[data-testid="verification"]', { timeout: 240000 }));
  await scrollTo('[data-testid="verification"]'); await pause(800);
  await caption('A per-criterion report with the evidence it saw. Tom can read it in seconds.', 6000);

  // ---- 5. client releases
  await switchRole();
  await scrollTo('[data-testid="release-btn"]');
  await caption('If Tom approves, or simply goes silent after a passing check, the money is released. Freelancers can\'t be ghosted.', 3500);
  await page.click('[data-testid="release-btn"]');
  await waitFast(() => page.waitForFunction(() => document.querySelector('[data-testid="status-0"]')?.textContent?.includes('Paid out'), null, { timeout: 60000 }));
  await page.mouse.wheel(0, -2000); await pause(500);
  await caption('PayPal Payouts sends $200 straight to Maria\'s PayPal account.', 5000);

  // ---- 6. milestone 2: dispute and mediation
  await caption('Milestone 2. Tom funds the final files.', 1500);
  await payWithPayPal('fund-1');
  await switchRole();
  await scrollTo('[data-testid="submit-note"]');
  await caption('Maria rushes the final delivery: one PNG, no SVG file and no colour guide.', 1000);
  await slowType('[data-testid="submit-note"]', 'Final logo attached. Will send the other formats later.');
  await page.setInputFiles('[data-testid="submit-files"]', [join(OUT, 'assets', 'final-logo.png')]);
  await page.click('[data-testid="submit-btn"]');
  await waitFast(() => page.waitForSelector('[data-testid="milestone-1"] [data-testid="verification"]', { timeout: 240000 }));
  await scrollTo('[data-testid="milestone-1"] [data-testid="verification"]');
  await caption('The Verifier catches it: the PNG is there, the SVG and the guide are not. No auto-release this time.', 6000);

  await switchRole();
  await scrollTo('[data-testid="milestone-1"] [data-testid="dispute-open"]');
  await caption('Tom opens a dispute. The $200 is frozen in escrow.', 800);
  await page.click('[data-testid="milestone-1"] [data-testid="dispute-open"]');
  await slowType('[data-testid="dispute-text"]', "I only got a PNG. No SVG for the sign printer and no colour guide, and my print deadline is close.");
  await page.click('[data-testid="dispute-submit"]'); await pause(2000);

  await switchRole();
  await scrollTo('[data-testid="statement-text"]');
  await caption('Maria gives her side.', 500);
  await slowType('[data-testid="statement-text"]', 'The logo itself is finished and approved. The SVG and guide just need a day to export.');
  await page.click('[data-testid="statement-submit"]'); await pause(1500);
  await caption('The AI Mediator weighs the agreement, the verification report and both statements.');
  await page.click('[data-testid="mediate-btn"]');
  await waitFast(() => page.waitForSelector('[data-testid="proposal"]', { timeout: 240000 }));
  await scrollTo('[data-testid="proposal"]'); await pause(800);
  await caption('It proposes a split, with reasoning tied to the acceptance criteria. Nothing moves unless both people accept.', 7000);
  await page.click('[data-testid="accept-proposal"]'); await pause(1500);
  await switchRole();
  await scrollTo('[data-testid="accept-proposal"]');
  await page.click('[data-testid="accept-proposal"]');
  await caption('Both accept. Handshake executes the settlement on PayPal.');
  await waitFast(() => page.waitForFunction(() => document.querySelector('[data-testid="status-1"]')?.textContent?.includes('Settled'), null, { timeout: 90000 }));
  await page.mouse.wheel(0, -2000); await pause(800);
  await caption("A PayPal payout for Maria's share and a partial PayPal refund to Tom, all recorded in the ledger.", 7000);

  // ---- 7. close
  await card('Handshake', [
    'For the freelancers, contractors and creators who do business in chats.',
    'PayPal Orders v2 · Payments refunds · Payouts · Invoicing · Webhooks',
    'Google Gemini: Agreement Drafter · Delivery Verifier (vision) · Mediator',
    'AI advises. People decide. PayPal moves the money.',
  ], 7000);
} finally {
  const video = page.video();
  await ctx.close();
  await browser.close();
  const raw = await video.path();
  renameSync(raw, join(OUT, 'raw.webm'));
  writeFileSync(join(OUT, 'marks.json'), JSON.stringify(marks, null, 1));
  console.log('Recorded', join(OUT, 'raw.webm'), 'length', now().toFixed(1), 's; fast-forward ranges:', marks.length);
}
