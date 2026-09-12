/**
 * Almacen sobre Tiger Data (PostgreSQL + Timescale).
 * Adapta los repositorios de `src/server/db` a la interfaz `Store`.
 *
 * La lectura del historial es una consulta temporal real sobre la hypertable
 * `financial_events`, acotada por negocio y ventana de tiempo.
 */
import type { EngineResult } from '@/domain/types';
import type { ComposedView } from '@/server/ai/viewspec';
import type { PendingProposal } from '@/lib/contracts';
import { getPool, SCHEMA } from '@/server/db/pool';
import { runMigrations } from '@/server/db/migrations';
import {
  appendEvent as dbAppendEvent,
  claimOperationKey as dbClaimOperationKey,
  loadPendingProposal,
  loadResult,
  loadScenarioInput,
  loadScenarioMeta,
  loadViewSpec,
  markProposalResolved as dbMarkProposalResolved,
  saveResult as dbSaveResult,
  saveScenario as dbSaveScenario,
  savePendingProposal as dbSavePendingProposal,
  saveViewSpec as dbSaveViewSpec,
} from '@/server/db/repository';
import { DEMO_BUSINESS_ID } from '@fixtures/index';
import type {
  ClaimOutcome,
  EventRecord,
  EventType,
  ScenarioRecord,
  Store,
  StoredViewSpec,
} from './types';

interface EventRow {
  event_id: string;
  recorded_at: string;
  business_id: string;
  scenario_id: string | null;
  revision: number;
  effective_date: string;
  event_type: EventType;
  payload: Record<string, unknown>;
}

export class TigerDataStore implements Store {
  readonly kind = 'tiger-data' as const;

  describe(): string {
    return 'Servicio Tiger Data configurado en DATABASE_URL, schema dedicado "' + SCHEMA + '".';
  }

  async ensureReady(): Promise<void> {
    const pool = getPool();
    await runMigrations(pool);
    // Comprobacion minima de lectura para no declarar conexion sin verificarla.
    await pool.query('SELECT 1');
  }

  async getScenario(scenarioId: string): Promise<ScenarioRecord | null> {
    const input = await loadScenarioInput(scenarioId);
    if (!input) return null;
    const meta = await loadScenarioMeta(scenarioId);
    return {
      input,
      label: meta?.label ?? 'Escenario',
      parentScenarioId: meta?.parentScenarioId ?? null,
    };
  }

  async saveScenario(record: ScenarioRecord): Promise<void> {
    await dbSaveScenario(record.input, {
      label: record.label,
      parentScenarioId: record.parentScenarioId,
    });
  }

  async getCurrentScenarioId(businessId: string): Promise<string | null> {
    const { rows } = await getPool().query<{ current_scenario_id: string }>(
      `SELECT current_scenario_id FROM ${SCHEMA}.business_state WHERE business_id = $1`,
      [businessId],
    );
    return rows[0]?.current_scenario_id ?? null;
  }

  async setCurrentScenarioId(businessId: string, scenarioId: string): Promise<void> {
    await getPool().query(
      `INSERT INTO ${SCHEMA}.business_state (business_id, current_scenario_id)
       VALUES ($1, $2)
       ON CONFLICT (business_id) DO UPDATE
         SET current_scenario_id = EXCLUDED.current_scenario_id,
             updated_at = now()`,
      [businessId, scenarioId],
    );
  }

  async getResult(resultId: string): Promise<EngineResult | null> {
    return loadResult(resultId);
  }

  async saveResult(result: EngineResult): Promise<void> {
    await dbSaveResult(result);
  }

  async getViewSpec(
    resultId: string,
    focus: string,
    promptVersion: string,
  ): Promise<ComposedView | null> {
    const record = await loadViewSpec(resultId, focus, promptVersion);
    if (!record) return null;
    return record.payload as ComposedView;
  }

  async saveViewSpec(entry: StoredViewSpec): Promise<void> {
    await dbSaveViewSpec({
      resultId: entry.resultId,
      focus: entry.focus,
      promptVersion: entry.promptVersion,
      payload: entry.view,
      source: entry.view.source,
    });
  }

  async savePendingProposal(proposal: PendingProposal): Promise<void> {
    await dbSavePendingProposal({
      id: proposal.id,
      businessId: DEMO_BUSINESS_ID,
      scenarioId: proposal.scenarioId,
      baseRevision: proposal.baseRevision,
      payload: proposal,
    });
  }

  async getPendingProposal(proposalId: string): Promise<PendingProposal | null> {
    const record = await loadPendingProposal(proposalId);
    if (!record || record.status !== 'pending') return null;
    return record.payload as PendingProposal;
  }

  async markProposalResolved(
    proposalId: string,
    status: 'confirmed' | 'discarded',
  ): Promise<void> {
    await dbMarkProposalResolved(proposalId, status);
  }

  async appendEvent(event: Omit<EventRecord, 'eventId' | 'recordedAt'>): Promise<EventRecord> {
    const appended = await dbAppendEvent({
      businessId: event.businessId,
      scenarioId: event.scenarioId,
      revision: event.revision,
      effectiveDate: event.effectiveDate,
      eventType: event.eventType,
      payload: event.payload,
    });
    return { ...event, eventId: appended.eventId, recordedAt: appended.recordedAt };
  }

  /** Consulta temporal sobre la hypertable, acotada por negocio y ventana. */
  async listEvents(businessId: string, from?: string, to?: string): Promise<EventRecord[]> {
    const { rows } = await getPool().query<EventRow>(
      `SELECT event_id,
              to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS recorded_at,
              business_id,
              scenario_id,
              revision,
              to_char(effective_date, 'YYYY-MM-DD') AS effective_date,
              event_type,
              payload
         FROM ${SCHEMA}.financial_events
        WHERE business_id = $1
          AND recorded_at >= COALESCE($2::timestamptz, '-infinity'::timestamptz)
          AND recorded_at <= COALESCE($3::timestamptz, 'infinity'::timestamptz)
        ORDER BY recorded_at ASC, revision ASC`,
      [businessId, from ?? null, to ?? null],
    );
    return rows.map((row) => ({
      eventId: row.event_id,
      recordedAt: row.recorded_at,
      businessId: row.business_id,
      scenarioId: row.scenario_id,
      revision: row.revision,
      effectiveDate: row.effective_date,
      eventType: row.event_type,
      payload: row.payload ?? {},
    }));
  }

  async claimOperationKey(
    key: string,
    operation: string,
    resultRef: string,
  ): Promise<ClaimOutcome> {
    return dbClaimOperationKey(key, operation, resultRef);
  }
}
