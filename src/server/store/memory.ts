/**
 * Almacen en memoria del proceso. Existe solo para poder trabajar sin
 * credenciales de Tiger Data. NO es persistencia: se pierde al reiniciar y la
 * interfaz lo declara. Nunca se presenta como la integracion real.
 */
import type { EngineResult } from '@/domain/types';
import type { ComposedView } from '@/server/ai/viewspec';
import type { PendingProposal } from '@/lib/contracts';
import type {
  ClaimOutcome,
  EventRecord,
  ScenarioRecord,
  Store,
  StoredViewSpec,
} from './types';

interface MemoryState {
  scenarios: Map<string, ScenarioRecord>;
  current: Map<string, string>;
  results: Map<string, EngineResult>;
  viewSpecs: Map<string, ComposedView>;
  proposals: Map<string, { proposal: PendingProposal; status: 'pending' | 'confirmed' | 'discarded' }>;
  events: EventRecord[];
  operationKeys: Map<string, string>;
}

/**
 * El estado vive en globalThis para sobrevivir al recargado de modulos de
 * Next.js en desarrollo. Sigue siendo memoria del proceso.
 */
const GLOBAL_KEY = Symbol.for('compromisos.memory-store');

function state(): MemoryState {
  const holder = globalThis as unknown as Record<symbol, MemoryState | undefined>;
  if (!holder[GLOBAL_KEY]) {
    holder[GLOBAL_KEY] = {
      scenarios: new Map(),
      current: new Map(),
      results: new Map(),
      viewSpecs: new Map(),
      proposals: new Map(),
      events: [],
      operationKeys: new Map(),
    };
  }
  return holder[GLOBAL_KEY]!;
}

const viewKey = (resultId: string, focus: string, promptVersion: string) =>
  resultId + '|' + focus + '|' + promptVersion;

export class MemoryStore implements Store {
  readonly kind = 'memoria-local' as const;

  describe(): string {
    return 'Memoria del proceso: el escenario y el historial se pierden al reiniciar el servidor.';
  }

  async ensureReady(): Promise<void> {
    /* nada que preparar */
  }

  async getScenario(scenarioId: string): Promise<ScenarioRecord | null> {
    return state().scenarios.get(scenarioId) ?? null;
  }

  async saveScenario(record: ScenarioRecord): Promise<void> {
    state().scenarios.set(record.input.scenarioId, structuredClone(record));
  }

  async getCurrentScenarioId(businessId: string): Promise<string | null> {
    return state().current.get(businessId) ?? null;
  }

  async setCurrentScenarioId(businessId: string, scenarioId: string): Promise<void> {
    state().current.set(businessId, scenarioId);
  }

  async getResult(resultId: string): Promise<EngineResult | null> {
    return state().results.get(resultId) ?? null;
  }

  async saveResult(result: EngineResult): Promise<void> {
    state().results.set(result.id, result);
  }

  async getViewSpec(
    resultId: string,
    focus: string,
    promptVersion: string,
  ): Promise<ComposedView | null> {
    return state().viewSpecs.get(viewKey(resultId, focus, promptVersion)) ?? null;
  }

  async saveViewSpec(entry: StoredViewSpec): Promise<void> {
    state().viewSpecs.set(
      viewKey(entry.resultId, entry.focus, entry.promptVersion),
      entry.view,
    );
  }

  async savePendingProposal(proposal: PendingProposal): Promise<void> {
    state().proposals.set(proposal.id, { proposal, status: 'pending' });
  }

  async getPendingProposal(proposalId: string): Promise<PendingProposal | null> {
    const entry = state().proposals.get(proposalId);
    return entry && entry.status === 'pending' ? entry.proposal : null;
  }

  async markProposalResolved(
    proposalId: string,
    status: 'confirmed' | 'discarded',
  ): Promise<void> {
    const entry = state().proposals.get(proposalId);
    if (entry) entry.status = status;
  }

  async appendEvent(event: Omit<EventRecord, 'eventId' | 'recordedAt'>): Promise<EventRecord> {
    const full: EventRecord = {
      ...event,
      eventId: crypto.randomUUID(),
      recordedAt: new Date().toISOString(),
    };
    state().events.push(full);
    return full;
  }

  async listEvents(businessId: string, from?: string, to?: string): Promise<EventRecord[]> {
    return state()
      .events.filter((e) => e.businessId === businessId)
      .filter((e) => (from ? e.recordedAt >= from : true))
      .filter((e) => (to ? e.recordedAt <= to : true))
      .sort((a, b) =>
        a.recordedAt === b.recordedAt ? a.revision - b.revision : a.recordedAt < b.recordedAt ? -1 : 1,
      );
  }

  async claimOperationKey(
    key: string,
    _operation: string,
    resultRef: string,
  ): Promise<ClaimOutcome> {
    const keys = state().operationKeys;
    const existing = keys.get(key);
    if (existing !== undefined) return { claimed: false, existingRef: existing };
    keys.set(key, resultRef);
    return { claimed: true, existingRef: null };
  }

  /** Solo para pruebas: vacia el estado del proceso. */
  static reset(): void {
    const holder = globalThis as unknown as Record<symbol, MemoryState | undefined>;
    holder[GLOBAL_KEY] = undefined;
  }
}
