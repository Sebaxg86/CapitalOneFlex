import { NextResponse } from 'next/server';
import { z } from 'zod';
import { confirmProposal } from '@/server/workspace';
import { focusSchema, handleError, idempotencySchema, readJson } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  proposalId: z.string().min(1).max(120),
  baseRevision: z.number().int().min(0),
  idempotencyKey: idempotencySchema,
  focus: focusSchema.optional(),
});

/** Confirmacion humana: aplica la propuesta y recalcula. Idempotente por clave. */
export async function POST(request: Request) {
  try {
    const body = await readJson(request, bodySchema);
    const result = await confirmProposal(
      body.proposalId,
      body.baseRevision,
      body.idempotencyKey,
      body.focus ?? 'payroll',
    );
    return NextResponse.json(result);
  } catch (err) {
    return handleError(err);
  }
}
