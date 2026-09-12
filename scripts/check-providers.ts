/**
 * Verificacion de las dos integraciones obligatorias contra los proveedores
 * reales. No sustituye nada por mocks: si algo falla, lo dice.
 *
 *   npm run check:providers
 *
 * Nunca imprime claves ni la URI de conexion.
 */
import { loadLocalEnv, hasDatabase, hasGemini, sanitizeDbError } from '../src/server/env';

loadLocalEnv();

import { computeEngineResult } from '../src/domain/engine';
import { demoScenario, withDelayedInvoiceA, DEMO_BUSINESS_ID } from '../fixtures/index';
import { probeModel, readGeminiConfig, sanitizeGeminiError } from '../src/server/ai/gemini';
import { callCompose, callInterpret } from '../src/server/ai/gemini';
import { buildComposeContext, buildInterpretContext } from '../src/server/ai/prompts';
import { validateInterpretation } from '../src/server/ai/interpret';
import { enforceServerRules, validateViewSpec } from '../src/server/ai/viewspec';
import { DEMO_MESSAGE } from '../fixtures/index';

const OK = '[OK]';
const FAIL = '[FALLA]';
const SKIP = '[PENDIENTE]';

let geminiVerified = false;
let tigerVerified = false;
let hypertableVerified = false;

function line(text = ''): void {
  process.stdout.write(text + '\n');
}

function section(title: string): void {
  line();
  line('== ' + title + ' ==');
}

// --- Gemini ----------------------------------------------------------------

async function checkGemini(): Promise<void> {
  section('Gemini API');
  if (!hasGemini()) {
    line(SKIP + ' Falta GEMINI_API_KEY en .env.local. Revisa CONFIGURACION.md.');
    return;
  }

  const probe = await probeModel();
  line('Modelos candidatos probados: ' + (probe.candidatesTried.join(', ') || 'ninguno'));
  if (!probe.ok || !probe.model) {
    line(FAIL + ' ' + probe.detail);
    return;
  }
  line(OK + ' Acceso y salida estructurada verificados con el modelo: ' + probe.model);
  if (probe.usage?.totalTokens) {
    line('     Uso de la prueba mínima: ' + String(probe.usage.totalTokens) + ' tokens en total.');
  }
  if (!readGeminiConfig().model) {
    line('     Sugerencia: guarda GEMINI_MODEL=' + probe.model + ' en .env.local para fijarlo.');
  }

  const scenario = demoScenario(process.env.DEMO_TODAY || undefined);
  const result = computeEngineResult(scenario);

  // Tarea 1: interpretacion real contra el contrato.
  try {
    const context = buildInterpretContext(
      result,
      scenario.obligations.map((o) => ({
        id: o.id,
        direction: o.direction,
        date: o.date,
        counterparty: o.counterparty,
        concept: o.concept,
        amountCents: o.amountCents,
      })),
    );
    const call = await callInterpret(probe.model, DEMO_MESSAGE, context);
    const outcome = validateInterpretation(call.json, scenario, DEMO_MESSAGE, 'gemini', 'gemini');
    if (outcome.kind === 'proposal') {
      line(OK + ' Interpretación real: propuesta válida con ' + String(outcome.proposal!.changes.length) + ' cambio(s).');
      for (const change of outcome.proposal!.changes) line('     ' + change.humanDiff);
    } else if (outcome.kind === 'clarification') {
      line(OK + ' Interpretación real: el modelo pidió aclaración (respuesta válida del contrato).');
      line('     ' + outcome.question);
    } else {
      line(FAIL + ' Interpretación real rechazada por el servidor: ' + outcome.issues.join('; '));
      return;
    }
  } catch (err) {
    line(FAIL + ' Interpretación real: ' + sanitizeGeminiError(err));
    return;
  }

  // Tarea 2: composicion real sobre un resultado con riesgo.
  try {
    const risky = computeEngineResult(withDelayedInvoiceA(scenario));
    const call = await callCompose(probe.model, buildComposeContext(risky, 'payroll'));
    const validation = validateViewSpec(call.json, risky);
    if (!validation.ok || !validation.spec) {
      line(FAIL + ' Composición real rechazada por el validador: ' + validation.issues.slice(0, 3).join('; '));
      return;
    }
    const { spec, enforcement } = enforceServerRules(validation.spec, risky);
    line(OK + ' Composición real validada. Secciones: ' + spec.sections.map((s) => s.type).join(' > '));
    if (enforcement.length > 0) line('     Ajustes del servidor: ' + enforcement.join(' '));
    geminiVerified = true;
  } catch (err) {
    line(FAIL + ' Composición real: ' + sanitizeGeminiError(err));
  }
}

