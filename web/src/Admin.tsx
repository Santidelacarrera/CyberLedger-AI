import { useEffect, useState } from 'react';
import { api } from './api';
import { auditQuery, EVENT_TYPES, formatDuration, pageLabel, severityOf } from './auditUtils';
import type { AuditFilters, AuditPage, Policy, Session, Severity, SummaryResponse } from './types';

const ACTIONS = ['patch_in_place', 'patch_and_rightsize', 'replace_cheaper', 'destroy', 'revoke_identity', 'throttle_llm'];

const PAGE = 25;

export function AuditView({ s }: { s: Session }) {
  const [page, setPage] = useState<AuditPage>();
  const [filters, setFilters] = useState<AuditFilters>({});
  const [offset, setOffset] = useState(0);
  const [chain, setChain] = useState<{ ok: boolean; brokenAt?: number }>();
  const [err, setErr] = useState<string>();
  const load = (f = filters, o = offset) =>
    api.audit(s, auditQuery(f, PAGE, o)).then((p) => { setPage(p); setErr(undefined); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); api.verifyAudit(s).then(setChain).catch(() => undefined); }, [s]);
  const apply = (f: AuditFilters) => { setFilters(f); setOffset(0); load(f, 0); };
  const go = (o: number) => { setOffset(o); load(filters, o); };
  const download = async () => {
    try {
      const url = URL.createObjectURL(await api.exportAudit(s));
      const a = document.createElement('a'); a.href = url; a.download = 'cyberledger-audit.ndjson'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <>
      <SummaryCard s={s} />
      <section className="card">
        <h2>Registro de eventos
          {chain && <span className={`badge ${chain.ok ? 'st-DONE' : 'st-FAILED'}`}>{chain.ok ? 'Cadena íntegra' : `Manipulada en #${chain.brokenAt}`}</span>}
        </h2>
        <form className="filters" onSubmit={(e) => { e.preventDefault(); apply(filters); }}>
          <select aria-label="Evento" value={filters.event ?? ''} onChange={(e) => apply({ ...filters, event: e.target.value })}>
            <option value="">Todos los eventos</option>{EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          <select aria-label="Severidad" value={filters.severity ?? ''} onChange={(e) => apply({ ...filters, severity: e.target.value as Severity | '' })}>
            <option value="">Toda severidad</option><option value="critical">crítico</option><option value="warning">aviso</option>
            <option value="notice">aviso menor</option><option value="info">info</option></select>
          <input aria-label="Actor" placeholder="Actor" value={filters.actor ?? ''} onChange={(e) => setFilters({ ...filters, actor: e.target.value })} />
          <input aria-label="Desde" type="date" value={filters.from ?? ''} onChange={(e) => apply({ ...filters, from: e.target.value })} />
          <input aria-label="Hasta" type="date" value={filters.to ?? ''} onChange={(e) => apply({ ...filters, to: e.target.value })} />
          <button>Filtrar</button>
          <button type="button" onClick={download}>Exportar NDJSON</button>
        </form>
        {err && <p className="error">{err} (requiere rol admin)</p>}
        <table className="table"><thead><tr><th>#</th><th>Fecha</th><th>Actor</th><th>Evento</th><th>Sujeto</th></tr></thead>
          <tbody>{page?.items.map((r) => (
            <tr key={r.seq}><td>{r.seq}</td><td>{new Date(r.at).toLocaleString()}</td><td>{r.actor}</td>
              <td><span className={`sev sev-${severityOf(r.event)}`}>{r.event}</span></td><td>{r.subject?.slice(0, 8)}</td></tr>))}</tbody></table>
        {page && <footer className="pager">
          <button disabled={offset === 0} onClick={() => go(Math.max(0, offset - PAGE))}>← Anterior</button>
          <span className="muted">{pageLabel(page.offset, page.items.length, page.total)}</span>
          <button disabled={offset + PAGE >= page.total} onClick={() => go(offset + PAGE)}>Siguiente →</button>
        </footer>}
      </section>
    </>
  );
}

const RISK_LABEL = { low: 'Riesgo bajo', medium: 'Riesgo medio', high: 'Riesgo alto' } as const;

function SummaryCard({ s }: { s: Session }) {
  const [res, setRes] = useState<SummaryResponse>();
  const [explain, setExplain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const run = async (fn: () => Promise<SummaryResponse>) => {
    setBusy(true); setErr(undefined);
    try { setRes(await fn()); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const sum = res?.summary;
  return (
    <section className="card summary">
      <h2>Resumen IA del registro
        {sum && <span className={`badge risk-${sum.risk_level}`}>{RISK_LABEL[sum.risk_level]}</span>}
      </h2>
      <div className="row-actions">
        <button className="primary" disabled={busy} onClick={() => run(() => api.auditSummary(s, explain))}>Resumir registro real</button>
        <button disabled={busy} onClick={() => run(() => api.auditSummarySynthetic(s, 'normal', explain))}>Datos sintéticos: normal</button>
        <button disabled={busy} onClick={() => run(() => api.auditSummarySynthetic(s, 'incident', explain))}>Datos sintéticos: incidente</button>
        <label className="muted"><input type="checkbox" checked={explain} onChange={(e) => setExplain(e.target.checked)} /> Redactar con LLM local</label>
      </div>
      {err && <p className="error">{err} (requiere rol admin)</p>}
      {sum && res && <>
        <p className="why">{sum.narrative}</p>
        <p className="muted">{res.source === 'synthetic' ? `Datos sintéticos (${res.scenario}) · ` : ''}{res.eventsAnalyzed} eventos
          {res.truncated ? ' (truncado a los más recientes)' : ''} · texto: {sum.narrative_source === 'llm' ? 'LLM local (cifras verificadas)' : 'reglas'}</p>
        <dl className="kpis">
          <div><dt>Propuestas</dt><dd>{sum.actions.created}</dd></div>
          <div><dt>Aprobaciones</dt><dd>{sum.actions.approved}</dd></div>
          <div><dt>Fallidas / revertidas</dt><dd className={sum.actions.failed + sum.actions.rolled_back ? 'bad' : ''}>{sum.actions.failed} / {sum.actions.rolled_back}</dd></div>
          <div><dt>Mediana a decisión</dt><dd>{formatDuration(sum.median_decision_seconds)}</dd></div>
        </dl>
        {sum.anomalies.length > 0 && <>
          <h3>Anomalías</h3>
          <ul className="anoms">{sum.anomalies.map((a) => (
            <li key={a.code} className={`an-${a.severity}`}><b>{a.code}</b> <span>{a.message}</span></li>))}</ul></>}
      </>}
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
