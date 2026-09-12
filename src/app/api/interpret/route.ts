import { NextResponse } from 'next/server';
import { z } from 'zod';
import { interpret } from '@/server/workspace';
import { handleError, readJson } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  message: z.string().min(1).max(4_000),
  scenarioId: z.string().min(1).max(64).optional(),
});

/** Mensaje -> propuesta pendiente o aclaracion. Nunca muta datos. */
export async function POST(request: Request) {
  try {
    const body = await readJson(request, bodySchema);
    const response = await interpret(body.message);
    return NextResponse.json(response);
  } catch (err) {
    return handleError(err);
  }
}
