import { NextResponse } from 'next/server';
import { z } from 'zod';
import { proposeInvoiceChange } from '@/server/workspace';
import { handleError,readJson } from '../../_shared';
export const runtime='nodejs';
const schema=z.object({scenarioId:z.string().min(1).max(120),baseRevision:z.number().int().nonnegative(),obligationId:z.string().min(1).max(120),action:z.enum(['delay','earlier','correct']),newDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)});
export async function POST(request:Request) {
  try { const b=await readJson(request,schema);return NextResponse.json(await proposeInvoiceChange(b.scenarioId,b.baseRevision,b.obligationId,b.action,b.newDate)); }
  catch(error) { return handleError(error); }
}
