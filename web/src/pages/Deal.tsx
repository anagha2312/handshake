import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  Lock, CheckCircle2, XCircle, HelpCircle, Sparkles, Loader2, Copy, Check, FileText, Link2, Upload, Scale,
  AlertTriangle, ArrowRightLeft, Clock, Banknote, Undo2, PenLine, FastForward, ExternalLink, Receipt,
} from 'lucide-react';
import { api, money, readImage, timeAgo } from '../api';

type Role = 'client' | 'freelancer';
type View = any;

const STATUS: Record<string, { label: string; cls: string }> = {
  AWAITING_FUNDING: { label: 'Awaiting funding', cls: 'bg-slate-100 text-slate-600' },
  FUNDED: { label: 'In escrow', cls: 'bg-brand-50 text-brand-700' },
  SUBMITTED: { label: 'Work submitted', cls: 'bg-sky-50 text-sky-700' },
  DISPUTED: { label: 'In mediation', cls: 'bg-rose-50 text-rose-700' },
  RELEASED: { label: 'Paid out', cls: 'bg-emerald-600 text-white' },
  SETTLED: { label: 'Settled', cls: 'bg-violet-600 text-white' },
  REFUNDED: { label: 'Refunded', cls: 'bg-slate-600 text-white' },
};

export default function DealPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const as = params.get('as') as Role | null;
  const k = params.get('k');
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const auth = { as, k };

  const load = useCallback(async () => {
    try { setView(await api(`/api/deals/${id}?as=${as}&k=${k}`)); setError(''); } catch (e: any) { setError(e.message); }
  }, [id, as, k]);

  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [load]);

  useEffect(() => {
    const funded = params.get('funded'), err = params.get('error'), cancelled = params.get('cancelled');
    if (funded) setToast({ kind: 'ok', text: 'Payment captured by PayPal. The money is now held in escrow.' });
    if (err) setToast({ kind: 'err', text: err });
    if (cancelled) setToast({ kind: 'err', text: 'PayPal checkout was cancelled. Nothing was charged.' });
    if (funded || err || cancelled) {
      const p = new URLSearchParams(params); p.delete('funded'); p.delete('error'); p.delete('cancelled'); setParams(p, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = useCallback(async (path: string, body: object = {}, ok?: string) => {
    try {
      const out = await api(path, { ...auth, ...body });
      if (ok) setToast({ kind: 'ok', text: ok });
      await load();
      return out;
    } catch (e: any) { setToast({ kind: 'err', text: e.message }); throw e; }
  }, [as, k, load]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !view) return <div className="mx-auto max-w-xl px-4 py-20 text-center"><div className="text-lg font-semibold">{error}</div><Link to="/deals" className="btn-ghost mt-4">See demo deals</Link></div>;
  if (!view) return <div className="mx-auto max-w-6xl px-4 py-10"><div className="shimmer h-40 rounded-2xl" /></div>;

  const { deal, milestones, events, totals, links, role } = view;
  const me = role === 'client' ? deal.client_name : deal.freelancer_name;
  const signed = deal.client_accepted_at && deal.freelancer_accepted_at;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {toast && (
        <div className={`fixed top-16 left-1/2 z-40 w-[min(92vw,560px)] -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${toast.kind === 'ok' ? 'bg-ink text-white' : 'bg-rose-600 text-white'}`} onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
      {toast && <AutoHide onHide={() => setToast(null)} key={toast.text} />}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>{deal.client_name}</span><ArrowRightLeft size={14} /><span>{deal.freelancer_name}</span>
          </div>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{deal.title}</h1>
          <p className="mt-1 max-w-2xl text-slate-600">{deal.summary}</p>
        </div>
        <RoleBar role={role} me={me} links={links} demo={view.demo} />
      </div>

      <MoneyBar totals={totals} currency={deal.currency} />

      {!signed && <SignPanel deal={deal} role={role} links={links} onSign={() => act(`/api/deals/${deal.id}/accept`, {}, 'Agreement signed.')} />}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {milestones.map((m: any, i: number) => (
            <MilestoneCard key={m.id} m={m} i={i} deal={deal} role={role} signed={!!signed} act={act} demo={view.demo} hours={view.autoReleaseHours} />
          ))}
        </div>
        <aside className="space-y-5">
          <div className="card p-5">
            <div className="font-semibold">Agreement terms</div>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
              {deal.terms.map((t: string, i: number) => <li key={i} className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-slate-400" />{t}</li>)}
            </ul>
            <div className="mt-3 flex gap-3 text-xs text-slate-500">
              <span>{deal.client_accepted_at ? '✓' : '○'} {deal.client_name}</span>
              <span>{deal.freelancer_accepted_at ? '✓' : '○'} {deal.freelancer_name}</span>
            </div>
            {deal.source_text && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-slate-500 hover:text-ink">Original conversation</summary>
                <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-slate-50 p-3 font-mono text-[11px] whitespace-pre-wrap text-slate-600">{deal.source_text}</pre>
              </details>
            )}
          </div>
          <Timeline events={events} currency={deal.currency} />
        </aside>
      </div>
    </div>
  );
}

function AutoHide({ onHide }: { onHide: () => void }) {
  useEffect(() => { const t = setTimeout(onHide, 6000); return () => clearTimeout(t); }, [onHide]);
  return null;
}

function RoleBar({ role, me, links, demo }: { role: Role; me: string; links: any; demo: boolean }) {
  const nav = useNavigate();
  const other: Role = role === 'client' ? 'freelancer' : 'client';
  return (
    <div className="flex flex-col items-end gap-2">
      <span className={`chip ${role === 'client' ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-700'}`}>Viewing as {me} ({role})</span>
      {demo && links?.[other] && (
        <button data-testid="switch-role" onClick={() => nav(links[other])} className="text-xs font-semibold text-slate-500 hover:text-ink">
          Demo: switch to the {other}'s view →
        </button>
      )}
    </div>
  );
}

function MoneyBar({ totals, currency }: { totals: any; currency: string }) {
  const pct = (n: number) => `${totals.total ? (n / totals.total) * 100 : 0}%`;
  return (
    <div className="card mt-6 p-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Deal total" value={money(totals.total, currency)} />
        <Stat label="Held in escrow" value={money(totals.inEscrow, currency)} icon={<Lock size={14} className="text-brand-600" />} />
        <Stat label="Paid to freelancer" value={money(totals.released, currency)} />
        <Stat label="Refunded to client" value={money(totals.refunded, currency)} />
      </div>
      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className="bg-emerald-600 transition-all" style={{ width: pct(totals.released) }} />
        <div className="bg-brand-500/50 transition-all" style={{ width: pct(totals.inEscrow) }} />
        <div className="bg-slate-400 transition-all" style={{ width: pct(totals.refunded) }} />
      </div>
    </div>
  );
}

const Stat = ({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) => (
  <div><div className="flex items-center gap-1 text-xs font-medium text-slate-500">{icon}{label}</div><div className="mt-0.5 text-xl font-bold">{value}</div></div>
);

function CopyLink({ path, label }: { path: string; label: string }) {
  const [done, setDone] = useState(false);
  const url = `${location.origin}${path}`;
  return (
    <button onClick={() => { navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1500); }} className="btn-ghost !py-2 text-left">
      {done ? <Check size={15} /> : <Copy size={15} />} {done ? 'Copied!' : label}
    </button>
  );
}

function SignPanel({ deal, role, links, onSign }: { deal: any; role: Role; links: any; onSign: () => void }) {
  const mine = role === 'client' ? deal.client_accepted_at : deal.freelancer_accepted_at;
  const other: Role = role === 'client' ? 'freelancer' : 'client';
  const otherName = role === 'client' ? deal.freelancer_name : deal.client_name;
  return (
    <div className="card mt-5 flex flex-wrap items-center justify-between gap-4 border-amber-200 bg-amber-50/40 p-5">
      <div>
        <div className="flex items-center gap-2 font-semibold"><PenLine size={16} /> {mine ? `Waiting for ${otherName} to sign` : 'Review the agreement and sign'}</div>
        <p className="mt-1 text-sm text-slate-600">
          {mine ? `Send ${otherName} their private link. Nobody can fund or release money until both of you have signed.` : 'Read the milestones and acceptance criteria below. Once both parties sign, the client can fund milestone 1.'}
        </p>
      </div>
      {mine ? (links?.[other] && <CopyLink path={links[other]} label={`Copy ${other}'s link`} />)
        : <button data-testid="sign-btn" onClick={onSign} className="btn-brand"><PenLine size={16} /> Sign agreement</button>}
    </div>
  );
}

// ------------------------------------------------------------------ milestone
function MilestoneCard({ m, i, deal, role, signed, act, demo, hours }: { m: any; i: number; deal: any; role: Role; signed: boolean; act: any; demo: boolean; hours: number }) {
  const st = STATUS[m.status];
  const ver = m.verification;
  const verdicts: Record<string, string> = {};
  if (ver?.state === 'done') ver.criteria.forEach((c: any, idx: number) => { verdicts[idx] = c.verdict; });
  const done = ['RELEASED', 'SETTLED', 'REFUNDED'].includes(m.status);

  return (
    <div data-testid={`milestone-${i}`} className={`card overflow-hidden ${m.status === 'DISPUTED' ? 'border-rose-200' : ''}`}>
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-bold ${done ? 'bg-emerald-600 text-white' : 'bg-ink text-white'}`}>{done ? <Check size={14} /> : i + 1}</span>
          <div className="min-w-0 flex-1 basis-[calc(100%-3rem)] font-semibold sm:basis-auto">{m.title}</div>
          <span data-testid={`status-${i}`} className={`chip ml-10 sm:ml-0 ${st.cls}`}>{st.label}</span>
          <span className="ml-auto text-lg font-bold sm:ml-0">{money(m.amount, deal.currency)}</span>
        </div>
        {m.description && <p className="mt-2 text-sm text-slate-600">{m.description}</p>}
        {m.due_date && <div className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Clock size={12} /> Due {new Date(m.due_date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>}
        <ul className="mt-3 space-y-1.5">
          {m.criteria.map((c: string, idx: number) => (
            <li key={idx} className="flex gap-2 text-sm">
              <VerdictIcon v={verdicts[idx]} />
              <span className={verdicts[idx] === 'not_met' ? 'text-rose-700' : ''}>{c}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-slate-100 bg-slate-50/60 p-5">
        {m.status === 'AWAITING_FUNDING' && <Funding m={m} deal={deal} role={role} signed={signed} act={act} />}
        {m.status === 'FUNDED' && (role === 'freelancer'
          ? <><SubmitWork m={m} act={act} /><div className="mt-3 text-right"><button onClick={() => confirm(`Refund the full ${money(m.amount, deal.currency)} to ${deal.client_name}?`) && act(`/api/milestones/${m.id}/refund`, {}, 'Refund sent via PayPal.')} className="text-xs text-slate-500 hover:text-rose-700"><Undo2 size={12} className="inline" /> Cancel milestone & refund client</button></div></>
          : <Waiting icon={<Lock size={16} className="text-brand-600" />} text={`${money(m.amount, deal.currency)} is safely in escrow. ${deal.freelancer_name} has been told to start. You'll review the work before anything is paid.`}>
              <DisputeOpener m={m} act={act} role={role} />
            </Waiting>)}
        {m.status === 'SUBMITTED' && <Review m={m} deal={deal} role={role} act={act} demo={demo} hours={hours} />}
        {m.status === 'DISPUTED' && <Dispute m={m} deal={deal} role={role} act={act} />}
        {done && <Outcome m={m} deal={deal} />}
      </div>
    </div>
  );
}

const VerdictIcon = ({ v }: { v?: string }) =>
  v === 'met' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
  : v === 'not_met' ? <XCircle size={16} className="mt-0.5 shrink-0 text-rose-600" />
  : v === 'unclear' ? <HelpCircle size={16} className="mt-0.5 shrink-0 text-amber-500" />
  : <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full border-2 border-slate-300" style={{ marginLeft: 4, marginRight: 4 }} />;

const Waiting = ({ icon, text, children }: { icon: React.ReactNode; text: string; children?: React.ReactNode }) => (
  <div><div className="flex items-start gap-2 text-sm text-slate-600">{icon}<span>{text}</span></div>{children}</div>
);

function Funding({ m, deal, role, signed, act }: any) {
  const [busy, setBusy] = useState('');
  if (!signed) return <Waiting icon={<PenLine size={16} />} text="Funding opens once both parties sign the agreement." />;
  if (role === 'freelancer') return <Waiting icon={<Clock size={16} />} text={`Waiting for ${deal.client_name} to fund this milestone. Don't start until it shows "In escrow". Then you're guaranteed the money is there.`} />;
  const pay = async () => {
    setBusy('pay');
    try { const { approveUrl } = await act(`/api/milestones/${m.id}/fund`); location.href = approveUrl; } catch { setBusy(''); }
  };
  const invoice = async () => { setBusy('inv'); try { await act(`/api/milestones/${m.id}/invoice`, {}, 'PayPal invoice sent. Pay it from the email or the PayPal app.'); } finally { setBusy(''); } };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button data-testid={`fund-${m.position}`} onClick={pay} disabled={!!busy} className="btn-paypal !px-5">
          {busy === 'pay' ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />} Fund {money(m.amount, deal.currency)} with PayPal
        </button>
        {!m.invoice_id
          ? <button onClick={invoice} disabled={!!busy || !deal.client_email} title={deal.client_email ? '' : 'Add a client email to use invoices'} className="btn-ghost"><Receipt size={16} /> Send me a PayPal invoice instead</button>
          : <button onClick={() => act(`/api/milestones/${m.id}/sync`, {}, 'Checked with PayPal.')} className="btn-ghost"><Receipt size={16} /> Invoice sent. Check payment</button>}
      </div>
      <p className="mt-2 text-xs text-slate-500">Paid into Handshake's PayPal escrow, not to {deal.freelancer_name} directly. Released only when you approve the work.</p>
    </div>
  );
}

function SubmitWork({ m, act }: any) {
  const [note, setNote] = useState('');
  const [links, setLinks] = useState('');
  const [files, setFiles] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const add = async (list: FileList | null) => {
    if (!list) return;
    const out = await Promise.all([...list].slice(0, 6).map((f) => readImage(f)));
    setFiles((p) => [...p, ...out].slice(0, 6));
  };
  const submit = async () => {
    setBusy(true);
    try {
      await act(`/api/milestones/${m.id}/submit`, { note, links: links.split(/\s+/).filter(Boolean), files: files.map(({ name, mimeType, dataBase64 }) => ({ name, mimeType, dataBase64 })) }, 'Submitted. The AI Verifier is checking your work against the criteria.');
    } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold"><Lock size={15} className="text-brand-600" /> Money is in escrow. Deliver the work:</div>
      <textarea data-testid="submit-note" className="input mt-2" rows={3} placeholder="What are you delivering? Mention how each acceptance criterion is met." value={note} onChange={(e) => setNote(e.target.value)} />
      <input data-testid="submit-links" className="input mt-2" placeholder="Links (preview site, Drive folder, Figma…), space separated" value={links} onChange={(e) => setLinks(e.target.value)} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {files.map((f, i) => f.preview
          ? <img key={i} src={f.preview} className="h-14 w-14 rounded-lg border object-cover" />
          : <span key={i} className="chip bg-white text-slate-600 border"><FileText size={12} />{f.name}</span>)}
        <label className="btn-ghost cursor-pointer !py-2"><Upload size={15} /> Add files / photos
          <input data-testid="submit-files" type="file" multiple className="hidden" onChange={(e) => add(e.target.files)} />
        </label>
        <button data-testid="submit-btn" onClick={submit} disabled={busy} className="btn-primary ml-auto">{busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Submit for AI check</button>
      </div>
    </div>
  );
}

function Submission({ s }: { s: any }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Delivered {timeAgo(s.created_at)}</div>
      {s.note && <p className="mt-1 text-sm whitespace-pre-wrap">{s.note}</p>}
      {s.links.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{s.links.map((l: string) => <a key={l} href={l} target="_blank" className="chip bg-slate-100 text-slate-700 hover:bg-slate-200"><Link2 size={12} />{l.replace(/^https?:\/\//, '').slice(0, 40)}</a>)}</div>}
      {s.files.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{s.files.map((f: any) => f.mimeType.startsWith('image/')
        ? <a key={f.path} href={f.path} target="_blank"><img src={f.path} className="h-20 w-20 rounded-lg border object-cover" /></a>
        : <a key={f.path} href={f.path} target="_blank" className="chip border bg-white text-slate-600"><FileText size={12} />{f.name}</a>)}</div>}
    </div>
  );
}

function VerificationReport({ ver, onRetry }: { ver: any; onRetry: () => void }) {
  if (!ver || ver.state === 'running') return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-sky-800"><Loader2 size={15} className="animate-spin" /> AI Verifier is inspecting the evidence…</div>
      <div className="mt-3 space-y-2"><div className="shimmer h-3 rounded" /><div className="shimmer h-3 w-4/5 rounded" /></div>
    </div>
  );
  if (ver.state === 'error') return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
      <div className="font-semibold text-amber-800">The AI Verifier couldn't run (the free model is busy).</div>
      <button onClick={onRetry} className="mt-2 font-semibold text-amber-900 underline">Retry verification</button>
    </div>
  );
  const tone = ver.overall === 'pass' ? 'border-emerald-200 bg-emerald-50/50' : ver.overall === 'partial' ? 'border-amber-200 bg-amber-50/50' : 'border-rose-200 bg-rose-50/50';
  return (
    <div data-testid="verification" className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold"><Sparkles size={15} /> AI Verifier: {ver.overall === 'pass' ? 'All criteria met' : ver.overall === 'partial' ? 'Partially met' : 'Criteria not met'}</div>
        <span className="text-xs text-slate-500">confidence {Math.round((ver.confidence <= 1 ? ver.confidence * 100 : ver.confidence))}% · {ver.model}</span>
      </div>
      <p className="mt-1 text-sm text-slate-700">{ver.summary}</p>
      <div className="mt-3 space-y-2">
        {ver.criteria.map((c: any, i: number) => (
          <div key={i} className="rounded-lg bg-white/80 p-2.5 text-sm">
            <div className="flex gap-2 font-medium"><VerdictIcon v={c.verdict} />{c.criterion}</div>
            <div className="mt-1 pl-6 text-xs text-slate-600"><span className="font-semibold">Evidence:</span> {c.evidence} <span className="text-slate-400">·</span> {c.reasoning}</div>
          </div>
        ))}
      </div>
      {ver.suggestions_for_freelancer?.length > 0 && ver.overall !== 'pass' && (
        <div className="mt-3 text-xs text-slate-600"><span className="font-semibold">To fix:</span> {ver.suggestions_for_freelancer.join(' · ')}</div>
      )}
    </div>
  );
}

function Countdown({ at }: { at: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((new Date(at).getTime() - now) / 1000));
  const h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return <span className="font-mono">{h}h {String(mm).padStart(2, '0')}m {String(ss).padStart(2, '0')}s</span>;
}

function Review({ m, deal, role, act, demo, hours }: any) {
  const [busy, setBusy] = useState(false);
  const ver = m.verification;
  return (
    <div className="space-y-3">
      {m.submission && <Submission s={m.submission} />}
      <VerificationReport ver={ver} onRetry={() => act(`/api/milestones/${m.id}/verify`)} />
      {m.auto_release_at && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <Clock size={13} /> Auto-releases to {deal.freelancer_name} in <Countdown at={m.auto_release_at} /> unless {deal.client_name} approves sooner or opens a dispute ({hours}h review window).
          {demo && <button onClick={() => act(`/api/milestones/${m.id}/fast-forward`, {}, 'Review window skipped (demo). Auto-release triggered.')} className="chip bg-slate-200 text-slate-700 hover:bg-slate-300"><FastForward size={11} /> Demo: skip window</button>}
        </div>
      )}
      {role === 'client' ? (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button data-testid="release-btn" disabled={busy} onClick={async () => { setBusy(true); try { await act(`/api/milestones/${m.id}/release`, {}, `Released! PayPal Payouts is sending ${money(m.amount, deal.currency)} to ${deal.freelancer_name}.`); } finally { setBusy(false); } }} className="btn-brand !px-5">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Banknote size={16} />} Approve & release {money(m.amount, deal.currency)}
          </button>
          <DisputeOpener m={m} act={act} role={role} inline />
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
          <span>Waiting for {deal.client_name} to review. You can resubmit if the check flagged something.</span>
          <DisputeOpener m={m} act={act} role={role} inline />
        </div>
      )}
      {role === 'freelancer' && ver?.state === 'done' && ver.overall !== 'pass' && <details className="text-sm"><summary className="cursor-pointer font-semibold text-slate-700">Resubmit work</summary><div className="mt-2"><SubmitWork m={m} act={act} /></div></details>}
    </div>
  );
}

function DisputeOpener({ m, act, role, inline }: any) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  if (!open) return <button data-testid="dispute-open" onClick={() => setOpen(true)} className={inline ? 'btn-danger' : 'mt-2 text-xs text-slate-500 hover:text-rose-700'}><AlertTriangle size={inline ? 16 : 12} className="inline" /> Open a dispute</button>;
  return (
    <div className="mt-3 w-full rounded-xl border border-rose-200 bg-white p-3">
      <div className="text-sm font-semibold">What went wrong?</div>
      <textarea data-testid="dispute-text" className="input mt-2" rows={3} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={role === 'client' ? 'e.g. The final files are missing the PNG versions and the color guide.' : "e.g. The client hasn't responded in 10 days."} />
      <div className="mt-2 flex justify-end gap-2">
        <button onClick={() => setOpen(false)} className="btn-ghost !py-1.5">Cancel</button>
        <button data-testid="dispute-submit" onClick={() => act(`/api/milestones/${m.id}/dispute`, { statement: text }, 'Dispute opened. Funds are frozen until it is resolved.')} className="btn-danger !py-1.5">Freeze funds & open dispute</button>
      </div>
    </div>
  );
}

function Dispute({ m, deal, role, act }: any) {
  const d = m.dispute;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const mine = role === 'client' ? d.client_statement : d.freelancer_statement;
  const p = d.proposal;
  const myDecision = role === 'client' ? d.client_decision : d.freelancer_decision;
  const run = async (key: string, fn: () => Promise<unknown>) => { setBusy(key); try { await fn(); } catch { /* toast shown */ } finally { setBusy(''); } };

  return (
    <div className="space-y-3">
      {m.submission && <Submission s={m.submission} />}
      {m.verification?.state === 'done' && <VerificationReport ver={m.verification} onRetry={() => {}} />}
      <div className="flex items-center gap-2 font-semibold text-rose-700"><Scale size={16} /> Mediation: {money(m.amount, deal.currency)} frozen in escrow</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Statement who={`${deal.client_name} (client)`} text={d.client_statement} />
        <Statement who={`${deal.freelancer_name} (freelancer)`} text={d.freelancer_statement} />
      </div>
      {d.status !== 'SETTLED' && (!mine || (d.status === 'GATHERING' && !p)) && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-sm font-semibold">{mine ? 'Update your side' : 'Tell the mediator your side'}</div>
          <textarea data-testid="statement-text" className="input mt-2" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Stick to facts: what was agreed, what was delivered, what's missing." />
          <div className="mt-2 text-right"><button data-testid="statement-submit" disabled={!text.trim() || !!busy} onClick={() => run('st', async () => { await act(`/api/disputes/${d.id}/statement`, { statement: text }, 'Statement added.'); setText(''); })} className="btn-primary !py-1.5">Submit statement</button></div>
        </div>
      )}
      {!p && (
        <button data-testid="mediate-btn" disabled={!!busy} onClick={() => run('med', () => act(`/api/disputes/${d.id}/mediate`, {}, 'The AI Mediator has proposed a settlement.'))} className="btn-primary w-full !py-3">
          {busy === 'med' ? <><Loader2 size={16} className="animate-spin" /> Mediator is weighing the agreement, evidence and both statements…</> : <><Sparkles size={16} /> Ask the AI Mediator for a fair split</>}
        </button>
      )}
      {p && (
        <div data-testid="proposal" className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-violet-700 uppercase"><Sparkles size={13} /> AI Mediator proposal</div>
          <div className="mt-1 text-lg font-bold">{p.headline}</div>
          <div className="mt-3 flex h-8 overflow-hidden rounded-lg text-xs font-semibold text-white">
            <div className="flex items-center justify-center bg-emerald-600" style={{ width: `${p.freelancer_percent}%` }}>{p.freelancer_percent >= 15 && `${deal.freelancer_name} ${money(p.freelancer_amount, deal.currency)}`}</div>
            <div className="flex items-center justify-center bg-slate-500" style={{ width: `${100 - p.freelancer_percent}%` }}>{100 - p.freelancer_percent >= 15 && `${deal.client_name} ${money(p.client_refund, deal.currency)}`}</div>
          </div>
          <p className="mt-3 text-sm text-slate-700">{p.rationale}</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {p.findings.map((f: any, i: number) => (
              <li key={i} className="flex gap-2"><span className={`chip h-fit shrink-0 ${f.favors === 'client' ? 'bg-amber-100 text-amber-800' : f.favors === 'freelancer' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-600'}`}>{f.favors}</span>{f.point}</li>
            ))}
          </ul>
          {p.next_steps?.length > 0 && <div className="mt-3 text-xs text-slate-600"><span className="font-semibold">Next steps:</span> {p.next_steps.join(' · ')}</div>}
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-violet-200 pt-3 text-sm">
            <span>{d.client_decision === 'accepted' ? '✓' : '○'} {deal.client_name}</span>
            <span>{d.freelancer_decision === 'accepted' ? '✓' : '○'} {deal.freelancer_name}</span>
            {!myDecision && d.status === 'PROPOSED' && (
              <div className="ml-auto flex gap-2">
                <button onClick={() => run('rej', () => act(`/api/disputes/${d.id}/decide`, { accept: false }, 'Rejected. Add more context and ask the mediator again.'))} disabled={!!busy} className="btn-ghost !py-1.5">Reject</button>
                <button data-testid="accept-proposal" onClick={() => run('acc', () => act(`/api/disputes/${d.id}/decide`, { accept: true }, 'Accepted.'))} disabled={!!busy} className="btn-brand !py-1.5">
                  {busy === 'acc' ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Accept split
                </button>
              </div>
            )}
            {myDecision === 'accepted' && d.status === 'PROPOSED' && <span className="ml-auto text-slate-500">Waiting for the other party…</span>}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Money only moves if both parties accept. PayPal then pays the freelancer's share and refunds the rest automatically.</p>
        </div>
      )}
    </div>
  );
}

const Statement = ({ who, text }: { who: string; text: string | null }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
    <div className="text-xs font-semibold text-slate-500">{who}</div>
    <p className={`mt-1 ${text ? '' : 'italic text-slate-400'}`}>{text || 'No statement yet'}</p>
  </div>
);

function Outcome({ m, deal }: any) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      {m.released_amount > 0 && <span className="flex items-center gap-1.5"><Banknote size={16} className="text-emerald-600" /> <b>{money(m.released_amount, deal.currency)}</b> paid to {deal.freelancer_name}
        {m.payout_status && <span className={`chip ${m.payout_status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>PayPal payout: {m.payout_status.toLowerCase()}</span>}</span>}
      {m.refunded_amount > 0 && <span className="flex items-center gap-1.5"><Undo2 size={16} className="text-slate-500" /> <b>{money(m.refunded_amount, deal.currency)}</b> refunded to {deal.client_name}</span>}
    </div>
  );
}

// ------------------------------------------------------------------ timeline
function Timeline({ events, currency }: { events: any[]; currency: string }) {
  const badge = (actor: string) => {
    if (actor === 'ai') return <span className="grid h-6 w-6 place-items-center rounded-full bg-violet-100 text-violet-700"><Sparkles size={12} /></span>;
    if (actor === 'paypal') return <span className="grid h-6 w-6 place-items-center rounded-full bg-[#ffc439] text-[10px] font-extrabold text-[#003087]">PP</span>;
    if (actor === 'system') return <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-200 text-slate-600"><Lock size={11} /></span>;
    return <span className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold ${actor === 'client' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`}>{actor[0].toUpperCase()}</span>;
  };
  return (
    <div className="card p-5">
      <div className="font-semibold">Activity & ledger</div>
      <ol className="mt-3 space-y-3">
        {events.map((e) => (
          <li key={e.id} className="flex gap-2.5 text-sm">
            <div className="shrink-0">{badge(e.actor)}</div>
            <div className="min-w-0">
              <div className="text-slate-700">{e.message}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-400">
                <span>{timeAgo(e.created_at)}</span>
                {e.ref && <span className="truncate font-mono" title={e.ref}><ExternalLink size={9} className="inline" /> {e.ref}</span>}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
