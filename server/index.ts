import './env.ts';
import { existsSync } from 'node:fs';
import express, { type Request, type Response, type NextFunction } from 'express';
import { db, getDeal, getMilestone, type Role } from './db.ts';
import * as engine from './engine.ts';
import { draftAgreement } from './ai.ts';
import { verifyWebhook, PayPalError, MOCK, probe } from './paypal.ts';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');
const DEMO = process.env.DEMO_MODE !== 'false';

app.set('trust proxy', true);
app.use(express.json({ limit: '25mb' }));
app.use('/uploads', express.static('uploads', { fallthrough: false }));

const appUrl = (req: Request) => process.env.APP_URL?.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).then((out) => { if (!res.headersSent) res.json(out ?? { ok: true }); }).catch(next);

// Every action is authorised by the role link (?as=client&k=token) the party received.
function auth(req: Request, dealId: string, need?: Role): Role {
  const deal = getDeal(dealId);
  if (!deal) throw Object.assign(new Error('Deal not found'), { status: 404 });
  const src = { ...req.query, ...(req.body || {}) } as Record<string, unknown>;
  const role = engine.roleFor(deal, src.as, src.k);
  if (!role) throw Object.assign(new Error('This link is not valid for this deal.'), { status: 403 });
  if (need && role !== need) throw Object.assign(new Error(`Only the ${need} can do this.`), { status: 403 });
  return role;
}
function milestoneAuth(req: Request, need?: Role) {
  const m = getMilestone(String(req.params.id));
  if (!m) throw Object.assign(new Error('Milestone not found'), { status: 404 });
  return { m, role: auth(req, m.deal_id, need) };
}
function disputeAuth(req: Request) {
  const d = db.prepare('SELECT milestone_id FROM disputes WHERE id = ?').get(String(req.params.id)) as { milestone_id: string } | undefined;
  if (!d) throw Object.assign(new Error('Dispute not found'), { status: 404 });
  const m = getMilestone(d.milestone_id)!;
  return auth(req, m.deal_id);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, paypal: MOCK ? 'simulated' : process.env.PAYPAL_ENV || 'sandbox', demo: DEMO }));

