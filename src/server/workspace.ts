/**
 * Orquestacion del area de trabajo.
 *
 * Orden fijo: persistir el estado, calcular el resultado con el motor,
 * persistir el resultado y solo despues pedir la composicion. Una respuesta
 * tardia con un resultId anterior se descarta en la capa de composicion.
 */
import { computeEngineResult } from '@/domain/engine';
import { formatCents } from '@/domain/money';
import { formatEconomicDate } from '@/domain/dates';
import type { EngineResult, ScenarioInput } from '@/domain/types';
import {
  DEFAULT_DEMO_TODAY,
  DEMO_BUSINESS,
  DEMO_BUSINESS_ID,
  demoScenario,
} from '@fixtures/index';
import { composeView, getUsableModel, interpretMessage } from '@/server/ai/agent';
import { isGeminiConfigured, readGeminiConfig } from '@/server/ai/gemini';
import { PROMPT_VERSION, type ComposedView, type Focus } from '@/server/ai/viewspec';
import { MemoryStore } from '@/server/store/memory';
import { RevisionConflict, type EventRecord, type ScenarioRecord, type Store } from '@/server/store/types';
import type {
  BeforeAfter,
  HistoryEntry,
  HistoryResponse,
  IntegrationsState,
  InterpretResponse,
  MutationResponse,
  PendingProposal,
  ProposalChange,
  WorkspaceState,
} from '@/lib/contracts';

const ROOT_SCENARIO_ID = 'scenario:demo';

// --- Seleccion de almacen --------------------------------------------------

let storePromise: Promise<Store> | null = null;

