import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { DEMO_INGEST } from './demo';
import { Detail } from './Detail';
import { Matrix } from './Matrix';
import { money } from './matrix';
import type { ActionRecord, Session, Summary } from './types';

const load = (): Session | null => { try { return JSON.parse(sessionStorage.getItem('cl') ?? 'null'); } catch { return null; } };

export function App() {
  const [s, setS] = useState<Session | null>(load);
  if (!s) return <Login onLogin={(v) => { sessionStorage.setItem('cl', JSON.stringify(v)); setS(v); }} />;
  return <Dashboard s={s} onLogout={() => { sessionStorage.removeItem('cl'); setS(null); }} />;
}

function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [baseUrl, setBase] = useState('http://localhost:3000');
  const [apiKey, setKey] = useState('');
  return (
    <main className="login">
      <form className="card" onSubmit={(e) => { e.preventDefault(); onLogin({ baseUrl, apiKey }); }}>
        <h1>CyberLedger AI</h1>
        <p className="muted">Riesgo neto integrado: seguridad + coste cloud</p>
        <label>API URL<input value={baseUrl} onChange={(e) => setBase(e.target.value)} /></label>
        <label>API key<input type="password" value={apiKey} onChange={(e) => setKey(e.target.value)} autoFocus /></label>
        <button className="primary" disabled={!apiKey}>Entrar</button>
      </form>
    </main>
  );
}

function Dashboard({ s, onLogout }: { s: Session; onLogout: () => void }) {
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [sum, setSum] = useState<Summary>();
  const [sel, setSel] = useState<string>();
  const [filter, setFilter] = useState<'PENDING_APPROVAL' | 'all'>('PENDING_APPROVAL');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { const [a, m] = await Promise.all([api.actions(s), api.summary(s)]); setActions(a); setSum(m); setErr(undefined); }
    catch (e) { setErr((e as Error).message); }
  }, [s]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, [refresh]);

  const shown = actions.filter((a) => filter === 'all' || a.status === filter);
  const current = actions.find((a) => a.id === sel) ?? shown[0];
  const ingest = async () => { setBusy(true); try { await api.ingest(s, DEMO_INGEST); await refresh(); } catch (e) { setErr((e as Error).message); } setBusy(false); };

  return (
    <div className="app">
      <header className="top">
        <h1>CyberLedger AI</h1>
        <div className="grow" />
        <button onClick={ingest} disabled={busy}>{busy ? 'Analizando…' : 'Cargar datos demo'}</button>
        <button onClick={onLogout}>Salir</button>
      </header>
      {err && <p className="error banner">{err}</p>}
      <section className="stats">
        <Stat label="Pendientes de decisión" value={String(sum?.pending ?? '–')} />
        <Stat label="Ahorro potencial / mes" value={sum ? money(sum.pendingSavings) : '–'} tone="good" />
        <Stat label="Ahorro ejecutado / mes" value={sum ? money(sum.realizedSavings) : '–'} tone="good" />
        <Stat label="Fallidas / revertidas" value={String((sum?.byStatus.FAILED ?? 0) + (sum?.byStatus.ROLLED_BACK ?? 0))} tone="bad" />
      </section>
      <div className="grid">
        <section className="card">
          <h2>Matriz Riesgo / Coste</h2>
          <Matrix actions={shown} selected={current?.id} onSelect={setSel} />
        </section>
        <section className="card inbox">
          <h2>Bandeja SecOps / FinOps
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="PENDING_APPROVAL">Pendientes</option><option value="all">Todas</option>
            </select>
          </h2>
          {shown.length === 0 && <p className="muted">Sin acciones. Carga datos demo para ver el flujo.</p>}
          <ul>{shown.map((a) => (
            <li key={a.id} className={a.id === current?.id ? 'sel' : ''}>
              <button onClick={() => setSel(a.id)}>
                <strong>{a.proposal.resource_id}</strong>
                <span>{a.proposal.action.replace(/_/g, ' ')}</span>
                <em className="good">{a.proposal.monthly_savings > 0 ? money(a.proposal.monthly_savings) : ''}</em>
                <span className={`badge st-${a.status}`}>{a.status.replace('_', ' ')}</span>
              </button>
            </li>))}</ul>
        </section>
        {current && <Detail key={current.id + current.status + current.approvals.length} a={current} s={s} onChange={refresh} />}
      </div>
    </div>
  );
}

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: string }) =>
  <div className="card stat"><span>{label}</span><b className={tone}>{value}</b></div>;
