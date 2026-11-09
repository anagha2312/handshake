// Deal engine: every state change and every money movement goes through here.
// AI proposes; people decide; PayPal moves the money.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  db, newId, newToken, getDeal, getMilestone, listMilestones, latestSubmission, openDispute,
  updateMilestone, logEvent, type Role, type MilestoneRow, type DealRow, type DisputeRow,
} from './db.ts';
import * as paypal from './paypal.ts';
import * as ai from './ai.ts';

export class UserError extends Error { status = 400 }
const fail = (msg: string): never => { throw new UserError(msg) };

const AUTO_RELEASE_HOURS = Number(process.env.AUTO_RELEASE_HOURS || 72);
const DEMO = process.env.DEMO_MODE !== 'false';
const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number, c: string) => `${c === 'USD' ? '$' : ''}${n.toFixed(2)}${c === 'USD' ? '' : ' ' + c}`;

// One money operation per milestone at a time (single-process app).
const locks = new Set<string>();
async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  if (locks.has(id)) fail('Another payment action is already in progress for this milestone. Try again in a moment.');
  locks.add(id);
  try { return await fn(); } finally { locks.delete(id); }
}

// ---------------------------------------------------------------- deals
export interface NewDealInput {
  title: string; summary: string; currency: string;
  client_name: string; client_email: string; freelancer_name: string; freelancer_email: string;
  terms: string[]; risk_flags: unknown[]; source_text: string;
  milestones: { title: string; description: string; amount: number; due_date?: string; acceptance_criteria: string[] }[];
  created_by: Role;
}

