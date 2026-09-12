import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rejectAction } from '@/server/workspace';
import { focusSchema, handleError, idempotencySchema, readJson } from '../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  optionId: z.string().min(1).max(64),
  baseRevision: z.number().int().min(0),
  idempotencyKey: idempotencySchema,
  focus: focusSchema.optional(),
});

/** Excluir una accion crea un escenario separado y recalcula. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await readJson(request, bodySchema);
    const result = await rejectAction(
      id,
      body.optionId,
      body.baseRevision,
      body.idempotencyKey,
      body.focus ?? 'payroll',
    );
    return NextResponse.json(result);
  } catch (err) {
    return handleError(err);
  }
}
