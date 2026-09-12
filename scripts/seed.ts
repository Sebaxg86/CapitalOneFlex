/**
 * Seed idempotente de los datos de la demo (negocio `biz:marea`).
 *
 * Reglas duras:
 * - NUNCA hace `DROP` ni `TRUNCATE`, ni borra datos ajenos.
 * - Sin bandera no borra nada: hace upsert de las filas de la demo.
 * - `--reset-demo` es un reinicio EXCLUSIVO de datos demo: borra solo las filas
 *   cuyo `business_id` es `biz:marea` y sus dependencias directas.
 * - Sin `DATABASE_URL` informa y termina con codigo 0.
 *
 * Uso: npm run db:seed  |  npm run db:seed -- --reset-demo
 */
import type { PoolClient } from 'pg';
import { getServerEnv, loadLocalEnv, sanitizeDbError } from '../src/server/env';
import { closePool, getPool, withTransaction, SCHEMA } from '../src/server/db/pool';
import {
  appendEvent,
  claimOperationKey,
  saveResult,
  saveScenario,
  upsertBusiness,
} from '../src/server/db/repository';
import { computeEngineResult } from '../src/domain/engine';
import { DEMO_BUSINESS, DEMO_BUSINESS_ID, demoScenario } from '../fixtures/index';

/** Prefijo de las claves de idempotencia que crea este script. */
const SEED_KEY_PREFIX = `seed:${DEMO_BUSINESS_ID}:`;

/**
 * Reinicio EXCLUSIVO de datos demo. Cada sentencia esta acotada por
 * `business_id = 'biz:marea'` (o por las filas que dependen de sus escenarios).
 * No toca tablas, ni otros negocios, ni la base.
 */
async function resetDemoData(client: PoolClient): Promise<void> {
  const scenarioSubquery = `SELECT id FROM ${SCHEMA}.scenarios WHERE business_id = $1`;
  await client.query(
    `DELETE FROM ${SCHEMA}.action_options WHERE scenario_id IN (${scenarioSubquery})`,
    [DEMO_BUSINESS_ID],
  );
  await client.query(`DELETE FROM ${SCHEMA}.obligations WHERE business_id = $1`, [
    DEMO_BUSINESS_ID,
  ]);
  await client.query(
    `DELETE FROM ${SCHEMA}.view_specs
      WHERE result_id IN (
        SELECT id FROM ${SCHEMA}.scenario_results WHERE scenario_id IN (${scenarioSubquery})
      )`,
    [DEMO_BUSINESS_ID],
  );
  await client.query(
    `DELETE FROM ${SCHEMA}.scenario_results WHERE scenario_id IN (${scenarioSubquery})`,
    [DEMO_BUSINESS_ID],
  );
  await client.query(`DELETE FROM ${SCHEMA}.pending_proposals WHERE business_id = $1`, [
    DEMO_BUSINESS_ID,
  ]);
  await client.query(`DELETE FROM ${SCHEMA}.financial_events WHERE business_id = $1`, [
    DEMO_BUSINESS_ID,
  ]);
  // El schema `compromisos` es exclusivo de esta demo de un solo negocio, y
  // `operation_keys` no tiene columna de negocio: al reiniciar los datos demo
  // se limpian todas sus claves para que la idempotencia quede coherente.
  await client.query(`DELETE FROM ${SCHEMA}.operation_keys`);
  await client.query(`DELETE FROM ${SCHEMA}.scenarios WHERE business_id = $1`, [
    DEMO_BUSINESS_ID,
  ]);
  await client.query(`DELETE FROM ${SCHEMA}.businesses WHERE id = $1`, [DEMO_BUSINESS_ID]);
}

async function main(): Promise<number> {
  const reset = process.argv.includes('--reset-demo');
  loadLocalEnv();
  const env = getServerEnv();

  if (!env.DATABASE_URL) {
    console.log('Tiger Data no configurado: falta DATABASE_URL en .env.local');
    console.log('Copia .env.example a .env.local y sigue CONFIGURACION.md para obtener la URI.');
    console.log('No se sembró ningún dato. Esto no es un error.');
    return 0;
  }

  // Obliga a que el pool exista antes de abrir la transaccion.
  getPool();

  const input = demoScenario(env.DEMO_TODAY);
  const result = computeEngineResult(input);

  await withTransaction(async (client) => {
    if (reset) {
      console.log(
        `Reinicio exclusivo de datos demo: se borran solo las filas de ${DEMO_BUSINESS_ID}.`,
      );
      await resetDemoData(client);
    }

    await upsertBusiness(
      {
        id: DEMO_BUSINESS.id,
        name: DEMO_BUSINESS.name,
        currency: DEMO_BUSINESS.currency,
        timezone: DEMO_BUSINESS.timezone,
      },
      client,
    );

    await saveScenario(input, {
      label: 'Escenario base de la demo',
      parentScenarioId: null,
      executor: client,
    });

    await saveResult(result, client);

    // El evento de creacion se registra una sola vez: la clave de idempotencia
    // es global y sobrevive a ejecuciones repetidas del seed.
    // Clave compartida con el servidor (src/server/workspace.ts): si el
    // escenario ya se creo desde la aplicacion, el seed no repite el evento.
    const key = `scenario_created:${input.scenarioId}`;
    const claim = await claimOperationKey(key, 'seed_scenario_created', result.id, client);
    if (claim.claimed) {
      await appendEvent(
        {
          businessId: input.businessId,
          scenarioId: input.scenarioId,
          revision: input.baseRevision,
          effectiveDate: input.demoToday,
          eventType: 'scenario_created',
          payload: {
            resultId: result.id,
            inputVersion: result.inputVersion,
            obligationCount: input.obligations.length,
            note: 'Escenario base de la demo sembrado por scripts/seed.ts.',
          },
        },
        client,
      );
      console.log('Evento scenario_created registrado.');
    } else {
      console.log('El evento scenario_created ya existía: no se duplica.');
    }
  });

  console.log(`Negocio: ${DEMO_BUSINESS.name} (${DEMO_BUSINESS_ID})`);
  console.log(
    `Escenario ${input.scenarioId} revision ${input.baseRevision} con ` +
      `${input.obligations.length} obligaciones y fecha demo ${input.demoToday}.`,
  );
  console.log(`Resultado ${result.id} guardado (inputVersion ${result.inputVersion}).`);
  console.log('Seed idempotente: volver a ejecutarlo no duplica ni borra nada.');
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error('Fallo el seed:', sanitizeDbError(err));
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
