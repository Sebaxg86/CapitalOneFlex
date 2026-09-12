/**
 * Contrato de la composicion dinamica de pantallas.
 *
 * El modelo elige QUE componentes se muestran, en que ORDEN y con que
 * PROTAGONISMO, y puede aportar titulos y notas breves. No aporta numeros,
 * HTML, estilos, codigo ni referencias inventadas:
 *
 * - Catalogo cerrado de seis componentes.
 * - Maximo seis secciones, sin tipos duplicados.
 * - Cada referencia debe pertenecer al resultado del motor recibido.
 * - Los textos del modelo no pueden contener digitos: cualquier cifra se cita
 *   con un token `{{fact:...}}` que resuelve el servidor con el valor del motor.
 * - Reglas del servidor: si hay riesgo se exige resumen de riesgo; si hay
 *   planes se exige comparacion; si no hay planes se exigen bloqueos y se
 *   elimina la comparacion vacia.
 */
import { z } from 'zod';
import type { EngineResult } from '@/domain/types';

/** Version del contrato + prompt. Forma parte de la clave de cache. */
export const PROMPT_VERSION = 'v1';

export const COMPONENT_TYPES = [
  'risk_summary',
  'cash_calendar',
  'receivables',
  'plan_comparison',
  'constraints',
  'history',
] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

export const EMPHASIS_VALUES = ['high', 'normal', 'low'] as const;
export type Emphasis = (typeof EMPHASIS_VALUES)[number];

export const FOCUS_VALUES = ['overview', 'payroll', 'receivables', 'no_solution', 'history'] as const;
export type Focus = (typeof FOCUS_VALUES)[number];

export const MAX_SECTIONS = 6;

export const FOCUS_LABELS: Record<Focus, string> = {
  overview: 'Panorama general',
  payroll: 'Nómina y riesgo',
  receivables: 'Cobros pendientes',
  no_solution: 'Bloqueos y faltante',
  history: 'Historial',
};

export const COMPONENT_LABELS: Record<ComponentType, string> = {
  risk_summary: 'Resumen de riesgo',
  cash_calendar: 'Calendario de caja',
  receivables: 'Facturas relevantes',
  plan_comparison: 'Comparador de planes',
  constraints: 'Restricciones y bloqueos',
  history: 'Historial de decisiones',
};

// --- Validacion de los textos del modelo ----------------------------------

const FACT_TOKEN_RE = /\{\{(fact:[A-Za-z0-9:_.-]+)\}\}/g;

/** Texto libre prohibido: digitos, marcado, llaves sueltas, URLs, SQL. */
const FORBIDDEN_RESIDUE_RE = /[0-9<>{}\\$]/;
const URL_RE = /https?:|www\.|:\/\//i;
const SQL_RE = /\b(select|insert|update|delete|drop|union|script|javascript)\b/i;

export interface TextIssue {
  field: string;
  reason: string;
}

/**
 * Comprueba un texto aportado por el modelo y devuelve los tokens de hechos
 * que usa. Rechaza cualquier cifra escrita a mano.
 */
export function checkModelText(
  text: string,
  field: string,
  allowedFactIds: Set<string>,
): { issues: TextIssue[]; factIds: string[] } {
  const issues: TextIssue[] = [];
  const factIds: string[] = [];

  for (const match of text.matchAll(FACT_TOKEN_RE)) {
    const id = match[1];
    factIds.push(id);
    if (!allowedFactIds.has(id)) {
      issues.push({ field, reason: 'cita un hecho que no pertenece a este resultado: ' + id });
    }
  }

  const residue = text.replace(FACT_TOKEN_RE, ' ');
  if (FORBIDDEN_RESIDUE_RE.test(residue)) {
    issues.push({
      field,
      reason: 'contiene cifras o marcado fuera de un token de hecho del motor',
    });
  }
  if (URL_RE.test(residue)) issues.push({ field, reason: 'contiene una URL' });
  if (SQL_RE.test(residue)) issues.push({ field, reason: 'contiene lenguaje de consulta o script' });

  // No aceptar titulos que afirmen una garantia o aprobacion inexistente.
  if (/\b(garantizad|asegurad|aprobad|confirmad por el proveedor|ya acept)/i.test(residue)) {
    issues.push({ field, reason: 'afirma una garantía o aprobación que no existe' });
  }

  return { issues, factIds };
}

