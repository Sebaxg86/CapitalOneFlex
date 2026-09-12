/**
 * Lectura de variables de entorno. SOLO servidor.
 *
 * Reglas duras de este modulo:
 * - Nunca se imprime un valor de entorno ni `process.env` completo.
 * - Los mensajes de error de base de datos se sanitizan antes de mostrarse:
 *   una URI de conexion contiene usuario, contrasena y host.
 * - Los scripts que corren fuera de Next.js (migrate, seed, pruebas live) deben
 *   cargar `.env.local` explicitamente; Next lo carga solo para su propio
 *   proceso. Se usa `loadEnvConfig` de `@next/env`, que ya viene con Next; si
 *   no estuviera disponible se usa un parser minimo propio, sin dependencias
 *   nuevas.
 */
import { z } from 'zod';
import { isEconomicDate } from '../domain/dates';

/** Fecha economica por defecto del dataset. No depende del reloj del equipo. */
export const DEFAULT_DEMO_TODAY = '2026-09-12';

/** Trata la cadena vacia como "variable ausente". */
const optionalText = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().min(1).optional(),
);

const demoTodaySchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z
    .string()
    .refine(isEconomicDate, { message: 'DEMO_TODAY: se espera una fecha YYYY-MM-DD valida' })
    .default(DEFAULT_DEMO_TODAY),
);

const serverEnvSchema = z.object({
  GEMINI_API_KEY: optionalText,
  GEMINI_MODEL: optionalText,
  DATABASE_URL: optionalText,
  DEMO_TODAY: demoTodaySchema,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

// --- Carga de .env.local para procesos fuera de Next.js --------------------

let envFileLoaded = false;

/** Parser minimo de `.env.local`. No sobreescribe variables ya definidas. */
function loadEnvFileFallback(dir: string): boolean {
  try {
    // Import perezoso: estos modulos solo existen en Node, nunca en el cliente.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.join(dir, '.env.local');
    if (!fs.existsSync(file)) return false;
    const contents = fs.readFileSync(file, 'utf8');
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Carga `.env.local` una sola vez. Idempotente y silenciosa: no informa de
 * valores, solo de si encontro un archivo.
 */
export function loadLocalEnv(dir: string = process.cwd()): void {
  if (envFileLoaded) return;
  envFileLoaded = true;
  // Dentro del runtime de Next.js el entorno ya esta cargado.
  if (process.env.NEXT_RUNTIME) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nextEnv = require('@next/env') as typeof import('@next/env');
    nextEnv.loadEnvConfig(dir, false, { info: () => {}, error: () => {} });
    return;
  } catch {
    // `@next/env` no disponible: se usa el parser propio.
  }
  loadEnvFileFallback(dir);
}

// --- Lectura validada ------------------------------------------------------

let cached: ServerEnv | null = null;

/**
 * Devuelve el entorno de servidor validado. Cachea el resultado; llamar a
 * `resetServerEnvCache()` tras modificar `process.env` en pruebas.
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  loadLocalEnv();
  const parsed = serverEnvSchema.safeParse({
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    DATABASE_URL: process.env.DATABASE_URL,
    DEMO_TODAY: process.env.DEMO_TODAY,
  });
  if (!parsed.success) {
    // Solo se reportan nombres de variables y el motivo, nunca sus valores.
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('; ');
    throw new EnvError(`Configuracion de entorno invalida -> ${detail}`);
  }
  cached = parsed.data;
  return cached;
}

/** Limpia la cache del entorno. Util en pruebas. */
export function resetServerEnvCache(): void {
  cached = null;
  envFileLoaded = false;
}

/** true si hay `DATABASE_URL`. No comprueba que la conexion funcione. */
export function hasDatabase(): boolean {
  return getServerEnv().DATABASE_URL !== undefined;
}

/** true si hay `GEMINI_API_KEY`. No comprueba que la clave sea valida. */
export function hasGemini(): boolean {
  return getServerEnv().GEMINI_API_KEY !== undefined;
}

// --- Sanitizado de errores -------------------------------------------------

const URI_RE = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'<>]+/g;
/** `usuario:clave@host` suelto, sin esquema delante. */
const CREDENTIALS_RE = /[^\s:@/]+:[^\s:@/]+@[^\s/"']+/g;
const PASSWORD_RE = /\b(password|passwd|pwd|pass)\s*=\s*[^\s;,"']+/gi;

const HIDDEN = '[oculto]';
const HIDDEN_URI = '[credenciales y host ocultos]';

function messageOf(err: unknown): string {
  if (err === null || err === undefined) return 'error desconocido';
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code;
    return typeof code === 'string' && code.length > 0
      ? `${err.message} (codigo ${code})`
      : err.message;
  }
  try {
    return String(err);
  } catch {
    return 'error no representable';
  }
}

/** Reemplazo literal, sin construir expresiones regulares con datos sensibles. */
function replaceAllLiteral(text: string, needle: string, replacement: string): string {
  if (needle.length < 3) return text;
  return text.split(needle).join(replacement);
}

/** Fragmentos concretos de `DATABASE_URL` que nunca deben aparecer en un log. */
function secretsFromDatabaseUrl(): string[] {
  const raw = process.env.DATABASE_URL;
  if (!raw) return [];
  const secrets: string[] = [raw];
  try {
    const url = new URL(raw);
    if (url.password) {
      secrets.push(url.password, decodeURIComponent(url.password));
    }
    if (url.username) {
      secrets.push(url.username, decodeURIComponent(url.username));
    }
    if (url.hostname) secrets.push(url.hostname);
  } catch {
    // URI no parseable: basta con ocultar la cadena completa.
  }
  return secrets.filter((s) => s.length >= 3);
}

/**
 * Convierte cualquier error de base de datos en un texto seguro para mostrar
 * o registrar: sin usuario, sin contrasena y sin host.
 */
export function sanitizeDbError(err: unknown): string {
  let message = messageOf(err);
  message = message.replace(URI_RE, (match) => {
    const idx = match.indexOf('://');
    const scheme = idx > 0 ? match.slice(0, idx) : 'uri';
    return `${scheme}://${HIDDEN_URI}`;
  });
  message = message.replace(CREDENTIALS_RE, HIDDEN_URI);
  message = message.replace(PASSWORD_RE, (_m, key: string) => `${key}=${HIDDEN}`);
  for (const secret of secretsFromDatabaseUrl()) {
    message = replaceAllLiteral(message, secret, HIDDEN);
  }
  return message;
}
