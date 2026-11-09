import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, Plus } from 'lucide-react';
import { api, money, timeAgo } from '../api';

const DOT: Record<string, string> = {
  AWAITING_FUNDING: 'bg-slate-300', FUNDED: 'bg-brand-500', SUBMITTED: 'bg-sky-500', DISPUTED: 'bg-rose-500',
  RELEASED: 'bg-emerald-700', SETTLED: 'bg-violet-600', REFUNDED: 'bg-slate-500',
};

export default function Deals() {
  const [deals, setDeals] = useState<any[] | null>(null);
  useEffect(() => { api('/api/deals').then(setDeals).catch(() => setDeals([])); }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Deals</h1>
          <p className="mt-1 text-sm text-slate-600">Demo directory: open any deal as either party. In production each person only sees their own private links.</p>
        </div>
        <Link to="/new" className="btn-primary"><Plus size={16} /> New deal</Link>
      </div>
      <div className="mt-6 space-y-3">
        {deals === null && <div className="shimmer h-24 rounded-2xl" />}
        {deals?.length === 0 && (
          <div className="card p-10 text-center text-slate-600">No deals yet. <Link to="/new" className="font-semibold text-brand-700 underline">Draft your first one from a chat.</Link></div>
        )}
        {deals?.map((d) => (
          <div key={d.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{d.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-slate-500">{d.client_name} <ArrowRightLeft size={12} /> {d.freelancer_name} · {timeAgo(d.created_at)}</div>
              <div className="mt-2 flex gap-1">{d.statuses.map((s: string, i: number) => <span key={i} title={s} className={`h-1.5 w-8 rounded-full ${DOT[s] || 'bg-slate-200'}`} />)}</div>
            </div>
            <div className="text-lg font-bold sm:text-right">{money(d.total, d.currency)}</div>
            <div className="flex flex-wrap gap-2">
              <Link to={d.links.client} className="btn-ghost !py-1.5">Open as client</Link>
              <Link to={d.links.freelancer} className="btn-ghost !py-1.5">Open as freelancer</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
