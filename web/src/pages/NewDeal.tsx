import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ImagePlus, X, Plus, Trash2, AlertTriangle, HelpCircle, Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { api, money, readImage } from '../api';
import { SAMPLES } from '../samples';

type Role = 'client' | 'freelancer';
interface Milestone { title: string; description: string; amount: number; due_date: string; acceptance_criteria: string[] }
interface Draft {
  title: string; summary: string; currency: string; client_name: string; freelancer_name: string;
  milestones: Milestone[]; terms: string[];
  risk_flags: { severity: 'high' | 'medium' | 'low'; issue: string; suggestion: string }[];
  questions: string[];
}

const THINKING = ['Reading the conversation…', 'Finding who pays whom, and for what…', 'Splitting the work into milestones…', 'Writing testable acceptance criteria…', 'Looking for gaps that cause disputes…'];

export default function NewDeal() {
  const nav = useNavigate();
  const [role, setRole] = useState<Role>('freelancer');
  const [chat, setChat] = useState('');
  const [images, setImages] = useState<{ mimeType: string; data: string; preview: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [model, setModel] = useState('');
  const [emails, setEmails] = useState({ client: '', freelancer: '' });
  const [demo, setDemo] = useState<{ clientEmail?: string; freelancerEmail?: string }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { api('/api/demo-config').then(setDemo).catch(() => {}); }, []);
  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, THINKING.length - 1)), 1800);
    return () => clearInterval(t);
  }, [loading]);

  async function addImages(files: FileList | null) {
    if (!files) return;
    const out = await Promise.all([...files].slice(0, 4).map((f) => readImage(f, 1600)));
    setImages((prev) => [...prev, ...out.map((o) => ({ mimeType: o.mimeType, data: o.dataBase64, preview: o.preview }))].slice(0, 4));
  }

  async function runDraft() {
    setLoading(true); setStep(0); setError('');
    try {
      const res = await api<{ draft: Draft; model: string }>('/api/draft', { chat, images: images.map(({ mimeType, data }) => ({ mimeType, data })) });
      setDraft(res.draft); setModel(res.model);
      setEmails({ client: demo.clientEmail || '', freelancer: demo.freelancerEmail || '' });
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  async function create() {
    if (!draft) return;
    setSaving(true); setError('');
    try {
      const res = await api<{ id: string; links: { client: string; freelancer: string } }>('/api/deals', {
        ...draft, client_email: emails.client, freelancer_email: emails.freelancer,
        source_text: chat, created_by: role,
      });
      nav(`${res.links[role]}&created=1`);
    } catch (e: any) { setError(e.message); setSaving(false); }
  }

  if (draft) return (
    <Review draft={draft} setDraft={setDraft} model={model} role={role} emails={emails} setEmails={setEmails}
      onBack={() => setDraft(null)} onCreate={create} saving={saving} error={error} />
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-extrabold tracking-tight">Start a Handshake</h1>
      <p className="mt-2 text-slate-600">Paste the conversation where you agreed on the work. The AI drafts the agreement and you review every word before anything is signed.</p>

      <div className="card mt-6 p-5">
        <span className="label">I am the</span>
        <div className="inline-flex rounded-xl bg-slate-100 p-1">
          {(['freelancer', 'client'] as Role[]).map((r) => (
            <button key={r} onClick={() => setRole(r)} className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${role === r ? 'bg-white shadow-sm' : 'text-slate-500'}`}>
              {r === 'freelancer' ? 'Freelancer (getting paid)' : 'Client (paying)'}
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-end justify-between">
          <span className="label">Conversation</span>
          <div className="flex flex-wrap gap-1.5">
            {SAMPLES.map((s) => (
              <button key={s.label} onClick={() => setChat(s.text)} className="chip bg-slate-100 text-slate-600 hover:bg-slate-200">Try: {s.label}</button>
            ))}
          </div>
        </div>
        <textarea data-testid="chat-input" value={chat} onChange={(e) => setChat(e.target.value)} rows={11} className="input mt-1 font-mono text-[13px]"
          placeholder={'[10/20, 9:14 AM] Tom: Hi! We need a new logo…\n[10/20, 9:20 AM] Maria: Happy to help, $400 for…'} />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {images.map((img, i) => (
            <div key={i} className="relative">
              <img src={img.preview} className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
              <button onClick={() => setImages(images.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 rounded-full bg-ink p-0.5 text-white"><X size={12} /></button>
            </div>
          ))}
          <label className="btn-ghost cursor-pointer !py-2"><ImagePlus size={16} /> Add chat screenshots
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addImages(e.target.files)} />
          </label>
        </div>

        {error && <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

        <button data-testid="draft-btn" onClick={runDraft} disabled={loading || (!chat.trim() && !images.length)} className="btn-brand mt-5 w-full !py-3">
          {loading ? <><Loader2 size={16} className="animate-spin" /> {THINKING[step]}</> : <><Sparkles size={16} /> Draft agreement with AI</>}
        </button>
      </div>
    </div>
  );
}

function Review({ draft, setDraft, model, role, emails, setEmails, onBack, onCreate, saving, error }: {
  draft: Draft; setDraft: (d: Draft) => void; model: string; role: Role;
  emails: { client: string; freelancer: string }; setEmails: (e: { client: string; freelancer: string }) => void;
  onBack: () => void; onCreate: () => void; saving: boolean; error: string;
}) {
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const setM = (i: number, patch: Partial<Milestone>) => set({ milestones: draft.milestones.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const total = draft.milestones.reduce((s, m) => s + (Number(m.amount) || 0), 0);
  const [applied, setApplied] = useState<number[]>([]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink"><ArrowLeft size={14} /> Back to conversation</button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="chip bg-brand-50 text-brand-700"><Sparkles size={12} /> Drafted by AI ({model}). Review and edit anything.</span>
          <input value={draft.title} onChange={(e) => set({ title: e.target.value })} className="mt-2 block w-full bg-transparent text-3xl font-extrabold tracking-tight outline-none" />
          <textarea value={draft.summary} onChange={(e) => set({ summary: e.target.value })} rows={2} className="mt-1 w-full resize-none bg-transparent text-slate-600 outline-none" />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <div className="card grid gap-4 p-5 sm:grid-cols-2">
            <div>
              <span className="label">Client (pays)</span>
              <input className="input" value={draft.client_name} onChange={(e) => set({ client_name: e.target.value })} />
              <input className="input mt-2" placeholder="Client email (for PayPal invoice, optional)" value={emails.client} onChange={(e) => setEmails({ ...emails, client: e.target.value })} />
            </div>
            <div>
              <span className="label">Freelancer (gets paid)</span>
              <input className="input" value={draft.freelancer_name} onChange={(e) => set({ freelancer_name: e.target.value })} />
              <input data-testid="freelancer-email" className="input mt-2" placeholder="Freelancer's PayPal email (receives payouts)" value={emails.freelancer} onChange={(e) => setEmails({ ...emails, freelancer: e.target.value })} />
            </div>
          </div>

          {draft.milestones.map((m, i) => (
            <div key={i} className="card p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink text-xs font-bold text-white">{i + 1}</span>
                <input className="flex-1 bg-transparent text-lg font-semibold outline-none" value={m.title} onChange={(e) => setM(i, { title: e.target.value })} />
                <div className="flex items-center rounded-xl border border-slate-200 px-2">
                  <span className="text-sm text-slate-400">{draft.currency}</span>
                  <input type="number" min={1} className="w-24 bg-transparent px-1 py-1.5 text-right font-semibold outline-none" value={m.amount} onChange={(e) => setM(i, { amount: Number(e.target.value) })} />
                </div>
                {draft.milestones.length > 1 && <button onClick={() => set({ milestones: draft.milestones.filter((_, j) => j !== i) })} className="text-slate-400 hover:text-rose-600"><Trash2 size={16} /></button>}
              </div>
              <textarea className="input mt-3" rows={2} value={m.description} onChange={(e) => setM(i, { description: e.target.value })} />
              <div className="mt-3 flex items-center gap-2 text-sm">
                <span className="label !mb-0">Due</span>
                <input type="date" className="input !w-auto !py-1" value={m.due_date || ''} onChange={(e) => setM(i, { due_date: e.target.value })} />
              </div>
              <span className="label mt-4">Acceptance criteria (what the AI Verifier will check)</span>
              <div className="space-y-2">
                {m.acceptance_criteria.map((c, k) => (
                  <div key={k} className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="shrink-0 text-brand-600" />
                    <input className="input !py-1.5" value={c} onChange={(e) => setM(i, { acceptance_criteria: m.acceptance_criteria.map((x, j) => (j === k ? e.target.value : x)) })} />
                    <button onClick={() => setM(i, { acceptance_criteria: m.acceptance_criteria.filter((_, j) => j !== k) })} className="text-slate-400 hover:text-rose-600"><X size={16} /></button>
                  </div>
                ))}
                <button onClick={() => setM(i, { acceptance_criteria: [...m.acceptance_criteria, ''] })} className="text-sm font-medium text-brand-700 hover:underline"><Plus size={14} className="inline" /> Add criterion</button>
              </div>
            </div>
          ))}
          <button onClick={() => set({ milestones: [...draft.milestones, { title: 'New milestone', description: '', amount: 100, due_date: '', acceptance_criteria: [''] }] })} className="btn-ghost w-full"><Plus size={16} /> Add milestone</button>

          <div className="card p-5">
            <span className="label">Terms</span>
            <ul className="space-y-2">
              {draft.terms.map((t, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input className="input !py-1.5" value={t} onChange={(e) => set({ terms: draft.terms.map((x, j) => (j === i ? e.target.value : x)) })} />
                  <button onClick={() => set({ terms: draft.terms.filter((_, j) => j !== i) })} className="text-slate-400 hover:text-rose-600"><X size={16} /></button>
                </li>
              ))}
            </ul>
            <button onClick={() => set({ terms: [...draft.terms, ''] })} className="mt-2 text-sm font-medium text-brand-700 hover:underline"><Plus size={14} className="inline" /> Add term</button>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="card p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-slate-500">Total</span>
              <span className="text-2xl font-extrabold">{money(total, draft.currency)}</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">{draft.milestones.length} milestone(s), each funded into PayPal escrow separately</div>
            {error && <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            <button data-testid="create-btn" onClick={onCreate} disabled={saving} className="btn-brand mt-4 w-full !py-3">
              {saving ? <Loader2 size={16} className="animate-spin" /> : null} Sign as {role} & get share link
            </button>
            <p className="mt-2 text-xs text-slate-500">The other party reviews the same agreement and signs from their own link.</p>
          </div>

          {draft.risk_flags.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} className="text-amber-500" /> Gaps the AI found</div>
              <div className="mt-3 space-y-3">
                {draft.risk_flags.map((f, i) => (
                  <div key={i} className={`rounded-xl border p-3 text-sm ${f.severity === 'high' ? 'border-rose-200 bg-rose-50/50' : f.severity === 'medium' ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between">
                      <span className={`chip ${f.severity === 'high' ? 'bg-rose-100 text-rose-700' : f.severity === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{f.severity}</span>
                    </div>
                    <div className="mt-1.5 font-medium">{f.issue}</div>
                    <div className="mt-1 text-slate-600">{f.suggestion}</div>
                    <button disabled={applied.includes(i)} onClick={() => { set({ terms: [...draft.terms, f.suggestion] }); setApplied([...applied, i]); }}
                      className="mt-2 text-xs font-semibold text-brand-700 hover:underline disabled:text-slate-400 disabled:no-underline">
                      {applied.includes(i) ? '✓ Added to terms' : '+ Add as a term'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {draft.questions.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center gap-2 font-semibold"><HelpCircle size={16} className="text-slate-500" /> Settle these before signing</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{draft.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
