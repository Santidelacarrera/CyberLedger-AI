import { expect, test } from 'vitest';
import { quadrant, toPoint } from './matrix';

test('maps risk to the top and waste to the right', () => {
  const hi = toPoint({ financial_waste: 1, security_risk: 1, monthly_savings: 0 }, 400, 300);
  const lo = toPoint({ financial_waste: 0, security_risk: 0, monthly_savings: 0 }, 400, 300);
  expect(hi.x).toBeGreaterThan(lo.x); expect(hi.y).toBeLessThan(lo.y);
});
test('clamps out-of-range and scales radius with savings', () => {
  const a = toPoint({ financial_waste: 5, security_risk: -1, monthly_savings: 0 }, 400, 300);
  expect(a.x).toBe(364); expect(a.y).toBe(264);
  expect(toPoint({ financial_waste: 0, security_risk: 0, monthly_savings: 900 }, 400, 300, 36, 900).r).toBeGreaterThan(a.r);
});
test('quadrants', () => {
  expect(quadrant({ financial_waste: 0.9, security_risk: 0.9 })).toBe('Parchear y redimensionar');
  expect(quadrant({ financial_waste: 0.1, security_risk: 0.1 })).toBe('Vigilar');
});
