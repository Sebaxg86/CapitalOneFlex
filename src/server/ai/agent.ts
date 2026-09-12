/**
 * Un agente logico del producto con dos tareas delimitadas.
 * Aqui se une la llamada al proveedor con la validacion y los caminos
 * alternativos explicitos. Ninguna de las dos tareas muta datos por si misma.
 */
import type { EngineResult, ScenarioInput } from '@/domain/types';
import type { InterpretResponse } from '@/lib/contracts';
import {
  callCompose,
  callInterpret,
  GeminiError,
  isGeminiConfigured,
  probeModel,
  readGeminiConfig,
  sanitizeGeminiError,
} from './gemini';
import { buildComposeContext, buildInterpretContext } from './prompts';
import { localRuleInterpretation, validateInterpretation } from './interpret';
import {
  enforceServerRules,
  fallbackComposedView,
  PROMPT_VERSION,
  validateViewSpec,
  type ComposedView,
  type Focus,
} from './viewspec';

let modelPromise: Promise<string | null> | null = null;

/** Modelo utilizable: el fijado en GEMINI_MODEL o el primero verificado. */
export async function getUsableModel(): Promise<string | null> {
  const { apiKey, model } = readGeminiConfig();
  if (!apiKey) return null;
  if (model) return model;
  if (!modelPromise) {
    modelPromise = probeModel().then((probe) => (probe.ok && probe.model ? probe.model : null));
  }
  return modelPromise;
}

/** Limpia el modelo memoizado (util tras cambiar el entorno). */
export function resetModelCache(): void {
  modelPromise = null;
}

// --- Tarea 1: interpretar --------------------------------------------------

export async function interpretMessage(
  message: string,
  scenario: ScenarioInput,
  obligationsForContext: Parameters<typeof buildInterpretContext>[1],
  result: EngineResult,
): Promise<InterpretResponse> {
  const trimmed = message.trim();
  if (trimmed.length < 4) {
    return {
      kind: 'clarification',
      question: 'El mensaje está vacío o es demasiado corto para interpretarlo.',
      options: [],
      source: 'fallback',
    };
  }

  const model = await getUsableModel();

  if (!model) {
    // Sin Gemini configurado: lectura por reglas, rotulada como tal.
    const raw = localRuleInterpretation(trimmed, scenario);
    const outcome = validateInterpretation(raw, scenario, trimmed, 'manual', 'reglas-locales');
    if (outcome.kind === 'proposal' && outcome.proposal) {
      return { kind: 'proposal', proposal: outcome.proposal };
    }
    if (outcome.kind === 'clarification') {
      return {
        kind: 'clarification',
        question: outcome.question!,
        options: outcome.options ?? [],
        source: 'fallback',
      };
    }
    return {
      kind: 'error',
      message:
        'El adaptador local de reglas no pudo derivar un cambio válido: ' +
        outcome.issues.join('; ') +
        '. Gemini no está configurado.',
      allowManual: true,
    };
  }

  try {
    const context = buildInterpretContext(result, obligationsForContext);
    const call = await callInterpret(model, trimmed, context);
    const outcome = validateInterpretation(call.json, scenario, trimmed, 'gemini', 'gemini');
    if (outcome.kind === 'proposal' && outcome.proposal) {
      return { kind: 'proposal', proposal: outcome.proposal };
    }
    if (outcome.kind === 'clarification') {
      return {
        kind: 'clarification',
        question: outcome.question!,
        options: outcome.options ?? [],
        source: 'gemini',
      };
    }
    return {
      kind: 'error',
      message:
        'La lectura del mensaje no pasó la validación del servidor y no se aplicó nada: ' +
        outcome.issues.join('; '),
      allowManual: true,
    };
  } catch (err) {
    const detail = err instanceof GeminiError ? err.message : sanitizeGeminiError(err);
    return {
      kind: 'error',
      message: 'No se obtuvo interpretación del proveedor: ' + detail + '. No se aplicó ningún cambio.',
      allowManual: true,
    };
  }
}

// --- Tarea 2: componer -----------------------------------------------------

export async function composeView(result: EngineResult, focus: Focus): Promise<ComposedView> {
  if (!isGeminiConfigured()) {
    return fallbackComposedView(
      result,
      focus,
      'Gemini no está configurado: falta GEMINI_API_KEY en .env.local. Esta es la vista básica determinista del servidor.',
    );
  }

  const model = await getUsableModel();
  if (!model) {
    return fallbackComposedView(
      result,
      focus,
      'No se identificó un modelo accesible con salida estructurada. Esta es la vista básica determinista del servidor.',
    );
  }

  try {
    const call = await callCompose(model, buildComposeContext(result, focus));
    const validation = validateViewSpec(call.json, result);
    if (!validation.ok || !validation.spec) {
      return fallbackComposedView(
        result,
        focus,
        'La composición recibida no pasó la validación: ' + validation.issues.slice(0, 3).join('; '),
      );
    }
    const { spec, enforcement } = enforceServerRules(validation.spec, result);
    return {
      spec,
      source: 'gemini',
      enforcement,
      promptVersion: PROMPT_VERSION,
    };
  } catch (err) {
    const detail = err instanceof GeminiError ? err.message : sanitizeGeminiError(err);
    return fallbackComposedView(
      result,
      focus,
      'No se obtuvo composición del proveedor: ' + detail + '. Esta es la vista básica determinista del servidor.',
    );
  }
}
