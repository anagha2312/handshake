import { Link } from 'react-router-dom';
import { ArrowRight, MessageSquareText, FileCheck2, Lock, ScanSearch, Scale, Banknote, ShieldCheck, Timer, Users } from 'lucide-react';

const steps = [
  { icon: MessageSquareText, title: 'Paste the chat', text: 'Drop in the WhatsApp, DM or email thread where you agreed on the work, or a screenshot of it.' },
  { icon: FileCheck2, title: 'AI writes the deal', text: 'Milestones, amounts, deadlines and testable acceptance criteria, plus the gaps that usually cause fights.' },
  { icon: Lock, title: 'PayPal holds the money', text: 'The client funds each milestone through PayPal. The freelancer can see the money is really there.' },
  { icon: ScanSearch, title: 'AI checks the work', text: 'The freelancer submits files, photos or links. The AI Verifier checks every criterion before anyone pays.' },
  { icon: Banknote, title: 'Release in one click', text: 'The client approves and PayPal Payouts sends the money. Silence for 72h after a passing check releases it automatically.' },
  { icon: Scale, title: 'Fair when it goes wrong', text: 'The AI Mediator weighs the evidence and proposes a split. When both accept, PayPal pays and refunds automatically.' },
];

export default function Landing() {
  return (
    <div>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-14 pb-16 md:grid-cols-2 md:pt-20">
        <div>
          <span className="chip bg-brand-50 text-brand-700"><ShieldCheck size={14} /> Escrow for deals made in chat</span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-balance md:text-5xl">
            Turn any chat into a <span className="text-brand-600">protected deal</span>.
          </h1>
          <p className="mt-4 text-lg text-slate-600 text-pretty">
            Freelancers get stiffed. Clients pay for work that never comes. Handshake turns the messages you already sent into a
            clear agreement, holds the money with PayPal, and lets an impartial AI check the work before anyone gets paid.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/new" className="btn-brand !px-5 !py-3">Start a Handshake <ArrowRight size={16} /></Link>
            <Link to="/deals" className="btn-ghost !px-5 !py-3">Explore demo deals</Link>
          </div>
          <p className="mt-4 text-xs text-slate-500">No platform account needed for the other person. They just open a link.</p>
        </div>

        <div className="relative">
          <div className="card p-4">
            <div className="mb-3 text-xs font-semibold text-slate-500">WhatsApp · Tom (Sunrise Bakery)</div>
            <div className="space-y-2 text-sm">
              <Bubble who="Tom">can we split payment? half when you send concepts half at the end</Bubble>
              <Bubble who="Maria" me>Sure. $400 total. 3 concepts within a week, finals as SVG + PNG + a color guide</Bubble>
              <Bubble who="Tom">perfect. need it before Nov 15 for signage printing</Bubble>
            </div>
          </div>
          <div className="mx-auto -my-2 w-fit rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm relative z-10">AI turns it into ↓</div>
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">Sunrise Bakery logo package</div>
              <span className="chip bg-brand-50 text-brand-700"><Lock size={12} /> $200 in escrow</span>
            </div>
            <div className="mt-3 space-y-2 text-sm">
              <MiniMilestone n={1} title="3 initial concepts" amount="$200" state="Funded" />
              <MiniMilestone n={2} title="Final files (SVG, PNG, guide)" amount="$200" state="Awaiting funding" />
            </div>
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              ⚠ No revision limit agreed. Suggest: "2 rounds of revisions included".
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-bold tracking-tight">How it works</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {steps.map((s, i) => (
              <div key={s.title} className="rounded-2xl border border-slate-200 p-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-ink"><s.icon size={18} /></span>
                  <span className="text-xs font-bold text-slate-400">STEP {i + 1}</span>
                </div>
                <div className="mt-3 font-semibold">{s.title}</div>
                <p className="mt-1 text-sm text-slate-600">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-14 md:grid-cols-3">
        <Principle icon={Users} title="Built for the handshake economy">
          Cross-border freelancers, local contractors, tutors, creators: the people who agree on work in DMs and have no platform protecting them.
        </Principle>
        <Principle icon={ShieldCheck} title="AI advises, people decide">
          The AI never moves money on its own. Funds only move when the client approves, the review window passes, or both sides accept a settlement.
        </Principle>
        <Principle icon={Timer} title="Protection both ways">
          Clients only pay for work that meets what was agreed. Freelancers know the money exists before they start, and silence can't block payment forever.
        </Principle>
      </section>
    </div>
  );
}

function Bubble({ who, me, children }: { who: string; me?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex ${me ? 'justify-end' : ''}`}>
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${me ? 'bg-brand-50 text-ink' : 'bg-slate-100'}`}>
        <div className="text-[10px] font-semibold text-slate-500">{who}</div>
        {children}
      </div>
    </div>
  );
}

function MiniMilestone({ n, title, amount, state }: { n: number; title: string; amount: string; state: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
      <div className="flex items-center gap-2"><span className="text-xs font-bold text-slate-400">{n}</span>{title}</div>
      <div className="flex items-center gap-2"><span className="text-xs text-slate-500">{state}</span><span className="font-semibold">{amount}</span></div>
    </div>
  );
}

function Principle({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div>
      <Icon className="text-brand-600" size={22} />
      <div className="mt-2 font-semibold">{title}</div>
      <p className="mt-1 text-sm text-slate-600">{children}</p>
    </div>
  );
}
