/**
 * Consultas temporales sobre la hypertable `financial_events`. SOLO servidor.
 *
 * Distincion obligatoria del producto: el historial NUNCA presenta una
 * expectativa actualizada como dinero recibido, ni un plan aceptado como pago
 * ejecutado. Cada entrada lleva su tipo, su etiqueta legible y, cuando procede,
 * una advertencia explicita.
 */
import type { Pool, QueryResult, QueryResultRow } from 'pg';
import { getPool, SCHEMA } from './pool';
import type { EventType } from './migrations';
import { loadResultForRevision, type Executor } from './repository';
import { formatCents } from '../../domain/money';
import { formatEconomicDate, isEconomicDate } from '../../domain/dates';
import type { EngineResult } from '../../domain/types';

/** Naturaleza real del evento, separada de su nombre tecnico. */
export type HistoryKind =
  | 'expectation_updated'
  | 'settled_movement'
  | 'scenario_constraint'
  | 'result_generated'
  | 'scenario_created';

export interface HistoryEntry {
  eventId: string;
  /** Timestamp de auditoria en UTC (ISO 8601). */
  recordedAt: string;
  businessId: string;
  scenarioId: string | null;
  revision: number;
  /** Fecha economica a la que afecta el evento (`YYYY-MM-DD`). */
  effectiveDate: string;
  eventType: EventType;
  kind: HistoryKind;
  /** Etiqueta corta en espanol para la interfaz. */
  label: string;
  detail: string;
  /** Advertencia cuando el evento NO representa dinero movido. */
  caveat: string | null;
  payload: Record<string, unknown>;
}

interface Descriptor {
  kind: HistoryKind;
  label: string;
  caveat: string | null;
}

/**
 * Catalogo cerrado de tipos de evento. Los textos son fijos del producto: no
 * los aporta ningun modelo.
 */
const DESCRIPTORS: Record<EventType, Descriptor> = {
  receivable_rescheduled: {
    kind: 'expectation_updated',
    label: 'Expectativa de cobro actualizada',
    caveat:
      'Novedad confirmada sobre la fecha esperada. NO es un cobro recibido: el dinero sigue pendiente.',
  },
  settled_movement: {
    kind: 'settled_movement',
    label: 'Movimiento liquidado',
    caveat: null,
  },
  scenario_constraint: {
    kind: 'scenario_constraint',
    label: 'Restriccion de escenario',
    caveat:
      'Cambia lo que el motor puede considerar. No modifica ningun pago ya registrado.',
  },
  result_generated: {
    kind: 'result_generated',
    label: 'Resultado del motor generado',
    caveat:
      'Los planes calculados siguen siendo escenarios condicionados, no pagos ejecutados.',
  },
  scenario_created: {
    kind: 'scenario_created',
    label: 'Escenario creado',
    caveat: null,
  },
};

interface EventRow extends QueryResultRow {
  event_id: string;
  recorded_at: Date | string;
  business_id: string;
  scenario_id: string | null;
  revision: number;
  effective_date: string;
  event_type: EventType;
  payload: Record<string, unknown> | null;
}

const EVENT_COLUMNS = `
  event_id,
  recorded_at,
  business_id,
  scenario_id,
  revision,
  to_char(effective_date, 'YYYY-MM-DD') AS effective_date,
  event_type,
  payload
`;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

async function run<R extends QueryResultRow>(
  executor: Executor,
  text: string,
  values: unknown[],
): Promise<QueryResult<R>> {
  return (executor as Pool).query<R>(text, values);
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asMoney(value: unknown): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? formatCents(value) : null;
}

function asDate(value: unknown): string | null {
  return isEconomicDate(value) ? formatEconomicDate(value) : null;
}

/**
 * Texto de apoyo construido solo con campos conocidos del payload. Si el
 * payload no trae un dato, no se inventa.
 */
