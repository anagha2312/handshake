import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { Handshake } from 'lucide-react';
import Landing from './pages/Landing';
import NewDeal from './pages/NewDeal';
import DealPage from './pages/Deal';
import Deals from './pages/Deals';

export default function App() {
  const nav = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-slate-100 text-ink' : 'text-slate-600 hover:text-ink'}`;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white"><Handshake size={18} /></span>
            Handshake
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/deals" className={nav}>Deals</NavLink>
            <Link to="/new" className="btn-primary ml-2 !py-1.5">New deal</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/new" element={<NewDeal />} />
          <Route path="/deals" element={<Deals />} />
          <Route path="/deal/:id" element={<DealPage />} />
        </Routes>
      </main>
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        Sandbox demo: payments run on the PayPal sandbox and no real money moves. AI by Google Gemini.
      </footer>
    </div>
  );
}
