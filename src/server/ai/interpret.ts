/**
 * Validacion semantica de la interpretacion y construccion del diff humano.
 *
 * Nada de lo que devuelve el modelo se aplica sin pasar por aqui:
 * - los identificadores deben existir en el escenario vigente,
 * - las fechas deben ser reales y posteriores al dia de la demo,
 * - cada cambio debe estar respaldado por un fragmento literal del mensaje,
 * - los importes provienen del mensaje del usuario, nunca del modelo.
 *
 * Si algo no encaja, no se aplica nada: se devuelve un error y el usuario
 * puede editar el cambio a mano por el mismo flujo de confirmacion.
 */
import { z } from 'zod';
import { addDays, compareDates, formatEconomicDate, isEconomicDate } from '@/domain/dates';
import { formatCents, pesos } from '@/domain/money';
import type { ScenarioInput } from '@/domain/types';
import type { PendingProposal, ProposalChange, ProposalOperation } from '@/lib/contracts';

/** Ventana razonable para una nueva fecha de cobro. */
export const MAX_RESCHEDULE_DAYS = 180;

const rawChangeSchema = z.object({
  op: z.enum(['reschedule_receivable', 'exclude_action', 'set_minimum_cash']),
  obligationId: z.string().optional(),
  optionId: z.string().optional(),
  newDate: z.string().optional(),
  amountPesos: z.number().optional(),
  evidence: z.string().min(1).max(400),
});

const rawInterpretSchema = z.object({
  kind: z.enum(['clarification', 'proposal']),
  question: z.string().max(300).optional(),
  options: z.array(z.string().max(160)).max(4).optional(),
  changes: z.array(rawChangeSchema).max(3).optional(),
});

export type RawInterpretation = z.infer<typeof rawInterpretSchema>;

export interface InterpretationOutcome {
  kind: 'proposal' | 'clarification' | 'error';
  proposal?: PendingProposal;
  question?: string;
  options?: string[];
  issues: string[];
}

/** Normaliza para comparar fragmentos: minusculas, sin acentos, espacios simples. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function evidenceIsGrounded(evidence: string, message: string): boolean {
  const needle = normalize(evidence);
  if (needle.length < 4) return false;
  return normalize(message).includes(needle);
}

function makeProposalId(): string {
  return 'proposal:' + crypto.randomUUID();
}

/**
 * Valida la respuesta cruda del modelo contra el escenario y el mensaje original.
 */
