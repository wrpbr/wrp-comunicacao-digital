import { randomUUID } from 'node:crypto';
import { decryptString, safeEqual } from '../crypto.js';
import { formatCallName } from '../domain.js';
import { HttpError } from '../http.js';
import type { DocAdapter } from '../store/types.js';
import type { AppConfig } from '../config.js';
import type { DisplayMode, Heartbeat, Ticket, Unit } from '../types.js';
import { tvBus } from '../bus.js';
import { recordAudit } from './audit.js';

export async function listUnits(adapter: DocAdapter): Promise<Unit[]> {
  const units = await adapter.list<Unit>('units');
  return units.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export async function requireUnit(adapter: DocAdapter, slug: string): Promise<Unit> {
  const unit = await adapter.get<Unit>('units', slug);
  if (!unit) throw new HttpError(404, 'Unidade municipal não encontrada.', 'unidade_ausente');
  return unit;
}

export function presentTicket(ticket: Ticket, unit: Unit) {
  return {
    id: ticket.id,
    unitSlug: ticket.unitSlug,
    number: ticket.number,
    displayName: formatCallName(ticket.citizenName, unit.callNameMode),
    service: ticket.service,
    status: ticket.status,
    createdAt: ticket.createdAt,
    calledAt: ticket.calledAt ?? null,
    desk: ticket.desk ?? unit.desk,
  };
}

export async function unitSnapshot(adapter: DocAdapter, slug: string) {
  const unit = await requireUnit(adapter, slug);
  const tickets = (await adapter.list<Ticket>('tickets')).filter((ticket) => ticket.unitSlug === slug);
  const waiting = tickets
    .filter((ticket) => ticket.status === 'waiting')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((ticket) => presentTicket(ticket, unit));
  const recentCalls = tickets
    .filter((ticket) => ticket.status !== 'waiting' && ticket.calledAt)
    .sort((a, b) => (b.calledAt ?? '').localeCompare(a.calledAt ?? ''))
    .slice(0, 6)
    .map((ticket) => presentTicket(ticket, unit));
  return {
    unit: {
      slug: unit.slug,
      name: unit.name,
      serviceLabel: unit.serviceLabel,
      displayMode: unit.displayMode,
      callNameMode: unit.callNameMode,
      businessHours: unit.businessHours,
      desk: unit.desk,
    },
    playlist: unit.playlist,
    waiting,
    recentCalls,
    currentCall: recentCalls[0] ?? null,
    serverTime: new Date().toISOString(),
  };
}

export async function checkIn(
  adapter: DocAdapter,
  input: { unitSlug: string; citizenName: string; service: string; actorId: string; actorRole: string; ip?: string },
): Promise<{ ticket: Ticket; publicTicket: ReturnType<typeof presentTicket> }> {
  const unit = await requireUnit(adapter, input.unitSlug);
  unit.sequence += 1;
  const number = `${unit.prefix}-${String(unit.sequence).padStart(3, '0')}`;
  await adapter.put('units', unit.slug, unit);
  const ticket: Ticket = {
    id: `tkt_${randomUUID()}`,
    unitSlug: unit.slug,
    number,
    citizenName: input.citizenName.trim(),
    service: input.service.trim(),
    status: 'waiting',
    createdAt: new Date().toISOString(),
  };
  await adapter.put('tickets', ticket.id, ticket);
  await recordAudit(adapter, {
    actorUserId: input.actorId,
    actorRole: input.actorRole,
    action: 'queue_checkin',
    targetEntity: 'ticket',
    targetId: ticket.id,
    recipient: ticket.citizenName,
    ipAddress: input.ip,
    metadata: { unitSlug: unit.slug, number },
  });
  const snapshot = await unitSnapshot(adapter, unit.slug);
  tvBus.publish(unit.slug, { event: 'queue', data: snapshot });
  return { ticket, publicTicket: presentTicket(ticket, unit) };
}

export async function callTicket(
  adapter: DocAdapter,
  input: { unitSlug: string; ticketId?: string; desk?: string; actorId: string; actorRole: string; ip?: string },
): Promise<{ ticket: Ticket; publicTicket: ReturnType<typeof presentTicket> }> {
  const unit = await requireUnit(adapter, input.unitSlug);
  const tickets = (await adapter.list<Ticket>('tickets')).filter((ticket) => ticket.unitSlug === unit.slug && ticket.status === 'waiting');
  tickets.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ticket = input.ticketId ? tickets.find((item) => item.id === input.ticketId) : tickets[0];
  if (!ticket) throw new HttpError(404, 'Não há senha aguardando nesta unidade.', 'fila_vazia');
  ticket.status = 'called';
  ticket.calledAt = new Date().toISOString();
  ticket.calledBy = input.actorId;
  ticket.desk = input.desk?.trim() || unit.desk;
  await adapter.put('tickets', ticket.id, ticket);
  const publicTicket = presentTicket(ticket, unit);
  await recordAudit(adapter, {
    actorUserId: input.actorId,
    actorRole: input.actorRole,
    action: 'queue_call',
    targetEntity: 'ticket',
    targetId: ticket.id,
    recipient: publicTicket.displayName,
    ipAddress: input.ip,
    metadata: { unitSlug: unit.slug, number: ticket.number, callNameMode: unit.callNameMode },
  });
  const snapshot = await unitSnapshot(adapter, unit.slug);
  const started = Date.now();
  tvBus.publish(unit.slug, { event: 'call', data: { ...snapshot, currentCall: publicTicket, latencyOriginMs: started } });
  return { ticket, publicTicket };
}

export async function recordHeartbeat(
  adapter: DocAdapter,
  input: { unitSlug: string; mode?: DisplayMode; playerVersion?: string; userAgent?: string; source?: Heartbeat['source'] },
): Promise<Heartbeat> {
  await requireUnit(adapter, input.unitSlug);
  const beat: Heartbeat = {
    id: `hb_${randomUUID()}`,
    unitSlug: input.unitSlug,
    at: new Date().toISOString(),
    mode: input.mode ?? 'split',
    playerVersion: input.playerVersion ?? '1.0.0',
    userAgent: input.userAgent,
    source: input.source ?? 'player',
  };
  await adapter.put('heartbeats', beat.id, beat);
  return beat;
}

export async function heartbeatSummary(adapter: DocAdapter) {
  const units = await listUnits(adapter);
  const beats = await adapter.list<Heartbeat>('heartbeats');
  const now = Date.now();
  return units.map((unit) => {
    const latest = beats
      .filter((beat) => beat.unitSlug === unit.slug)
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    const ageMs = latest ? now - new Date(latest.at).getTime() : null;
    return {
      unitSlug: unit.slug,
      name: unit.name,
      displayMode: unit.displayMode,
      callNameMode: unit.callNameMode,
      lastHeartbeatAt: latest?.at ?? null,
      online: ageMs !== null && ageMs < 45_000,
      ageMs,
      source: latest?.source ?? null,
    };
  });
}

export async function displayAuthorized(adapter: DocAdapter, config: AppConfig, slug: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const unit = await adapter.get<Unit>('units', slug);
  if (!unit) return false;
  try {
    return safeEqual(decryptString(unit.displayTokenCipher, config.secretsKey), token);
  } catch {
    return false;
  }
}

export async function revealDisplayToken(adapter: DocAdapter, config: AppConfig, slug: string): Promise<string> {
  const unit = await requireUnit(adapter, slug);
  return decryptString(unit.displayTokenCipher, config.secretsKey);
}

export async function updateUnit(
  adapter: DocAdapter,
  slug: string,
  patch: Partial<Pick<Unit, 'callNameMode' | 'displayMode' | 'businessHours' | 'oohMessage' | 'playlist' | 'desk'>>,
  actor: { id: string; role: string },
  ip?: string,
): Promise<Unit> {
  const unit = await requireUnit(adapter, slug);
  const next = { ...unit, ...patch, slug: unit.slug, prefix: unit.prefix, sequence: unit.sequence };
  await adapter.put('units', slug, next);
  await recordAudit(adapter, {
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'unit_update',
    targetEntity: 'unit',
    targetId: slug,
    ipAddress: ip,
    metadata: { displayMode: next.displayMode, callNameMode: next.callNameMode },
  });
  const snapshot = await unitSnapshot(adapter, slug);
  tvBus.publish(slug, { event: 'playlist', data: snapshot });
  return next;
}