function demoToday(): string {
  const value = process.env.DEMO_TODAY?.trim();
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : DEFAULT_DEMO_TODAY;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

async function createStore(): Promise<Store> {
  if (isDatabaseConfigured()) {
    try {
      const mod = await import('@/server/store/tigerdata');
      const store = new mod.TigerDataStore();
      await store.ensureReady();
      return store;
    } catch (err) {
      // No se degrada en silencio: se registra y la interfaz lo declara.
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[compromisos] Tiger Data no disponible, se usa memoria local:', detail);
      lastStorageError = detail;
    }
  }
  const store = new MemoryStore();
  await store.ensureReady();
  return store;
}

let lastStorageError: string | null = null;

export function getStore(): Promise<Store> {
  if (!storePromise) storePromise = createStore();
  return storePromise;
}

/** Solo para pruebas: fuerza la reconstruccion del almacen. */
export function resetStoreForTests(): void {
  storePromise = null;
  lastStorageError = null;
  MemoryStore.reset();
}

// --- Semilla ---------------------------------------------------------------

async function ensureSeeded(store: Store): Promise<ScenarioRecord> {
  const currentId = await store.getCurrentScenarioId(DEMO_BUSINESS_ID);
  if (currentId) {
    const record = await store.getScenario(currentId);
    if (record) return record;
  }
  const existing = await store.getScenario(ROOT_SCENARIO_ID);
  if (existing) {
    await store.setCurrentScenarioId(DEMO_BUSINESS_ID, ROOT_SCENARIO_ID);
    return existing;
  }
  const record: ScenarioRecord = {
    input: demoScenario(demoToday()),
    label: 'Semana inicial del negocio',
    parentScenarioId: null,
  };
  await store.saveScenario(record);
  await store.setCurrentScenarioId(DEMO_BUSINESS_ID, ROOT_SCENARIO_ID);
  // Misma clave que usa scripts/seed.ts: sembrar y arrancar el servidor no
  // registran dos veces la creacion del mismo escenario.
  const claim = await store.claimOperationKey(
    'scenario_created:' + ROOT_SCENARIO_ID,
    'scenario_created',
    ROOT_SCENARIO_ID,
  );
  if (claim.claimed) {
    await store.appendEvent({
      businessId: DEMO_BUSINESS_ID,
      scenarioId: ROOT_SCENARIO_ID,
      revision: record.input.baseRevision,
      effectiveDate: record.input.demoToday,
      eventType: 'scenario_created',
      payload: { label: record.label, obligaciones: record.input.obligations.length },
    });
  }
  return record;
}

// --- Resultado y composicion ----------------------------------------------

async function computeAndStore(store: Store, input: ScenarioInput): Promise<EngineResult> {
  const result = computeEngineResult(input);
  const existing = await store.getResult(result.id);
  if (!existing) await store.saveResult(result);
  // El evento se registra una sola vez por resultado, aunque el calculo lo
  // disparen varios procesos (servidor, seed, scripts) o peticiones a la vez.
  const claim = await store.claimOperationKey(
    'result_generated:' + result.id,
    'result_generated',
    result.id,
  );
  if (claim.claimed) {
    await store.appendEvent({
      businessId: input.businessId,
      scenarioId: input.scenarioId,
      revision: input.baseRevision,
      effectiveDate: input.demoToday,
      eventType: 'result_generated',
      payload: {
        resultId: result.id,
        faltanteCentavos: result.baseline.shortfallCents,
        planes: result.plans.length,
        sinSolucion: result.infeasibility?.reason ?? null,
      },
    });
  }
  return result;
}

/** Composicion con cache por resultado + foco + version de contrato. */
export async function composeForResult(
  result: EngineResult,
  focus: Focus,
): Promise<ComposedView> {
  const store = await getStore();
  const cached = await store.getViewSpec(result.id, focus, PROMPT_VERSION);
  if (cached && cached.spec.resultId === result.id) return cached;

  const view = await composeView(result, focus);
  // Defensa final: una composicion de otro resultado nunca se guarda ni se usa.
  if (view.spec.resultId !== result.id) {
    const { fallbackComposedView } = await import('@/server/ai/viewspec');
    return fallbackComposedView(
      result,
      focus,
      'Llegó una respuesta de un cálculo anterior y se descartó.',
    );
  }
  await store.saveViewSpec({
    view,
    resultId: result.id,
    focus,
    promptVersion: PROMPT_VERSION,
  });
  return view;
}

// --- Estado de integraciones ----------------------------------------------

async function buildIntegrations(store: Store): Promise<IntegrationsState> {
  const { model } = readGeminiConfig();
  const geminiConfigured = isGeminiConfigured();
  let geminiModel: string | undefined;
  if (geminiConfigured) {
    geminiModel = (await getUsableModel()) ?? undefined;
  }

  return {
    gemini: {
      configured: geminiConfigured,
      // "verificado" solo lo puede afirmar el script de comprobacion o una
      // llamada real ya realizada en esta ejecucion.
      verified: Boolean(geminiConfigured && geminiModel),
      detail: geminiConfigured
        ? geminiModel
          ? 'Conectado. Organiza la vista y lee los avisos.'
          : 'Hay una clave, pero ningún modelo respondió. Se usa la vista básica.'
        : 'Sin conexión a Gemini: la vista la organiza el propio sistema.',
      model: geminiModel ?? model,
    },
    tigerData: {
      configured: isDatabaseConfigured(),
      verified: store.kind === 'tiger-data',
      detail:
        store.kind === 'tiger-data'
          ? 'Conectado. El historial se conserva al cerrar.'
          : isDatabaseConfigured()
            ? 'No se pudo conectar. Los cambios solo duran esta sesión.'
            : 'Sin base de datos: los cambios solo duran esta sesión.',
    },
  };
}

function buildNotices(store: Store, view: ComposedView): string[] {
  const notices: string[] = [];
  if (store.kind === 'memoria-local') {
    notices.push(
      'Los cambios solo duran esta sesión. Negocio y mensajes de ejemplo: nada de esto es un cliente real.',
    );
  }
  if (view.source === 'fallback') {
    notices.push(
      ('Esta vista no la organizó Gemini, sino el propio sistema. ' + (view.fallbackReason ?? '')).trim(),
    );
  }
  return notices;
}

// --- Estado completo -------------------------------------------------------

export async function getWorkspaceState(
  focus: Focus = 'overview',
  scenarioId?: string,
): Promise<WorkspaceState> {
  const store = await getStore();
  let record = await ensureSeeded(store);
  if (scenarioId && scenarioId !== record.input.scenarioId) {
    const requested = await store.getScenario(scenarioId);
    if (requested) {
      await store.setCurrentScenarioId(DEMO_BUSINESS_ID, scenarioId);
      record = requested;
    }
  }

  const result = await computeAndStore(store, record.input);
  const view = await composeForResult(result, focus);
  const integrations = await buildIntegrations(store);

  return {
    business: {
      id: DEMO_BUSINESS.id,
      name: DEMO_BUSINESS.name,
      description: DEMO_BUSINESS.description,
      currency: DEMO_BUSINESS.currency,
      timezone: DEMO_BUSINESS.timezone,
    },
    scenario: {
      id: record.input.scenarioId,
      revision: record.input.baseRevision,
      label: record.label,
      demoToday: record.input.demoToday,
      parentScenarioId: record.parentScenarioId,
    },
    result,
    view,
    integrations,
    storage: store.kind,
    notices: buildNotices(store, view),
  };
}

// --- Interpretacion --------------------------------------------------------

export async function interpret(message: string): Promise<InterpretResponse> {
  const store = await getStore();
  const record = await ensureSeeded(store);
  const result = await computeAndStore(store, record.input);

  const response = await interpretMessage(
    message,
    record.input,
    record.input.obligations.map((o) => ({
      id: o.id,
      direction: o.direction,
      date: o.date,
      counterparty: o.counterparty,
      concept: o.concept,
      amountCents: o.amountCents,
    })),
    result,
  );

  if (response.kind === 'proposal') {
    await store.savePendingProposal(response.proposal);
  }
  return response;
}

// --- Aplicacion de cambios confirmados -------------------------------------

function applyChanges(input: ScenarioInput, changes: ProposalChange[]): ScenarioInput {
  let next: ScenarioInput = {
    ...input,
    obligations: input.obligations.map((o) => ({ ...o })),
    excludedActionIds: [...input.excludedActionIds],
  };
  for (const change of changes) {
    const op = change.operation;
    if (op.op === 'reschedule_receivable') {
      next.obligations = next.obligations.map((o) =>
        o.id === op.obligationId ? { ...o, date: op.newDate } : o,
      );
    } else if (op.op === 'exclude_action') {
      if (!next.excludedActionIds.includes(op.optionId)) {
        next.excludedActionIds = [...next.excludedActionIds, op.optionId].sort();
      }
    } else {
      next = { ...next, minimumCashCents: op.amountCents };
    }
  }
  return { ...next, baseRevision: input.baseRevision + 1 };
}

function eventForChange(change: ProposalChange): {
  eventType: EventRecord['eventType'];
  payload: Record<string, unknown>;
  effectiveDate: string | null;
} {
  const op = change.operation;
  if (op.op === 'reschedule_receivable') {
    return {
      eventType: 'receivable_rescheduled',
      payload: {
        obligationId: op.obligationId,
        nuevaFecha: op.newDate,
        evidencia: change.evidence,
        nota: 'Expectativa de cobro actualizada. No es un cobro recibido.',
      },
      effectiveDate: op.newDate,
    };
  }
  if (op.op === 'exclude_action') {
    return {
      eventType: 'scenario_constraint',
      payload: {
        optionId: op.optionId,
        evidencia: change.evidence,
        nota: 'Acción descartada del escenario. El pago registrado no cambia.',
      },
      effectiveDate: null,
    };
  }
  return {
    eventType: 'scenario_constraint',
    payload: {
      cajaMinimaCentavos: op.amountCents,
      evidencia: change.evidence,
      nota: 'Nueva caja mínima exigida por el usuario.',
    },
    effectiveDate: null,
  };
}

export async function confirmProposal(
  proposalId: string,
  baseRevision: number,
  idempotencyKey: string,
  focus: Focus = 'payroll',
): Promise<MutationResponse> {
  const store = await getStore();
  const record = await ensureSeeded(store);

  const claim = await store.claimOperationKey(idempotencyKey, 'confirm', proposalId);
  if (!claim.claimed) {
    // Ya se aplico con esta misma clave: no se duplica el evento.
    return { state: await getWorkspaceState(focus), deduplicated: true };
  }

  const proposal = await store.getPendingProposal(proposalId);
  if (!proposal) {
    throw new Error('la propuesta ya no está pendiente o no existe');
  }
  if (proposal.baseRevision !== record.input.baseRevision || baseRevision !== record.input.baseRevision) {
    throw new RevisionConflict(record.input.baseRevision);
  }

  const nextInput = applyChanges(record.input, proposal.changes);
  await store.saveScenario({ ...record, input: nextInput });

  for (const change of proposal.changes) {
    const { eventType, payload, effectiveDate } = eventForChange(change);
    await store.appendEvent({
      businessId: nextInput.businessId,
      scenarioId: nextInput.scenarioId,
      revision: nextInput.baseRevision,
      effectiveDate: effectiveDate ?? nextInput.demoToday,
      eventType,
      payload: { ...payload, diff: change.humanDiff },
    });
  }

  await store.markProposalResolved(proposalId, 'confirmed');
  await computeAndStore(store, nextInput);

  return { state: await getWorkspaceState(focus), deduplicated: false };
}

// --- Rechazo de acciones: escenario separado --------------------------------

function derivedScenarioId(rootId: string, exclusionCount: number): string {
  const base = rootId.replace(/:excl\d+$/, '');
  return base + ':excl' + exclusionCount;
}

export async function rejectAction(
  scenarioId: string,
  optionId: string,
  baseRevision: number,
  idempotencyKey: string,
  focus: Focus = 'payroll',
): Promise<MutationResponse> {
  const store = await getStore();
  const record = await ensureSeeded(store);

  // La clave de idempotencia se comprueba ANTES que la revision: un reintento
  // de la misma operacion llega cuando el escenario vigente ya avanzo, y no
  // debe confundirse con un conflicto de concurrencia.
  const claim = await store.claimOperationKey(idempotencyKey, 'reject', optionId);
  if (!claim.claimed) {
    return { state: await getWorkspaceState(focus), deduplicated: true };
  }

  if (scenarioId !== record.input.scenarioId || baseRevision !== record.input.baseRevision) {
    throw new RevisionConflict(record.input.baseRevision);
  }

  // La etiqueta legible de la accion se resuelve aqui: ningun texto visible
  // debe mostrar el identificador interno de la opcion.
  const option = record.input.obligations
    .flatMap((o) => o.actions)
    .find((a) => a.id === optionId);
  if (!option) throw new Error('la acción indicada no existe en este escenario');

  const excluded = [...new Set([...record.input.excludedActionIds, optionId])].sort();
  const newId = derivedScenarioId(record.input.scenarioId, excluded.length);
  const nextInput: ScenarioInput = {
    ...record.input,
    scenarioId: newId,
    excludedActionIds: excluded,
    baseRevision: record.input.baseRevision + 1,
    obligations: record.input.obligations.map((o) => ({ ...o })),
  };

  await store.saveScenario({
    input: nextInput,
    label: 'Escenario sin ' + option.label,
    parentScenarioId: record.input.scenarioId,
  });
  await store.appendEvent({
    businessId: nextInput.businessId,
    scenarioId: newId,
    revision: nextInput.baseRevision,
    effectiveDate: nextInput.demoToday,
    eventType: 'scenario_created',
    payload: {
      derivadoDe: record.input.scenarioId,
      accionDescartada: optionId,
      accionDescartadaLabel: option.label,
    },
  });
  await store.appendEvent({
    businessId: nextInput.businessId,
    scenarioId: newId,
    revision: nextInput.baseRevision,
    effectiveDate: nextInput.demoToday,
    eventType: 'scenario_constraint',
    payload: {
      optionId,
      nota: 'Acción descartada. Es una restricción del escenario, no un pago ejecutado.',
    },
  });
  await store.setCurrentScenarioId(DEMO_BUSINESS_ID, newId);
  await computeAndStore(store, nextInput);

  return { state: await getWorkspaceState(focus), deduplicated: false };
}

/** Vuelve al escenario padre. Los controles de "volver" del shell lo usan. */
export async function activateScenario(scenarioId: string, focus: Focus = 'payroll'): Promise<MutationResponse> {
  const store = await getStore();
  const record = await store.getScenario(scenarioId);
  if (!record) throw new Error('el escenario indicado no existe');
  await store.setCurrentScenarioId(DEMO_BUSINESS_ID, scenarioId);
  return { state: await getWorkspaceState(focus), deduplicated: false };
}

// --- Historial -------------------------------------------------------------

const KIND_BY_EVENT: Record<string, HistoryEntry['kind']> = {
  receivable_rescheduled: 'expectativa',
  settled_movement: 'liquidado',
  scenario_constraint: 'restriccion',
  result_generated: 'resultado',
  scenario_created: 'escenario',
};

const LABEL_BY_EVENT: Record<string, string> = {
  receivable_rescheduled: 'Expectativa de cobro actualizada',
  settled_movement: 'Movimiento liquidado',
  scenario_constraint: 'Restricción del escenario',
  result_generated: 'Resultado calculado',
  scenario_created: 'Escenario creado',
};

function describeEvent(event: EventRecord): string {
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload.diff === 'string') return payload.diff;
  if (event.eventType === 'result_generated') {
    const shortfall = Number(payload.faltanteCentavos ?? 0);
    const plans = Number(payload.planes ?? 0);
    return shortfall > 0
      ? 'Faltante de ' + formatCents(shortfall) + ' con ' + String(plans) + ' plan(es) disponible(s).'
      : 'Escenario factible: sin faltante frente a la caja mínima.';
  }
  if (event.eventType === 'scenario_created') {
    // Se prefiere la etiqueta legible; el id solo aparece en eventos antiguos
    // guardados antes de que se registrara la etiqueta.
    const label =
      typeof payload.accionDescartadaLabel === 'string'
        ? payload.accionDescartadaLabel
        : typeof payload.accionDescartada === 'string'
          ? payload.accionDescartada
          : null;
    return label !== null
      ? 'Se creó un escenario aparte al excluir «' + label + '».'
      : 'Escenario inicial del negocio, con fecha económica ' +
          formatEconomicDate(event.effectiveDate) +
          '.';
  }
  if (typeof payload.nota === 'string') return payload.nota;
  return 'Evento registrado.';
}

