/**
 * Adaptador de Gemini API. Credenciales solo en servidor.
 *
 * Una llamada por interpretacion y una por composicion, con timeout acotado y
 * sin reintentos. Si falla, quien llama decide el camino alternativo explicito:
 * nunca se presenta un fallback local como respuesta del proveedor.
 */
import { GoogleGenAI } from '@google/genai';
import {
  COMPOSE_RESPONSE_SCHEMA,
  COMPOSE_SYSTEM_INSTRUCTION,
  INTERPRET_RESPONSE_SCHEMA,
  INTERPRET_SYSTEM_INSTRUCTION,
  buildComposePrompt,
  buildInterpretPrompt,
} from './prompts';

/** Timeout por llamada, en milisegundos. */
export const GEMINI_TIMEOUT_MS = 20_000;

/**
 * Preferencia de modelos cuando GEMINI_MODEL no esta fijado.
 *
 * Es solo una preferencia: los identificadores caducan (Google retira modelos
 * para cuentas nuevas) y la cuota depende de la cuenta. `probeModel` completa
 * esta lista con los modelos que la propia cuenta declara y comprueba acceso
 * real antes de elegir. No se asume que un identificador siga existiendo.
 */
export const CANDIDATE_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
] as const;

/** Modelos de texto de proposito general: fuera imagen, audio, TTS y similares. */
const EXCLUDED_MODEL_PATTERN =
  /(tts|image|audio|embedding|native|live|dialog|robotics|computer|transcribe|banana|lyria|deep-research|antigravity)/i;

export function isGeneralTextModel(name: string): boolean {
  return /^gemini-/.test(name) && !EXCLUDED_MODEL_PATTERN.test(name);
}

export interface GeminiConfig {
  apiKey?: string;
  model?: string;
}

export function readGeminiConfig(): GeminiConfig {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim();
  return { apiKey: apiKey || undefined, model: model || undefined };
}

export function isGeminiConfigured(): boolean {
  return Boolean(readGeminiConfig().apiKey);
}

export class GeminiError extends Error {
  readonly stage: 'config' | 'call' | 'parse';
  constructor(message: string, stage: 'config' | 'call' | 'parse') {
    super(message);
    this.name = 'GeminiError';
    this.stage = stage;
  }
}

/** Quita cualquier rastro de clave de un mensaje de error antes de mostrarlo. */
export function sanitizeGeminiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const key = process.env.GEMINI_API_KEY?.trim();
  let out = raw;
  if (key && key.length > 6) out = out.split(key).join('[clave oculta]');
  out = out.replace(/AIza[0-9A-Za-z_-]{10,}/g, '[clave oculta]');
  out = out.replace(/([?&]key=)[^&\s"']+/gi, '$1[clave oculta]');
  return out.slice(0, 400);
}

let cachedClient: { apiKey: string; client: GoogleGenAI } | null = null;

function getClient(apiKey: string): GoogleGenAI {
  if (cachedClient && cachedClient.apiKey === apiKey) return cachedClient.client;
  const client = new GoogleGenAI({ apiKey });
  cachedClient = { apiKey, client };
  return client;
}

export interface GeminiCallResult {
  json: unknown;
  model: string;
  usage?: { promptTokens?: number; responseTokens?: number; totalTokens?: number };
  elapsedMs: number;
}

async function callStructured(
  model: string,
  systemInstruction: string,
  prompt: string,
  responseJsonSchema: unknown,
): Promise<GeminiCallResult> {
  const { apiKey } = readGeminiConfig();
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY no está configurada', 'config');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await getClient(apiKey).models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseJsonSchema,
        temperature: 0.2,
        abortSignal: controller.signal,
      },
    });
    const text = response.text;
    if (!text) throw new GeminiError('la respuesta del modelo llegó vacía', 'parse');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new GeminiError('la respuesta del modelo no es JSON válido', 'parse');
    }
    return {
      json,
      model,
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount,
        responseTokens: response.usageMetadata?.candidatesTokenCount,
        totalTokens: response.usageMetadata?.totalTokenCount,
      },
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    if (controller.signal.aborted) {
      throw new GeminiError('el proveedor no respondió dentro del tiempo límite', 'call');
    }
    throw new GeminiError(sanitizeGeminiError(err), 'call');
  } finally {
    clearTimeout(timer);
  }
}

/** Llamada de interpretacion. Devuelve el JSON sin validar semanticamente. */
export function callInterpret(model: string, message: string, context: string) {
  return callStructured(
    model,
    INTERPRET_SYSTEM_INSTRUCTION,
    buildInterpretPrompt(message, context),
    INTERPRET_RESPONSE_SCHEMA,
  );
}

