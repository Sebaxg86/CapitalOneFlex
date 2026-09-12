/**
 * Migraciones explicitas y aditivas del schema `compromisos`.
 *
 * Reglas duras:
 * - Nada de `DROP`, `TRUNCATE` ni borrados. Solo creacion idempotente.
 * - Cada migracion se aplica una sola vez y dentro de su propia transaccion.
 *   El registro vive en `compromisos.schema_migrations`.
 * - La hypertable es obligatoria: si `create_hypertable` falla porque Timescale
 *   no esta disponible, la migracion FALLA con un mensaje claro. No se degrada
 *   en silencio a una tabla normal, porque entonces la consulta temporal de la
 *   demo seria una promesa falsa.
 * - `CREATE EXTENSION` va en una migracion propia para que sea la primera
 *   sentencia de su transaccion.
 */
import type { Pool, PoolClient } from 'pg';
import { SCHEMA } from './pool';
import { sanitizeDbError } from '../env';

export interface Migration {
  id: string;
  sql: string;
}

/** Id de la migracion que instala la extension Timescale. */
export const TIMESCALE_EXTENSION_MIGRATION = '0003_timescaledb_extension';

/** Id de la migracion que convierte `financial_events` en hypertable. */
export const HYPERTABLE_MIGRATION = '0004_financial_events_hypertable';

