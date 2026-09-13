import { beforeEach, expect, it } from 'vitest';
import { confirmProposal, getWorkspaceState, proposeInvoiceChange, resetStoreForTests } from '@/server/workspace';
import { DEFAULT_DEMO_TODAY } from '@fixtures/index';
beforeEach(()=>{delete process.env.GEMINI_API_KEY;delete process.env.DATABASE_URL;process.env.DEMO_TODAY=DEFAULT_DEMO_TODAY;resetStoreForTests();});
it('la captura guiada propone una fecha exacta y no modifica datos antes de confirmar',async()=>{
  const initial=await getWorkspaceState();
  const response=await proposeInvoiceChange(initial.scenario.id,0,'inv-a','delay','2026-09-20');
  if(response.kind!=='proposal') throw new Error('Falta propuesta');
  expect(response.proposal.source).toBe('manual');
  expect(response.proposal.changes[0].operation).toEqual({op:'reschedule_receivable',obligationId:'inv-a',newDate:'2026-09-20'});
  expect((await getWorkspaceState()).result.id).toBe(initial.result.id);
  const confirmed=await confirmProposal(response.proposal.id,0,'guided');
  expect(confirmed.state.result.baseline.shortfallCents).toBe(1_000_000);
});
it('rechaza fechas imposibles, acciones incoherentes y facturas inexistentes',async()=>{
  const initial=await getWorkspaceState();
  for(const [id,action,date] of [['missing','delay','2026-09-20'],['inv-a','delay','2026-09-13'],['inv-a','earlier','2026-09-20'],['inv-a','correct','2026-09-31'],['inv-a','correct','2026-09-10']] as const) {
    expect((await proposeInvoiceChange(initial.scenario.id,0,id,action,date)).kind).toBe('error');
  }
  expect((await getWorkspaceState()).result.id).toBe(initial.result.id);
});
it('admite adelantar y corregir la fecha; rechaza una revisión antigua',async()=>{
  const initial=await getWorkspaceState();
  expect((await proposeInvoiceChange(initial.scenario.id,0,'inv-a','earlier','2026-09-13')).kind).toBe('proposal');
  expect((await proposeInvoiceChange(initial.scenario.id,0,'inv-a','correct','2026-09-16')).kind).toBe('proposal');
  await expect(proposeInvoiceChange(initial.scenario.id,9,'inv-a','delay','2026-09-20')).rejects.toThrow();
});