// Stand-in for PayPal's approval page, used only in simulation mode (no PayPal credentials configured).
app.get('/simulated-paypal/checkout', (req, res) => {
  if (!MOCK) return res.status(404).send('Not available: the real PayPal sandbox is configured.');
  const q = req.query as Record<string, string>;
  if (!q.return?.startsWith(appUrl(req))) return res.status(400).send('Bad return URL');
  const esc = (v: string) => String(v || '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const ret = new URL(q.return);
  ret.searchParams.set('token', q.token || '');
  res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulated PayPal checkout</title>
<body style="font-family:Inter,system-ui,sans-serif;background:#f5f7fa;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="background:#fff;border-radius:16px;box-shadow:0 4px 24px #0001;padding:32px;width:min(92vw,420px)">
<div style="background:#fff7e0;color:#7a5200;font-size:12px;font-weight:600;padding:8px 12px;border-radius:8px">SIMULATION MODE: no PayPal credentials are configured, so this page stands in for PayPal's approval screen.</div>
<h2 style="margin:20px 0 4px">Approve payment</h2><div style="color:#555">${esc(q.description)}</div>
<div style="font-size:34px;font-weight:800;margin:16px 0">${esc(q.amount)} ${esc(q.currency)}</div>
<a id="payment-submit-btn" href="${esc(ret.toString())}" style="display:block;text-align:center;background:#ffc439;color:#111;font-weight:700;padding:14px;border-radius:999px;text-decoration:none">Pay Now</a>
<a href="${esc(q.cancel)}" style="display:block;text-align:center;margin-top:12px;color:#555;font-size:14px">Cancel</a></div></body>`);
});

// Sandbox test-account emails (not passwords) so judges can run the flow without typing them.
app.get('/api/demo-config', (_req, res) => res.json(DEMO ? {
  clientEmail: process.env.SANDBOX_CLIENT_EMAIL || '', freelancerEmail: process.env.SANDBOX_FREELANCER_EMAIL || '',
} : {}));

// ---- AI Agreement Drafter
app.post('/api/draft', wrap(async (req) => {
  const { chat = '', images = [] } = req.body as { chat?: string; images?: { mimeType: string; data: string }[] };
  if (!chat.trim() && !images.length) throw new engine.UserError('Paste a conversation or add a screenshot.');
  const { data, model } = await draftAgreement(chat.slice(0, 30_000), images);
  return { draft: data, model };
}));

// ---- Deals
app.post('/api/deals', wrap((req) => {
  const deal = engine.createDeal(req.body);
  const role: Role = req.body.created_by === 'freelancer' ? 'freelancer' : 'client';
  return { id: deal.id, links: engine.dealView(deal.id, role).links, role };
}));

app.get('/api/deals', wrap(() => {
  if (!DEMO) return [];
  // Demo directory so judges can jump into any deal as either party.
  const rows = db.prepare(`SELECT d.id, d.title, d.client_name, d.freelancer_name, d.currency, d.created_at, d.client_token, d.freelancer_token,
      (SELECT COALESCE(SUM(amount),0) FROM milestones WHERE deal_id = d.id) AS total,
      (SELECT GROUP_CONCAT(status) FROM milestones WHERE deal_id = d.id) AS statuses
    FROM deals d ORDER BY d.created_at DESC, d.rowid DESC LIMIT 50`).all() as any[];
  return rows.map(({ client_token, freelancer_token, statuses, ...r }) => ({
    ...r, statuses: String(statuses || '').split(','),
    links: { client: `/deal/${r.id}?as=client&k=${client_token}`, freelancer: `/deal/${r.id}?as=freelancer&k=${freelancer_token}` },
  }));
}));

app.get('/api/deals/:id', wrap((req) => {
  const role = auth(req, String(req.params.id));
  return engine.dealView(String(req.params.id), role);
}));

app.post('/api/deals/:id/accept', wrap((req) => {
  const role = auth(req, String(req.params.id));
  engine.acceptDeal(String(req.params.id), role);
}));

// ---- Funding: PayPal Orders v2 (redirect approval) or Invoicing v2
app.post('/api/milestones/:id/fund', wrap(async (req) => {
  const { m } = milestoneAuth(req, 'client');
  const order = await engine.startFunding(m.id, appUrl(req));
  return { approveUrl: order.approveUrl, orderId: order.id };
}));

app.get('/api/paypal/return', async (req, res) => {
  const orderId = String(req.query.token || '');
  const m = getMilestone(String(req.query.milestone || ''));
  const deal = m && getDeal(m.deal_id);
  const back = deal ? `/deal/${deal.id}?as=client&k=${deal.client_token}` : '/';
  try {
    if (!m || m.order_id !== orderId) throw new Error('Order does not match this milestone');
    await engine.completeFunding(orderId);
    res.redirect(`${back}&funded=${m.id}`);
  } catch (e: any) {
    console.error('capture failed', e.message);
    res.redirect(`${back}&error=${encodeURIComponent(e.message.slice(0, 200))}`);
  }
});

app.post('/api/milestones/:id/invoice', wrap(async (req) => {
  const { m } = milestoneAuth(req, 'client');
  return engine.fundByInvoice(m.id);
}));

app.post('/api/milestones/:id/sync', wrap(async (req) => {
  const { m } = milestoneAuth(req);
  await engine.syncInvoice(m.id);
  await engine.tick();
}));

// ---- Delivery + AI verification
app.post('/api/milestones/:id/submit', wrap(async (req) => {
  const { m } = milestoneAuth(req, 'freelancer');
  const { note = '', links = [], files = [] } = req.body;
  await engine.submitWork(m.id, note, links, files);
}));

app.post('/api/milestones/:id/verify', wrap(async (req) => {
  const { m } = milestoneAuth(req);
  await engine.runVerification(m.id);
}));

// ---- Money out
app.post('/api/milestones/:id/release', wrap(async (req) => {
  const { m } = milestoneAuth(req, 'client');
  await engine.release(m.id, 'client');
}));

app.post('/api/milestones/:id/refund', wrap(async (req) => {
  const { m } = milestoneAuth(req, 'freelancer');
  await engine.refundFull(m.id);
}));

// ---- Disputes + AI mediation
app.post('/api/milestones/:id/dispute', wrap(async (req) => {
  const { m, role } = milestoneAuth(req);
  const id = engine.startDispute(m.id, role, String(req.body.statement || ''));
  return { id };
}));

app.post('/api/disputes/:id/statement', wrap((req) => {
  const role = disputeAuth(req);
  engine.addStatement(String(req.params.id), role, String(req.body.statement || ''));
}));

app.post('/api/disputes/:id/mediate', wrap(async (req) => {
  disputeAuth(req);
  return engine.requestMediation(String(req.params.id));
}));

app.post('/api/disputes/:id/decide', wrap(async (req) => {
  const role = disputeAuth(req);
  await engine.decide(String(req.params.id), role, Boolean(req.body.accept));
}));

// ---- Demo helper: skip the review window so auto-release can be shown live
app.post('/api/milestones/:id/fast-forward', wrap(async (req) => {
  if (!DEMO) throw new engine.UserError('Demo mode is off.');
  const { m } = milestoneAuth(req);
  if (m.status !== 'SUBMITTED' || !m.auto_release_at) throw new engine.UserError('Nothing is scheduled to auto-release.');
  db.prepare('UPDATE milestones SET auto_release_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), m.id);
  await engine.tick();
}));

// ---- PayPal webhooks (signature verified against PAYPAL_WEBHOOK_ID)
app.post('/api/webhooks/paypal', async (req, res) => {
  const event = req.body;
  try {
    if (!(await verifyWebhook(req.headers, event))) return res.status(400).json({ ok: false });
    const resource = event.resource || {};
    switch (event.event_type) {
      case 'CHECKOUT.ORDER.APPROVED':
        // The payer approved but may have closed the tab before returning: capture anyway.
        await engine.completeFunding(resource.id).catch(() => {});
        break;
      case 'INVOICING.INVOICE.PAID': {
        const m = db.prepare('SELECT id FROM milestones WHERE invoice_id = ?').get(resource.invoice?.id || resource.id) as { id: string } | undefined;
        if (m) await engine.syncInvoice(m.id);
        break;
      }
      case 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED':
      case 'PAYMENT.PAYOUTSBATCH.SUCCESS':
        await engine.tick();
        break;
    }
    res.json({ ok: true });
  } catch (e: any) {
    console.error('webhook error', e.message);
    res.status(500).json({ ok: false });
  }
});

// ---- Errors
app.use('/api', (err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof engine.UserError ? 400 : err instanceof PayPalError ? 502 : err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

// ---- Frontend
if (PROD) {
  if (!existsSync('dist/index.html')) throw new Error('Run `npm run build` first.');
  app.use(express.static('dist'));
  app.get(/^\/(?!api|uploads|simulated-paypal).*/, (_req, res) => res.sendFile('index.html', { root: 'dist' }));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

// A dropped connection to PayPal or Gemini must never take the whole server down.
process.on('unhandledRejection', (e) => console.error('unhandled rejection', e));
process.on('uncaughtException', (e) => console.error('uncaught exception', e));

setInterval(() => engine.tick().catch((e) => console.error('tick', e)), 20_000);

const mode = await probe();
app.listen(PORT, () => console.log(`Handshake running on http://localhost:${PORT} (PayPal: ${mode})`));