export async function getHistory(): Promise<HistoryResponse> {
  const store = await getStore();
  await ensureSeeded(store);
  const events = await store.listEvents(DEMO_BUSINESS_ID);

  const entries: HistoryEntry[] = events.map((e) => ({
    id: e.eventId,
    recordedAt: e.recordedAt,
    effectiveDate: e.effectiveDate,
    revision: e.revision,
    scenarioId: e.scenarioId,
    eventType: e.eventType,
    kind: KIND_BY_EVENT[e.eventType] ?? 'resultado',
    label: LABEL_BY_EVENT[e.eventType] ?? e.eventType,
    detail: describeEvent(e),
  }));

  // Reconstruccion antes/despues por revision a partir de los resultados guardados.
  const byRevision = new Map<number, string>();
  for (const e of events) {
    if (e.eventType !== 'result_generated') continue;
    const resultId = (e.payload as { resultId?: string }).resultId;
    if (resultId) byRevision.set(e.revision, resultId);
  }
  const revisions = [...byRevision.keys()].sort((a, b) => a - b);
  const beforeAfter: BeforeAfter[] = [];
  for (let i = 1; i < revisions.length; i += 1) {
    const before = await store.getResult(byRevision.get(revisions[i - 1])!);
    const after = await store.getResult(byRevision.get(revisions[i])!);
    beforeAfter.push({
      revision: revisions[i],
      beforeResultId: before?.id ?? null,
      afterResultId: after?.id ?? null,
      beforeShortfallCents: before?.baseline.shortfallCents ?? null,
      afterShortfallCents: after?.baseline.shortfallCents ?? null,
      beforeMinClosingCents: before?.baseline.minimumClosingCents ?? null,
      afterMinClosingCents: after?.baseline.minimumClosingCents ?? null,
    });
  }

  return { entries, beforeAfter, storage: store.kind };
}

export { RevisionConflict };
export type { PendingProposal };
