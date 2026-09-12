/**
 * Almacen del escenario y su historia. Dos implementaciones:
 * - Tiger Data (PostgreSQL + Timescale): la modalidad real.
 * - Memoria del proceso: solo para trabajar sin credenciales. Se rotula en la
 *   interfaz y no sobrevive a un reinicio del servidor.
 */
import type { EngineResult, ScenarioInput } from '@/domain/types';
import type { ComposedView } from '@/server/ai/viewspec';
import type { PendingProposal } from '@/lib/contracts';

export const EVENT_TYPES = [
  /** Una novedad confirmada sobre un cobro: expectativa actualizada. */
  'receivable_rescheduled',
  /** Un movimiento realmente liquidado. */
  'settled_movement',
  /** Una restriccion del escenario (accion descartada, caja minima). */
  'scenario_constraint',
  /** Un resultado del motor generado y persistido. */
  'result_generated',
  /** Creacion de un escenario derivado. */
  'scenario_created',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface ScenarioRecord {
  input: ScenarioInput;
  label: string;
  parentScenarioId: string | null;
}

export interface EventRecord {
  eventId: string;
  /** Timestamp de auditoria en UTC. */
  recordedAt: string;
  businessId: string;
  scenarioId: string | null;
  revision: number;
  /** Fecha economica a la que se refiere el evento. */
  effectiveDate: string;
  eventType: EventType;
  payload: Record<string, unknown>;
}

export interface StoredViewSpec {
  view: ComposedView;
  resultId: string;
  focus: string;
  promptVersion: string;
}

export interface ClaimOutcome {
  claimed: boolean;
  existingRef: string | null;
}

export class RevisionConflict extends Error {
  readonly currentRevision: number;
  constructor(currentRevision: number) {
    super('el escenario cambió desde que se generó la propuesta');
    this.name = 'RevisionConflict';
    this.currentRevision = currentRevision;
  }
}

export interface Store {
  readonly kind: 'tiger-data' | 'memoria-local';
  /** Descripcion honesta del almacen para la interfaz. */
  describe(): string;

  ensureReady(): Promise<void>;

  getScenario(scenarioId: string): Promise<ScenarioRecord | null>;
  saveScenario(record: ScenarioRecord): Promise<void>;

  getCurrentScenarioId(businessId: string): Promise<string | null>;
  setCurrentScenarioId(businessId: string, scenarioId: string): Promise<void>;

  getResult(resultId: string): Promise<EngineResult | null>;
  saveResult(result: EngineResult): Promise<void>;

  getViewSpec(resultId: string, focus: string, promptVersion: string): Promise<ComposedView | null>;
  saveViewSpec(entry: StoredViewSpec): Promise<void>;

  savePendingProposal(proposal: PendingProposal): Promise<void>;
  getPendingProposal(proposalId: string): Promise<PendingProposal | null>;
  markProposalResolved(proposalId: string, status: 'confirmed' | 'discarded'): Promise<void>;

  appendEvent(event: Omit<EventRecord, 'eventId' | 'recordedAt'>): Promise<EventRecord>;
  listEvents(businessId: string, from?: string, to?: string): Promise<EventRecord[]>;

  /** Idempotencia global. Devuelve claimed=false si la clave ya se uso. */
  claimOperationKey(key: string, operation: string, resultRef: string): Promise<ClaimOutcome>;
}
