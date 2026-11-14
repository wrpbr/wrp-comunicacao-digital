import type { AuditLog } from '../types.js';

export interface DocAdapter {
  get<T>(collection: string, id: string): Promise<T | null>;
  put<T>(collection: string, id: string, doc: T): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
  list<T>(collection: string): Promise<T[]>;
  appendAudit(doc: AuditLog): Promise<void>;
  listAudit(): Promise<AuditLog[]>;
  lock<T>(fn: () => Promise<T>): Promise<T>;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS documents (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS documents_collection_idx ON documents (collection);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_no_update ON audit_logs;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

DROP TRIGGER IF EXISTS audit_no_delete ON audit_logs;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
`;