/** Tipos de evento admitidos en la hypertable. Debe coincidir con el check. */
export const EVENT_TYPES = [
  'receivable_rescheduled',
  'settled_movement',
  'scenario_constraint',
  'result_generated',
  'scenario_created',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Migraciones en orden estricto de aplicacion. */
export const migrations: Migration[] = [
  {
    id: '0001_schema',
    sql: `
      CREATE SCHEMA IF NOT EXISTS ${SCHEMA};
    `,
  },
  {
    id: '0002_core_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.businesses (
        id          text PRIMARY KEY,
        name        text NOT NULL,
        currency    text NOT NULL,
        timezone    text NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS ${SCHEMA}.scenarios (
        id                   text PRIMARY KEY,
        business_id          text NOT NULL,
        revision             integer NOT NULL DEFAULT 0,
        opening_balance_cents bigint NOT NULL,
        minimum_cash_cents   bigint NOT NULL,
        horizon_start        date NOT NULL,
        horizon_days         integer NOT NULL,
        demo_today           date NOT NULL,
        excluded_action_ids  text[] NOT NULL DEFAULT '{}',
        parent_scenario_id   text,
        label                text,
        created_at           timestamptz NOT NULL DEFAULT now(),
        updated_at           timestamptz NOT NULL DEFAULT now()
      );

      -- Las obligaciones viven por escenario y guardan la revision que las
      -- escribio, para poder reconstruir el origen de un faltante.
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.obligations (
        id           text NOT NULL,
        business_id  text NOT NULL,
        direction    text NOT NULL CHECK (direction IN ('inflow', 'outflow')),
        amount_cents bigint NOT NULL,
        date         date NOT NULL,
        counterparty text NOT NULL,
        concept      text NOT NULL,
        essential    boolean NOT NULL,
        settled      boolean NOT NULL,
        scenario_id  text NOT NULL,
        revision     integer NOT NULL,
        PRIMARY KEY (scenario_id, id)
      );

      CREATE TABLE IF NOT EXISTS ${SCHEMA}.action_options (
        id            text NOT NULL,
        scenario_id   text NOT NULL,
        obligation_id text NOT NULL,
        kind          text NOT NULL CHECK (kind IN ('defer', 'split', 'advance_receivable')),
        approval      text NOT NULL CHECK (approval IN ('confirmed', 'requires_agreement')),
        label         text NOT NULL,
        counterparty  text NOT NULL,
        variants      jsonb NOT NULL,
        PRIMARY KEY (scenario_id, id)
      );

      CREATE TABLE IF NOT EXISTS ${SCHEMA}.scenario_results (
        id            text PRIMARY KEY,
        scenario_id   text NOT NULL,
        revision      integer NOT NULL,
        input_version text NOT NULL,
        payload       jsonb NOT NULL,
        computed_at   timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS ${SCHEMA}.pending_proposals (
        id            text PRIMARY KEY,
        business_id   text NOT NULL,
        scenario_id   text NOT NULL,
        base_revision integer NOT NULL,
        payload       jsonb NOT NULL,
        status        text NOT NULL CHECK (status IN ('pending', 'confirmed', 'discarded')),
        created_at    timestamptz NOT NULL DEFAULT now(),
        resolved_at   timestamptz
      );

      CREATE TABLE IF NOT EXISTS ${SCHEMA}.view_specs (
        id             text PRIMARY KEY,
        result_id      text NOT NULL,
        focus          text NOT NULL,
        prompt_version text NOT NULL,
        payload        jsonb NOT NULL,
        source         text NOT NULL CHECK (source IN ('gemini', 'fallback')),
        created_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT view_specs_result_focus_prompt_key UNIQUE (result_id, focus, prompt_version)
      );

      -- Idempotencia GLOBAL: tabla normal, no la hypertable. Una constraint
      -- unica por clave no seria compatible con la dimension temporal.
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.operation_keys (
        key        text PRIMARY KEY,
        operation  text NOT NULL,
        result_ref text,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS obligations_scenario_idx
        ON ${SCHEMA}.obligations (scenario_id, revision);
      CREATE INDEX IF NOT EXISTS action_options_obligation_idx
        ON ${SCHEMA}.action_options (scenario_id, obligation_id);
      CREATE INDEX IF NOT EXISTS scenario_results_scenario_idx
        ON ${SCHEMA}.scenario_results (scenario_id, revision DESC, computed_at DESC);
      CREATE INDEX IF NOT EXISTS pending_proposals_business_idx
        ON ${SCHEMA}.pending_proposals (business_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS scenarios_business_idx
        ON ${SCHEMA}.scenarios (business_id);
    `,
  },
  {
    id: TIMESCALE_EXTENSION_MIGRATION,
    // Unica sentencia de la migracion: tolera que la extension ya exista.
    sql: `
      -- La extension vive siempre en public. Si el servicio ya la trae
      -- instalada (caso habitual en Tiger Data) no se vuelve a crear: en
      -- algunos servicios el usuario de la aplicacion no es superusuario.
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
          CREATE EXTENSION timescaledb WITH SCHEMA public;
        END IF;
      END
      $$;
    `,
  },
  {
    id: HYPERTABLE_MIGRATION,
    sql: `
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.financial_events (
        recorded_at    timestamptz NOT NULL DEFAULT now(),
        event_id       uuid NOT NULL,
        business_id    text NOT NULL,
        scenario_id    text,
        revision       integer NOT NULL,
        effective_date date NOT NULL,
        event_type     text NOT NULL CHECK (event_type IN (
          'receivable_rescheduled',
          'settled_movement',
          'scenario_constraint',
          'result_generated',
          'scenario_created'
        )),
        payload        jsonb NOT NULL,
        PRIMARY KEY (recorded_at, event_id)
      );

      SELECT create_hypertable('${SCHEMA}.financial_events', 'recorded_at', if_not_exists => TRUE);
    `,
  },
  {
    id: '0005_financial_events_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS financial_events_business_time_idx
        ON ${SCHEMA}.financial_events (business_id, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS financial_events_scenario_revision_idx
        ON ${SCHEMA}.financial_events (scenario_id, revision);
    `,
  },
  {
    // Puntero al escenario vigente de cada negocio. Permite volver a un
    // escenario anterior sin borrar los derivados.
    id: '0006_business_state',
    sql: `
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.business_state (
        business_id text PRIMARY KEY,
        current_scenario_id text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
];

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly migrationId: string,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

const LEDGER_SQL = `
  CREATE SCHEMA IF NOT EXISTS ${SCHEMA};
  CREATE TABLE IF NOT EXISTS ${SCHEMA}.schema_migrations (
    id          text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
  );
`;

function hintFor(migrationId: string): string {
  if (migrationId === TIMESCALE_EXTENSION_MIGRATION) {
    return (
      ' La extension timescaledb no se pudo crear. Comprueba que el servicio de' +
      ' Tiger Data tenga Timescale habilitado y que el usuario pueda crear' +
      ' extensiones. La demo requiere hypertable: no se continua sin ella.'
    );
  }
  if (migrationId === HYPERTABLE_MIGRATION) {
    return (
      ' No se pudo convertir compromisos.financial_events en hypertable.' +
      ' Sin Timescale la consulta temporal de la demo no seria real, asi que la' +
      ' migracion se detiene en lugar de dejar una tabla normal.'
    );
  }
  return '';
}

/**
 * Aplica las migraciones pendientes. Devuelve los ids realmente aplicados.
 * Cada migracion corre en su propia transaccion junto con su registro.
 */
export async function runMigrations(pool: Pool): Promise<string[]> {
  await pool.query(LEDGER_SQL);
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM ${SCHEMA}.schema_migrations`,
  );
  const applied = new Set(rows.map((r) => r.id));
  const pending = migrations.filter((m) => !applied.has(m.id));

  const result: string[] = [];
  for (const migration of pending) {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      // TimescaleDB resuelve varias de sus funciones internas SIN calificar el
      // schema (por ejemplo timescaledb_pre_restore). Si `compromisos` va
      // primero en el search_path, las busca alli y falla con 42883. Durante
      // las migraciones ponemos `public` delante: todo nuestro SQL califica el
      // schema explicitamente, asi que nada se crea fuera de `compromisos`.
      await client.query(`SET LOCAL search_path TO public, ${SCHEMA}`);
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO ${SCHEMA}.schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
        [migration.id],
      );
      await client.query('COMMIT');
      result.push(migration.id);
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // El rollback puede fallar si la conexion murio; el error util es el otro.
      }
      throw new MigrationError(
        `Fallo la migracion ${migration.id}: ${sanitizeDbError(err)}.${hintFor(migration.id)}`,
        migration.id,
      );
    } finally {
      client.release();
    }
  }
  return result;
}

/** Comprueba que `financial_events` sea realmente una hypertable de Timescale. */
export async function verifyHypertable(
  pool: Pool,
): Promise<{ isHypertable: boolean; extensionVersion: string | null }> {
  const hypertable = await pool.query(
    `SELECT hypertable_schema, hypertable_name
       FROM timescaledb_information.hypertables
      WHERE hypertable_name = 'financial_events'
        AND hypertable_schema = $1`,
    [SCHEMA],
  );
  const extension = await pool.query<{ extversion: string }>(
    `SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'`,
  );
  return {
    isHypertable: hypertable.rowCount !== null && hypertable.rowCount > 0,
    extensionVersion: extension.rows[0]?.extversion ?? null,
  };
}
