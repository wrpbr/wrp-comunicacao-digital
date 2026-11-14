import { randomUUID } from 'node:crypto';
import type { DocAdapter } from '../store/types.js';
import type { AuditLog } from '../types.js';
import { formatSaoPaulo } from '../time.js';

export type AuditInput = {
  actorUserId: string;
  actorRole: string;
  action: string;
  targetEntity: string;
  targetId: string;
  recipient?: string;
  deliveryStatus?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
  now?: Date;
};

export async function recordAudit(adapter: DocAdapter, input: AuditInput): Promise<AuditLog> {
  const now = input.now ?? new Date();
  const doc: AuditLog = {
    id: `aud_${randomUUID()}`,
    timestampUtc: now.toISOString(),
    timestampSaoPaulo: formatSaoPaulo(now),
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: input.action,
    targetEntity: input.targetEntity,
    targetId: input.targetId,
    recipient: input.recipient ?? '',
    deliveryStatus: input.deliveryStatus ?? '',
    ipAddress: input.ipAddress ?? '',
    metadata: input.metadata ?? {},
  };
  await adapter.appendAudit(doc);
  return doc;
}

export function filterAudit(
  rows: AuditLog[],
  query: {
    from?: string;
    to?: string;
    actor?: string;
    action?: string;
    status?: string;
    q?: string;
  },
): AuditLog[] {
  return rows.filter((row) => {
    if (query.from && row.timestampUtc < query.from) return false;
    if (query.to && row.timestampUtc > query.to) return false;
    if (query.actor && row.actorUserId !== query.actor && row.actorRole !== query.actor) return false;
    if (query.action && row.action !== query.action) return false;
    if (query.status && row.deliveryStatus !== query.status) return false;
    if (query.q) {
      const blob = JSON.stringify(row).toLowerCase();
      if (!blob.includes(query.q.toLowerCase())) return false;
    }
    return true;
  });
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function auditToCsv(rows: AuditLog[]): string {
  const header = [
    'timestamp_utc',
    'timestamp_america_sao_paulo',
    'actor_user_id',
    'actor_role',
    'action',
    'target_entity',
    'target_id',
    'recipient',
    'delivery_status',
    'ip_address',
    'metadata',
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.timestampUtc,
        row.timestampSaoPaulo,
        row.actorUserId,
        row.actorRole,
        row.action,
        row.targetEntity,
        row.targetId,
        row.recipient,
        row.deliveryStatus,
        row.ipAddress,
        row.metadata,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\n')}\n`;
}
