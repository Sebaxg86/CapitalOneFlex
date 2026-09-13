/**
 * Contratos compartidos entre el servidor y el cliente de la aplicacion.
 * El cliente NUNCA envia resultados calculados como verdad: solo identificadores,
 * revisiones y claves de idempotencia.
 */
import type { EngineResult } from '@/domain/types';
import type { ComposedView, Focus } from '@/server/ai/viewspec';

export interface IntegrationStatus {
  /** Hay variable de entorno presente. No implica que funcione. */
  configured: boolean;
  /** Se comprobo de verdad contra el proveedor en esta ejecucion. */
  verified: boolean;
  detail: string;
  model?: string;
}

export interface IntegrationsState {
  gemini: IntegrationStatus;
  tigerData: IntegrationStatus;
}

export interface BusinessSummary {
  id: string;
  name: string;
  description: string;
  currency: string;
  timezone: string;
}

export interface ScenarioSummary {
  id: string;
  revision: number;
  label: string;
  demoToday: string;
  parentScenarioId: string | null;
}

/** Estado completo del area de trabajo: lo que el cliente necesita para pintar. */
export interface WorkspaceState {
  business: BusinessSummary;
  scenario: ScenarioSummary;
  result: EngineResult;
  view: ComposedView;
  integrations: IntegrationsState;
  /** De donde salio el estado: Tiger Data real o memoria del proceso. */
  storage: 'tiger-data' | 'memoria-local';
  /** Advertencias honestas para la interfaz (modo fixture, etc.). */
  notices: string[];
}

// --- Interpretacion de novedades ------------------------------------------

export type ProposalOperation =
  | { op: 'reschedule_receivable'; obligationId: string; newDate: string }
  | { op: 'exclude_action'; optionId: string }
  | { op: 'set_minimum_cash'; amountCents: number };

export interface ProposalChange {
  operation: ProposalOperation;
  /** Fragmento literal del mensaje que respalda el cambio. */
  evidence: string;
  /** Diff legible calculado por el servidor, no por el modelo. */
  humanDiff: string;
  comparison?: { subject: string; before: string; after: string; note: string };
}

export interface PendingProposal {
  id: string;
  scenarioId: string;
  baseRevision: number;
  changes: ProposalChange[];
  summary: string;
  source: 'gemini' | 'manual';
  /** De donde salio la lectura del mensaje. Se rotula en la interfaz. */
  adapter?: 'gemini' | 'reglas-locales' | 'formulario';
}

export type InterpretResponse =
  | { kind: 'proposal'; proposal: PendingProposal }
  | { kind: 'clarification'; question: string; options: string[]; source: 'gemini' | 'fallback' }
  | { kind: 'error'; message: string; allowManual: true };

export interface ConfirmRequest {
  proposalId: string;
  baseRevision: number;
  idempotencyKey: string;
}

export interface RejectRequest {
  optionId: string;
  baseRevision: number;
  idempotencyKey: string;
}

export interface ComposeRequest {
  resultId: string;
  focus: Focus;
}

export interface MutationResponse {
  state: WorkspaceState;
  /** true cuando la operacion ya se habia aplicado con la misma clave. */
  deduplicated: boolean;
}

// --- Historial ------------------------------------------------------------

/** Naturaleza del evento. Distingue expectativa de dinero realmente movido. */
export type HistoryKind = 'expectativa' | 'liquidado' | 'restriccion' | 'resultado' | 'escenario';

export interface HistoryUndo {
  available: boolean;
  reason?: string;
}

export interface HistoryEntry {
  id: string;
  recordedAt: string;
  effectiveDate: string;
  revision: number;
  scenarioId: string | null;
  eventType: string;
  kind: HistoryKind;
  label: string;
  detail: string;
  undo?: HistoryUndo;
}

export interface BeforeAfter {
  revision: number;
  beforeShortfallCents: number | null;
  afterShortfallCents: number | null;
  beforeMinClosingCents: number | null;
  afterMinClosingCents: number | null;
  beforeResultId: string | null;
  afterResultId: string | null;
}

export interface HistoryResponse {
  entries: HistoryEntry[];
  beforeAfter: BeforeAfter[];
  storage: 'tiger-data' | 'memoria-local';
}

export interface ApiError {
  error: string;
  /** Presente en 409: hay que volver a revisar con la revision vigente. */
  currentRevision?: number;
}

export type { ComposedView, Focus };
