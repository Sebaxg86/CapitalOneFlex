/**
 * Migracion explicita del schema `compromisos` en Tiger Data.
 *
 * Sin `DATABASE_URL` no falla: informa y termina con codigo 0, para que el
 * desarrollo local del motor y la interfaz pueda continuar. Con credenciales,
 * aplica solo las migraciones pendientes y comprueba de verdad que
 * `financial_events` sea una hypertable de Timescale.
 *
 * Uso: npm run db:migrate
 */
import { getServerEnv, loadLocalEnv, sanitizeDbError } from '../src/server/env';
import { closePool, getPool, SCHEMA } from '../src/server/db/pool';
import { runMigrations, verifyHypertable } from '../src/server/db/migrations';

async function main(): Promise<number> {
  loadLocalEnv();
  const env = getServerEnv();

  if (!env.DATABASE_URL) {
    console.log('Tiger Data no configurado: falta DATABASE_URL en .env.local');
    console.log('Copia .env.example a .env.local y sigue CONFIGURACION.md para obtener la URI.');
    console.log('No se aplicó ninguna migración. Esto no es un error.');
    return 0;
  }

  const pool = getPool();
  console.log(`Aplicando migraciones en el schema dedicado "${SCHEMA}"...`);
  const applied = await runMigrations(pool);

  if (applied.length === 0) {
    console.log('Sin migraciones pendientes: el schema ya estaba al día.');
  } else {
    console.log(`Migraciones aplicadas (${applied.length}):`);
    for (const id of applied) console.log(`  - ${id}`);
  }

  const { isHypertable, extensionVersion } = await verifyHypertable(pool);
  console.log(
    `Extension timescaledb: ${extensionVersion ? `version ${extensionVersion}` : 'NO instalada'}`,
  );

  if (!isHypertable) {
    console.error(
      `Verificacion fallida: ${SCHEMA}.financial_events NO figura como hypertable en` +
        ' timescaledb_information.hypertables. La demo requiere la hypertable real;' +
        ' revisa que el servicio de Tiger Data tenga Timescale habilitado.',
    );
    return 1;
  }

  console.log(`Verificado: ${SCHEMA}.financial_events es una hypertable de Timescale.`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    // Los errores de conexion pueden contener la URI completa con contrasena.
    console.error('Fallo la migracion:', sanitizeDbError(err));
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