export function validateInterpretation(
  raw: unknown,
  scenario: ScenarioInput,
  message: string,
  source: 'gemini' | 'manual',
  adapter: 'gemini' | 'reglas-locales',
): InterpretationOutcome {
  const parsed = rawInterpretSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: 'error',
      issues: parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message),
    };
  }
  const data = parsed.data;

  if (data.kind === 'clarification') {
    const question =
      data.question?.trim() ||
      'El mensaje no permite fijar el cambio con certeza. Indica la factura y la fecha exacta.';
    return { kind: 'clarification', question, options: data.options ?? [], issues: [] };
  }

  const changes = data.changes ?? [];
  if (changes.length === 0) {
    return {
      kind: 'clarification',
      question: 'El mensaje no contiene un cambio aplicable al escenario. Precisa qué debería cambiar.',
      options: [],
      issues: [],
    };
  }

  const issues: string[] = [];
  const validated: ProposalChange[] = [];
  const maxDate = addDays(scenario.demoToday, MAX_RESCHEDULE_DAYS);

  for (const [index, change] of changes.entries()) {
    const where = 'cambio ' + String(index + 1);

    if (!evidenceIsGrounded(change.evidence, message)) {
      issues.push(where + ': el fragmento citado no aparece literalmente en el mensaje');
      continue;
    }

    if (change.op === 'reschedule_receivable') {
      const ob = scenario.obligations.find((o) => o.id === change.obligationId);
      if (!ob) {
        issues.push(where + ': la factura citada no existe en este escenario');
        continue;
      }
      if (ob.direction !== 'inflow') {
        issues.push(where + ': solo se puede reprogramar un cobro');
        continue;
      }
      if (ob.settled) {
        issues.push(where + ': ese movimiento ya está liquidado y no se reprograma');
        continue;
      }
      if (!change.newDate || !isEconomicDate(change.newDate)) {
        issues.push(where + ': la fecha propuesta no es una fecha válida');
        continue;
      }
      if (compareDates(change.newDate, scenario.demoToday) < 0) {
        issues.push(where + ': la fecha propuesta es anterior al día de la demo');
        continue;
      }
      if (compareDates(change.newDate, maxDate) > 0) {
        issues.push(where + ': la fecha propuesta queda fuera de la ventana razonable');
        continue;
      }
      if (change.newDate === ob.date) {
        issues.push(where + ': la fecha propuesta es la que ya estaba registrada');
        continue;
      }
      const operation: ProposalOperation = {
        op: 'reschedule_receivable',
        obligationId: ob.id,
        newDate: change.newDate,
      };
      validated.push({
        operation,
        evidence: change.evidence.trim(),
        humanDiff:
          ob.concept +
          ' (' +
          ob.counterparty +
          ', ' +
          formatCents(ob.amountCents) +
          '): el cobro esperado pasa del ' +
          formatEconomicDate(ob.date) +
          ' al ' +
          formatEconomicDate(change.newDate) +
          '. Es una expectativa actualizada, no un cobro recibido.',
      });
      continue;
    }

    if (change.op === 'exclude_action') {
      const option = scenario.obligations
        .flatMap((o) => o.actions)
        .find((a) => a.id === change.optionId);
      if (!option) {
        issues.push(where + ': la acción citada no existe en este escenario');
        continue;
      }
      if (scenario.excludedActionIds.includes(option.id)) {
        issues.push(where + ': esa acción ya estaba descartada');
        continue;
      }
      validated.push({
        operation: { op: 'exclude_action', optionId: option.id },
        evidence: change.evidence.trim(),
        humanDiff:
          'Se descarta la acción "' +
          option.label +
          '". El motor deja de considerarla; el pago registrado no cambia.',
      });
      continue;
    }

    // set_minimum_cash
    if (typeof change.amountPesos !== 'number' || !Number.isFinite(change.amountPesos)) {
      issues.push(where + ': falta la cantidad de caja mínima');
      continue;
    }
    if (change.amountPesos < 0 || change.amountPesos > 1_000_000) {
      issues.push(where + ': la caja mínima propuesta está fuera de rango');
      continue;
    }
    let amountCents: number;
    try {
      amountCents = pesos(change.amountPesos);
    } catch {
      issues.push(where + ': la cantidad de caja mínima no es un importe válido');
      continue;
    }
    // El importe debe venir del mensaje: sus digitos tienen que aparecer en el.
    const digits = String(Math.round(change.amountPesos));
    if (!normalize(message).replace(/[.,\s]/g, '').includes(digits)) {
      issues.push(where + ': la cantidad propuesta no aparece en el mensaje');
      continue;
    }
    if (amountCents === scenario.minimumCashCents) {
      issues.push(where + ': la caja mínima propuesta es la que ya estaba registrada');
      continue;
    }
    validated.push({
      operation: { op: 'set_minimum_cash', amountCents },
      evidence: change.evidence.trim(),
      humanDiff:
        'La caja mínima pasa de ' +
        formatCents(scenario.minimumCashCents) +
        ' a ' +
        formatCents(amountCents) +
        '.',
    });
  }

  if (validated.length === 0) {
    return {
      kind: 'error',
      issues:
        issues.length > 0
          ? issues
          : ['no se pudo derivar ningún cambio válido del mensaje'],
    };
  }

  const proposal: PendingProposal = {
    id: makeProposalId(),
    scenarioId: scenario.scenarioId,
    baseRevision: scenario.baseRevision,
    changes: validated,
    summary:
      validated.length === 1
        ? 'Un cambio pendiente de confirmación.'
        : String(validated.length) + ' cambios pendientes de confirmación.',
    source,
    adapter,
  };

  return { kind: 'proposal', proposal, issues };
}

