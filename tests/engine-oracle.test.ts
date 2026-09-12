/**
 * Oraculo numerico congelado de ARQUITECTURA.md seccion 3.
 * Si alguno de estos numeros cambia, el motor dejo de cumplir la especificacion.
 */
import { describe, expect, it } from 'vitest';
import { computeEngineResult } from '@/domain/engine';
import { pesos } from '@/domain/money';
import {
  DEFAULT_DEMO_TODAY,
  day,
  oracleScenario,
  withDelayedInvoiceA,
  withExclusions,
} from '@fixtures/index';

const T = DEFAULT_DEMO_TODAY;
const D = (n: number) => day(T, n);

function closingOn(result: ReturnType<typeof computeEngineResult>, n: number): number {
  const entry = result.baseline.dailyBalances.find((d) => d.date === D(n));
  if (!entry) throw new Error('dia fuera del horizonte: D' + n);
  return entry.closingCents;
}

describe('oraculo: escenario base', () => {
  const result = computeEngineResult(oracleScenario(T));

  it('cierra D2 en 26,000 y D3 en 11,000', () => {
    expect(closingOn(result, 2)).toBe(pesos(26_000));
    expect(closingOn(result, 3)).toBe(pesos(11_000));
  });

  it('es factible y no genera faltante', () => {
    expect(result.baseline.feasible).toBe(true);
    expect(result.baseline.shortfallCents).toBe(0);
    expect(result.infeasibility).toBeNull();
    expect(result.plans).toHaveLength(0);
    expect(result.risks).toHaveLength(0);
  });

  it('muestra el cobro B como pendiente fuera del horizonte', () => {
    const pending = result.pendingOutsideHorizon.find((p) => p.obligationId === 'inv-b');
    expect(pending).toBeDefined();
    expect(pending!.date).toBe(D(8));
    expect(pending!.amountCents).toBe(pesos(11_000));
    expect(pending!.movedByPlan).toBe(false);
  });

  it('el horizonte cubre exactamente siete dias', () => {
    expect(result.horizon.days).toHaveLength(7);
    expect(result.horizon.start).toBe(D(0));
    expect(result.horizon.end).toBe(D(6));
  });
});

describe('oraculo: la factura A se retrasa a D8', () => {
  const delayed = withDelayedInvoiceA(oracleScenario(T));
  const result = computeEngineResult(delayed);

  it('cierra D2 en 8,000 y D3 en -7,000', () => {
    expect(closingOn(result, 2)).toBe(pesos(8_000));
    expect(closingOn(result, 3)).toBe(pesos(-7_000));
  });

  it('el faltante frente a la caja minima es 10,000', () => {
    expect(result.baseline.shortfallCents).toBe(pesos(10_000));
    expect(result.baseline.feasible).toBe(false);
    expect(result.baseline.minimumClosingDate).toBe(D(3));
  });

  it('senala el riesgo sobre la nomina', () => {
    expect(result.risks.map((r) => r.id)).toContain('risk:payroll');
  });

  it('ofrece exactamente las dos alternativas condicionadas S y C', () => {
    expect(result.plans.map((p) => p.id)).toEqual(['plan:S1', 'plan:C1']);
    expect(result.infeasibility).toBeNull();
    for (const plan of result.plans) {
      expect(plan.conditional).toBe(true);
      expect(plan.pendingConditions).toHaveLength(1);
    }
  });

  it('accion S: dividir el pago deja D3 en 3,000 sin comision', () => {
    const plan = result.plans.find((p) => p.id === 'plan:S1')!;
    const d3 = plan.dailyBalances.find((d) => d.date === D(3))!;
    expect(d3.closingCents).toBe(pesos(3_000));
    expect(plan.costCents).toBe(0);
    expect(plan.modifiedObligationCount).toBe(1);
    const moved = plan.pendingOutsideHorizon.find(
      (p) => p.obligationId === 'sup-cloud' && p.date === D(8),
    );
    expect(moved).toBeDefined();
    expect(moved!.amountCents).toBe(pesos(10_000));
    expect(moved!.movedByPlan).toBe(true);
  });

  it('accion C: adelantar el cobro B deja D3 en 3,780 con costo 220', () => {
    const plan = result.plans.find((p) => p.id === 'plan:C1')!;
    const d3 = plan.dailyBalances.find((d) => d.date === D(3))!;
    expect(d3.closingCents).toBe(pesos(3_780));
    expect(plan.costCents).toBe(pesos(220));
    expect(plan.modifiedObligationCount).toBe(1);
  });

  it('los planes se ordenan por costo ascendente', () => {
    const costs = result.plans.map((p) => p.costCents);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });

  it('el neto del adelanto es 10,780 en el detalle de cobros', () => {
    const receivable = result.receivables.find((r) => r.obligationId === 'inv-b')!;
    expect(receivable.advanceNetCents).toBe(pesos(10_780));
    expect(receivable.advanceCostCents).toBe(pesos(220));
    expect(receivable.advanceToDate).toBe(D(2));
  });
});

describe('oraculo: rechazos', () => {
  const delayed = withDelayedInvoiceA(oracleScenario(T));

  it('rechazar S deja C como unica alternativa', () => {
    const result = computeEngineResult(withExclusions(delayed, ['action:S']));
    expect(result.plans.map((p) => p.id)).toEqual(['plan:C1']);
    expect(result.infeasibility).toBeNull();
    expect(result.constraints.map((c) => c.id)).toContain('constraint:excluded:action:S');
  });

  it('rechazar C deja S como unica alternativa', () => {
    const result = computeEngineResult(withExclusions(delayed, ['action:C']));
    expect(result.plans.map((p) => p.id)).toEqual(['plan:S1']);
  });

  it('rechazar ambas deja sin solucion con faltante residual 10,000', () => {
    const result = computeEngineResult(withExclusions(delayed, ['action:S', 'action:C']));
    expect(result.plans).toHaveLength(0);
    expect(result.infeasibility).not.toBeNull();
    expect(result.infeasibility!.reason).toBe('no_solution');
    expect(result.infeasibility!.minimalResidualShortfallCents).toBe(pesos(10_000));
    expect(result.infeasibility!.affectedConstraintIds).toContain('constraint:payroll');
    expect(result.infeasibility!.affectedConstraintIds).toContain('constraint:minimum_cash');
  });

  it('sin solucion se refiere solo a las acciones enumeradas', () => {
    const result = computeEngineResult(withExclusions(delayed, ['action:S', 'action:C']));
    expect(result.infeasibility!.scopeNote).toMatch(/acciones registradas/i);
  });
});

describe('oraculo: determinismo', () => {
  it('la misma entrada produce el mismo identificador de resultado', () => {
    const a = computeEngineResult(withDelayedInvoiceA(oracleScenario(T)));
    const b = computeEngineResult(withDelayedInvoiceA(oracleScenario(T)));
    expect(a.id).toBe(b.id);
    expect(a.inputVersion).toBe(b.inputVersion);
  });

  it('un escenario distinto produce un identificador distinto', () => {
    const a = computeEngineResult(withDelayedInvoiceA(oracleScenario(T)));
    const b = computeEngineResult(withExclusions(withDelayedInvoiceA(oracleScenario(T)), ['action:S']));
    expect(a.id).not.toBe(b.id);
  });
});