/** Llamada de composicion. Devuelve el JSON sin validar semanticamente. */
export function callCompose(model: string, context: string) {
  return callStructured(
    model,
    COMPOSE_SYSTEM_INSTRUCTION,
    buildComposePrompt(context),
    COMPOSE_RESPONSE_SCHEMA,
  );
}

// --- Deteccion y verificacion del modelo ----------------------------------

export interface ModelProbe {
  ok: boolean;
  model?: string;
  detail: string;
  candidatesTried: string[];
  usage?: GeminiCallResult['usage'];
}

/** Modelos de la cuenta que soportan generateContent. Requiere clave valida. */
export async function listAccessibleModels(): Promise<string[]> {
  const { apiKey } = readGeminiConfig();
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY no está configurada', 'config');
  const pager = await getClient(apiKey).models.list();
  const names: string[] = [];
  for await (const model of pager) {
    const actions = model.supportedActions ?? [];
    if (actions.length === 0 || actions.includes('generateContent')) {
      names.push((model.name ?? '').replace(/^models\//, ''));
    }
  }
  return names.filter(Boolean);
}

const PROBE_SCHEMA = {
  type: 'object',
  properties: {
    saludo: { type: 'string' },
    numero: { type: 'integer' },
  },
  required: ['saludo', 'numero'],
  propertyOrdering: ['saludo', 'numero'],
} as const;

/**
 * Comprueba acceso real y salida estructurada con datos ficticios.
 * No sustituye por mock si falla: devuelve ok=false con el motivo saneado.
 */
export async function probeModel(preferred?: string): Promise<ModelProbe> {
  const { apiKey, model: configured } = readGeminiConfig();
  if (!apiKey) {
    return {
      ok: false,
      detail: 'Falta GEMINI_API_KEY en .env.local.',
      candidatesTried: [],
    };
  }

  let available: string[] = [];
  let listError: string | null = null;
  try {
    available = await listAccessibleModels();
  } catch (err) {
    listError = sanitizeGeminiError(err);
  }

  const wanted = [preferred, configured].filter(Boolean) as string[];
  const preferidos = CANDIDATE_MODELS.filter(
    (m) => available.length === 0 || available.includes(m),
  );
  // Si ninguno de los preferidos sigue disponible, se prueban los que la cuenta
  // declara: asi la deteccion no caduca cuando Google renombra o retira modelos.
  const delListado = available.filter(isGeneralTextModel);
  const unique = [...new Set([...wanted, ...preferidos, ...delListado])];

  const tried: string[] = [];
  const errores: string[] = [];
  let lastError = listError ?? 'sin intentos';

  for (const model of unique) {
    tried.push(model);
    try {
      const result = await callStructured(
        model,
        'Responde unicamente con el JSON pedido.',
        'Devuelve saludo="hola" y numero=7. Son datos ficticios de prueba.',
        PROBE_SCHEMA,
      );
      const json = result.json as { saludo?: unknown; numero?: unknown };
      if (typeof json.saludo !== 'string' || typeof json.numero !== 'number') {
        lastError = 'el modelo respondió sin respetar el esquema estructurado';
        errores.push(model + ': ' + lastError);
        continue;
      }
      return {
        ok: true,
        model,
        detail:
          'Acceso verificado con salida estructurada. Modelos listados por la cuenta: ' +
          (available.length > 0 ? String(available.length) : 'no disponible') +
          '.',
        candidatesTried: tried,
        usage: result.usage,
      };
    } catch (err) {
      lastError = err instanceof GeminiError ? err.message : sanitizeGeminiError(err);
      errores.push(model + ': ' + resumenDeError(lastError));
    }
  }

  return {
    ok: false,
    detail:
      'Ningún modelo candidato respondió correctamente. Motivos: ' +
      (errores.length > 0 ? errores.slice(0, 6).join(' | ') : lastError),
    candidatesTried: tried,
  };
}

/** Resume los errores habituales del proveedor para que el informe sea legible. */
function resumenDeError(mensaje: string): string {
  if (/no longer available/i.test(mensaje)) return 'retirado para cuentas nuevas';
  if (/RESOURCE_EXHAUSTED|"code":\s*429/i.test(mensaje)) return 'cuota agotada';
  if (/"code":\s*503|high demand/i.test(mensaje)) return 'proveedor saturado';
  if (/NOT_FOUND|"code":\s*404/i.test(mensaje)) return 'modelo no encontrado';
  if (/"code":\s*40[13]/i.test(mensaje)) return 'clave sin permiso para este modelo';
  if (/tiempo límite|aborted/i.test(mensaje)) return 'sin respuesta dentro del tiempo límite';
  return mensaje.replace(/\s+/g, ' ').slice(0, 90);
}