function buildDetail(row: EventRow): string {
  const payload = row.payload ?? {};
  const parts: string[] = [];
  const concept = asText(payload.concept) ?? asText(payload.obligationId);
  const counterparty = asText(payload.counterparty);
  const amount = asMoney(payload.amountCents);
  const fromDate = asDate(payload.fromDate);
  const toDate = asDate(payload.toDate);
  const optionId = asText(payload.optionId);
  const resultId = asText(payload.resultId);
  const note = asText(payload.note);

  switch (row.event_type) {
    case 'receivable_rescheduled': {
      const sujeto = concept ? `El cobro ${concept}` : 'El cobro';
      const de = counterparty ? ` de ${counterparty}` : '';
      const importe = amount ? ` por ${amount}` : '';
      const desde = fromDate ? ` deja de esperarse el ${fromDate}` : '';
      const hasta = toDate ? ` y pasa a esperarse el ${toDate}` : '';
      parts.push(`${sujeto}${de}${importe}${desde}${hasta}.`.replace(/\s+\./, '.'));
      break;
    }
    case 'settled_movement': {
      const sujeto = concept ? `Movimiento ${concept}` : 'Movimiento';
      const importe = amount ? ` por ${amount}` : '';
      const con = counterparty ? ` con ${counterparty}` : '';
      parts.push(`${sujeto}${importe}${con} quedo liquidado.`);
      break;
    }
    case 'scenario_constraint': {
      const accion = optionId ? `Se excluyo la accion ${optionId}.` : 'Se cambio una restriccion del escenario.';
      parts.push(accion);
      break;
    }
    case 'result_generated': {
      parts.push(resultId ? `Se calculo el resultado ${resultId}.` : 'Se calculo un resultado del motor.');
      break;
    }
    case 'scenario_created': {
      parts.push(
        row.scenario_id
          ? `Se registro el escenario ${row.scenario_id}.`
          : 'Se registro un escenario.',
      );
      break;
    }
  }
  if (note) parts.push(note);
  return parts.join(' ');
}

function toEntry(row: EventRow): HistoryEntry {
  const descriptor = DESCRIPTORS[row.event_type];
  return {
    eventId: row.event_id,
    recordedAt: toIso(row.recorded_at),
    businessId: row.business_id,
    scenarioId: row.scenario_id,
    revision: row.revision,
    effectiveDate: row.effective_date,
    eventType: row.event_type,
    kind: descriptor.kind,
    label: descriptor.label,
    detail: buildDetail(row),
    caveat: descriptor.caveat,
    payload: row.payload ?? {},
  };
}

export interface HistoryRange {
  /** Inicio de la ventana (ISO o Date). Por defecto, sin limite inferior. */
  from?: string | Date;
  /** Fin de la ventana (ISO o Date). Por defecto, sin limite superior. */
  to?: string | Date;
}

function boundary(value: string | Date | undefined, fallback: '-infinity' | 'infinity'): string {
  if (value === undefined) return fallback;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Consulta temporal real sobre la hypertable: eventos de un negocio dentro de
 * una ventana, ordenados por tiempo y revision.
 */
export async function getHistory(
  businessId: string,
  range: HistoryRange = {},
  executor?: Executor,
): Promise<HistoryEntry[]> {
  const db = executor ?? getPool();
  const { rows } = await run<EventRow>(
    db,
    `SELECT ${EVENT_COLUMNS}
       FROM ${SCHEMA}.financial_events
      WHERE business_id = $1
        AND recorded_at BETWEEN $2::timestamptz AND $3::timestamptz
      ORDER BY recorded_at ASC, revision ASC`,
    [businessId, boundary(range.from, '-infinity'), boundary(range.to, 'infinity')],
  );
  return rows.map(toEntry);
}

export interface BeforeAfter {
  before: EngineResult | null;
  after: EngineResult | null;
  event: HistoryEntry | null;
}

/**
 * Reconstruye los snapshots antes/despues de una revision. `before` es el
 * ultimo resultado calculado en una revision anterior; `after`, el de la
 * revision indicada. Sirve para verificar el origen de un faltante sin
 * atribuir causalidad a ningun texto generado.
 */
export async function getBeforeAfter(
  scenarioId: string,
  revision: number,
  executor?: Executor,
): Promise<BeforeAfter> {
  const db = executor ?? getPool();
  const after = await loadResultForRevision(scenarioId, revision, db);

  const previous = await run<{ payload: EngineResult }>(
    db,
    `SELECT payload
       FROM ${SCHEMA}.scenario_results
      WHERE scenario_id = $1 AND revision < $2
      ORDER BY revision DESC, computed_at DESC
      LIMIT 1`,
    [scenarioId, revision],
  );

  const eventRows = await run<EventRow>(
    db,
    `SELECT ${EVENT_COLUMNS}
       FROM ${SCHEMA}.financial_events
      WHERE scenario_id = $1 AND revision = $2
      ORDER BY recorded_at ASC
      LIMIT 1`,
    [scenarioId, revision],
  );

  return {
    before: previous.rows[0]?.payload ?? null,
    after,
    event: eventRows.rows[0] ? toEntry(eventRows.rows[0]) : null,
  };
}
