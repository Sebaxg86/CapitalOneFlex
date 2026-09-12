/**
 * Casos limite del motor: horizonte, esenciales, comisiones explicitas,
 * aplazamiento completo, acciones incompatibles y tope de busqueda.
 */
import { describe, expect, it } from 'vitest';
import { COMBINATION_LIMIT, computeEngineResult, EngineError } from '@/domain/engine';
import { pesos } from '@/domain/money';
import { addDays } from '@/domain/dates';
import type { Obligation, ScenarioInput } from '@/domain/types';
import { DEFAULT_DEMO_TODAY, day } from '@fixtures/index';

const T = DEFAULT_DEMO_TODAY;
const D = (n: number) => day(T, n);
const BIZ = 'biz:test';

function scenario(obligations: Obligation[], overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    businessId: BIZ,
    scenarioId: 'scenario:test',
    baseRevision: 0,
    openingBalanceCents: pesos(10_000),
    minimumCashCents: pesos(1_000),
    horizonStart: T,
    horizonDays: 7,
    obligations,
    excludedActionIds: [],
    demoToday: T,
    ...overrides,
  };
}

function outflow(id: string, amount: number, n: number, extra: Partial<Obligation> = {}): Obligation {
  return {
    id,
    businessId: BIZ,
    direction: 'outflow',
    amountCents: pesos(amount),
    date: D(n),
    counterparty: 'Proveedor ' + id,
    concept: 'Pago ' + id,
    essential: false,
    settled: false,
    actions: [],
    ...extra,
  };
}

function inflow(id: string, amount: number, n: number, extra: Partial<Obligation> = {}): Obligation {
  return {
    id,
    businessId: BIZ,
    direction: 'inflow',
    amountCents: pesos(amount),
    date: D(n),
    counterparty: 'Cliente ' + id,
    concept: 'Factura ' + id,
    essential: false,
    settled: false,
    actions: [],
    ...extra,
  };
}

describe('horizonte y pendientes', () => {
  it('los movimientos liquidados no vuelven a contar', () => {
    const result = computeEngineResult(
      scenario([outflow('p1', 5_000, 1, { settled: true }), outflow('p2', 1_000, 2)]),
    );
    expect(result.baseline.dailyBalances[1].outflowCents).toBe(0);
    expect(result.baseline.dailyBalances[2].outflowCents).toBe(pesos(1_000));
  });

  it('aplazar fuera del horizonte no elimina la obligacion', () => {
    const result = computeEngineResult(
      scenario([
        outflow('p1', 9_500, 2, {
          actions: [
            {
              id: 'action:defer',
              obligationId: 'p1',
              kind: 'defer',
              approval: 'confirmed',
              label: 'Aplazar p1',
              counterparty: 'Proveedor p1',
              variants: [{ id: 'V1', toDate: D(10), feeCents: pesos(100) }],
            },
          ],
        }),
      ]),
    );
    const plan = result.plans.find((p) => p.id === 'plan:V1');
    expect(plan).toBeDefined();
    const moved = plan!.pendingOutsideHorizon[0];
    expect(moved.date).toBe(D(10));
    // El importe aplazado incluye la comision explicita.
    expect(moved.amountCents).toBe(pesos(9_600));
    expect(plan!.costCents).toBe(pesos(100));
  });

  it('rechaza flujos anteriores al inicio del horizonte', () => {
    const past = addDays(T, -1);
    expect(() =>
      computeEngineResult(scenario([{ ...outflow('p1', 100, 0), date: past }])),
    ).toThrow(EngineError);
  });
});

describe('esenciales y caja minima', () => {
  it('una obligacion esencial no admite acciones registradas', () => {
    expect(() =>
      computeEngineResult(
        scenario([
          outflow('nom', 1_000, 2, {
            essential: true,
            actions: [
              {
                id: 'action:x',
                obligationId: 'nom',
                kind: 'defer',
                approval: 'confirmed',
                label: 'Aplazar nomina',
                counterparty: 'Equipo',
                variants: [{ id: 'X1', toDate: D(5), feeCents: 0 }],
              },
            ],
          }),
        ]),
      ),
    ).toThrow(EngineError);
  });

  it('la caja minima no puede ser negativa', () => {
    expect(() => computeEngineResult(scenario([], { minimumCashCents: -1 }))).toThrow(EngineError);
  });

  it('el faltante usa el saldo minimo del horizonte, no el ultimo dia', () => {
    const result = computeEngineResult(
      scenario([outflow('p1', 9_500, 2), inflow('c1', 9_500, 5)]),
    );
    expect(result.baseline.minimumClosingDate).toBe(D(2));
    expect(result.baseline.shortfallCents).toBe(pesos(500));
  });
});

