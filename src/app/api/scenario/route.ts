import { NextResponse } from 'next/server';
import { getWorkspaceState } from '@/server/workspace';
import { handleError, parseFocus } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Estado y version actual del escenario vigente. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const focus = parseFocus(url.searchParams.get('focus'));
    const state = await getWorkspaceState(focus);
    return NextResponse.json(state);
  } catch (err) {
    return handleError(err);
  }
}
