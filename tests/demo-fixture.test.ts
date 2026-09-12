/**
 * Valores esperados del negocio de la demo (10 obligaciones), recalculados
 * de forma independiente del oraculo. Coinciden con el oraculo por diseno:
 * las obligaciones adicionales netean cero en los dias D1, D4 y D6.
 */
import { describe, expect, it } from 'vitest';
import { computeEngineResult } from '@/domain/engine';
import { pesos } from '@/domain/money';
import {
  DEFAULT_DEMO_TODAY,
  day,
  demoScenario,
  withDelayedInvoiceA,
  withExclusions,
} from '@fixtures/index';

const T = DEFAULT_DEMO_TODAY;
const D = (n: number) => day(T, n);

const closings = (result: ReturnType<typeof computeEngineResult>) =>
  result.baseline.dailyBalances.map((d) => d.closingCents);

describe('negocio de la demo: semana inicialmente viable', () => {
  const input = demoScenario(T);
  const result = computeEngineResult(input);

  it('tiene diez obligaciones', () => {
    expect(input.obligations).toHaveLength(10);
  });

  it('saldos de cierre D0..D6 = 20,000 / 20,000 / 26,000 / 11,000 / 11,000 / 11,000 / 11,000', () => {
    expect(closings(result)).toEqual([
      pesos(20_000),
      pesos(20_000),
      pesos(26_000),
      pesos(11_000),
      pesos(11_000),
      pesos(11_000),
      pesos(11_000),
    ]);
  });

  it('es factible y no propone planes', () => {
    expect(result.baseline.feasible).toBe(true);
    expect(result.plans).toHaveLength(0);
    expect(result.infeasibility).toBeNull();
  });

  it('lista dos compromisos esenciales dentro del horizonte', () => {
    const esenciales = result.constraints.filter((c) => c.kind === 'essential_obligation');
    expect(esenciales.map((c) => c.obligationId).sort()).toEqual(['bank-fees', 'payroll', 'rent']);
  });
});

describe('negocio de la demo: la factura F-1042 se retrasa', () => {
  const delayed = withDelayedInvoiceA(demoScenario(T));
  const result = computeEngineResult(delayed);

  it('saldos de cierre D0..D6 = 20,000 / 20,000 / 8,000 / -7,000 / -7,000 / -7,000 / -7,000', () => {
    expect(closings(result)).toEqual([
      pesos(20_000),
      pesos(20_000),
      pesos(8_000),
      pesos(-7_000),
      pesos(-7_000),
      pesos(-7_000),
      pesos(-7_000),
    ]);
  });

  it('el faltante es 10,000 y el dia critico es D3', () => {
    expect(result.baseline.shortfallCents).toBe(pesos(10_000));
    expect(result.baseline.minimumClosingDate).toBe(D(3));
  });

  it('propone las dos alternativas condicionadas, sin planes redundantes', () => {
    expect(result.plans.map((p) => p.id)).toEqual(['plan:S1', 'plan:C1']);
    // El aplazamiento a Nube Fria existe pero no aporta un plan propio: solo
    // aparece como accion disponible, nunca como plan que resuelva por si mismo.
    expect(result.plans.some((p) => p.actions.some((a) => a.optionId === 'action:D'))).toBe(false);
  });

  it('plan S deja D3 en 3,000 y plan C deja D3 en 3,780', () => {
    const s = result.plans.find((p) => p.id === 'plan:S1')!;
    const c = result.plans.find((p) => p.id === 'plan:C1')!;
    expect(s.dailyBalances.find((d) => d.date === D(3))!.closingCents).toBe(pesos(3_000));
    expect(c.dailyBalances.find((d) => d.date === D(3))!.closingCents).toBe(pesos(3_780));
    expect(s.costCents).toBe(0);
    expect(c.costCents).toBe(pesos(220));
  });

  it('los dos planes siguen siendo condicionados', () => {
    for (const plan of result.plans) {
      expect(plan.conditional).toBe(true);
      // Redacción nueva del mismo aviso obligatorio: «liquidez disponible»
      // pasó a «dinero disponible», sin perder la advertencia.
      expect(plan.pendingConditions[0].text).toMatch(/no es dinero disponible/i);
    }
  });
});

describe('negocio de la demo: recorrido de rechazos', () => {
  const delayed = withDelayedInvoiceA(demoScenario(T));

  it('rechazar el aplazamiento del proveedor deja el adelanto de cobro', () => {
    const result = computeEngineResult(withExclusions(delayed, ['action:S']));
    expect(result.plans.map((p) => p.id)).toEqual(['plan:C1']);
  });

  it('rechazar tambien el adelanto deja sin solucion con faltante 10,000', () => {
    const result = computeEngineResult(withExclusions(delayed, ['action:S', 'action:C']));
    expect(result.plans).toHaveLength(0);
    expect(result.infeasibility!.reason).toBe('no_solution');
    expect(result.infeasibility!.minimalResidualShortfallCents).toBe(pesos(10_000));
  });

  it('el cobro adelantado queda marcado como excluido en el detalle de cobros', () => {
    const result = computeEngineResult(withExclusions(delayed, ['action:C']));
    const receivable = result.receivables.find((r) => r.obligationId === 'inv-b')!;
    expect(receivable.advanceExcluded).toBe(true);
  });
});