export function createDeal(input: NewDealInput) {
  if (!input.milestones?.length) fail('Add at least one milestone.');
  for (const m of input.milestones) {
    if (!(Number(m.amount) > 0)) fail(`Milestone "${m.title}" needs an amount greater than 0.`);
    if (!m.acceptance_criteria?.filter(Boolean).length) fail(`Milestone "${m.title}" needs at least one acceptance criterion.`);
  }
  if (!/^\S+@\S+\.\S+$/.test(input.freelancer_email || '')) fail("Add the freelancer's PayPal email so funds can be released to them.");
  const id = newId('deal');
  const currency = (input.currency || 'USD').toUpperCase();
  db.prepare(`INSERT INTO deals (id, title, summary, currency, client_name, client_email, freelancer_name, freelancer_email, terms, risk_flags, source_text, client_token, freelancer_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, input.title || 'Untitled deal', input.summary || '', currency,
    input.client_name || 'Client', input.client_email || '', input.freelancer_name || 'Freelancer', input.freelancer_email,
    JSON.stringify(input.terms || []), JSON.stringify(input.risk_flags || []), input.source_text || '',
    newToken(), newToken(),
  );
  input.milestones.forEach((m, i) => {
    db.prepare('INSERT INTO milestones (id, deal_id, position, title, description, amount, due_date, criteria) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId('ms'), id, i, m.title, m.description || '', round2(Number(m.amount)), m.due_date || null, JSON.stringify(m.acceptance_criteria.filter(Boolean)));
  });
  const total = input.milestones.reduce((s, m) => s + Number(m.amount), 0);
  logEvent({ deal_id: id, type: 'deal_created', actor: input.created_by, message: `Agreement drafted from conversation: ${input.milestones.length} milestone(s), ${fmt(total, currency)} total`, amount: total });
  acceptDeal(id, input.created_by);
  return getDeal(id)!;
}

export function acceptDeal(dealId: string, role: Role) {
  const deal = getDeal(dealId) ?? fail('Deal not found');
  const col = role === 'client' ? 'client_accepted_at' : 'freelancer_accepted_at';
  if (deal[col]) return;
  db.prepare(`UPDATE deals SET ${col} = datetime('now') WHERE id = ?`).run(dealId);
  const name = role === 'client' ? deal.client_name : deal.freelancer_name;
  logEvent({ deal_id: dealId, type: 'accepted', actor: role, message: `${name} accepted the agreement` });
  const d = getDeal(dealId)!;
  if (d.client_accepted_at && d.freelancer_accepted_at) {
    logEvent({ deal_id: dealId, type: 'active', actor: 'system', message: 'Both parties signed. Milestones can now be funded into PayPal escrow.' });
  }
}

const requireSigned = (deal: DealRow) => {
  if (!deal.client_accepted_at || !deal.freelancer_accepted_at) fail('Both parties must accept the agreement first.');
};

// ---------------------------------------------------------------- funding (Orders v2 / Invoicing v2)
export async function startFunding(milestoneId: string, appUrl: string) {
  const m = getMilestone(milestoneId) ?? fail('Milestone not found');
  const deal = getDeal(m.deal_id)!;
  requireSigned(deal);
  if (m.status !== 'AWAITING_FUNDING') fail('This milestone is already funded.');
  const order = await paypal.createOrder({
    milestoneId: m.id, amount: m.amount, currency: deal.currency,
    description: `Escrow: ${deal.title} - ${m.title}`,
    returnUrl: `${appUrl}/api/paypal/return?milestone=${m.id}`,
    cancelUrl: `${appUrl}/deal/${deal.id}?as=client&k=${deal.client_token}&cancelled=1`,
  });
  updateMilestone(m.id, { order_id: order.id });
  logEvent({ deal_id: deal.id, milestone_id: m.id, type: 'order_created', actor: 'paypal', message: `PayPal order created for "${m.title}"`, amount: m.amount, ref: order.id });
  return order;
}

export async function completeFunding(orderId: string) {
  const m = db.prepare('SELECT * FROM milestones WHERE order_id = ?').get(orderId) as MilestoneRow | undefined ?? fail('Unknown PayPal order');
  if (m.status !== 'AWAITING_FUNDING') return m; // already captured (e.g. webhook beat the redirect)
  return withLock(m.id, async () => {
    const deal = getDeal(m.deal_id)!;
    const cap = await paypal.captureOrder(orderId);
    if (cap.captureStatus !== 'COMPLETED' && cap.captureStatus !== 'PENDING') fail(`PayPal capture status: ${cap.captureStatus || cap.status}`);
    updateMilestone(m.id, { status: 'FUNDED', capture_id: cap.captureId });
    logEvent({ deal_id: deal.id, milestone_id: m.id, type: 'funded', actor: 'client', message: `${fmt(m.amount, deal.currency)} secured in PayPal escrow for "${m.title}"`, amount: m.amount, ref: cap.captureId });
    return getMilestone(m.id)!;
  });
}

export async function fundByInvoice(milestoneId: string) {
  const m = getMilestone(milestoneId) ?? fail('Milestone not found');
  const deal = getDeal(m.deal_id)!;
  requireSigned(deal);
  if (m.status !== 'AWAITING_FUNDING') fail('This milestone is already funded.');
  if (!deal.client_email) fail("Add the client's email to send a PayPal invoice.");
  const inv = await paypal.createAndSendInvoice({
    milestoneId: m.id, clientEmail: deal.client_email, clientName: deal.client_name, freelancerName: deal.freelancer_name,
    title: `${deal.title}: ${m.title}`, amount: m.amount, currency: deal.currency,
    note: `Pay this invoice to fund milestone "${m.title}". Handshake holds the money and releases it to ${deal.freelancer_name} only when you approve the work (or an agreed mediation settles it).`,
  });
  updateMilestone(m.id, { invoice_id: inv.invoiceId });
  logEvent({ deal_id: deal.id, milestone_id: m.id, type: 'invoice_sent', actor: 'paypal', message: `PayPal invoice sent to ${deal.client_email}`, amount: m.amount, ref: inv.invoiceId });
  return inv;
}

export async function syncInvoice(milestoneId: string) {
  const m = getMilestone(milestoneId) ?? fail('Milestone not found');
  if (!m.invoice_id || m.status !== 'AWAITING_FUNDING') return m;
  const inv = await paypal.getInvoice(m.invoice_id);
  if (inv.status === 'PAID' || inv.status === 'MARKED_AS_PAID') {
    const deal = getDeal(m.deal_id)!;
    updateMilestone(m.id, { status: 'FUNDED', capture_id: inv.paymentId ?? null });
    logEvent({ deal_id: deal.id, milestone_id: m.id, type: 'funded', actor: 'client', message: `Invoice paid - ${fmt(m.amount, deal.currency)} secured in escrow for "${m.title}"`, amount: m.amount, ref: m.invoice_id });
  }
  return getMilestone(m.id)!;
}

// ---------------------------------------------------------------- delivery + AI verification
export interface UploadedFile { name: string; mimeType: string; dataBase64: string }

export async function submitWork(milestoneId: string, note: string, links: string[], files: UploadedFile[]) {
  const m = getMilestone(milestoneId) ?? fail('Milestone not found');
  const deal = getDeal(m.deal_id)!;
  if (!['FUNDED', 'SUBMITTED'].includes(m.status)) fail('Work can be submitted once the milestone is funded.');
  if (!note.trim() && !links.length && !files.length) fail('Add a note, a link or at least one file.');
  const dir = join('uploads', m.id);
  mkdirSync(dir, { recursive: true });
  const stored = files.slice(0, 6).map((f, i) => {
    const safe = `${Date.now()}-${i}-${basename(f.name).replace(/[^\w.\-]+/g, '_').slice(-60)}`;
    writeFileSync(join(dir, safe), Buffer.from(f.dataBase64, 'base64'));
    return { name: f.name, mimeType: f.mimeType, path: `/uploads/${m.id}/${safe}` };
  });
  const cleanLinks = links.map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l)).slice(0, 5);
  const subId = newId('sub');
  db.prepare('INSERT INTO submissions (id, milestone_id, note, links, files) VALUES (?, ?, ?, ?, ?)')
    .run(subId, m.id, note, JSON.stringify(cleanLinks), JSON.stringify(stored));
  updateMilestone(m.id, { status: 'SUBMITTED', verification: JSON.stringify({ state: 'running' }), auto_release_at: null });
  logEvent({ deal_id: deal.id, milestone_id: m.id, type: 'submitted', actor: 'freelancer', message: `${deal.freelancer_name} submitted work for "${m.title}" (${stored.length} file(s), ${cleanLinks.length} link(s))` });
  // Verification runs in the background; the UI polls.
  runVerification(m.id).catch((e) => console.error('verification failed', e));
  return getMilestone(m.id)!;
}

async function fetchExcerpt(url: string) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(u.hostname)) return '';
    const res = await fetch(u, { signal: AbortSignal.timeout(6000), redirect: 'follow', headers: { 'User-Agent': 'HandshakeVerifier/1.0' } });
    const type = res.headers.get('content-type') || '';
    if (!type.includes('text') && !type.includes('json')) return `(non-text content: ${type})`;
    const html = (await res.text()).slice(0, 200_000);
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? '';
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return `${title ? `[title: ${title}] ` : ''}${text.slice(0, 2500)}`;
  } catch { return ''; }
}

export async function runVerification(milestoneId: string) {
  const m = getMilestone(milestoneId)!;
  const deal = getDeal(m.deal_id)!;
  const sub = latestSubmission(m.id);
  if (!sub) return;
  const links: string[] = JSON.parse(sub.links);
  const files: { name: string; mimeType: string; path: string }[] = JSON.parse(sub.files);
  try {
    const { data, model } = await ai.verifyDelivery({
      milestone: { title: m.title, description: m.description, criteria: JSON.parse(m.criteria) },
      note: sub.note,
      links: await Promise.all(links.map(async (url) => ({ url, excerpt: await fetchExcerpt(url) }))),
      files: files.map((f) => ({
        name: f.name, mimeType: f.mimeType,
        data: f.mimeType.startsWith('image/') ? readFileSync(join('.', f.path)).toString('base64') : undefined,
      })),
    });
    const current = getMilestone(m.id)!;
    if (current.status !== 'SUBMITTED') return;
    const releaseAt = data.overall === 'pass' ? new Date(Date.now() + AUTO_RELEASE_HOURS * 3600_000).toISOString() : null;
    updateMilestone(m.id, { verification: JSON.stringify({ state: 'done', model, submission_id: sub.id, at: new Date().toISOString(), ...data }), auto_release_at: releaseAt });
    const met = data.criteria.filter((c) => c.verdict === 'met').length;
    logEvent({
      deal_id: deal.id, milestone_id: m.id, type: 'verified', actor: 'ai',
      message: `AI Verifier: ${data.overall.toUpperCase()} - ${met}/${data.criteria.length} criteria met. ${releaseAt ? `Auto-release in ${AUTO_RELEASE_HOURS}h unless ${deal.client_name} disputes.` : `${deal.client_name} decides whether to release.`}`,
    });
  } catch (e: any) {
    updateMilestone(m.id, { verification: JSON.stringify({ state: 'error', error: String(e.message || e).slice(0, 300) }) });
    logEvent({ deal_id: deal.id, milestone_id: m.id, type: 'verify_error', actor: 'ai', message: 'AI verification could not run (model busy). The client can still review manually or retry.' });
  }
}

// ---------------------------------------------------------------- release / refund (Payouts v1, Payments v2)
async function payFreelancer(m: MilestoneRow, deal: DealRow, amount: number, why: string, actor: 'client' | 'system') {
  const payout = await paypal.sendPayout({
    receiver: deal.freelancer_email, amount, currency: deal.currency, key: `${m.id}-rel`,
    note: `${why} - "${deal.title}: ${m.title}". Paid via Handshake escrow.`,
  });
  updateMilestone(m.id, { released_amount: round2(m.released_amount + amount), payout_batch_id: payout.batchId, payout_status: payout.status });
  logEvent({ deal_id: deal.id, milestone_id: m.id, type: 'payout', actor, message: `${fmt(amount, deal.currency)} released to ${deal.freelancer_name} via PayPal Payouts (${why})${payout.simulated ? ' [simulated payout]' : ''}`, amount, ref: payout.batchId });
}

async function refundClient(m: MilestoneRow, deal: DealRow, amount: number, why: string, actor: 'freelancer' | 'system') {
  if (!m.capture_id) fail('No PayPal capture on file to refund.');
  const r = await paypal.refundCapture(m.capture_id!, amount, deal.currency, `${why} - ${deal.title}: ${m.title}`, `${m.id}-ref`);
  updateMilestone(m.id, { refunded_amount: round2(m.refunded_amount + amount), refund_id: r.refundId });
  logEvent({ deal_id: deal.id, milestone_id: m.id, type: 'refund', actor, message: `${fmt(amount, deal.currency)} refunded to ${deal.client_name} via PayPal (${why})${r.refundId.includes('-SIM-') ? ' [simulated]' : ''}`, amount, ref: r.refundId });
}

export async function release(milestoneId: string, by: 'client' | 'system') {
  const m0 = getMilestone(milestoneId) ?? fail('Milestone not found');
  if (!['FUNDED', 'SUBMITTED'].includes(m0.status)) fail('Only funded milestones can be released.');
  return withLock(m0.id, async () => {
    const m = getMilestone(milestoneId)!;
    const deal = getDeal(m.deal_id)!;
    await payFreelancer(m, deal, m.amount, by === 'client' ? `approved by ${deal.client_name}` : 'auto-released after review window', by);
    updateMilestone(m.id, { status: 'RELEASED', auto_release_at: null });
    return getMilestone(m.id)!;
  });
}

export async function refundFull(milestoneId: string) {
  const m0 = getMilestone(milestoneId) ?? fail('Milestone not found');
  if (!['FUNDED', 'SUBMITTED'].includes(m0.status)) fail('Only funded milestones can be refunded.');
  return withLock(m0.id, async () => {
    const m = getMilestone(milestoneId)!;
    const deal = getDeal(m.deal_id)!;
    await refundClient(m, deal, m.amount, `${deal.freelancer_name} cancelled the milestone`, 'freelancer');
    updateMilestone(m.id, { status: 'REFUNDED', auto_release_at: null });
    return getMilestone(m.id)!;
  });
}

// ---------------------------------------------------------------- disputes + AI mediation
export function startDispute(milestoneId: string, role: Role, statement: string) {
  const m = getMilestone(milestoneId) ?? fail('Milestone not found');
  const deal = getDeal(m.deal_id)!;
  if (!['FUNDED', 'SUBMITTED'].includes(m.status)) fail('Disputes can be opened on funded milestones.');
  if (!statement.trim()) fail('Explain what went wrong so the mediator can weigh it.');
  const id = newId('dsp');
  db.prepare(`INSERT INTO disputes (id, milestone_id, opened_by, ${role}_statement) VALUES (?, ?, ?, ?)`).run(id, m.id, role, statement);
  updateMilestone(m.id, { status: 'DISPUTED', auto_release_at: null });
  const name = role === 'client' ? deal.client_name : deal.freelancer_name;
  logEvent({ deal_id: deal.id, milestone_id: m.id, type: 'dispute_opened', actor: role, message: `${name} opened a dispute on "${m.title}". Funds stay frozen in escrow.` });
  return id;
}

export function addStatement(disputeId: string, role: Role, statement: string) {
  const d = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as DisputeRow | undefined ?? fail('Dispute not found');
  if (d.status === 'SETTLED') fail('This dispute is settled.');
  if (!statement.trim()) fail('Statement is empty.');
  db.prepare(`UPDATE disputes SET ${role}_statement = ?, status = 'GATHERING', proposal = NULL, client_decision = NULL, freelancer_decision = NULL WHERE id = ?`).run(statement, disputeId);
  const m = getMilestone(d.milestone_id)!;
  const deal = getDeal(m.deal_id)!;
  logEvent({ deal_id: deal.id, milestone_id: m.id, type: 'statement', actor: role, message: `${role === 'client' ? deal.client_name : deal.freelancer_name} added their side of the story` });
}

export async function requestMediation(disputeId: string) {
  const d = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as DisputeRow | undefined ?? fail('Dispute not found');
  if (d.status === 'SETTLED') fail('This dispute is settled.');
  const m = getMilestone(d.milestone_id)!;
  const deal = getDeal(m.deal_id)!;
  const ver = m.verification ? JSON.parse(m.verification) : null;
  const { data, model } = await ai.mediate({
    amount: m.amount, currency: deal.currency,
    milestone: { title: m.title, description: m.description, criteria: JSON.parse(m.criteria) },
    terms: JSON.parse(deal.terms), verification: ver?.state === 'done' ? { overall: ver.overall, criteria: ver.criteria, summary: ver.summary } : null,
    submissionNote: latestSubmission(m.id)?.note ?? '',
    clientName: deal.client_name, freelancerName: deal.freelancer_name,
    clientStatement: d.client_statement ?? '', freelancerStatement: d.freelancer_statement ?? '',
  });
  const freelancerAmount = round2((m.amount * data.freelancer_percent) / 100);
  const proposal = { ...data, model, freelancer_amount: freelancerAmount, client_refund: round2(m.amount - freelancerAmount), at: new Date().toISOString() };
  db.prepare("UPDATE disputes SET proposal = ?, status = 'PROPOSED', client_decision = NULL, freelancer_decision = NULL WHERE id = ?").run(JSON.stringify(proposal), disputeId);
  logEvent({ deal_id: deal.id, milestone_id: m.id, type: 'proposal', actor: 'ai', message: `AI Mediator proposed: ${data.headline}` });
  return proposal;
}

export async function decide(disputeId: string, role: Role, accept: boolean) {
  const d = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as DisputeRow | undefined ?? fail('Dispute not found');
  if (d.status !== 'PROPOSED' || !d.proposal) fail('There is no proposal to decide on.');
  const m = getMilestone(d.milestone_id)!;
  const deal = getDeal(m.deal_id)!;
  const name = role === 'client' ? deal.client_name : deal.freelancer_name;
  db.prepare(`UPDATE disputes SET ${role}_decision = ? WHERE id = ?`).run(accept ? 'accepted' : 'rejected', disputeId);
  logEvent({ deal_id: deal.id, milestone_id: m.id, type: 'decision', actor: role, message: `${name} ${accept ? 'accepted' : 'rejected'} the mediator's proposal` });
  if (!accept) {
    db.prepare("UPDATE disputes SET status = 'GATHERING' WHERE id = ?").run(disputeId);
    return;
  }
  const fresh = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as unknown as DisputeRow;
  if (fresh.client_decision === 'accepted' && fresh.freelancer_decision === 'accepted') await settle(fresh);
}

async function settle(d: DisputeRow) {
  const p = JSON.parse(d.proposal!) as { freelancer_amount: number; client_refund: number; freelancer_percent: number };
  await withLock(d.milestone_id, async () => {
    const m = getMilestone(d.milestone_id)!;
    const deal = getDeal(m.deal_id)!;
    if (p.freelancer_amount > 0) await payFreelancer(m, deal, p.freelancer_amount, `mediated settlement, ${p.freelancer_percent}%`, 'system');
    if (p.client_refund > 0) await refundClient(getMilestone(m.id)!, deal, p.client_refund, `mediated settlement, ${100 - p.freelancer_percent}%`, 'system');
    updateMilestone(m.id, { status: 'SETTLED' });
    db.prepare("UPDATE disputes SET status = 'SETTLED' WHERE id = ?").run(d.id);
    logEvent({ deal_id: deal.id, milestone_id: m.id, type: 'settled', actor: 'system', message: `Dispute settled by agreement: ${fmt(p.freelancer_amount, deal.currency)} to ${deal.freelancer_name}, ${fmt(p.client_refund, deal.currency)} back to ${deal.client_name}` });
  });
}

// ---------------------------------------------------------------- background jobs
export async function tick() {
  const due = db.prepare("SELECT * FROM milestones WHERE status = 'SUBMITTED' AND auto_release_at IS NOT NULL AND auto_release_at <= ?")
    .all(new Date().toISOString()) as unknown as MilestoneRow[];
  for (const m of due) await release(m.id, 'system').catch((e) => console.error('auto-release failed', m.id, e.message));

  const pending = db.prepare("SELECT * FROM milestones WHERE payout_batch_id IS NOT NULL AND (payout_status IS NULL OR payout_status NOT IN ('SUCCESS','FAILED','DENIED','UNCLAIMED','RETURNED','BLOCKED','REFUNDED','REVERSED'))")
    .all() as unknown as MilestoneRow[];
  for (const m of pending) {
    try {
      const b = await paypal.getPayoutBatch(m.payout_batch_id!);
      const status = b.itemStatus || b.status;
      if (status && status !== m.payout_status) {
        updateMilestone(m.id, { payout_status: status });
        if (status === 'SUCCESS') logEvent({ deal_id: m.deal_id, milestone_id: m.id, type: 'payout_confirmed', actor: 'paypal', message: 'PayPal confirmed the payout landed in the freelancer\'s account', ref: b.transactionId ?? m.payout_batch_id });
      }
    } catch (e: any) { console.error('payout sync failed', e.message); }
  }

  const invoices = db.prepare("SELECT id FROM milestones WHERE invoice_id IS NOT NULL AND status = 'AWAITING_FUNDING'").all() as { id: string }[];
  for (const i of invoices) await syncInvoice(i.id).catch(() => {});
}

// ---------------------------------------------------------------- read model for the UI
export function dealView(dealId: string, role: Role | null) {
  const deal = getDeal(dealId) ?? fail('Deal not found');
  const milestones = listMilestones(deal.id).map((m) => {
    const sub = latestSubmission(m.id);
    const dispute = openDispute(m.id);
    return {
      ...m,
      criteria: JSON.parse(m.criteria) as string[],
      verification: m.verification ? JSON.parse(m.verification) : null,
      submission: sub ? { ...sub, links: JSON.parse(sub.links), files: JSON.parse(sub.files) } : null,
      dispute: dispute ? { ...dispute, proposal: dispute.proposal ? JSON.parse(dispute.proposal) : null } : null,
    };
  });
  const events = db.prepare('SELECT * FROM events WHERE deal_id = ? ORDER BY id DESC').all(deal.id);
  const total = round2(milestones.reduce((s, m) => s + m.amount, 0));
  const inEscrow = round2(milestones.filter((m) => ['FUNDED', 'SUBMITTED', 'DISPUTED'].includes(m.status)).reduce((s, m) => s + m.amount, 0));
  const released = round2(milestones.reduce((s, m) => s + m.released_amount, 0));
  const refunded = round2(milestones.reduce((s, m) => s + m.refunded_amount, 0));
  const { client_token, freelancer_token, source_text, ...pub } = deal;
  return {
    deal: { ...pub, terms: JSON.parse(deal.terms), risk_flags: JSON.parse(deal.risk_flags), source_text },
    role,
    // Each party only ever needs the other's link to share it; demo mode exposes both so judges can switch sides.
    links: role ? {
      client: role === 'client' || DEMO || !deal.client_accepted_at ? `/deal/${deal.id}?as=client&k=${client_token}` : null,
      freelancer: role === 'freelancer' || DEMO || !deal.freelancer_accepted_at ? `/deal/${deal.id}?as=freelancer&k=${freelancer_token}` : null,
    } : null,
    demo: DEMO,
    milestones, events,
    totals: { total, inEscrow, released, refunded },
    autoReleaseHours: AUTO_RELEASE_HOURS,
    paypalMode: paypal.MOCK ? 'simulated' : 'sandbox',
  };
}

export function roleFor(deal: DealRow, as: unknown, token: unknown): Role | null {
  if (as === 'client' && token === deal.client_token) return 'client';
  if (as === 'freelancer' && token === deal.freelancer_token) return 'freelancer';
  return null;
}
