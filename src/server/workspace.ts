/**
 * Orquestacion del area de trabajo.
 *
 * Orden fijo: persistir el estado, calcular el resultado con el motor,
 * persistir el resultado y solo despues pedir la composicion. Una respuesta
 * tardia con un resultId anterior se descarta en la capa de composicion.
 */
import { validateInterpretation } from './ai/interpret';
import { patchForOperation, patchKey, matchesPatch, reversePatch, undoPatchSchema, type UndoPatch } from './history-actions';
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
  focus: Focus = 'payroll',
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
  const resolvedFocus = focus === 'payroll' ? (result.infeasibility ? 'no_solution' : result.baseline.shortfallCents > 0 ? 'payroll' : 'overview') : focus;
  const view = await composeForResult(result, resolvedFocus);
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

export async function proposeInvoiceChange(scenarioId: string, baseRevision: number, obligationId: string, action: 'delay' | 'earlier' | 'correct', newDate: string): Promise<InterpretResponse> {
  const store = await getStore();
  const record = await ensureSeeded(store);
  if (record.input.scenarioId !== scenarioId || record.input.baseRevision !== baseRevision) throw new RevisionConflict(record.input.baseRevision);
  const invoice = record.input.obligations.find(o=>o.id===obligationId && o.direction==='inflow' && !o.settled);
  const fail = (message:string): InterpretResponse => ({kind:'error',message,allowManual:true});
  if (!invoice) return fail('Selecciona una factura pendiente de cobro.');
  if (action === 'delay' && newDate <= invoice.date) return fail('Para registrar un retraso, elige una fecha posterior a la actual.');
  if (action === 'earlier' && newDate >= invoice.date) return fail('Para adelantar la fecha, elige una fecha anterior a la actual.');
  const message = invoice.concept + ': nueva fecha esperada ' + newDate;
  const outcome = validateInterpretation({kind:'proposal',changes:[{op:'reschedule_receivable',obligationId,newDate,evidence:message}]},record.input,message,'manual','formulario');
  if (outcome.kind !== 'proposal' || !outcome.proposal) return fail('Revisa la fecha: debe ser distinta de la actual y estar dentro de los próximos 180 días del ejemplo.');
  await store.savePendingProposal(outcome.proposal);
  return {kind:'proposal',proposal:outcome.proposal};
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

/** Persistir datos, resultado, historial e idempotencia juntos. La composición
 * se hace después; una caída de Gemini no invalida el cambio financiero. */
async function persistMutation(store: Store, current: ScenarioRecord, input: ScenarioInput, events: Omit<EventRecord,'eventId'|'recordedAt'>[], key: string, operation: string, reference: string, label: string, proposalId?: string, parentScenarioId: string | null = current.input.scenarioId) {
  const result = computeEngineResult(input);
  const resultEvent: Omit<EventRecord,'eventId'|'recordedAt'> = {
    businessId:input.businessId, scenarioId:input.scenarioId, revision:input.baseRevision,
    effectiveDate:input.demoToday, eventType:'result_generated',
    payload:{resultId:result.id, faltanteCentavos:result.baseline.shortfallCents, planes:result.plans.length, sinSolucion:result.infeasibility?.reason ?? null},
  };
  return store.commitMutation({expectedScenarioId:current.input.scenarioId, expectedRevision:current.input.baseRevision, key, operation, reference,
    record:{input, label, parentScenarioId}, result, events:[...events,resultEvent], proposalId});
}

async function alreadyCommitted(store: Store, key: string, reference: string): Promise<boolean> {
  const existing = await store.getOperationRef(key);
  if (existing === null) return false;
  if (existing !== reference) throw new Error('clave usada por otra operación');
  return true;
}

export async function confirmProposal(proposalId: string, baseRevision: number, idempotencyKey: string, focus: Focus = 'payroll'): Promise<MutationResponse> {
  const store = await getStore();
  const record = await ensureSeeded(store);
  if (await alreadyCommitted(store,idempotencyKey,proposalId)) return {state:await getWorkspaceState(focus),deduplicated:true};
  const proposal = await store.getPendingProposal(proposalId);
  if (!proposal) throw new Error('la propuesta ya no está pendiente o no existe');
  if (proposal.scenarioId !== record.input.scenarioId || proposal.baseRevision !== record.input.baseRevision || baseRevision !== record.input.baseRevision) throw new RevisionConflict(record.input.baseRevision);
  const nextInput = {...applyChanges(record.input,proposal.changes), scenarioId:'scenario:' + crypto.randomUUID()};
  let cursor = record.input;
  const events = proposal.changes.map(change => {
    const undo = patchForOperation(cursor,change.operation);
    cursor = applyChanges(cursor,[change]);
    const event = eventForChange(change);
    return {businessId:nextInput.businessId,scenarioId:nextInput.scenarioId,revision:nextInput.baseRevision,effectiveDate:event.effectiveDate ?? nextInput.demoToday,eventType:event.eventType,payload:{...event.payload,diff:change.humanDiff,undo}};
  });
  const committed = await persistMutation(store,record,nextInput,events,idempotencyKey,'confirm',proposalId,'Datos actualizados',proposalId);
  return {state:await getWorkspaceState(focus),deduplicated:!committed};
}

export async function rejectAction(scenarioId: string, optionId: string, baseRevision: number, idempotencyKey: string, focus: Focus = 'payroll'): Promise<MutationResponse> {
  const store = await getStore();
  const record = await ensureSeeded(store);
  if (await alreadyCommitted(store,idempotencyKey,optionId)) return {state:await getWorkspaceState(focus),deduplicated:true};
  if (scenarioId !== record.input.scenarioId || baseRevision !== record.input.baseRevision) throw new RevisionConflict(record.input.baseRevision);
  const option = record.input.obligations.flatMap(o=>o.actions).find(a=>a.id===optionId);
  if (!option || record.input.excludedActionIds.includes(optionId)) throw new Error('la acción no está disponible');
  const nextInput = {...record.input,scenarioId:'scenario:' + crypto.randomUUID(),baseRevision:baseRevision+1,excludedActionIds:[...record.input.excludedActionIds,optionId].sort()};
  const event: Omit<EventRecord,'eventId'|'recordedAt'> = {businessId:nextInput.businessId,scenarioId:nextInput.scenarioId,revision:nextInput.baseRevision,effectiveDate:nextInput.demoToday,eventType:'scenario_constraint',payload:{optionId,diff:'Descartaste: ' + option.label,undo:patchForOperation(record.input,{op:'exclude_action',optionId})}};
  const committed = await persistMutation(store,record,nextInput,[event],idempotencyKey,'reject',optionId,'Sin ' + option.label);
  return {state:await getWorkspaceState(focus),deduplicated:!committed};
}

/** Nuevo recorrido de demo: datos originales, sin exclusiones ni ascendencia. */
export async function resetExample(scenarioId: string, baseRevision: number, idempotencyKey: string): Promise<MutationResponse> {
  const store = await getStore();
  const current = await ensureSeeded(store);
  const reference = 'reset:' + scenarioId;
  if (await alreadyCommitted(store,idempotencyKey,reference)) return {state:await getWorkspaceState('overview'),deduplicated:true};
  if (current.input.scenarioId !== scenarioId || current.input.baseRevision !== baseRevision) throw new RevisionConflict(current.input.baseRevision);
  const input = {...demoScenario(demoToday()),scenarioId:'scenario:' + crypto.randomUUID()};
  const event: Omit<EventRecord,'eventId'|'recordedAt'> = {businessId:input.businessId,scenarioId:input.scenarioId,revision:input.baseRevision,effectiveDate:input.demoToday,eventType:'scenario_created',payload:{label:'Ejemplo reiniciado',nota:'Nuevo recorrido con los datos iniciales y sin opciones descartadas.'}};
  const committed = await persistMutation(store,current,input,[event],idempotencyKey,'reset',reference,'Ejemplo inicial',undefined,null);
  return {state:await getWorkspaceState('overview'),deduplicated:!committed};
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

/** Solo se revierten decisiones que pertenecen al escenario activo. */
async function historyUndoContext(store: Store, record: ScenarioRecord, events: EventRecord[]) {
  const ancestors = new Map<string, number>();
  let cursor: ScenarioRecord | null = record;
  let revisionLimit = record.input.baseRevision;
  while (cursor && !ancestors.has(cursor.input.scenarioId)) {
    ancestors.set(cursor.input.scenarioId, Math.min(cursor.input.baseRevision, revisionLimit));
    revisionLimit = Math.min(cursor.input.baseRevision - 1, revisionLimit);
    cursor = cursor.parentScenarioId ? await store.getScenario(cursor.parentScenarioId) : null;
  }
  const active = (event: EventRecord) => event.scenarioId !== null && ancestors.has(event.scenarioId) && event.revision <= ancestors.get(event.scenarioId)!;
  const undone = new Set(events.filter(active).map(e=>e.payload.undoOf).filter((id): id is string => typeof id === 'string'));
  const patches = new Map<string, UndoPatch>();
  for (const event of events) {
    if (event.payload.undoOf) continue;
    const parsed = undoPatchSchema.safeParse(event.payload.undo);
    if (parsed.success) { patches.set(event.eventId,parsed.data); continue; }
    // Compatibilidad con el historial antiguo: usar un resultado anterior
    // guardado, nunca deducir la fecha o reserva a partir de un texto.
    if (!active(event)) continue;
    const parent = event.scenarioId ? await store.getScenario(event.scenarioId) : null;
    const prior = events.filter(e=>e.eventType === 'result_generated' && e.revision === event.revision - 1 && (e.scenarioId === event.scenarioId || e.scenarioId === parent?.parentScenarioId));
    if (prior.length !== 1) continue;
    const before = typeof prior[0].payload.resultId === 'string' ? await store.getResult(prior[0].payload.resultId) : null;
    if (!before) continue;
    if (event.eventType === 'receivable_rescheduled' && typeof event.payload.obligationId === 'string' && typeof event.payload.nuevaFecha === 'string') {
      const old = before.receivables.find(o=>o.obligationId===event.payload.obligationId);
      if (old) patches.set(event.eventId,{kind:'date',id:old.obligationId,before:old.date,after:event.payload.nuevaFecha});
    } else if (event.eventType === 'scenario_constraint' && typeof event.payload.optionId === 'string') {
      patches.set(event.eventId,{kind:'excluded',id:event.payload.optionId,before:before.excludedActionIds.includes(event.payload.optionId),after:true});
    } else if (event.eventType === 'scenario_constraint' && typeof event.payload.cajaMinimaCentavos === 'number') {
      patches.set(event.eventId,{kind:'reserve',before:before.minimumCashCents,after:event.payload.cajaMinimaCentavos});
    }
  }
  const info = new Map<string, {available:boolean;reason?:string}>();
  for (const [index,event] of events.entries()) {
    const isDecision = !event.payload.undoOf && (event.eventType === 'receivable_rescheduled' || (event.eventType === 'scenario_constraint' && (typeof event.payload.optionId === 'string' || typeof event.payload.cajaMinimaCentavos === 'number' || event.payload.undo)));
    if (!isDecision) continue;
    const patch = patches.get(event.eventId);
    let reason: string | undefined;
    if (!active(event)) reason = 'Esta acción pertenece a otro escenario.';
    else if (undone.has(event.eventId)) reason = 'Acción deshecha.';
    else if (!patch || patch.before === patch.after) reason = 'No hay un valor anterior verificable para deshacer esta acción.';
    else if (events.slice(index+1).some(later=>active(later) && !undone.has(later.eventId) && patches.has(later.eventId) && patchKey(patches.get(later.eventId)!) === patchKey(patch))) reason = 'Primero deshaz el cambio más reciente de este mismo dato.';
    else if (!matchesPatch(record.input,patch)) reason = 'Este dato ya cambió. No se puede restaurar desde esta acción.';
    info.set(event.eventId,{available:!reason,reason});
  }
  return {info,patches,active};
}

export async function undoHistoryAction(eventId: string, scenarioId: string, baseRevision: number, idempotencyKey: string): Promise<MutationResponse> {
  const store = await getStore();
  const record = await ensureSeeded(store);
  if (await alreadyCommitted(store,idempotencyKey,eventId)) return {state:await getWorkspaceState('history'),deduplicated:true};
  if (record.input.scenarioId !== scenarioId || record.input.baseRevision !== baseRevision) throw new RevisionConflict(record.input.baseRevision);
  const events = await store.listEvents(DEMO_BUSINESS_ID);
  const context = await historyUndoContext(store,record,events);
  const target = events.find(event=>event.eventId===eventId);
  if (!target || !context.info.get(eventId)?.available) throw new RevisionConflict(record.input.baseRevision);
  const patch = context.patches.get(eventId)!;
  const next = {...reversePatch(record.input,patch), scenarioId:'scenario:' + crypto.randomUUID(),baseRevision:baseRevision+1};
  const event: Omit<EventRecord,'eventId'|'recordedAt'> = {businessId:next.businessId,scenarioId:next.scenarioId,revision:next.baseRevision,effectiveDate:next.demoToday,eventType:'scenario_constraint',payload:{undoOf:eventId,diff:'Deshiciste: ' + describeEvent(target),restored:patch.before,field:patchKey(patch)}};
  const committed = await persistMutation(store,record,next,[event],idempotencyKey,'undo',eventId,'Acción deshecha');
  return {state:await getWorkspaceState('history'),deduplicated:!committed};
}

export async function getHistory(): Promise<HistoryResponse> {
  const store = await getStore();
  const record = await ensureSeeded(store);
  const events = await store.listEvents(DEMO_BUSINESS_ID);
  const undoContext = await historyUndoContext(store,record,events);

  const entries: HistoryEntry[] = events.filter(undoContext.active).map((e) => ({
    id: e.eventId,
    recordedAt: e.recordedAt,
    effectiveDate: e.effectiveDate,
    revision: e.revision,
    scenarioId: e.scenarioId,
    eventType: e.eventType,
    kind: KIND_BY_EVENT[e.eventType] ?? 'resultado',
    label: LABEL_BY_EVENT[e.eventType] ?? e.eventType,
    detail: describeEvent(e),
    undo: undoContext.info.get(e.eventId),
  }));

  // Reconstruccion antes/despues por revision a partir de los resultados guardados.
  const byRevision = new Map<number, string>();
  for (const e of events) {
    if (e.eventType !== 'result_generated' || !undoContext.active(e)) continue;
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
