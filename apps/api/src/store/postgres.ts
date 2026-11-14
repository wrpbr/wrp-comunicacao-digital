import pg from 'pg';
import type { AuditLog } from '../types.js';
import { SCHEMA_SQL, type DocAdapter } from './types.js';

const { Pool } = pg;

export class PostgresAdapter implements DocAdapter {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private pool: pg.Pool) {}

  async get<T>(collection: string, id: string): Promise<T | null> {
    const result = await this.pool.query('SELECT body FROM documents WHERE collection = $1 AND id = $2', [
      collection,
      id,
    ]);
    return (result.rows[0]?.body as T | undefined) ?? null;
  }

  async put<T>(collection: string, id: string, doc: T): Promise<void> {
    if (collection === 'audit_logs') throw new Error('audit_logs is immutable. Use appendAudit.');
    await this.pool.query(
      `INSERT INTO documents (collection, id, body, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (collection, id)
       DO UPDATE SET body = EXCLUDED.body, updated_at = now()`,
      [collection, id, JSON.stringify(doc)],
    );
  }

  async delete(collection: string, id: string): Promise<void> {
    if (collection === 'audit_logs') throw new Error('audit_logs is immutable');
    await this.pool.query('DELETE FROM documents WHERE collection = $1 AND id = $2', [collection, id]);
  }

  async list<T>(collection: string): Promise<T[]> {
    const result = await this.pool.query('SELECT body FROM documents WHERE collection = $1 ORDER BY id', [collection]);
    return result.rows.map((row) => row.body as T);
  }

  async appendAudit(doc: AuditLog): Promise<void> {
    await this.pool.query('INSERT INTO audit_logs (id, body) VALUES ($1, $2::jsonb)', [doc.id, JSON.stringify(doc)]);
  }

  async listAudit(): Promise<AuditLog[]> {
    const result = await this.pool.query('SELECT body FROM audit_logs ORDER BY created_at ASC');
    return result.rows.map((row) => row.body as AuditLog);
  }

  async lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const client = await this.pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock(42089)');
        return await fn();
      } finally {
        await client.query('SELECT pg_advisory_unlock(42089)').catch(() => undefined);
        client.release();
      }
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export async function createPostgresAdapter(databaseUrl: string): Promise<PostgresAdapter> {
  const pool = new Pool({ connectionString: databaseUrl });
  await pool.query(SCHEMA_SQL);
  return new PostgresAdapter(pool);
}
