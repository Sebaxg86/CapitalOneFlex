import { NextResponse } from 'next/server';
import { z } from 'zod';
import { undoHistoryAction } from '@/server/workspace';
import { handleError, idempotencySchema, readJson } from '../../_shared';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.object({eventId:z.string().uuid(),scenarioId:z.string().min(1).max(120),baseRevision:z.number().int().nonnegative(),idempotencyKey:idempotencySchema});
export async function POST(request: Request) {
  try {
    const body = await readJson(request,schema);
    return NextResponse.json(await undoHistoryAction(body.eventId,body.scenarioId,body.baseRevision,body.idempotencyKey));
  } catch(error) { return handleError(error); }
}
