import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

mkdirSync('data', { recursive: true });
export const db = new DatabaseSync(process.env.DB_PATH || 'data/handshake.db');
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  client_name TEXT NOT NULL,
  client_email TEXT NOT NULL DEFAULT '',
  freelancer_name TEXT NOT NULL,
  freelancer_email TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '[]',
  risk_flags TEXT NOT NULL DEFAULT '[]',
  source_text TEXT NOT NULL DEFAULT '',
  client_token TEXT NOT NULL,
  freelancer_token TEXT NOT NULL,
  client_accepted_at TEXT,
  freelancer_accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL,
  due_date TEXT,
  criteria TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'AWAITING_FUNDING',
  order_id TEXT,
  capture_id TEXT,
  invoice_id TEXT,
  released_amount REAL NOT NULL DEFAULT 0,
  refunded_amount REAL NOT NULL DEFAULT 0,
  payout_batch_id TEXT,
  payout_status TEXT,
  refund_id TEXT,
  verification TEXT,
  auto_release_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  links TEXT NOT NULL DEFAULT '[]',
  files TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  opened_by TEXT NOT NULL,
  client_statement TEXT,
  freelancer_statement TEXT,
  proposal TEXT,
  client_decision TEXT,
  freelancer_decision TEXT,
  status TEXT NOT NULL DEFAULT 'GATHERING',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  milestone_id TEXT,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  message TEXT NOT NULL,
  amount REAL,
  ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;
export const newToken = () => randomBytes(16).toString('hex');

export type Role = 'client' | 'freelancer';
export type Actor = Role | 'ai' | 'paypal' | 'system';

export interface DealRow {
  id: string; title: string; summary: string; currency: string;
  client_name: string; client_email: string; freelancer_name: string; freelancer_email: string;
  terms: string; risk_flags: string; source_text: string;
  client_token: string; freelancer_token: string;
  client_accepted_at: string | null; freelancer_accepted_at: string | null; created_at: string;
}
export interface MilestoneRow {
  id: string; deal_id: string; position: number; title: string; description: string; amount: number;
  due_date: string | null; criteria: string; status: MilestoneStatus;
  order_id: string | null; capture_id: string | null; invoice_id: string | null;
  released_amount: number; refunded_amount: number;
  payout_batch_id: string | null; payout_status: string | null; refund_id: string | null;
  verification: string | null;
  auto_release_at: string | null; updated_at: string;
}
export interface SubmissionRow { id: string; milestone_id: string; note: string; links: string; files: string; created_at: string }
export interface DisputeRow {
  id: string; milestone_id: string; opened_by: Role; client_statement: string | null; freelancer_statement: string | null;
  proposal: string | null; client_decision: string | null; freelancer_decision: string | null;
  status: 'GATHERING' | 'PROPOSED' | 'SETTLED' | 'ESCALATED'; created_at: string;
}
export interface EventRow { id: number; deal_id: string; milestone_id: string | null; type: string; actor: Actor; message: string; amount: number | null; ref: string | null; created_at: string }

export type MilestoneStatus =
  | 'AWAITING_FUNDING' | 'FUNDED' | 'SUBMITTED' | 'RELEASED' | 'DISPUTED' | 'SETTLED' | 'REFUNDED';

export const getDeal = (id: string) => db.prepare('SELECT * FROM deals WHERE id = ?').get(id) as DealRow | undefined;
export const getMilestone = (id: string) => db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as MilestoneRow | undefined;
export const listMilestones = (dealId: string) =>
  db.prepare('SELECT * FROM milestones WHERE deal_id = ? ORDER BY position').all(dealId) as unknown as MilestoneRow[];
export const latestSubmission = (milestoneId: string) =>
  db.prepare('SELECT * FROM submissions WHERE milestone_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(milestoneId) as SubmissionRow | undefined;
export const openDispute = (milestoneId: string) =>
  db.prepare("SELECT * FROM disputes WHERE milestone_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(milestoneId) as DisputeRow | undefined;

export function updateMilestone(id: string, fields: Partial<MilestoneRow>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sql = `UPDATE milestones SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => (fields as any)[k]), id);
}

export function logEvent(e: { deal_id: string; milestone_id?: string | null; type: string; actor: Actor; message: string; amount?: number | null; ref?: string | null }) {
  db.prepare('INSERT INTO events (deal_id, milestone_id, type, actor, message, amount, ref) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(e.deal_id, e.milestone_id ?? null, e.type, e.actor, e.message, e.amount ?? null, e.ref ?? null);
}
