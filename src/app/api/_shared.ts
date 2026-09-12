/**
 * Utilidades comunes de las rutas de API.
 * El cliente solo envia identificadores, revisiones y claves de idempotencia:
 * nunca resultados calculados.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { FOCUS_VALUES, type Focus } from '@/server/ai/viewspec';
import { RevisionConflict } from '@/server/store/types';

export const focusSchema = z.enum(FOCUS_VALUES).default('overview');

export const idempotencySchema = z
  .string()
  .min(8)
  .max(120)
  .regex(/^[A-Za-z0-9:_-]+$/, 'clave de idempotencia inválida');

export function parseFocus(value: string | null): Focus {
  const parsed = focusSchema.safeParse(value ?? undefined);
  return parsed.success ? parsed.data : 'overview';
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function conflict(message: string, currentRevision: number) {
  return NextResponse.json({ error: message, currentRevision }, { status: 409 });
}

/**
 * Mensaje único para el cliente: los detalles técnicos (validación, motor,
 * almacenamiento) se registran en el log del proceso y nunca se devuelven.
 */
export const GENERIC_ERROR_MESSAGE = 'No se pudo completar la operación. Vuelve a intentarlo.';

/** Traduce errores del dominio a respuestas HTTP sin filtrar detalles internos. */
export function handleError(err: unknown) {
  // Excepción deliberada: el conflicto de revisión ya está redactado para la
  // persona que usa la demo y le dice exactamente qué hacer.
  if (err instanceof RevisionConflict) {
    return conflict(
      'El escenario cambió desde que se generó esta operación. Vuelve a revisarla.',
      err.currentRevision,
    );
  }
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error('[compromisos] error en la API:', detail);
  return NextResponse.json({ error: GENERIC_ERROR_MESSAGE }, { status: 400 });
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    console.error('[compromisos] cuerpo de la petición ilegible:', err);
    throw new Error(GENERIC_ERROR_MESSAGE);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.error(
      '[compromisos] petición inválida:',
      parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; '),
    );
    throw new Error(GENERIC_ERROR_MESSAGE);
  }
  return parsed.data;
}
