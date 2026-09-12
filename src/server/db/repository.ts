/**
 * Repositorio SQL del schema `compromisos`. SOLO servidor.
 *
 * Reglas duras:
 * - Todas las consultas son parametrizadas ($1, $2...). Nunca se concatena un
 *   valor en el texto SQL.
 * - Los `bigint` llegan como string y se convierten con `centsFromDatabase`,
 *   que comprueba el rango seguro de JavaScript.
 * - Las fechas economicas se leen con `to_char(col, 'YYYY-MM-DD')`, sin
 *   convertirlas a `Date`: una conversion con zona horaria desplazaria el dia.
 * - La idempotencia es global y vive en `operation_keys`.
 * - El control de concurrencia es optimista: `bumpScenarioRevision` falla con
 *   `RevisionConflictError` si la revision cambio (la API debe responder 409).
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { getPool, withTransaction, SCHEMA } from './pool';
import { centsFromDatabase } from '../../domain/money';
import type { EventType } from './migrations';
import {
  scenarioInputSchema,
  type ActionOption,
  type EngineResult,
  type Obligation,
  type ScenarioInput,
} from '../../domain/types';

/** Pool o cliente dentro de una transaccion ya abierta. */
export type Executor = Pool | PoolClient;

async function run<R extends QueryResultRow = QueryResultRow>(
  executor: Executor,
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<R>> {
  return (executor as Pool).query<R>(text, values);
}

function resolve(executor?: Executor): Executor {
  return executor ?? getPool();
}

/**
 * Ejecuta `fn` en la transaccion del `executor` recibido o abre una nueva.
 * Permite componer: insertar evento y actualizar escenario en una sola unidad.
 */
async function inTransaction<T>(
  executor: Executor | undefined,
  fn: (client: Executor) => Promise<T>,
): Promise<T> {
  if (executor) return fn(executor);
  return withTransaction((client) => fn(client));
}

/** Conflicto de revision: alguien mas modifico el escenario. La API responde 409. */
export class RevisionConflictError extends Error {
  constructor(
    readonly scenarioId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number | null,
  ) {
    super(
      `Conflicto de revision en ${scenarioId}: se esperaba la revision ${expectedRevision} y la actual es ` +
        (actualRevision === null ? 'inexistente' : String(actualRevision)) +
        '. Vuelve a revisar el escenario antes de confirmar.',
    );
    this.name = 'RevisionConflictError';
  }
}

// --- Negocio ---------------------------------------------------------------

export interface BusinessRecord {
  id: string;
  name: string;
  currency: string;
  timezone: string;
}

export async function upsertBusiness(
  business: BusinessRecord,
  executor?: Executor,
): Promise<void> {
  await run(
    resolve(executor),
    `INSERT INTO ${SCHEMA}.businesses (id, name, currency, timezone)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           currency = EXCLUDED.currency,
           timezone = EXCLUDED.timezone`,
    [business.id, business.name, business.currency, business.timezone],
  );
}

// --- Escenarios ------------------------------------------------------------

export interface ScenarioMeta {
  id: string;
  businessId: string;
  revision: number;
  label: string | null;
  parentScenarioId: string | null;
}

interface ScenarioRow extends QueryResultRow {
  id: string;
  business_id: string;
  revision: number;
  opening_balance_cents: string;
  minimum_cash_cents: string;
  horizon_start: string;
  horizon_days: number;
  demo_today: string;
  excluded_action_ids: string[] | null;
  parent_scenario_id: string | null;
  label: string | null;
}

interface ObligationRow extends QueryResultRow {
  id: string;
  business_id: string;
  direction: 'inflow' | 'outflow';
  amount_cents: string;
  date: string;
  counterparty: string;
  concept: string;
  essential: boolean;
  settled: boolean;
}

interface ActionRow extends QueryResultRow {
  id: string;
  obligation_id: string;
  kind: ActionOption['kind'];
  approval: ActionOption['approval'];
  label: string;
  counterparty: string;
  variants: unknown;
}

const SCENARIO_COLUMNS = `
  id,
  business_id,
  revision,
  opening_balance_cents,
  minimum_cash_cents,
  to_char(horizon_start, 'YYYY-MM-DD') AS horizon_start,
  horizon_days,
  to_char(demo_today, 'YYYY-MM-DD') AS demo_today,
  excluded_action_ids,
  parent_scenario_id,
  label
`;

export async function loadScenarioMeta(
  scenarioId: string,
  executor?: Executor,
): Promise<ScenarioMeta | null> {
  const { rows } = await run<ScenarioRow>(
    resolve(executor),
    `SELECT ${SCENARIO_COLUMNS} FROM ${SCHEMA}.scenarios WHERE id = $1`,
    [scenarioId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    revision: row.revision,
    label: row.label,
    parentScenarioId: row.parent_scenario_id,
  };
}

/**
 * Reconstruye un `ScenarioInput` completo y lo valida con el esquema del
 * dominio. Devuelve null si el escenario no existe.
 */
export async function loadScenarioInput(
  scenarioId: string,
  executor?: Executor,
): Promise<ScenarioInput | null> {
  const db = resolve(executor);
  const scenario = await run<ScenarioRow>(
    db,
    `SELECT ${SCENARIO_COLUMNS} FROM ${SCHEMA}.scenarios WHERE id = $1`,
    [scenarioId],
  );
  const row = scenario.rows[0];
  if (!row) return null;

  const obligationRows = await run<ObligationRow>(
    db,
    `SELECT id,
            business_id,
            direction,
            amount_cents,
            to_char(date, 'YYYY-MM-DD') AS date,
            counterparty,
            concept,
            essential,
            settled
       FROM ${SCHEMA}.obligations
      WHERE scenario_id = $1
      ORDER BY date ASC, id ASC`,
    [scenarioId],
  );

  const actionRows = await run<ActionRow>(
    db,
    `SELECT id, obligation_id, kind, approval, label, counterparty, variants
       FROM ${SCHEMA}.action_options
      WHERE scenario_id = $1
      ORDER BY obligation_id ASC, id ASC`,
    [scenarioId],
  );

  const actionsByObligation = new Map<string, ActionOption[]>();
  for (const action of actionRows.rows) {
    const list = actionsByObligation.get(action.obligation_id) ?? [];
    list.push({
      id: action.id,
      obligationId: action.obligation_id,
      kind: action.kind,
      approval: action.approval,
      label: action.label,
      counterparty: action.counterparty,
      variants: action.variants,
    } as ActionOption);
    actionsByObligation.set(action.obligation_id, list);
  }

  const obligations = obligationRows.rows.map((ob) => ({
    id: ob.id,
    businessId: ob.business_id,
    direction: ob.direction,
    amountCents: centsFromDatabase(ob.amount_cents, `obligacion ${ob.id}`),
    date: ob.date,
    counterparty: ob.counterparty,
    concept: ob.concept,
    essential: ob.essential,
    settled: ob.settled,
    actions: actionsByObligation.get(ob.id) ?? [],
  }));

  const candidate = {
    businessId: row.business_id,
    baseRevision: row.revision,
    scenarioId: row.id,
    openingBalanceCents: centsFromDatabase(row.opening_balance_cents, 'saldo inicial'),
    minimumCashCents: centsFromDatabase(row.minimum_cash_cents, 'caja minima'),
    horizonStart: row.horizon_start,
    horizonDays: row.horizon_days,
    obligations,
    excludedActionIds: row.excluded_action_ids ?? [],
    demoToday: row.demo_today,
  };

  // El escenario reconstruido tiene que cumplir el contrato del dominio.
  return scenarioInputSchema.parse(candidate);
}

export interface SaveScenarioOptions {
  label?: string | null;
  parentScenarioId?: string | null;
  executor?: Executor;
}

/**
 * Inserta o actualiza escenario, obligaciones y acciones en UNA transaccion.
 * Las filas del escenario que ya no existen en la entrada se retiran, siempre
 * acotadas por `scenario_id`.
 */
export async function saveScenario(
  input: ScenarioInput,
  options: SaveScenarioOptions = {},
): Promise<void> {
  const parsed = scenarioInputSchema.parse(input);
  const { label = null, parentScenarioId = null, executor } = options;

  await inTransaction(executor, async (client) => {
    await run(
      client,
      `INSERT INTO ${SCHEMA}.scenarios (
         id, business_id, revision, opening_balance_cents, minimum_cash_cents,
         horizon_start, horizon_days, demo_today, excluded_action_ids,
         parent_scenario_id, label
       )
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8::date, $9::text[], $10, $11)
       ON CONFLICT (id) DO UPDATE
         SET business_id = EXCLUDED.business_id,
             revision = EXCLUDED.revision,
             opening_balance_cents = EXCLUDED.opening_balance_cents,
             minimum_cash_cents = EXCLUDED.minimum_cash_cents,
             horizon_start = EXCLUDED.horizon_start,
             horizon_days = EXCLUDED.horizon_days,
             demo_today = EXCLUDED.demo_today,
             excluded_action_ids = EXCLUDED.excluded_action_ids,
             parent_scenario_id = COALESCE(EXCLUDED.parent_scenario_id, ${SCHEMA}.scenarios.parent_scenario_id),
             label = COALESCE(EXCLUDED.label, ${SCHEMA}.scenarios.label),
             updated_at = now()`,
      [
        parsed.scenarioId,
        parsed.businessId,
        parsed.baseRevision,
        parsed.openingBalanceCents,
        parsed.minimumCashCents,
        parsed.horizonStart,
        parsed.horizonDays,
        parsed.demoToday,
        parsed.excludedActionIds,
        parentScenarioId,
        label,
      ],
    );

    const obligationIds = parsed.obligations.map((ob) => ob.id);
    const actionIds = parsed.obligations.flatMap((ob) => ob.actions.map((a) => a.id));

    // Retira solo filas de ESTE escenario que ya no forman parte de la entrada.
    await run(
      client,
      `DELETE FROM ${SCHEMA}.obligations
        WHERE scenario_id = $1 AND NOT (id = ANY($2::text[]))`,
      [parsed.scenarioId, obligationIds],
    );
    await run(
      client,
      `DELETE FROM ${SCHEMA}.action_options
        WHERE scenario_id = $1 AND NOT (id = ANY($2::text[]))`,
      [parsed.scenarioId, actionIds],
    );

    for (const ob of parsed.obligations) {
      await saveObligation(client, parsed.scenarioId, parsed.baseRevision, ob);
      for (const action of ob.actions) {
        await saveActionOption(client, parsed.scenarioId, action);
      }
    }
  });
}

async function saveObligation(
  client: Executor,
  scenarioId: string,
  revision: number,
  ob: Obligation,
): Promise<void> {
  await run(
    client,
    `INSERT INTO ${SCHEMA}.obligations (
       id, business_id, direction, amount_cents, date, counterparty, concept,
       essential, settled, scenario_id, revision
     )
     VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (scenario_id, id) DO UPDATE
       SET business_id = EXCLUDED.business_id,
           direction = EXCLUDED.direction,
           amount_cents = EXCLUDED.amount_cents,
           date = EXCLUDED.date,
           counterparty = EXCLUDED.counterparty,
           concept = EXCLUDED.concept,
           essential = EXCLUDED.essential,
           settled = EXCLUDED.settled,
           revision = EXCLUDED.revision`,
    [
      ob.id,
      ob.businessId,
      ob.direction,
      ob.amountCents,
      ob.date,
      ob.counterparty,
      ob.concept,
      ob.essential,
      ob.settled,
      scenarioId,
      revision,
    ],
  );
}

async function saveActionOption(
  client: Executor,
  scenarioId: string,
  action: ActionOption,
): Promise<void> {
  await run(
    client,
    `INSERT INTO ${SCHEMA}.action_options (
       id, scenario_id, obligation_id, kind, approval, label, counterparty, variants
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (scenario_id, id) DO UPDATE
       SET obligation_id = EXCLUDED.obligation_id,
           kind = EXCLUDED.kind,
           approval = EXCLUDED.approval,
           label = EXCLUDED.label,
           counterparty = EXCLUDED.counterparty,
           variants = EXCLUDED.variants`,
    [
      action.id,
      scenarioId,
      action.obligationId,
      action.kind,
      action.approval,
      action.label,
      action.counterparty,
      JSON.stringify(action.variants),
    ],
  );
}

/**
 * Control optimista de concurrencia. Sube la revision solo si coincide con la
 * esperada; si no, lanza `RevisionConflictError`.
 */
export async function bumpScenarioRevision(
  scenarioId: string,
  expectedRevision: number,
  executor?: Executor,
): Promise<number> {
  const db = resolve(executor);
  const updated = await run<{ revision: number }>(
    db,
    `UPDATE ${SCHEMA}.scenarios
        SET revision = revision + 1, updated_at = now()
      WHERE id = $1 AND revision = $2
      RETURNING revision`,
    [scenarioId, expectedRevision],
  );
  const row = updated.rows[0];
  if (row) return row.revision;

  const current = await run<{ revision: number }>(
    db,
    `SELECT revision FROM ${SCHEMA}.scenarios WHERE id = $1`,
    [scenarioId],
  );
  throw new RevisionConflictError(
    scenarioId,
    expectedRevision,
    current.rows[0]?.revision ?? null,
  );
}

// --- Resultados del motor --------------------------------------------------

export async function saveResult(result: EngineResult, executor?: Executor): Promise<void> {
  await run(
    resolve(executor),
    `INSERT INTO ${SCHEMA}.scenario_results (id, scenario_id, revision, input_version, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (id) DO UPDATE
       SET scenario_id = EXCLUDED.scenario_id,
           revision = EXCLUDED.revision,
           input_version = EXCLUDED.input_version,
           payload = EXCLUDED.payload,
           computed_at = now()`,
    [
      result.id,
      result.scenarioId,
      result.baseRevision,
      result.inputVersion,
      JSON.stringify(result),
    ],
  );
}

export async function loadResult(
  resultId: string,
  executor?: Executor,
): Promise<EngineResult | null> {
  const { rows } = await run<{ payload: EngineResult }>(
    resolve(executor),
    `SELECT payload FROM ${SCHEMA}.scenario_results WHERE id = $1`,
    [resultId],
  );
  return rows[0]?.payload ?? null;
}

/** Ultimo resultado calculado para una revision concreta del escenario. */
export async function loadResultForRevision(
  scenarioId: string,
  revision: number,
  executor?: Executor,
): Promise<EngineResult | null> {
  const { rows } = await run<{ payload: EngineResult }>(
    resolve(executor),
    `SELECT payload
       FROM ${SCHEMA}.scenario_results
      WHERE scenario_id = $1 AND revision = $2
      ORDER BY computed_at DESC
      LIMIT 1`,
    [scenarioId, revision],
  );
  return rows[0]?.payload ?? null;
}

// --- Propuestas pendientes -------------------------------------------------

export type ProposalStatus = 'pending' | 'confirmed' | 'discarded';

export interface PendingProposalRecord {
  id: string;
  businessId: string;
  scenarioId: string;
  baseRevision: number;
  payload: unknown;
  status: ProposalStatus;
  createdAt: string;
  resolvedAt: string | null;
}

interface ProposalRow extends QueryResultRow {
  id: string;
  business_id: string;
  scenario_id: string;
  base_revision: number;
  payload: unknown;
  status: ProposalStatus;
  created_at: Date | string;
  resolved_at: Date | string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toProposal(row: ProposalRow): PendingProposalRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    scenarioId: row.scenario_id,
    baseRevision: row.base_revision,
    payload: row.payload,
    status: row.status,
    createdAt: toIso(row.created_at) ?? '',
    resolvedAt: toIso(row.resolved_at),
  };
}

const PROPOSAL_COLUMNS = `id, business_id, scenario_id, base_revision, payload, status, created_at, resolved_at`;

export interface SavePendingProposalInput {
  id: string;
  businessId: string;
  scenarioId: string;
  baseRevision: number;
  payload: unknown;
  status?: ProposalStatus;
}

export async function savePendingProposal(
  input: SavePendingProposalInput,
  executor?: Executor,
): Promise<PendingProposalRecord> {
  const { rows } = await run<ProposalRow>(
    resolve(executor),
    `INSERT INTO ${SCHEMA}.pending_proposals (
       id, business_id, scenario_id, base_revision, payload, status
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (id) DO UPDATE
       SET business_id = EXCLUDED.business_id,
           scenario_id = EXCLUDED.scenario_id,
           base_revision = EXCLUDED.base_revision,
           payload = EXCLUDED.payload,
           status = EXCLUDED.status
     RETURNING ${PROPOSAL_COLUMNS}`,
    [
      input.id,
      input.businessId,
      input.scenarioId,
      input.baseRevision,
      JSON.stringify(input.payload),
      input.status ?? 'pending',
    ],
  );
  return toProposal(rows[0]);
}

export async function loadPendingProposal(
  id: string,
  executor?: Executor,
): Promise<PendingProposalRecord | null> {
  const { rows } = await run<ProposalRow>(
    resolve(executor),
    `SELECT ${PROPOSAL_COLUMNS} FROM ${SCHEMA}.pending_proposals WHERE id = $1`,
    [id],
  );
  return rows[0] ? toProposal(rows[0]) : null;
}

/**
 * Marca la propuesta como confirmada o descartada. Solo afecta a propuestas
 * todavia pendientes: confirmar dos veces no vuelve a resolverla.
 */
export async function markProposalResolved(
  id: string,
  status: Exclude<ProposalStatus, 'pending'>,
  executor?: Executor,
): Promise<PendingProposalRecord | null> {
  const { rows } = await run<ProposalRow>(
    resolve(executor),
    `UPDATE ${SCHEMA}.pending_proposals
        SET status = $2, resolved_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING ${PROPOSAL_COLUMNS}`,
    [id, status],
  );
  return rows[0] ? toProposal(rows[0]) : null;
}

// --- Composiciones de vista ------------------------------------------------

export type ViewSpecSource = 'gemini' | 'fallback';

export interface ViewSpecRecord {
  id: string;
  resultId: string;
  focus: string;
  promptVersion: string;
  payload: unknown;
  source: ViewSpecSource;
  createdAt: string;
}

interface ViewSpecRow extends QueryResultRow {
  id: string;
  result_id: string;
  focus: string;
  prompt_version: string;
  payload: unknown;
  source: ViewSpecSource;
  created_at: Date | string;
}

function toViewSpec(row: ViewSpecRow): ViewSpecRecord {
  return {
    id: row.id,
    resultId: row.result_id,
    focus: row.focus,
    promptVersion: row.prompt_version,
    payload: row.payload,
    source: row.source,
    createdAt: toIso(row.created_at) ?? '',
  };
}

const VIEW_SPEC_COLUMNS = `id, result_id, focus, prompt_version, payload, source, created_at`;

export interface SaveViewSpecInput {
  id?: string;
  resultId: string;
  focus: string;
  promptVersion: string;
  payload: unknown;
  source: ViewSpecSource;
}

/** Cache de composicion por resultado + foco + version de prompt. */
export async function saveViewSpec(
  input: SaveViewSpecInput,
  executor?: Executor,
): Promise<ViewSpecRecord> {
  const { rows } = await run<ViewSpecRow>(
    resolve(executor),
    `INSERT INTO ${SCHEMA}.view_specs (id, result_id, focus, prompt_version, payload, source)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT ON CONSTRAINT view_specs_result_focus_prompt_key DO UPDATE
       SET payload = EXCLUDED.payload,
           source = EXCLUDED.source,
           created_at = now()
     RETURNING ${VIEW_SPEC_COLUMNS}`,
    [
      input.id ?? randomUUID(),
      input.resultId,
      input.focus,
      input.promptVersion,
      JSON.stringify(input.payload),
      input.source,
    ],
  );
  return toViewSpec(rows[0]);
}

export async function loadViewSpec(
  resultId: string,
  focus: string,
  promptVersion: string,
  executor?: Executor,
): Promise<ViewSpecRecord | null> {
  const { rows } = await run<ViewSpecRow>(
    resolve(executor),
    `SELECT ${VIEW_SPEC_COLUMNS}
       FROM ${SCHEMA}.view_specs
      WHERE result_id = $1 AND focus = $2 AND prompt_version = $3`,
    [resultId, focus, promptVersion],
  );
  return rows[0] ? toViewSpec(rows[0]) : null;
}

// --- Eventos (hypertable) --------------------------------------------------

export interface AppendEventInput {
  businessId: string;
  scenarioId: string | null;
  revision: number;
  /** Fecha economica a la que se refiere el evento (`YYYY-MM-DD`). */
  effectiveDate: string;
  eventType: EventType;
  payload: Record<string, unknown>;
  /** Solo para reconstrucciones controladas; por defecto lo pone la base. */
  recordedAt?: Date;
}

export interface AppendedEvent {
  eventId: string;
  recordedAt: string;
}

/** Inserta un evento tipado en la hypertable `financial_events`. */
export async function appendEvent(
  input: AppendEventInput,
  executor?: Executor,
): Promise<AppendedEvent> {
  const eventId = randomUUID();
  const { rows } = await run<{ recorded_at: Date | string }>(
    resolve(executor),
    `INSERT INTO ${SCHEMA}.financial_events (
       recorded_at, event_id, business_id, scenario_id, revision, effective_date,
       event_type, payload
     )
     VALUES (COALESCE($1::timestamptz, now()), $2::uuid, $3, $4, $5, $6::date, $7, $8::jsonb)
     RETURNING recorded_at`,
    [
      input.recordedAt ? input.recordedAt.toISOString() : null,
      eventId,
      input.businessId,
      input.scenarioId,
      input.revision,
      input.effectiveDate,
      input.eventType,
      JSON.stringify(input.payload),
    ],
  );
  return { eventId, recordedAt: toIso(rows[0]?.recorded_at ?? null) ?? '' };
}

// --- Idempotencia ----------------------------------------------------------

export interface OperationClaim {
  claimed: boolean;
  existingRef: string | null;
}

/**
 * Mecanismo de idempotencia global. Si la clave es nueva la reclama y devuelve
 * `claimed: true`. Si ya existia devuelve la referencia previa para que la
 * operacion no se repita (confirmacion duplicada).
 */
export async function claimOperationKey(
  key: string,
  operation: string,
  resultRef: string | null = null,
  executor?: Executor,
): Promise<OperationClaim> {
  const db = resolve(executor);
  const inserted = await run<{ key: string }>(
    db,
    `INSERT INTO ${SCHEMA}.operation_keys (key, operation, result_ref)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO NOTHING
     RETURNING key`,
    [key, operation, resultRef],
  );
  if (inserted.rows.length > 0) {
    return { claimed: true, existingRef: resultRef };
  }
  const existing = await run<{ result_ref: string | null }>(
    db,
    `SELECT result_ref FROM ${SCHEMA}.operation_keys WHERE key = $1`,
    [key],
  );
  return { claimed: false, existingRef: existing.rows[0]?.result_ref ?? null };
}

/** Completa la referencia de una clave ya reclamada (por ejemplo, el resultId). */
export async function setOperationResultRef(
  key: string,
  resultRef: string,
  executor?: Executor,
): Promise<void> {
  await run(
    resolve(executor),
    `UPDATE ${SCHEMA}.operation_keys
        SET result_ref = $2
      WHERE key = $1 AND result_ref IS NULL`,
    [key, resultRef],
  );
}
