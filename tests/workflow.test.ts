/**
 * Recorrido vertical sobre el almacen en memoria: mensaje -> propuesta ->
 * confirmacion -> evento y estado persistidos -> motor -> composicion.
 *
 * Cubre ademas: confirmacion duplicada sin duplicar eventos, rechazo que
 * cambia la solucion del motor, caso sin solucion y vuelta al escenario padre.
 * Esto NO sustituye la verificacion con Gemini y Tiger Data reales.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  activateScenario,
  confirmProposal,
  getHistory,
  getWorkspaceState,
  interpret,
  rejectAction,
  resetStoreForTests,
} from '@/server/workspace';
import { pesos } from '@/domain/money';
import { DEMO_MESSAGE, AMBIGUOUS_MESSAGE, DEFAULT_DEMO_TODAY, day } from '@fixtures/index';

const T = DEFAULT_DEMO_TODAY;

beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.DATABASE_URL;
  process.env.DEMO_TODAY = T;
  resetStoreForTests();
});

describe('estado inicial', () => {
  it('arranca con la semana viable y una composicion valida', async () => {
    const state = await getWorkspaceState('overview');
    expect(state.result.baseline.feasible).toBe(true);
    expect(state.scenario.revision).toBe(0);
    expect(state.view.spec.resultId).toBe(state.result.id);
    expect(state.storage).toBe('memoria-local');
  });

  it('declara sin ambiguedad que no hay integraciones verificadas', async () => {
    const state = await getWorkspaceState('overview');
    expect(state.integrations.gemini.verified).toBe(false);
    expect(state.integrations.tigerData.verified).toBe(false);
    expect(state.view.source).toBe('fallback');
    expect(state.notices.join(' ')).toMatch(/vista básica determinista/i);
  });
});

describe('mensaje ambiguo', () => {
  it('pide aclaracion y no cambia los datos', async () => {
    const before = await getWorkspaceState('overview');
    const response = await interpret(AMBIGUOUS_MESSAGE);
    expect(response.kind).toBe('clarification');
    const after = await getWorkspaceState('overview');
    expect(after.scenario.revision).toBe(before.scenario.revision);
    expect(after.result.id).toBe(before.result.id);
  });
});

describe('recorrido confirmado', () => {
  it('un mensaje confirmado cambia los datos y produce un resultado verificable', async () => {
    const initial = await getWorkspaceState('overview');
    const response = await interpret(DEMO_MESSAGE);
    expect(response.kind).toBe('proposal');
    if (response.kind !== 'proposal') return;

    const proposal = response.proposal;
    expect(proposal.changes[0].operation).toEqual({
      op: 'reschedule_receivable',
      obligationId: 'inv-a',
      newDate: day(T, 8),
    });

    const confirmed = await confirmProposal(
      proposal.id,
      initial.scenario.revision,
      'test-key-confirm-1',
      'payroll',
    );
    expect(confirmed.deduplicated).toBe(false);
    expect(confirmed.state.scenario.revision).toBe(1);
    expect(confirmed.state.result.baseline.shortfallCents).toBe(pesos(10_000));
    expect(confirmed.state.result.plans.map((p) => p.id)).toEqual(['plan:S1', 'plan:C1']);
  });

  it('confirmar dos veces con la misma clave no duplica el evento', async () => {
    const initial = await getWorkspaceState('overview');
    const response = await interpret(DEMO_MESSAGE);
    if (response.kind !== 'proposal') throw new Error('se esperaba una propuesta');

    await confirmProposal(response.proposal.id, initial.scenario.revision, 'clave-repetida');
    const historyOnce = await getHistory();
    const reschedulesOnce = historyOnce.entries.filter(
      (e) => e.eventType === 'receivable_rescheduled',
    );

    const second = await confirmProposal(
      response.proposal.id,
      initial.scenario.revision,
      'clave-repetida',
    );
    expect(second.deduplicated).toBe(true);

    const historyTwice = await getHistory();
    const reschedulesTwice = historyTwice.entries.filter(
      (e) => e.eventType === 'receivable_rescheduled',
    );
    expect(reschedulesOnce).toHaveLength(1);
    expect(reschedulesTwice).toHaveLength(1);
    expect(second.state.scenario.revision).toBe(1);
  });

  it('confirmar contra una revision vieja devuelve conflicto', async () => {
    const initial = await getWorkspaceState('overview');
    const response = await interpret(DEMO_MESSAGE);
    if (response.kind !== 'proposal') throw new Error('se esperaba una propuesta');

    await confirmProposal(response.proposal.id, initial.scenario.revision, 'clave-a');

    const second = await interpret(DEMO_MESSAGE);
    if (second.kind === 'proposal') {
      await expect(
        confirmProposal(second.proposal.id, 0, 'clave-b'),
      ).rejects.toThrow(/cambió desde que se generó/i);
    }
  });
});

describe('rechazos y caso sin solucion', () => {
  async function llegarAlRiesgo() {
    const initial = await getWorkspaceState('overview');
    const response = await interpret(DEMO_MESSAGE);
    if (response.kind !== 'proposal') throw new Error('se esperaba una propuesta');
    return confirmProposal(response.proposal.id, initial.scenario.revision, 'clave-riesgo');
  }

  it('rechazar el aplazamiento cambia la solucion del motor, no solo el texto', async () => {
    const risky = await llegarAlRiesgo();
    const rejected = await rejectAction(
      risky.state.scenario.id,
      'action:S',
      risky.state.scenario.revision,
      'clave-rechazo-1',
      'payroll',
    );
    expect(rejected.state.result.plans.map((p) => p.id)).toEqual(['plan:C1']);
    expect(rejected.state.scenario.id).not.toBe(risky.state.scenario.id);
    expect(rejected.state.scenario.parentScenarioId).toBe(risky.state.scenario.id);
  });

  it('rechazar tambien el adelanto deja el caso sin solucion con faltante residual', async () => {
    const risky = await llegarAlRiesgo();
    const first = await rejectAction(
      risky.state.scenario.id,
      'action:S',
      risky.state.scenario.revision,
      'clave-rechazo-1',
    );
    const second = await rejectAction(
      first.state.scenario.id,
      'action:C',
      first.state.scenario.revision,
      'clave-rechazo-2',
    );
    expect(second.state.result.plans).toHaveLength(0);
    expect(second.state.result.infeasibility?.reason).toBe('no_solution');
    expect(second.state.result.infeasibility?.minimalResidualShortfallCents).toBe(pesos(10_000));
    // La composicion no puede esconder el bloqueo ni mostrar un comparador vacio.
    const types = second.state.view.spec.sections.map((s) => s.type);
    expect(types).toContain('constraints');
    expect(types).not.toContain('plan_comparison');
  });

  it('rechazar dos veces con la misma clave no crea dos escenarios', async () => {
    const risky = await llegarAlRiesgo();
    const first = await rejectAction(
      risky.state.scenario.id,
      'action:S',
      risky.state.scenario.revision,
      'clave-rechazo-unica',
    );
    const repeat = await rejectAction(
      risky.state.scenario.id,
      'action:S',
      risky.state.scenario.revision,
      'clave-rechazo-unica',
    );
    expect(repeat.deduplicated).toBe(true);
    expect(repeat.state.scenario.id).toBe(first.state.scenario.id);
  });

  it('se puede volver al escenario padre sin perder el derivado', async () => {
    const risky = await llegarAlRiesgo();
    const rejected = await rejectAction(
      risky.state.scenario.id,
      'action:S',
      risky.state.scenario.revision,
      'clave-volver',
    );
    const back = await activateScenario(risky.state.scenario.id, 'payroll');
    expect(back.state.scenario.id).toBe(risky.state.scenario.id);
    expect(back.state.result.plans.map((p) => p.id)).toEqual(['plan:S1', 'plan:C1']);

    const forward = await activateScenario(rejected.state.scenario.id, 'payroll');
    expect(forward.state.result.plans.map((p) => p.id)).toEqual(['plan:C1']);
  });
});

describe('composiciones distintas para las tres situaciones', () => {
  it('riesgo, cobros y sin solucion producen secciones distintas', async () => {
    const initial = await getWorkspaceState('overview');
    const response = await interpret(DEMO_MESSAGE);
    if (response.kind !== 'proposal') throw new Error('se esperaba una propuesta');
    const risky = await confirmProposal(
      response.proposal.id,
      initial.scenario.revision,
      'clave-composicion',
      'payroll',
    );

    const payroll = risky.state.view.spec.sections.map((s) => s.type);
    const receivables = (await getWorkspaceState('receivables')).view.spec.sections.map(
      (s) => s.type,
    );

    const r1 = await rejectAction(
      risky.state.scenario.id,
      'action:S',
      risky.state.scenario.revision,
      'k1',
    );
    const r2 = await rejectAction(
      r1.state.scenario.id,
      'action:C',
      r1.state.scenario.revision,
      'k2',
      'no_solution',
    );
    const blocked = r2.state.view.spec.sections.map((s) => s.type);

    expect(payroll).not.toEqual(receivables);
    expect(payroll).not.toEqual(blocked);
    expect(receivables).not.toEqual(blocked);
    expect(payroll[0]).toBe('risk_summary');
    expect(receivables[0]).toBe('receivables');
    expect(blocked[0]).toBe('constraints');
  });
});

describe('historial', () => {
  it('distingue expectativa actualizada de movimiento liquidado', async () => {
    const initial = await getWorkspaceState('overview');
    const response = await interpret(DEMO_MESSAGE);
    if (response.kind !== 'proposal') throw new Error('se esperaba una propuesta');
    await confirmProposal(response.proposal.id, initial.scenario.revision, 'clave-hist');

    const history = await getHistory();
    const reschedule = history.entries.find((e) => e.eventType === 'receivable_rescheduled');
    expect(reschedule).toBeDefined();
    expect(reschedule!.kind).toBe('expectativa');
    expect(reschedule!.detail).toMatch(/no un cobro recibido/i);
    expect(history.entries.some((e) => e.kind === 'liquidado')).toBe(false);
  });

  it('reconstruye el antes y el despues del cambio confirmado', async () => {
    const initial = await getWorkspaceState('overview');
    const response = await interpret(DEMO_MESSAGE);
    if (response.kind !== 'proposal') throw new Error('se esperaba una propuesta');
    await confirmProposal(response.proposal.id, initial.scenario.revision, 'clave-antes-despues');

    const history = await getHistory();
    const change = history.beforeAfter.at(-1);
    expect(change).toBeDefined();
    expect(change!.beforeShortfallCents).toBe(0);
    expect(change!.afterShortfallCents).toBe(pesos(10_000));
    expect(change!.beforeResultId).not.toBe(change!.afterResultId);
  });
});
