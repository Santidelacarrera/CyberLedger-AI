export interface Point { x: number; y: number; r: number }

/** Risk/Cost matrix geometry: x = financial waste (0-1), y = security risk (0-1, top = riskier),
 *  radius grows with log of monthly savings so one outlier does not hide the rest. */
export function toPoint(p: { financial_waste: number; security_risk: number; monthly_savings: number },
                        w: number, h: number, pad = 36, maxSavings = 1): Point {
  const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
  return {
    x: pad + clamp(p.financial_waste) * (w - 2 * pad),
    y: h - pad - clamp(p.security_risk) * (h - 2 * pad),
    r: 6 + 14 * (Math.log1p(Math.max(p.monthly_savings, 0)) / Math.log1p(Math.max(maxSavings, 1))),
  };
}

export type Quadrant = 'Parchear y redimensionar' | 'Parchear' | 'Reducir coste' | 'Vigilar';
export function quadrant(p: { financial_waste: number; security_risk: number }): Quadrant {
  const hiRisk = p.security_risk >= 0.5, hiWaste = p.financial_waste >= 0.5;
  return hiRisk && hiWaste ? 'Parchear y redimensionar' : hiRisk ? 'Parchear' : hiWaste ? 'Reducir coste' : 'Vigilar';
}

export const money = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
