/**
 * Pruebas del contrato de composicion: campos desconocidos, referencias
 * inventadas, importes no autorizados, composicion antigua y fallback.
 */
import { describe, expect, it } from 'vitest';
import { computeEngineResult } from '@/domain/engine';
import {
  buildFallbackViewSpec,
  checkModelText,
  enforceServerRules,
  fallbackComposedView,
  resolveFactTokens,
  validateViewSpec,
  type ViewSpec,
} from '@/server/ai/viewspec';
import {
  DEFAULT_DEMO_TODAY,
  demoScenario,
  withDelayedInvoiceA,
  withExclusions,
} from '@fixtures/index';

const T = DEFAULT_DEMO_TODAY;
const riskyResult = computeEngineResult(withDelayedInvoiceA(demoScenario(T)));
const blockedResult = computeEngineResult(
  withExclusions(withDelayedInvoiceA(demoScenario(T)), ['action:S', 'action:C']),
);
const healthyResult = computeEngineResult(demoScenario(T));

function spec(sections: unknown[], resultId = riskyResult.id, focus = 'payroll'): unknown {
  return { schemaVersion: 1, resultId, focus, sections };
}

describe('validacion del esquema de composicion', () => {
  it('acepta una composicion valida', () => {
    const outcome = validateViewSpec(
      spec([
        { type: 'risk_summary', emphasis: 'high', refs: ['risk:payroll'] },
        { type: 'plan_comparison', emphasis: 'normal', refs: ['plan:S1', 'plan:C1'] },
        { type: 'constraints', emphasis: 'normal', refs: ['constraint:payroll'] },
      ]),
      riskyResult,
    );
    expect(outcome.issues).toEqual([]);
    expect(outcome.ok).toBe(true);
  });

  it('rechaza campos desconocidos en una seccion', () => {
    const outcome = validateViewSpec(
      spec([{ type: 'risk_summary', emphasis: 'high', refs: [], html: '<b>hola</b>' }]),
      riskyResult,
    );
    expect(outcome.ok).toBe(false);
  });

  it('rechaza tipos de componente fuera del catalogo', () => {
    const outcome = validateViewSpec(
      spec([{ type: 'iframe_libre', emphasis: 'high', refs: [] }]),
      riskyResult,
    );
    expect(outcome.ok).toBe(false);
  });

  it('rechaza referencias inventadas', () => {
    const outcome = validateViewSpec(
      spec([{ type: 'plan_comparison', emphasis: 'high', refs: ['plan:INVENTADO'] }]),
      riskyResult,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.issues.join(' ')).toMatch(/referencia inexistente/);
  });

  it('rechaza una referencia valida en el componente equivocado', () => {
    const outcome = validateViewSpec(
      spec([{ type: 'receivables', emphasis: 'high', refs: ['plan:S1'] }]),
      riskyResult,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.issues.join(' ')).toMatch(/no aplicable/);
  });

  it('descarta una composicion de un resultado anterior', () => {
    const outcome = validateViewSpec(
      spec([{ type: 'risk_summary', emphasis: 'high', refs: [] }], healthyResult.id),
      riskyResult,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.issues.join(' ')).toMatch(/otro resultado/);
  });

  it('rechaza secciones duplicadas', () => {
    const outcome = validateViewSpec(
      spec([
        { type: 'risk_summary', emphasis: 'high', refs: [] },
        { type: 'risk_summary', emphasis: 'low', refs: [] },
      ]),
      riskyResult,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.issues.join(' ')).toMatch(/duplicada/);
  });

  it('rechaza mas de seis secciones', () => {
    const outcome = validateViewSpec(
      spec([
        { type: 'risk_summary', emphasis: 'high', refs: [] },
        { type: 'cash_calendar', emphasis: 'normal', refs: [] },
        { type: 'receivables', emphasis: 'normal', refs: [] },
        { type: 'plan_comparison', emphasis: 'normal', refs: [] },
        { type: 'constraints', emphasis: 'normal', refs: [] },
        { type: 'history', emphasis: 'low', refs: [] },
        { type: 'risk_summary', emphasis: 'low', refs: [] },
      ]),
      riskyResult,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe('importes no autorizados en textos del modelo', () => {
  const factIds = new Set(Object.keys(riskyResult.facts));

  it('rechaza un importe escrito por el modelo', () => {
    const { issues } = checkModelText('Te faltan $12,400 para la nomina', 'title', factIds);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('acepta un token de hecho del motor', () => {
    const { issues, factIds: used } = checkModelText(
      'Faltan {{fact:shortfall_total}} para sostener la caja minima',
      'note',
      factIds,
    );
    expect(issues).toEqual([]);
    expect(used).toEqual(['fact:shortfall_total']);
  });

  it('rechaza un token de hecho que no pertenece al resultado', () => {
    const { issues } = checkModelText('Faltan {{fact:inventado}}', 'note', factIds);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('rechaza HTML, URLs y lenguaje de consulta', () => {
    expect(checkModelText('<b>riesgo</b>', 'title', factIds).issues.length).toBeGreaterThan(0);
    expect(checkModelText('ver https://ejemplo.mx', 'note', factIds).issues.length).toBeGreaterThan(0);
    expect(checkModelText('select saldo from caja', 'note', factIds).issues.length).toBeGreaterThan(0);
  });

  it('rechaza titulos que afirman una aprobacion inexistente', () => {
    expect(
      checkModelText('Plan aprobado por el proveedor', 'title', factIds).issues.length,
    ).toBeGreaterThan(0);
  });

  it('el servidor resuelve los tokens con el valor del motor', () => {
    const text = resolveFactTokens('Faltante: {{fact:shortfall_total}}', riskyResult);
    expect(text).toContain(riskyResult.facts['fact:shortfall_total'].value);
    expect(text).not.toContain('{{');
  });

  it('una seccion con importe escrito a mano invalida la composicion completa', () => {
    const outcome = validateViewSpec(
      spec([{ type: 'risk_summary', emphasis: 'high', refs: [], note: 'Faltan 10,000 pesos' }]),
      riskyResult,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe('reglas que el servidor impone', () => {
  it('elimina el comparador cuando no hay planes', () => {
    const proposed: ViewSpec = {
      schemaVersion: 1,
      resultId: blockedResult.id,
      focus: 'no_solution',
      sections: [{ type: 'plan_comparison', emphasis: 'high', refs: [] }],
    };
    const { spec: out, enforcement } = enforceServerRules(proposed, blockedResult);
    expect(out.sections.some((s) => s.type === 'plan_comparison')).toBe(false);
    expect(enforcement.join(' ')).toMatch(/comparador/i);
  });

  it('exige bloqueos cuando hay riesgo y no hay planes', () => {
    const proposed: ViewSpec = {
      schemaVersion: 1,
      resultId: blockedResult.id,
      focus: 'no_solution',
      sections: [{ type: 'cash_calendar', emphasis: 'normal', refs: [] }],
    };
    const { spec: out } = enforceServerRules(proposed, blockedResult);
    expect(out.sections.some((s) => s.type === 'constraints')).toBe(true);
    expect(out.sections.some((s) => s.type === 'risk_summary')).toBe(true);
  });

  it('exige resumen de riesgo aunque el modelo lo omita', () => {
    const proposed: ViewSpec = {
      schemaVersion: 1,
      resultId: riskyResult.id,
      focus: 'receivables',
      sections: [{ type: 'receivables', emphasis: 'high', refs: [] }],
    };
    const { spec: out, enforcement } = enforceServerRules(proposed, riskyResult);
    expect(out.sections[0].type).toBe('risk_summary');
    expect(out.sections.some((s) => s.type === 'plan_comparison')).toBe(true);
    expect(enforcement.length).toBeGreaterThan(0);
  });

  it('exige las condiciones de aceptacion cuando hay planes condicionados', () => {
    const proposed: ViewSpec = {
      schemaVersion: 1,
      resultId: riskyResult.id,
      focus: 'payroll',
      sections: [
        { type: 'risk_summary', emphasis: 'high', refs: [] },
        { type: 'plan_comparison', emphasis: 'normal', refs: [] },
      ],
    };
    const { spec: out } = enforceServerRules(proposed, riskyResult);
    expect(out.sections.some((s) => s.type === 'constraints')).toBe(true);
  });

  it('nunca deja mas de seis secciones', () => {
    const proposed: ViewSpec = {
      schemaVersion: 1,
      resultId: riskyResult.id,
      focus: 'overview',
      sections: [
        { type: 'cash_calendar', emphasis: 'normal', refs: [] },
        { type: 'receivables', emphasis: 'normal', refs: [] },
        { type: 'history', emphasis: 'low', refs: [] },
        { type: 'constraints', emphasis: 'normal', refs: [] },
        { type: 'plan_comparison', emphasis: 'normal', refs: [] },
        { type: 'risk_summary', emphasis: 'high', refs: [] },
      ],
    };
    const { spec: out } = enforceServerRules(proposed, riskyResult);
    expect(out.sections.length).toBeLessThanOrEqual(6);
  });
});

describe('vista basica determinista', () => {
  it('el fallback siempre es una composicion valida del resultado vigente', () => {
    for (const result of [riskyResult, blockedResult, healthyResult]) {
      for (const focus of ['overview', 'payroll', 'receivables', 'no_solution', 'history'] as const) {
        const view = fallbackComposedView(result, focus, 'prueba');
        const outcome = validateViewSpec(view.spec, result);
        expect(outcome.issues).toEqual([]);
        expect(view.source).toBe('fallback');
      }
    }
  });

  it('el fallback sin planes no muestra comparador vacio', () => {
    const view = fallbackComposedView(blockedResult, 'no_solution', 'prueba');
    expect(view.spec.sections.some((s) => s.type === 'plan_comparison')).toBe(false);
    expect(view.spec.sections.some((s) => s.type === 'constraints')).toBe(true);
  });

  it('el fallback declara el motivo y no lo atribuye a Gemini', () => {
    const view = fallbackComposedView(riskyResult, 'payroll', 'Gemini no configurado');
    expect(view.fallbackReason).toBe('Gemini no configurado');
    expect(view.source).not.toBe('gemini');
  });
});

describe('tres situaciones producen composiciones distintas', () => {
  it('el orden de secciones cambia segun el foco y el resultado', () => {
    const payroll = buildFallbackViewSpec(riskyResult, 'payroll').sections.map((s) => s.type);
    const receivables = buildFallbackViewSpec(riskyResult, 'receivables').sections.map((s) => s.type);
    const blocked = buildFallbackViewSpec(blockedResult, 'no_solution').sections.map((s) => s.type);

    expect(payroll).not.toEqual(receivables);
    expect(payroll).not.toEqual(blocked);
    expect(receivables).not.toEqual(blocked);
    expect(receivables[0]).toBe('receivables');
    expect(blocked[0]).toBe('constraints');
  });
});