/** Sustituye los tokens `{{fact:...}}` por el valor calculado por el motor. */
export function resolveFactTokens(text: string, result: EngineResult): string {
  return text.replace(FACT_TOKEN_RE, (whole, id: string) => {
    const fact = result.facts[id];
    return fact ? fact.value : whole;
  });
}

// --- Esquema de la composicion --------------------------------------------

const refSchema = z.string().min(1).max(120);

const sectionBase = {
  emphasis: z.enum(EMPHASIS_VALUES),
  refs: z.array(refSchema).max(8).default([]),
  title: z.string().max(80).optional(),
  note: z.string().max(280).optional(),
};

export const viewSpecSectionSchema = z.discriminatedUnion('type', [
  z.object({ ...sectionBase, type: z.literal('risk_summary') }).strict(),
  z.object({ ...sectionBase, type: z.literal('cash_calendar') }).strict(),
  z.object({ ...sectionBase, type: z.literal('receivables') }).strict(),
  z.object({ ...sectionBase, type: z.literal('plan_comparison') }).strict(),
  z.object({ ...sectionBase, type: z.literal('constraints') }).strict(),
  z.object({ ...sectionBase, type: z.literal('history') }).strict(),
]);

export const viewSpecSchema = z
  .object({
    schemaVersion: z.literal(1),
    resultId: z.string().min(1).max(120),
    focus: z.enum(FOCUS_VALUES),
    sections: z.array(viewSpecSectionSchema).min(1).max(MAX_SECTIONS),
  })
  .strict();

export type ViewSpecSection = {
  type: ComponentType;
  emphasis: Emphasis;
  refs: string[];
  title?: string;
  note?: string;
};

export type ViewSpec = {
  schemaVersion: 1;
  resultId: string;
  focus: Focus;
  sections: ViewSpecSection[];
};

/** Composicion lista para renderizar, con la huella de lo que hizo el servidor. */
export interface ComposedView {
  spec: ViewSpec;
  source: 'gemini' | 'fallback';
  /** Ajustes que el servidor impuso sobre la propuesta del modelo. */
  enforcement: string[];
  /** Motivo del fallback, cuando lo hay. Nunca se atribuye a Gemini. */
  fallbackReason?: string;
  promptVersion: string;
}

export interface ValidationOutcome {
  ok: boolean;
  spec?: ViewSpec;
  issues: string[];
}

/** Referencias que un componente puede citar, por tipo. */
const REF_PREFIX_BY_TYPE: Record<ComponentType, string[]> = {
  risk_summary: ['risk:', 'fact:', 'obligation:', 'day:'],
  cash_calendar: ['day:', 'fact:', 'obligation:'],
  receivables: ['obligation:', 'fact:'],
  plan_comparison: ['plan:', 'fact:', 'constraint:'],
  constraints: ['constraint:', 'fact:', 'obligation:'],
  history: ['history:', 'fact:'],
};

/**
 * Valida una composicion contra el resultado del motor vigente.
 * Rechaza campos desconocidos, referencias inventadas, importes escritos por
 * el modelo, secciones duplicadas y composiciones de un resultado anterior.
 */
