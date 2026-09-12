import { NextResponse } from 'next/server';
import { z } from 'zod';
import { activateScenario } from '@/server/workspace';
import { focusSchema, handleError, readJson } from '../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ focus: focusSchema.optional() });

/** Volver a un escenario anterior sin borrar los derivados. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await readJson(request, bodySchema);
    const result = await activateScenario(id, body.focus ?? 'payroll');
    return NextResponse.json(result);
  } catch (err) {
    return handleError(err);
  }
}
