import { NextResponse } from 'next/server';
import { getHistory } from '@/server/workspace';
import { handleError } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Antes/despues y eventos tipados del negocio de la demo. */
export async function GET() {
  try {
    return NextResponse.json(await getHistory());
  } catch (err) {
    return handleError(err);
  }
}
