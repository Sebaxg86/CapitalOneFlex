/**
 * Pruebas de la capa SQL que NO necesitan base de datos.
 *
 * Comprueban invariantes de seguridad del schema: migraciones ordenadas y sin
 * sentencias destructivas, hypertable declarada explicitamente y sanitizado de
 * credenciales en los mensajes de error.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EVENT_TYPES,
  HYPERTABLE_MIGRATION,
  migrations,
  TIMESCALE_EXTENSION_MIGRATION,
} from '@/server/db/migrations';
import { sanitizeDbError } from '@/server/env';
import { SCHEMA } from '@/server/db/pool';

/** Codigo fuente del ejecutor de migraciones, para comprobar el search_path. */
const runnerSource = readFileSync(
  fileURLToPath(new URL('../src/server/db/migrations.ts', import.meta.url)),
  'utf8',
);

/** Divide el SQL en sentencias simples para revisarlas una a una. */
function statementsOf(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const allSql = migrations.map((m) => m.sql).join('\n');
const allStatements = migrations.flatMap((m) => statementsOf(m.sql));

describe('lista de migraciones', () => {
  it('tiene ids unicos', () => {
    const ids = migrations.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('esta ordenada de forma estable', () => {
    const ids = migrations.map((m) => m.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('incluye la extension y la hypertable como migraciones propias', () => {
    const ids = migrations.map((m) => m.id);
    expect(ids).toContain(TIMESCALE_EXTENSION_MIGRATION);
    expect(ids).toContain(HYPERTABLE_MIGRATION);
    // La extension se crea antes de convertir la tabla en hypertable.
    expect(ids.indexOf(TIMESCALE_EXTENSION_MIGRATION)).toBeLessThan(
      ids.indexOf(HYPERTABLE_MIGRATION),
    );
  });

  it('no deja migraciones vacias', () => {
    for (const migration of migrations) {
      expect(statementsOf(migration.sql).length).toBeGreaterThan(0);
    }
  });
});

describe('seguridad del SQL de migracion', () => {
  it('no contiene DROP TABLE ni DROP DATABASE', () => {
    expect(allSql).not.toMatch(/\bdrop\s+table\b/i);
    expect(allSql).not.toMatch(/\bdrop\s+database\b/i);
    expect(allSql).not.toMatch(/\bdrop\s+schema\b/i);
  });

  it('no contiene TRUNCATE', () => {
    expect(allSql).not.toMatch(/\btruncate\b/i);
  });

  it('no contiene DELETE FROM sin WHERE', () => {
    for (const statement of allStatements) {
      if (/\bdelete\s+from\b/i.test(statement)) {
        expect(statement).toMatch(/\bwhere\b/i);
      }
    }
  });

  it('escribe siempre en el schema dedicado', () => {
    expect(allSql).toContain(`${SCHEMA}.financial_events`);
    expect(allSql).toContain(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  });
});

describe('hypertable', () => {
  it('el SQL de creacion incluye create_hypertable', () => {
    expect(allSql).toContain('create_hypertable');
    const hypertable = migrations.find((m) => m.id === HYPERTABLE_MIGRATION);
    expect(hypertable?.sql).toContain(
      `create_hypertable('${SCHEMA}.financial_events', 'recorded_at', if_not_exists => TRUE)`,
    );
  });

  it('crea la extension solo si falta, y siempre en public', () => {
    const extension = migrations.find((m) => m.id === TIMESCALE_EXTENSION_MIGRATION);
    // Muchos servicios de Tiger Data ya traen la extension instalada y el
    // usuario de la aplicacion no es superusuario: crearla de nuevo fallaria.
    expect(extension?.sql).toMatch(/pg_extension WHERE extname = 'timescaledb'/i);
    expect(extension?.sql).toMatch(/CREATE EXTENSION timescaledb WITH SCHEMA public/i);
  });

  it('las migraciones ponen public primero en el search_path', () => {
    // TimescaleDB resuelve funciones internas sin calificar el schema: si el
    // schema dedicado va primero, create_hypertable falla con 42883.
    expect(runnerSource).toMatch(/SET LOCAL search_path TO public/i);
  });

  it('la clave primaria incluye la dimension temporal', () => {
    const hypertable = migrations.find((m) => m.id === HYPERTABLE_MIGRATION);
    expect(hypertable?.sql).toMatch(/PRIMARY KEY \(recorded_at, event_id\)/);
  });

  it('restringe event_type al catalogo cerrado', () => {
    const hypertable = migrations.find((m) => m.id === HYPERTABLE_MIGRATION)?.sql ?? '';
    for (const eventType of EVENT_TYPES) {
      expect(hypertable).toContain(`'${eventType}'`);
    }
  });
});

describe('sanitizeDbError', () => {
  const uri = 'postgresql://u:secreta@host:5432/db';

  it('elimina usuario, contrasena y host de una URI de conexion', () => {
    const sanitized = sanitizeDbError(new Error(`connection to ${uri} failed`));
    expect(sanitized).not.toContain('secreta');
    expect(sanitized).not.toContain('u:secreta');
    expect(sanitized).not.toContain('host:5432');
    expect(sanitized).not.toContain(uri);
    expect(sanitized).toContain('postgresql://');
  });

  it('funciona con cadenas y con valores no Error', () => {
    expect(sanitizeDbError(uri)).not.toContain('secreta');
    expect(sanitizeDbError(null)).toBe('error desconocido');
  });

  it('oculta credenciales sueltas sin esquema', () => {
    const sanitized = sanitizeDbError('auth failed for usuario:clave123@servidor.interno');
    expect(sanitized).not.toContain('clave123');
    expect(sanitized).not.toContain('servidor.interno');
  });

  it('oculta parametros de contrasena', () => {
    const sanitized = sanitizeDbError('opciones: sslmode=require password=zanahoria9');
    expect(sanitized).not.toContain('zanahoria9');
    expect(sanitized).toContain('sslmode=require');
  });
});
