import { quadrant, toPoint } from './matrix';
import type { ActionRecord } from './types';

const W = 520, H = 360;

export function Matrix({ actions, selected, onSelect }: { actions: ActionRecord[]; selected?: string; onSelect: (id: string) => void }) {
  const max = Math.max(1, ...actions.map((a) => a.proposal.monthly_savings));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="matrix" role="img" aria-label="Matriz riesgo de seguridad contra desperdicio de coste">
      <rect x="36" y="36" width={(W - 72) / 2} height={(H - 72) / 2} className="q q-tl" />
      <rect x={W / 2} y="36" width={(W - 72) / 2} height={(H - 72) / 2} className="q q-tr" />
      <text x="44" y="52" className="qlabel">Parchear</text>
      <text x={W - 44} y="52" className="qlabel" textAnchor="end">Parchear y redimensionar</text>
      <text x="44" y={H - 44} className="qlabel">Vigilar</text>
      <text x={W - 44} y={H - 44} className="qlabel" textAnchor="end">Reducir coste</text>
      <line x1="36" y1={H - 36} x2={W - 36} y2={H - 36} className="axis" />
      <line x1="36" y1="36" x2="36" y2={H - 36} className="axis" />
      <text x={W / 2} y={H - 8} textAnchor="middle" className="axis-label">Desperdicio de coste →</text>
      <text transform={`translate(12 ${H / 2}) rotate(-90)`} textAnchor="middle" className="axis-label">Riesgo de seguridad →</text>
      {actions.map((a) => {
        const p = toPoint(a.proposal, W, H, 36, max);
        return (
          <g key={a.id} onClick={() => onSelect(a.id)} className={`dot ${a.id === selected ? 'sel' : ''}`} tabIndex={0}
             onKeyDown={(e) => e.key === 'Enter' && onSelect(a.id)} role="button" aria-label={`${a.proposal.resource_id}, ${quadrant(a.proposal)}`}>
            <circle cx={p.x} cy={p.y} r={p.r} />
            <title>{a.proposal.resource_id}</title>
          </g>
        );
      })}
    </svg>
  );
}
