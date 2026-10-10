import { useEffect, useState } from 'react';
import { api } from './api';
import type { AuditEntry, Policy, Session } from './types';

const ACTIONS = ['patch_in_place', 'patch_and_rightsize', 'replace_cheaper', 'destroy', 'revoke_identity', 'throttle_llm'];

export function AuditView({ s }: { s: Session }) {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [chain, setChain] = useState<{ ok: boolean; brokenAt?: number }>();
  const [err, setErr] = useState<string>();
  useEffect(() => {
    Promise.all([api.audit(s), api.verifyAudit(s)]).then(([a, v]) => { setRows(a.slice().reverse()); setChain(v); }).catch((e) => setErr(e.message));
  }, [s]);
  return (
    <section className="card">
      <h2>Auditoría
        {chain && <span className={`badge ${chain.ok ? 'st-DONE' : 'st-FAILED'}`}>{chain.ok ? 'Cadena íntegra' : `Manipulada en #${chain.brokenAt}`}</span>}
      </h2>
      {err && <p className="error">{err} (requiere rol admin)</p>}
      <table className="table"><thead><tr><th>#</th><th>Fecha</th><th>Actor</th><th>Evento</th><th>Sujeto</th></tr></thead>
        <tbody>{rows.slice(0, 200).map((r) => (
          <tr key={r.seq}><td>{r.seq}</td><td>{new Date(r.at).toLocaleString()}</td><td>{r.actor}</td><td>{r.event}</td><td>{r.subject?.slice(0, 8)}</td></tr>))}</tbody></table>
    </section>
  );
}

export function PolicyView({ s }: { s: Session }) {
  const [p, setP] = useState<Policy>();
  const [dual, setDual] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [thr, setThr] = useState(0.3);
  const [msg, setMsg] = useState<string>();
  const load = () => api.policy(s).then((x) => { setP(x); setDual(x.body.dualControlActions); setBlocked(x.body.blockedActions); setThr(x.body.secopsRiskThreshold); }).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, [s]);
  const toggle = (list: string[], set: (v: string[]) => void, a: string) => set(list.includes(a) ? list.filter((x) => x !== a) : [...list, a]);
  const save = async () => {
    try { const r = await api.publishPolicy(s, { dualControlActions: dual, blockedActions: blocked, secopsRiskThreshold: thr }); setMsg(`Publicada versión ${r.version}`); load(); }
    catch (e) { setMsg((e as Error).message + ' (requiere rol admin)'); }
  };
  return (
    <section className="card policy">
      <h2>Política {p && <span className="muted">v{p.version} · {p.createdBy}</span>}</h2>
      <p className="muted">Las políticas son inmutables: guardar crea una nueva versión.</p>
      <table className="table"><thead><tr><th>Acción</th><th>Control dual</th><th>Bloqueada</th></tr></thead>
        <tbody>{ACTIONS.map((a) => (
          <tr key={a}><td>{a}</td>
            <td><input type="checkbox" checked={dual.includes(a)} onChange={() => toggle(dual, setDual, a)} aria-label={`control dual ${a}`} /></td>
            <td><input type="checkbox" checked={blocked.includes(a)} onChange={() => toggle(blocked, setBlocked, a)} aria-label={`bloquear ${a}`} /></td></tr>))}</tbody></table>
      <label className="row">Umbral de riesgo para exigir SecOps: {thr.toFixed(2)}
        <input type="range" min="0" max="1" step="0.05" value={thr} onChange={(e) => setThr(Number(e.target.value))} /></label>
      <footer><button className="primary" onClick={save}>Publicar nueva versión</button> {msg && <span className="muted">{msg}</span>}</footer>
    </section>
  );
}
