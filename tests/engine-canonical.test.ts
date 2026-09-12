/**
 * El identificador del resultado depende del ESTADO del escenario, no del
 * orden en que llegan sus filas. El mismo escenario reconstruido desde
 * Tiger Data y el que vive en memoria deben producir el mismo resultId.
 */
import { describe, expect, it } from 'vitest';
import { canonicalizeInput, computeEngineResult } from '@/domain/engine';
import type { ScenarioInput } from '@/domain/types';
import { DEFAULT_DEMO_TODAY, demoScenario, withDelayedInvoiceA } from '@fixtures/index';

const T = DEFAULT_DEMO_TODAY;

/** Devuelve el mismo escenario con las filas en otro orden. */
function barajado(input: ScenarioInput): ScenarioInput {
  return {
    ...input,
    obligations: [...input.obligations].reverse().map((ob) => ({
      ...ob,
      actions: [...ob.actions].reverse().map((a) => ({
        ...a,
        variants: [...a.variants].reverse(),
      })) as typeof ob.actions,
    })),
    excludedActionIds: [...input.excludedActionIds].reverse(),
  };
}

describe('identificador estable del resultado', () => {
  it('el orden de las obligaciones no cambia el resultId', () => {
    const base = demoScenario(T);
    expect(computeEngineResult(base).id).toBe(computeEngineResult(barajado(base)).id);
  });

  it('tampoco lo cambia el orden de acciones o exclusiones', () => {
    const riesgo = withDelayedInvoiceA(demoScenario(T));
    const conExclusiones: ScenarioInput = {
      ...riesgo,
      excludedActionIds: ['action:C', 'action:S'],
    };
    const invertidas: ScenarioInput = {
      ...riesgo,
      excludedActionIds: ['action:S', 'action:C'],
    };
    expect(computeEngineResult(conExclusiones).id).toBe(computeEngineResult(invertidas).id);
  });

  it('un cambio real de estado si cambia el resultId', () => {
    const base = demoScenario(T);
    expect(computeEngineResult(base).id).not.toBe(
      computeEngineResult(withDelayedInvoiceA(base)).id,
    );
  });

  it('los planes y saldos son identicos venga el escenario como venga', () => {
    const riesgo = withDelayedInvoiceA(demoScenario(T));
    const a = computeEngineResult(riesgo);
    const b = computeEngineResult(barajado(riesgo));
    expect(b.plans.map((p) => p.id)).toEqual(a.plans.map((p) => p.id));
    expect(b.baseline.dailyBalances).toEqual(a.baseline.dailyBalances);
    expect(b.constraints.map((c) => c.id)).toEqual(a.constraints.map((c) => c.id));
    expect(b.refs).toEqual(a.refs);
  });

  it('canonicalizar dos veces no cambia nada', () => {
    const base = demoScenario(T);
    expect(canonicalizeInput(canonicalizeInput(base))).toEqual(canonicalizeInput(base));
  });
});
