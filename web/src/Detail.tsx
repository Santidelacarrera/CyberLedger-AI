import { useState } from 'react';
import { api } from './api';
import { money } from './matrix';
import type { ActionRecord, Session } from './types';

const LABEL: Record<string, string> = {
  patch_in_place: 'Parchear', patch_and_rightsize: 'Parchear + redimensionar', replace_cheaper: 'Reemplazar por instancia más barata',
  destroy: 'Destruir recurso', revoke_identity: 'Revocar identidad/secreto', throttle_llm: 'Limitar gasto LLM y rotar clave',
};

export function Detail({ a, s, onChange }: { a: ActionRecord; s: Session; onChange: () => void }) {
  const [plan, setPlan] = useState<string>();
  const [err, setErr] = useState<string>();
  const run = async (fn: () => Promise<unknown>) => { setErr(undefined); try { await fn(); onChange(); } catch (e) { setErr((e as Error).message); } };
  const p = a.proposal;
  const pending = a.status === 'PENDING_APPROVAL';
  const missing = a.requiredRoles.filter((r) => !a.approvals.some((x) => x.role === r || x.role === 'admin'));
  return (
    <section className="card detail">
      <header>
        <h2>{p.resource_id}</h2>
        <span className={`badge st-${a.status}`}>{a.status}</span>
      </header>
      <p className="action">{LABEL[p.action] ?? p.action}</p>
      <dl className="kpis">
        <div><dt>Riesgo seguridad</dt><dd>{(p.security_risk * 100).toFixed(0)}%</dd></div>
        <div><dt>Desperdicio</dt><dd>{(p.financial_waste * 100).toFixed(0)}%</dd></div>
        <div><dt>Ahorro / mes</dt><dd className="good">{money(p.monthly_savings)}</dd></div>
        <div><dt>Payback</dt><dd>{p.payback_months == null ? '—' : `${p.payback_months} m`}</dd></div>
      </dl>
      <p className="why">{p.llm_summary ?? p.rationale}</p>
      <h3>Dry-run (diff)</h3>
      <pre className="diff">{(plan ?? p.terraform_diff).split('\n').map((l, i) => (
        <span key={i} className={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}>{l + '\n'}</span>))}</pre>
      <h3>Aprobaciones</h3>
      <ul className="approvals">
        {a.requiredRoles.map((r) => {
          const done = a.approvals.find((x) => x.role === r || (x.role === 'admin' && !missing.includes(r)));
          return <li key={r} className={done ? 'ok' : ''}>{done ? '✓' : '○'} {r.toUpperCase()} {done ? `— ${done.user}` : 'pendiente'}</li>;
        })}
      </ul>
      {a.error && <p className="error">Error: {a.error}</p>}
      {err && <p className="error">{err}</p>}
      <footer>
        <button onClick={() => run(async () => setPlan((await api.dryRun(s, a.id)).plan))}>Simular</button>
        {pending && <>
          <button className="primary" onClick={() => run(() => api.approve(s, a.id))}>Aprobar</button>
          <button className="danger" onClick={() => run(() => api.reject(s, a.id))}>Rechazar</button>
        </>}
      </footer>
    </section>
  );
}