// --- Tiger Data ------------------------------------------------------------

async function checkTigerData(): Promise<void> {
  section('Tiger Data');
  if (!hasDatabase()) {
    line(SKIP + ' Falta DATABASE_URL en .env.local. Revisa CONFIGURACION.md.');
    return;
  }

  const { getPool, closePool, SCHEMA } = await import('../src/server/db/pool');
  const { runMigrations, verifyHypertable } = await import('../src/server/db/migrations');
  const { appendEvent } = await import('../src/server/db/repository');
  const { getHistory, getBeforeAfter } = await import('../src/server/db/history');

  try {
    const pool = getPool();

    const version = await pool.query<{ version: string }>('SELECT version()');
    line(OK + ' Conexión establecida. ' + (version.rows[0]?.version.split(',')[0] ?? 'PostgreSQL'));

    const applied = await runMigrations(pool);
    line(
      OK +
        ' Migraciones en el schema "' +
        SCHEMA +
        '": ' +
        (applied.length > 0 ? 'aplicadas ' + applied.join(', ') : 'ya estaban al día'),
    );

    const check = await verifyHypertable(pool);
    if (!check.isHypertable) {
      line(FAIL + ' financial_events NO es una hypertable de Timescale.');
      return;
    }
    line(
      OK +
        ' financial_events es hypertable. Extensión timescaledb versión ' +
        (check.extensionVersion ?? 'desconocida') +
        '.',
    );
    hypertableVerified = true;

    // Escritura y lectura reales, mas consulta por intervalo temporal.
    const before = new Date(Date.now() - 60_000);
    const scenario = demoScenario(process.env.DEMO_TODAY || undefined);
    const written = await appendEvent({
      businessId: DEMO_BUSINESS_ID,
      scenarioId: scenario.scenarioId,
      revision: scenario.baseRevision,
      effectiveDate: scenario.demoToday,
      eventType: 'result_generated',
      payload: { comprobacion: 'check:providers', nota: 'Evento sintético de verificación.' },
    });
    line(OK + ' Escritura en la hypertable: evento ' + written.eventId.slice(0, 8) + '...');

    const history = await getHistory(DEMO_BUSINESS_ID, {
      from: before,
      to: new Date(Date.now() + 60_000),
    });
    const found = history.some((e) => e.eventId === written.eventId);
    line(
      (found ? OK : FAIL) +
        ' Consulta por intervalo temporal: ' +
        String(history.length) +
        ' evento(s) en la ventana; el evento escrito ' +
        (found ? 'aparece' : 'NO aparece') +
        '.',
    );
    if (!found) return;

    const beforeAfter = await getBeforeAfter(scenario.scenarioId, scenario.baseRevision);
    line(
      OK +
        ' Reconstrucción antes/después disponible (antes: ' +
        (beforeAfter.before ? 'sí' : 'sin revisión previa') +
        ', después: ' +
        (beforeAfter.after ? 'sí' : 'sin resultado guardado') +
        ').',
    );

    tigerVerified = true;
  } catch (err) {
    line(FAIL + ' ' + sanitizeDbError(err));
  } finally {
    await closePool().catch(() => undefined);
  }
}

// --- Cierre ----------------------------------------------------------------

async function main(): Promise<void> {
  line('Verificación de integraciones obligatorias');
  line('Los datos del negocio son ficticios. No se imprimen secretos.');

  await checkGemini();
  await checkTigerData();

  section('Resumen');
  line('Gemini real .................. ' + (geminiVerified ? 'VERIFICADO' : 'PENDIENTE'));
  line('Tiger Data real .............. ' + (tigerVerified ? 'VERIFICADO' : 'PENDIENTE'));
  line('financial_events hypertable .. ' + (hypertableVerified ? 'VERIFICADO' : 'PENDIENTE'));
  line();
  if (!geminiVerified || !tigerVerified || !hypertableVerified) {
    line('La demo NO está completa mientras alguna integración obligatoria siga pendiente.');
    process.exitCode = 1;
    return;
  }
  line('Ambas integraciones obligatorias quedaron verificadas contra el proveedor real.');
}

main().catch((err) => {
  line(FAIL + ' error inesperado: ' + sanitizeDbError(err));
  process.exitCode = 1;
});
