import type { AuditLog } from '../types.js';
import type { DocAdapter } from './types.js';

type Row = { id: string; body: unknown };

export class MemoryAdapter implements DocAdapter {
  private docs = new Map<string, Map<string, unknown>>();
  private audit: AuditLog[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  async get<T>(collection: string, id: string): Promise<T | null> {
    const hit = this.docs.get(collection)?.get(id);
    return hit ? (structuredClone(hit) as T) : null;
  }

  async put<T>(collection: string, id: string, doc: T): Promise<void> {
    if (collection === 'audit_logs') {
      throw new Error('audit_logs is immutable. Use appendAudit.');
    }
    let bucket = this.docs.get(collection);
    if (!bucket) {
      bucket = new Map();
      this.docs.set(collection, bucket);
    }
    bucket.set(id, structuredClone(doc));
  }

  async delete(collection: string, id: string): Promise<void> {
    if (collection === 'audit_logs') throw new Error('audit_logs is immutable');
    this.docs.get(collection)?.delete(id);
  }

  async list<T>(collection: string): Promise<T[]> {
    const bucket = this.docs.get(collection);
    if (!bucket) return [];
    return [...bucket.values()].map((row) => structuredClone(row) as T);
  }

  async appendAudit(doc: AuditLog): Promise<void> {
    if (this.audit.some((row) => row.id === doc.id)) {
      throw new Error('audit_logs is immutable');
    }
    this.audit.push(structuredClone(doc));
  }

  async listAudit(): Promise<AuditLog[]> {
    return this.audit.map((row) => structuredClone(row));
  }

  async lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Test helper: raw rows, still cloned. */
  rows(collection: string): Row[] {
    return [...(this.docs.get(collection)?.entries() ?? [])].map(([id, body]) => ({ id, body }));
  }
}