export function validateViewSpec(raw: unknown, result: EngineResult): ValidationOutcome {
  const parsed = viewSpecSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message),
    };
  }
  const spec = parsed.data as ViewSpec;
  const issues: string[] = [];

  if (spec.resultId !== result.id) {
    issues.push(
      'la composición pertenece a otro resultado (' +
        spec.resultId +
        '); se descarta por ser anterior o ajena',
    );
    return { ok: false, issues };
  }

  const seen = new Set<ComponentType>();
  for (const section of spec.sections) {
    if (seen.has(section.type)) {
      issues.push('sección duplicada: ' + section.type);
    }
    seen.add(section.type);
  }

  const validRefs = new Set(result.refs);
  const factIds = new Set(Object.keys(result.facts));

  for (const [index, section] of spec.sections.entries()) {
    const where = 'sections[' + index + '] (' + section.type + ')';
    for (const ref of section.refs) {
      if (!validRefs.has(ref)) {
        issues.push(where + ': referencia inexistente en el resultado: ' + ref);
        continue;
      }
      const allowed = REF_PREFIX_BY_TYPE[section.type];
      if (!allowed.some((prefix) => ref.startsWith(prefix))) {
        issues.push(where + ': referencia no aplicable a este componente: ' + ref);
      }
    }
    if (section.title) {
      for (const issue of checkModelText(section.title, where + '.title', factIds).issues) {
        issues.push(issue.field + ': ' + issue.reason);
      }
    }
    if (section.note) {
      for (const issue of checkModelText(section.note, where + '.note', factIds).issues) {
        issues.push(issue.field + ': ' + issue.reason);
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, spec, issues: [] };
}

// --- Reglas que el servidor impone siempre --------------------------------

function hasType(spec: ViewSpec, type: ComponentType): boolean {
  return spec.sections.some((s) => s.type === type);
}

function defaultSection(type: ComponentType, result: EngineResult, emphasis: Emphasis): ViewSpecSection {
  const refs: string[] = [];
  switch (type) {
    case 'risk_summary':
      refs.push(...result.risks.map((r) => r.id).slice(0, 3));
      break;
    case 'plan_comparison':
      refs.push(...result.plans.map((p) => p.id));
      break;
    case 'constraints':
      refs.push(...result.constraints.map((c) => c.id).slice(0, 6));
      break;
    case 'cash_calendar':
      refs.push(...result.horizon.days.map((d) => 'day:' + d).slice(0, 8));
      break;
    case 'receivables':
      refs.push(...result.receivables.map((r) => 'obligation:' + r.obligationId).slice(0, 6));
      break;
    case 'history':
      refs.push('history:scenario');
      break;
  }
  return { type, emphasis, refs: refs.filter((r) => result.refs.includes(r)) };
}

/**
 * Impone las reglas no negociables. La vista nunca puede ocultar inviabilidad
 * ni condiciones de aceptacion, aunque el modelo las omita.
 */
export function enforceServerRules(
  spec: ViewSpec,
  result: EngineResult,
): { spec: ViewSpec; enforcement: string[] } {
  const enforcement: string[] = [];
  let sections = [...spec.sections];

  const hasRisk = result.baseline.shortfallCents > 0 || result.risks.length > 0;
  const hasPlans = result.plans.length > 0;

  // 1. Comparacion vacia fuera.
  if (!hasPlans && sections.some((s) => s.type === 'plan_comparison')) {
    sections = sections.filter((s) => s.type !== 'plan_comparison');
    enforcement.push('Se eliminó el comparador de planes: no hay planes que comparar.');
  }

  // 2. Si hay riesgo, el resumen de riesgo es obligatorio y va primero.
  if (hasRisk && !sections.some((s) => s.type === 'risk_summary')) {
    sections.unshift(defaultSection('risk_summary', result, 'high'));
    enforcement.push('Se añadió el resumen de riesgo: el escenario tiene faltante de caja.');
  }

  // 3. Si hay planes, la comparacion es obligatoria.
  if (hasPlans && !sections.some((s) => s.type === 'plan_comparison')) {
    sections.push(defaultSection('plan_comparison', result, 'normal'));
    enforcement.push('Se añadió la comparación de planes con sus condiciones pendientes.');
  }

  // 4. Si hay riesgo y no hay planes, los bloqueos son obligatorios.
  if (hasRisk && !hasPlans && !sections.some((s) => s.type === 'constraints')) {
    sections.push(defaultSection('constraints', result, 'high'));
    enforcement.push('Se añadieron las restricciones: no existe plan dentro de las acciones permitidas.');
  }

  // 5. Si algun plan es condicionado, las restricciones deben estar visibles.
  const anyConditional = result.plans.some((p) => p.conditional);
  if (anyConditional && !sections.some((s) => s.type === 'constraints')) {
    sections.push(defaultSection('constraints', result, 'normal'));
    enforcement.push('Se añadieron las condiciones de aceptación pendientes.');
  }

  // 6. Sin duplicados y con tope de secciones.
  const seen = new Set<ComponentType>();
  const deduped: ViewSpecSection[] = [];
  for (const section of sections) {
    if (seen.has(section.type)) {
      enforcement.push('Se eliminó una sección duplicada: ' + COMPONENT_LABELS[section.type] + '.');
      continue;
    }
    seen.add(section.type);
    deduped.push(section);
  }
  sections = deduped;

  if (sections.length > MAX_SECTIONS) {
    const required = new Set<ComponentType>();
    if (hasRisk) required.add('risk_summary');
    if (hasPlans) required.add('plan_comparison');
    if ((hasRisk && !hasPlans) || anyConditional) required.add('constraints');
    const kept: ViewSpecSection[] = [];
    for (const section of sections) {
      if (kept.length < MAX_SECTIONS || required.has(section.type)) kept.push(section);
    }
    sections = kept.slice(0, MAX_SECTIONS);
    enforcement.push('Se recortó la composición al máximo de secciones permitido.');
  }

  return { spec: { ...spec, sections }, enforcement };
}

// --- Vista basica determinista (sin IA) ------------------------------------

/**
 * Composicion de respaldo calculada por el servidor. Se usa cuando la
 * composicion de Gemini falla o no esta configurada. Se rotula como tal:
 * nunca se presenta como salida del modelo.
 */
export function buildFallbackViewSpec(result: EngineResult, focus: Focus): ViewSpec {
  const hasRisk = result.baseline.shortfallCents > 0 || result.risks.length > 0;
  const hasPlans = result.plans.length > 0;

  let order: ComponentType[];
  if (focus === 'receivables') {
    order = ['receivables', 'risk_summary', 'plan_comparison', 'cash_calendar', 'constraints'];
  } else if (focus === 'history') {
    order = ['history', 'risk_summary', 'cash_calendar', 'constraints'];
  } else if (!hasPlans && hasRisk) {
    order = ['constraints', 'risk_summary', 'cash_calendar', 'history'];
  } else if (hasRisk) {
    order = ['risk_summary', 'plan_comparison', 'cash_calendar', 'constraints'];
  } else {
    order = ['cash_calendar', 'receivables', 'constraints'];
  }

  const sections = order
    .filter((type) => {
      if (type === 'plan_comparison' && !hasPlans) return false;
      if (type === 'risk_summary' && !hasRisk) return false;
      return true;
    })
    .slice(0, MAX_SECTIONS)
    .map((type, index) =>
      defaultSection(type, result, index === 0 ? 'high' : 'normal'),
    );

  return { schemaVersion: 1, resultId: result.id, focus, sections };
}

/** Composicion de respaldo ya empaquetada y con las reglas del servidor aplicadas. */
export function fallbackComposedView(
  result: EngineResult,
  focus: Focus,
  reason: string,
): ComposedView {
  const base = buildFallbackViewSpec(result, focus);
  const { spec, enforcement } = enforceServerRules(base, result);
  return {
    spec,
    source: 'fallback',
    enforcement,
    fallbackReason: reason,
    promptVersion: PROMPT_VERSION,
  };
}