describe('acciones incompatibles sobre la misma obligacion', () => {
  it('nunca combina dos acciones del mismo compromiso', () => {
    const result = computeEngineResult(
      scenario(
        [
          outflow('p1', 12_000, 2, {
            actions: [
              {
                id: 'action:defer',
                obligationId: 'p1',
                kind: 'defer',
                approval: 'confirmed',
                label: 'Aplazar p1',
                counterparty: 'Proveedor p1',
                variants: [{ id: 'V1', toDate: D(9), feeCents: 0 }],
              },
              {
                id: 'action:split',
                obligationId: 'p1',
                kind: 'split',
                approval: 'confirmed',
                label: 'Dividir p1',
                counterparty: 'Proveedor p1',
                variants: [
                  {
                    id: 'V2',
                    parts: [
                      { date: D(2), amountCents: pesos(2_000) },
                      { date: D(9), amountCents: pesos(10_000) },
                    ],
                    feeCents: 0,
                  },
                ],
              },
            ],
          }),
        ],
        { openingBalanceCents: pesos(5_000) },
      ),
    );
    for (const plan of result.plans) {
      const obligations = plan.actions.map((a) => a.obligationId);
      expect(new Set(obligations).size).toBe(obligations.length);
    }
    expect(result.plans.length).toBeGreaterThan(0);
  });
});

describe('tope de busqueda', () => {
  function wideScenario(obligationCount: number, variantsPerObligation: number): ScenarioInput {
    const obligations: Obligation[] = [];
    for (let i = 0; i < obligationCount; i += 1) {
      const id = 'p' + i;
      obligations.push(
        outflow(id, 4_000, 2, {
          actions: [
            {
              id: 'action:' + id,
              obligationId: id,
              kind: 'defer',
              approval: 'confirmed',
              label: 'Aplazar ' + id,
              counterparty: 'Proveedor ' + id,
              variants: Array.from({ length: variantsPerObligation }, (_, v) => ({
                id: 'V-' + id + '-' + v,
                toDate: D(3 + (v % 3)),
                feeCents: 0,
              })),
            },
          ],
        }),
      );
    }
    return scenario(obligations, { openingBalanceCents: pesos(1_000) });
  }

  it('responde "escenario demasiado amplio", no "sin solucion"', () => {
    // 9 obligaciones x (3 variantes + 1 sin accion) = 262144 combinaciones.
    const result = computeEngineResult(wideScenario(9, 3));
    expect(result.infeasibility).not.toBeNull();
    expect(result.infeasibility!.reason).toBe('search_too_wide');
    expect(result.diagnostics.truncated).toBe(true);
    expect(result.plans).toHaveLength(0);
  });

  it('un escenario por debajo del tope si se enumera', () => {
    // 4 obligaciones x 4 = 256 combinaciones.
    const result = computeEngineResult(wideScenario(4, 3));
    expect(result.diagnostics.evaluatedCombinations).toBeLessThanOrEqual(COMBINATION_LIMIT);
    expect(result.diagnostics.truncated).toBe(false);
    expect(result.infeasibility?.reason).not.toBe('search_too_wide');
  });
});

describe('hechos y referencias', () => {
  it('todas las referencias de planes, riesgos y restricciones estan en refs', () => {
    const result = computeEngineResult(
      scenario([
        outflow('nom', 9_500, 2, { essential: true }),
        inflow('c1', 500, 5, {
          actions: [
            {
              id: 'action:adv',
              obligationId: 'c1',
              kind: 'advance_receivable',
              approval: 'requires_agreement',
              label: 'Adelantar c1',
              counterparty: 'Cliente c1',
              variants: [{ id: 'A1', toDate: D(1), discountBasisPoints: 100 }],
            },
          ],
        }),
      ]),
    );
    const refs = new Set(result.refs);
    for (const plan of result.plans) expect(refs.has(plan.id)).toBe(true);
    for (const c of result.constraints) expect(refs.has(c.id)).toBe(true);
    for (const r of result.risks) expect(refs.has(r.id)).toBe(true);
    for (const f of Object.keys(result.facts)) expect(refs.has(f)).toBe(true);
  });

  it('el faltante total esta disponible como hecho resoluble', () => {
    const result = computeEngineResult(scenario([outflow('p1', 9_500, 2)]));
    expect(result.facts['fact:shortfall_total']).toBeDefined();
    expect(result.facts['fact:shortfall_total'].kind).toBe('money');
  });
});
