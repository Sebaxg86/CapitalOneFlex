import { NextResponse } from 'next/server';
import { z } from 'zod';
import { composeForResult, getStore } from '@/server/workspace';
import { focusSchema, handleError, readJson } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  resultId: z.string().min(1).max(120),
  focus: focusSchema,
});

/** resultId + foco -> composicion validada o vista basica determinista. */
export async function POST(request: Request) {
  try {
    const body = await readJson(request, bodySchema);
    const store = await getStore();
    const result = await store.getResult(body.resultId);
    if (!result) {
      return NextResponse.json(
        { error: 'el resultado indicado no existe o ya no es el vigente' },
        { status: 404 },
      );
    }
    const view = await composeForResult(result, body.focus);
    return NextResponse.json(view);
  } catch (err) {
    return handleError(err);
  }
}