// --- Adaptador local de reglas (sin IA) -----------------------------------

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

interface DateMatch {
  date: string;
  fragment: string;
}

/** Busca una fecha inequivoca en el mensaje. Devuelve null si es ambigua. */
export function findExplicitDate(message: string, referenceYear: number): DateMatch | null {
  const iso = message.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const candidate = iso[0];
    return isEconomicDate(candidate) ? { date: candidate, fragment: candidate } : null;
  }

  const spanish = message
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/\b(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?/);
  if (spanish) {
    const dayNumber = Number(spanish[1]);
    const month = MONTHS[spanish[2]];
    if (!month) return null;
    const year = spanish[3] ? Number(spanish[3]) : referenceYear;
    const candidate =
      String(year).padStart(4, '0') +
      '-' +
      String(month).padStart(2, '0') +
      '-' +
      String(dayNumber).padStart(2, '0');
    if (!isEconomicDate(candidate)) return null;
    const index = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').indexOf(spanish[0]);
    return { date: candidate, fragment: message.slice(index, index + spanish[0].length) };
  }

  const numeric = message.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const dayNumber = Number(numeric[1]);
    const month = Number(numeric[2]);
    const year = numeric[3] ? Number(numeric[3].padStart(4, '20')) : referenceYear;
    const candidate =
      String(year).padStart(4, '0') +
      '-' +
      String(month).padStart(2, '0') +
      '-' +
      String(dayNumber).padStart(2, '0');
    if (!isEconomicDate(candidate)) return null;
    return { date: candidate, fragment: numeric[0] };
  }

  return null;
}

/**
 * Lectura por reglas para trabajar sin Gemini configurado.
 * NO es interpretacion por IA y la interfaz lo rotula como tal.
 * Devuelve el mismo JSON crudo que devolveria el modelo, para que pase por
 * exactamente la misma validacion.
 */
export function localRuleInterpretation(
  message: string,
  scenario: ScenarioInput,
): RawInterpretation {
  const normalized = normalize(message);
  const receivables = scenario.obligations.filter((o) => o.direction === 'inflow' && !o.settled);

  const matches = receivables.filter((ob) => {
    const concept = normalize(ob.concept);
    const counterparty = normalize(ob.counterparty);
    const code = concept.match(/[a-z]-?\d{3,}/)?.[0];
    return (
      (code && normalized.includes(code)) ||
      normalized.includes(concept) ||
      normalized.includes(counterparty.split(' ')[0])
    );
  });

  if (matches.length === 0) {
    return {
      kind: 'clarification',
      question:
        'No se identificó ninguna factura del escenario en el mensaje. Indica la factura o el cliente.',
      options: receivables.map((o) => o.concept + ' - ' + o.counterparty),
    };
  }
  if (matches.length > 1) {
    return {
      kind: 'clarification',
      question: 'El mensaje puede referirse a más de una factura. Elige cuál se retrasa.',
      options: matches.map((o) => o.concept + ' - ' + o.counterparty),
    };
  }

  const referenceYear = Number(scenario.demoToday.slice(0, 4));
  const date = findExplicitDate(message, referenceYear);
  if (!date) {
    return {
      kind: 'clarification',
      question:
        'El mensaje no fija una fecha concreta de cobro para ' +
        matches[0].concept +
        '. Indica el día exacto.',
      options: [],
    };
  }

  return {
    kind: 'proposal',
    changes: [
      {
        op: 'reschedule_receivable',
        obligationId: matches[0].id,
        newDate: date.date,
        evidence: date.fragment,
      },
    ],
  };
}
