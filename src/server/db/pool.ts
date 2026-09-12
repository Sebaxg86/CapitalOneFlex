/**
 * Pool unico de PostgreSQL (Tiger Data). SOLO servidor.
 *
 * Decisiones fijadas aqui:
 * - TLS con verificacion de certificado (`rejectUnauthorized: true`). Tiger Data
 *   presenta certificados validos; desactivar la verificacion para "arreglar"
 *   un error de conexion esta prohibido.
 * - Schema dedicado `compromisos`. Cada conexion del pool fija
 *   `search_path = compromisos, public`, de modo que ninguna consulta escribe
 *   en `public` por accidente.
 * - `int8` (bigint) llega como string y se convierte con `centsFromDatabase`
 *   comprobando el rango seguro de JavaScript. Nunca se deja que `pg` lo
 *   convierta a number en silencio.
 * - `date` llega como string `YYYY-MM-DD`. El parser por defecto de `pg`
 *   devuelve un `Date` interpretado en la zona local, lo que desplazaria las
 *   fechas economicas un dia.
 */
import { Pool, types, type PoolClient, type PoolConfig } from 'pg';
import { getServerEnv, sanitizeDbError } from '../env';

/** Schema dedicado de la demo. Nunca se escribe fuera de aqui. */
export const SCHEMA = 'compromisos';

/** `search_path` que se fija en cada conexion. */
export const SEARCH_PATH = `${SCHEMA}, public`;

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super('Tiger Data no configurado: falta DATABASE_URL en .env.local');
    this.name = 'DatabaseNotConfiguredError';
  }
}

let typeParsersReady = false;

/** Ajusta los parsers de `pg` una sola vez por proceso. */
function configureTypeParsers(): void {
  if (typeParsersReady) return;
  typeParsersReady = true;
  // bigint como string: la conversion segura la hace `centsFromDatabase`.
  types.setTypeParser(types.builtins.INT8, (value: string) => value);
  // fecha economica como texto plano `YYYY-MM-DD`, sin zona horaria.
  types.setTypeParser(types.builtins.DATE, (value: string) => value);
}

let pool: Pool | null = null;

function buildConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    // Verificacion de certificado activada a proposito.
    ssl: { rejectUnauthorized: true },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'compromisos-demo',
    // El search_path se negocia al abrir la conexion, no con un SET posterior:
    // asi ninguna consulta puede adelantarse a el. Aun asi, todo el SQL del
    // proyecto califica el schema de forma explicita.
    options: `-c search_path=${SEARCH_PATH.replace(/\s+/g, '')}`,
  };
}

/**
 * Devuelve el pool singleton. Lanza `DatabaseNotConfiguredError` si no hay
 * `DATABASE_URL`: quien llama decide si eso es un fallo o un modo local.
 */
export function getPool(): Pool {
  if (pool) return pool;
  const env = getServerEnv();
  if (!env.DATABASE_URL) throw new DatabaseNotConfiguredError();
  configureTypeParsers();
  const created = new Pool(buildConfig(env.DATABASE_URL));
  // Un error de conexion inactiva no debe tumbar el proceso ni filtrar la URI.
  created.on('error', (err: Error) => {
    console.error('[db] error en conexion inactiva:', sanitizeDbError(err));
  });
  pool = created;
  return pool;
}

/** true si hay pool creado. No abre conexiones. */
export function isPoolOpen(): boolean {
  return pool !== null;
}

/**
 * Ejecuta `fn` dentro de una transaccion. Commit al terminar, rollback ante
 * cualquier error. El cliente siempre se devuelve al pool.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[db] fallo el rollback:', sanitizeDbError(rollbackErr));
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Cierra el pool. Los scripts deben llamarlo para que el proceso termine. */
export async function closePool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
