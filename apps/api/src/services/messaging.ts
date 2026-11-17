import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { classifyOutbound } from '../franchise.js';
import { sendWhatsApp, type MetaSendInput } from '../meta.js';
import type { DocAdapter } from '../store/types.js';
import { currentDateKey, currentMonthKey, formatSaoPaulo, isBirthdayOn, within24h } from '../time.js';
import { assertBrazilianPhone, emptyStatusCounts, isOpen, matchesSegment, optOutBlocks, optOutKeyword, samePhone } from '../domain.js';
import type {
  AlertRecord,
  Campaign,
  Citizen,
  DeliveryReport,
  DeliveryStatus,
  JobMarker,
  Message,
  MessageKind,
  OptOutRecord,
  ProbeResult,
  Segment,
  StatusCounts,
  Unit,
} from '../types.js';
import { HttpError } from '../http.js';
import { recordAudit } from './audit.js';
import { getFranchise, release, tryHold, type HoldResult } from './franchise.js';

export type Actor = { id: string; role: string };

export type ServiceCtx = {
  adapter: DocAdapter;
  config: AppConfig;
};

const BAIRROS = ['Centro', 'São José', 'Várzea'] as const;
const INTERESSES = ['saude', 'tributos', 'educacao', 'avisos_gerais'] as const;
const PREDIOS = ['UBS Centro', 'Prefeitura Sede', 'CRAS', 'Escola Municipal Centro'] as const;

export async function listPeople(adapter: DocAdapter): Promise<Citizen[]> {
  return adapter.list<Citizen>('people');
}

export async function findPersonByPhone(adapter: DocAdapter, phone: string): Promise<Citizen | null> {
  const people = await listPeople(adapter);
  return people.find((person) => person.phone === phone) ?? people.find((person) => samePhone(person.phone, phone)) ?? null;
}

async function activeOptOut(adapter: DocAdapter, phone: string): Promise<OptOutRecord | null> {
  const rows = await adapter.list<OptOutRecord>('opt_outs');
  return rows.find((row) => row.active && samePhone(row.phone, phone)) ?? null;
}

async function personBlocked(
  adapter: DocAdapter,
  person: Citizen | null,
  phone: string,
  honorLegalException: boolean,
): Promise<boolean> {
  if (optOutBlocks(person, honorLegalException)) return true;
  const row = await activeOptOut(adapter, phone);
  if (!row) return false;
  if (person?.legalException && honorLegalException) return false;
  return true;
}

function history(status: DeliveryStatus, at: string): Message['statusHistory'] {
  if (status === 'queued') return [{ status, at }];
  return [
    { status: 'queued', at },
    { status, at },
  ];
}

async function persistMessage(ctx: ServiceCtx, message: Message, actor: Actor, ip?: string): Promise<Message> {
  await ctx.adapter.put('messages', message.id, message);
  await recordAudit(ctx.adapter, {
    actorUserId: actor.id,
    actorRole: actor.role,
    action: message.direction === 'inbound' ? 'message_inbound' : 'message_outbound',
    targetEntity: 'message',
    targetId: message.id,
    recipient: message.recipientPhone,
    deliveryStatus: message.status,
    ipAddress: ip,
    metadata: {
      kind: message.kind,
      billable: message.billable,
      bucket: message.bucket,
      exclusionReason: message.exclusionReason ?? null,
      campaignId: message.campaignId ?? null,
      probe: message.probe,
    },
  });
  return message;
}

export async function dispatchAlertHooks(ctx: ServiceCtx, alerts: AlertRecord[]): Promise<void> {
  for (const alert of alerts) {
    if (ctx.config.alertWebhookUrl) {
      try {
        await fetch(ctx.config.alertWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'wrp-comunicacao-digital', alert }),
        });
      } catch {
        /* o registro local permanece */
      }
    }
    if (!ctx.config.adminAlertPhone) continue;
    const meta = await sendWhatsApp(ctx.config, {
      to: assertSafe(ctx.config.adminAlertPhone),
      body: alert.message,
    });
    const now = new Date().toISOString();
    const message: Message = {
      id: `msg_${randomUUID()}`,
      month: currentMonthKey(),
      direction: 'outbound',
      kind: 'admin_alert',
      bucket: 'none',
      billable: false,
      exclusionReason: 'Alerta operacional ao gestor. Fora da franquia de comunicação com o cidadão.',
      metaRejected: meta.metaRejected,
      probe: false,
      synthetic: false,
      recipientName: 'Gestor da franquia',
      recipientPhone: assertSafe(ctx.config.adminAlertPhone),
      body: alert.message,
      status: meta.status,
      statusHistory: history(meta.status, now),
      wamid: meta.wamid,
      metaMode: ctx.config.metaMode,
      error: meta.error,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.adapter.put('messages', message.id, message);
  }
}

function assertSafe(phone: string): string {
  try {
    return assertBrazilianPhone(phone);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Telefone inválido.', 'telefone_invalido');
  }
}

export async function sendOutbound(
  ctx: ServiceCtx,
  input: {
    to: string;
    body: string;
    kind: MessageKind;
    honorLegalException?: boolean;
    actor: Actor;
    ip?: string;
    campaignId?: string;
    reportId?: string;
    recipientName?: string;
    bairro?: string;
    interesse?: string;
    predioPublico?: string;
    index?: number;
    forceStatus?: DeliveryStatus;
    templateName?: string;
    probe?: boolean;
    citizenId?: string;
    alreadyHeld?: boolean;
    skipOptOut?: boolean;
  },
): Promise<{ message: Message; alerts: AlertRecord[] }> {
  const phone = assertSafe(input.to);
  const person = input.citizenId
    ? await ctx.adapter.get<Citizen>('people', input.citizenId)
    : await findPersonByPhone(ctx.adapter, phone);
  if (!input.skipOptOut && (await personBlocked(ctx.adapter, person, phone, Boolean(input.honorLegalException)))) {
    throw new HttpError(
      422,
      'Destinatário com opt-out ativo. O envio só ocorre se houver exceção legal marcada no cadastro e a campanha declarar essa base.',
      'opt_out',
    );
  }
  const windowOpen = within24h(person?.lastInboundAt);
  const planned = classifyOutbound({ kind: input.kind, withinServiceWindow: windowOpen, metaRejected: false });
  let alerts: AlertRecord[] = [];
  let held: 'franchise' | 'reserve' | null = null;
  if (!input.alreadyHeld && planned.bucket === 'franchise') {
    const hold = await tryHold(ctx.adapter, ctx.config, 'franchise', 1);
    if (!hold.ok) {
      throw new HttpError(
        409,
        `Franquia esgotada (${hold.used}/${hold.capacity}). Campanhas regulares bloqueadas até a autorização de um pacote de ${ctx.config.franchisePackSize} mensagens.`,
        'franquia_esgotada',
      );
    }
    alerts = hold.alerts;
    held = 'franchise';
  } else if (!input.alreadyHeld && planned.bucket === 'reserve') {
    const hold = await tryHold(ctx.adapter, ctx.config, 'reserve', 1);
    if (!hold.ok) {
      throw new HttpError(409, 'Reserva técnica esgotada. O alerta de urgência não foi enviado.', 'reserva_esgotada');
    }
    alerts = hold.alerts;
    held = 'reserve';
  }

  const metaInput: MetaSendInput = {
    to: phone,
    body: input.body,
    index: input.index,
    forceStatus: input.forceStatus,
    templateName: input.templateName,
    // A resposta automática de fora do expediente responde a quem acabou de escrever: a janela está aberta.
    withinServiceWindow: windowOpen || input.kind === 'ooh_autoreply',
  };
  let meta;
  try {
    meta = await sendWhatsApp(ctx.config, metaInput);
  } catch (error) {
    if (held) await release(ctx.adapter, ctx.config, held, 1);
    throw error;
  }
  const finalClass = classifyOutbound({
    kind: input.kind,
    withinServiceWindow: windowOpen,
    metaRejected: meta.metaRejected,
  });
  if (held && finalClass.bucket === 'none') {
    await release(ctx.adapter, ctx.config, held, 1);
  }
  const now = new Date().toISOString();
  const message: Message = {
    id: `msg_${randomUUID()}`,
    month: currentMonthKey(),
    direction: 'outbound',
    kind: input.kind,
    bucket: finalClass.bucket,
    billable: finalClass.billable,
    exclusionReason: finalClass.exclusionReason,
    metaRejected: meta.metaRejected,
    withinServiceWindow: windowOpen,
    probe: Boolean(input.probe),
    synthetic: false,
    campaignId: input.campaignId,
    reportId: input.reportId,
    citizenId: person?.id,
    recipientName: input.recipientName ?? person?.name ?? phone,
    recipientPhone: phone,
    bairro: input.bairro ?? person?.bairro,
    interesse: input.interesse ?? person?.interesses[0],
    predioPublico: input.predioPublico ?? person?.predioPublico,
    body: input.body,
    status: meta.status,
    statusHistory: history(meta.status, now),
    wamid: meta.wamid,
    metaMode: ctx.config.metaMode,
    error: meta.error,
    refunded: Boolean(held && finalClass.bucket === 'none'),
    createdAt: now,
    updatedAt: now,
  };
  await persistMessage(ctx, message, input.actor, input.ip);
  return { message, alerts };
}

export async function setOptOut(
  ctx: ServiceCtx,
  input: {
    phone: string;
    active: boolean;
    source: OptOutRecord['source'];
    keyword?: string;
    reason?: string;
    actor: Actor;
    ip?: string;
    legalException?: boolean;
    legalExceptionBasis?: string;
  },
): Promise<OptOutRecord> {
  const informed = assertSafe(input.phone);
  const person = await findPersonByPhone(ctx.adapter, informed);
  // O registro fica no telefone do cadastro, mesmo quando a Meta informa o número sem o nono dígito.
  const phone = person?.phone ?? informed;
  if (person) {
    person.optOut = input.active;
    if (input.legalException !== undefined) {
      person.legalException = input.legalException;
      person.legalExceptionBasis = input.legalExceptionBasis;
    }
    await ctx.adapter.put('people', person.id, person);
  } else if (input.legalException) {
    throw new HttpError(404, 'Exceção legal só pode ser marcada em um cadastro existente.', 'cidadao_ausente');
  }
  const existing = (await ctx.adapter.list<OptOutRecord>('opt_outs')).find((row) => samePhone(row.phone, phone));
  const now = new Date().toISOString();
  const record: OptOutRecord = {
    id: existing?.id ?? `opt_${randomUUID()}`,
    phone,
    citizenId: person?.id,
    active: input.active,
    source: input.source,
    keyword: input.keyword,
    reason: input.reason,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    actorUserId: input.actor.id,
  };
  await ctx.adapter.put('opt_outs', record.id, record);
  await recordAudit(ctx.adapter, {
    actorUserId: input.actor.id,
    actorRole: input.actor.role,
    action: input.active ? 'opt_out' : 'opt_in',
    targetEntity: 'opt_out',
    targetId: record.id,
    recipient: phone,
    ipAddress: input.ip,
    metadata: { source: input.source, keyword: input.keyword ?? null, reason: input.reason ?? null },
  });
  return record;
}

export async function recordInbound(
  ctx: ServiceCtx,
  input: { from: string; text: string; name?: string; unitSlug?: string; actor?: Actor; ip?: string },
): Promise<{ inbound: Message; ooh?: Message; optedOut: boolean; alerts: AlertRecord[] }> {
  const phone = assertSafe(input.from);
  const nowDate = new Date();
  const now = nowDate.toISOString();
  let person = await findPersonByPhone(ctx.adapter, phone);
  const keyword = optOutKeyword(input.text);
  if (keyword) {
    await setOptOut(ctx, {
      phone,
      active: true,
      source: 'keyword',
      keyword,
      reason: `Palavra-chave ${keyword}`,
      actor: input.actor ?? { id: 'citizen', role: 'cidadao' },
      ip: input.ip,
    });
    person = await findPersonByPhone(ctx.adapter, phone);
  }
  if (person) {
    person.lastInboundAt = now;
    await ctx.adapter.put('people', person.id, person);
  }
  const inbound: Message = {
    id: `msg_${randomUUID()}`,
    month: currentMonthKey(nowDate),
    direction: 'inbound',
    kind: 'inbound_citizen',
    bucket: 'none',
    billable: false,
    exclusionReason: 'Mensagem iniciada pelo cidadão. Não entra na franquia.',
    metaRejected: false,
    probe: false,
    synthetic: false,
    citizenId: person?.id,
    recipientName: person?.name ?? input.name ?? phone,
    recipientPhone: phone,
    bairro: person?.bairro,
    body: input.text,
    status: 'delivered',
    statusHistory: [{ status: 'delivered', at: now }],
    metaMode: ctx.config.metaMode,
    createdAt: now,
    updatedAt: now,
  };
  await persistMessage(ctx, inbound, input.actor ?? { id: 'citizen', role: 'cidadao' }, input.ip);

  let ooh: Message | undefined;
  const alerts: AlertRecord[] = [];
  if (ctx.config.oohSender === 'wrp') {
    const units = await ctx.adapter.list<Unit>('units');
    const unit = units.find((item) => item.slug === input.unitSlug) ?? units.find((item) => item.slug === 'unidade-atendimento-geral') ?? units[0];
    if (unit && !isOpen(unit.businessHours, nowDate)) {
      const today = currentDateKey(nowDate);
      if (!person || person.lastOohOn !== today) {
        const sent = await sendOutbound(ctx, {
          to: phone,
          body: unit.oohMessage,
          kind: 'ooh_autoreply',
          actor: { id: 'system', role: 'system' },
          ip: input.ip,
          recipientName: person?.name,
          skipOptOut: true,
        });
        ooh = sent.message;
        alerts.push(...sent.alerts);
        if (person) {
          person.lastOohOn = today;
          person.lastInboundAt = now;
          await ctx.adapter.put('people', person.id, person);
        }
      }
    }
  }
  return { inbound, ooh, optedOut: Boolean(keyword), alerts };
}

export async function recordAgentEcho(
  ctx: ServiceCtx,
  input: { phone: string; body: string; externalId?: string; withinServiceWindow?: boolean; actor: Actor; ip?: string },
): Promise<{ message: Message; alerts: AlertRecord[] }> {
  const phone = assertSafe(input.phone);
  if (input.externalId) {
    const existing = (await ctx.adapter.list<Message>('messages')).find((item) => item.wamid === `chatwoot:${input.externalId}`);
    if (existing) return { message: existing, alerts: [] };
  }
  const person = await findPersonByPhone(ctx.adapter, phone);
  const windowOpen = input.withinServiceWindow ?? within24h(person?.lastInboundAt);
  const klass = classifyOutbound({ kind: 'agent_reply', withinServiceWindow: windowOpen, metaRejected: false });
  let alerts: AlertRecord[] = [];
  if (klass.billable && klass.bucket === 'franchise') {
    const hold = await tryHold(ctx.adapter, ctx.config, 'franchise', 1);
    if (!hold.ok) {
      klass.billable = false;
      klass.bucket = 'none';
      klass.exclusionReason = 'Eco do atendente fora da janela de 24 horas, sem saldo de franquia. Revisar com o gestor.';
    } else alerts = hold.alerts;
  }
  const now = new Date().toISOString();
  const message: Message = {
    id: `msg_${randomUUID()}`,
    month: currentMonthKey(),
    direction: 'outbound',
    kind: 'agent_reply',
    bucket: klass.bucket,
    billable: klass.billable,
    exclusionReason: klass.exclusionReason,
    metaRejected: false,
    withinServiceWindow: windowOpen,
    probe: false,
    synthetic: false,
    citizenId: person?.id,
    recipientName: person?.name ?? phone,
    recipientPhone: phone,
    body: input.body,
    status: 'sent',
    statusHistory: history('sent', now),
    wamid: input.externalId ? `chatwoot:${input.externalId}` : undefined,
    metaMode: ctx.config.metaMode,
    createdAt: now,
    updatedAt: now,
  };
  await persistMessage(ctx, message, input.actor, input.ip);
  return { message, alerts };
}

export async function applyDeliveryStatus(
  ctx: ServiceCtx,
  input: { wamid?: string; messageId?: string; status: DeliveryStatus; actor: Actor; ip?: string },
): Promise<Message | null> {
  const messages = await ctx.adapter.list<Message>('messages');
  const message = messages.find((item) => (input.wamid ? item.wamid === input.wamid : item.id === input.messageId));
  if (!message) return null;
  const rank: Record<DeliveryStatus, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
  if (input.status !== 'failed' && rank[input.status] < rank[message.status]) return message;
  if (input.status === 'failed' && !message.refunded && (message.bucket === 'franchise' || message.bucket === 'reserve')) {
    await release(ctx.adapter, ctx.config, message.bucket, 1, message.month);
    message.billable = false;
    message.metaRejected = true;
    message.refunded = true;
    message.bucket = 'none';
    message.exclusionReason = 'Status de falha informado pela Meta. A mensagem saiu da franquia ou da reserva.';
  }
  const now = new Date().toISOString();
  message.status = input.status;
  message.statusHistory = [...message.statusHistory, { status: input.status, at: now }];
  message.updatedAt = now;
  await ctx.adapter.put('messages', message.id, message);
  await recordAudit(ctx.adapter, {
    actorUserId: input.actor.id,
    actorRole: input.actor.role,
    action: 'delivery_status',
    targetEntity: 'message',
    targetId: message.id,
    recipient: message.recipientPhone,
    deliveryStatus: input.status,
    ipAddress: input.ip,
    metadata: { wamid: message.wamid ?? null },
  });
  return message;
}

export async function createCampaign(
  ctx: ServiceCtx,
  input: {
    name: string;
    body: string;
    segment: Segment;
    allowLegalExceptions?: boolean;
    kind?: Campaign['kind'];
    actor: Actor;
    ip?: string;
  },
): Promise<Campaign> {
  const campaign: Campaign = {
    id: `cmp_${randomUUID()}`,
    name: input.name,
    body: input.body,
    kind: input.kind ?? 'segmentada',
    segment: input.segment,
    allowLegalExceptions: Boolean(input.allowLegalExceptions),
    status: 'rascunho',
    createdBy: input.actor.id,
    createdAt: new Date().toISOString(),
  };
  await ctx.adapter.put('campaigns', campaign.id, campaign);
  await recordAudit(ctx.adapter, {
    actorUserId: input.actor.id,
    actorRole: input.actor.role,
    action: 'campaign_create',
    targetEntity: 'campaign',
    targetId: campaign.id,
    ipAddress: input.ip,
    metadata: { segment: campaign.segment, kind: campaign.kind },
  });
  return campaign;
}

export async function previewSegment(adapter: DocAdapter, segment: Segment, publico?: 'cidadao' | 'servidor'): Promise<Citizen[]> {
  const people = await listPeople(adapter);
  return people.filter((person) => {
    if (person.synthetic) return false;
    if (publico && person.publico !== publico) return false;
    if (!publico && person.publico !== 'cidadao' && !segment.rules.some((rule) => rule.field === 'publico')) return false;
    return matchesSegment(person, segment);
  });
}

export async function dispatchCampaign(
  ctx: ServiceCtx,
  campaignId: string,
  actor: Actor,
  ip?: string,
): Promise<{ campaign: Campaign; sent: Message[]; excluded: Citizen[]; alerts: AlertRecord[] }> {
  const campaign = await ctx.adapter.get<Campaign>('campaigns', campaignId);
  if (!campaign) throw new HttpError(404, 'Campanha não encontrada.', 'nao_encontrado');
  const matched = await previewSegment(ctx.adapter, campaign.segment);
  const excluded: Citizen[] = [];
  const targets: Citizen[] = [];
  for (const person of matched) {
    if (await personBlocked(ctx.adapter, person, person.phone, campaign.allowLegalExceptions)) excluded.push(person);
    else targets.push(person);
  }
  if (targets.length === 0) {
    throw new HttpError(422, 'Nenhum destinatário elegível depois do filtro de opt-out.', 'sem_destinatarios');
  }
  const hold = await holdOrBlock(ctx, targets.length, campaign);
  const sent: Message[] = [];
  let rejected = 0;
  for (const person of targets) {
    const result = await sendOutbound(ctx, {
      to: person.phone,
      body: personalize(campaign.body, person),
      kind: campaign.kind === 'aniversario' ? 'birthday' : campaign.kind === 'servidores' ? 'servidor' : 'campaign',
      honorLegalException: campaign.allowLegalExceptions,
      actor,
      ip,
      campaignId: campaign.id,
      recipientName: person.name,
      alreadyHeld: true,
      skipOptOut: true,
    });
    if (!result.message.billable) rejected += 1;
    sent.push(result.message);
  }
  if (rejected) await release(ctx.adapter, ctx.config, 'franchise', rejected);
  const counts = emptyStatusCounts();
  for (const message of sent) counts[message.status] += 1;
  campaign.status = 'enviada';
  campaign.dispatchedAt = new Date().toISOString();
  campaign.stats = counts;
  await ctx.adapter.put('campaigns', campaign.id, campaign);
  await recordAudit(ctx.adapter, {
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'campaign_dispatch',
    targetEntity: 'campaign',
    targetId: campaign.id,
    ipAddress: ip,
    deliveryStatus: 'sent',
    metadata: { targets: targets.length, excluded: excluded.length, rejected, counts },
  });
  return { campaign, sent, excluded, alerts: hold.alerts };
}

function personalize(body: string, person: Citizen): string {
  return body.replaceAll('{{nome}}', person.name.split(' ')[0] ?? person.name).replaceAll('{{bairro}}', person.bairro);
}

async function holdOrBlock(ctx: ServiceCtx, count: number, campaign: Campaign): Promise<Extract<HoldResult, { ok: true }>> {
  const hold = await tryHold(ctx.adapter, ctx.config, 'franchise', count);
  if (!hold.ok) {
    campaign.status = 'bloqueada';
    await ctx.adapter.put('campaigns', campaign.id, campaign);
    throw new HttpError(
      409,
      `Franquia insuficiente para ${count} mensagens (${hold.remaining} vagas em ${hold.capacity}). Autorize um pacote de ${ctx.config.franchisePackSize} ou reduza o segmento. Urgências usam a reserva técnica.`,
      'franquia_esgotada',
    );
  }
  return hold;
}

export async function runBirthdays(
  ctx: ServiceCtx,
  actor: Actor,
  ip?: string,
  force = false,
): Promise<{ alreadyRan: boolean; campaign?: Campaign; sent: number; excluded: number; alerts: AlertRecord[] }> {
  const key = `birthday-${currentDateKey()}`;
  const marker = await ctx.adapter.get<JobMarker>('jobs', key);
  if (marker && !force) {
    return { alreadyRan: true, sent: marker.sent, excluded: 0, alerts: [], campaign: marker.campaignId ? await ctx.adapter.get<Campaign>('campaigns', marker.campaignId) ?? undefined : undefined };
  }
  const people = (await listPeople(ctx.adapter)).filter((person) => !person.synthetic && isBirthdayOn(person.birthDate));
  const targets: Citizen[] = [];
  const excluded: Citizen[] = [];
  for (const person of people) {
    if (await personBlocked(ctx.adapter, person, person.phone, false)) excluded.push(person);
    else targets.push(person);
  }
  const campaign = await createCampaign(ctx, {
    name: `Aniversariantes ${currentDateKey()}`,
    body: 'A Prefeitura de Pompéu e a Comunicação Digital desejam um feliz aniversário, {{nome}}. Mensagem institucional — responda PARAR para não receber novos comunicados.',
    segment: { match: 'AND', rules: [] },
    kind: 'aniversario',
    actor,
    ip,
  });
  let alerts: AlertRecord[] = [];
  const sent: Message[] = [];
  if (targets.length) {
    const hold = await holdOrBlock(ctx, targets.length, campaign);
    alerts = hold.alerts;
    let rejected = 0;
    for (const person of targets) {
      const result = await sendOutbound(ctx, {
        to: person.phone,
        body: personalize(campaign.body, person),
        kind: 'birthday',
        actor,
        ip,
        campaignId: campaign.id,
        alreadyHeld: true,
        skipOptOut: true,
      });
      if (!result.message.billable) rejected += 1;
      sent.push(result.message);
    }
    if (rejected) await release(ctx.adapter, ctx.config, 'franchise', rejected);
  }
  campaign.status = 'enviada';
  campaign.dispatchedAt = new Date().toISOString();
  campaign.stats = emptyStatusCounts();
  for (const message of sent) campaign.stats[message.status] += 1;
  await ctx.adapter.put('campaigns', campaign.id, campaign);
  const job: JobMarker = { id: key, ranAt: new Date().toISOString(), campaignId: campaign.id, sent: sent.filter((m) => m.billable).length };
  await ctx.adapter.put('jobs', job.id, job);
  await recordAudit(ctx.adapter, {
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'birthday_dispatch',
    targetEntity: 'campaign',
    targetId: campaign.id,
    ipAddress: ip,
    metadata: { sent: job.sent, excluded: excluded.length },
  });
  return { alreadyRan: false, campaign, sent: job.sent, excluded: excluded.length, alerts };
}

export async function runTestBatch(
  base: ServiceCtx,
  actor: Actor,
  ip: string | undefined,
  pattern: 'random' | 'pattern',
): Promise<{ report: DeliveryReport; alerts: AlertRecord[] }> {
  // Os cem destinatários do lote são sintéticos. O lote passa sempre pelo simulador, mesmo com
  // META_MODE=live, para nunca disparar pela WABA real contra números que não existem.
  const ctx: ServiceCtx = {
    adapter: base.adapter,
    config: { ...base.config, metaMode: 'simulator', simulatorPattern: pattern },
  };
  const before = (await getFranchise(ctx.adapter, ctx.config)).used;
  const campaign = await createCampaign(ctx, {
    name: `Lote POC 100 — ${formatSaoPaulo()}`,
    body: 'Mensagem de teste do POC Comunicação Digital (Pregão 089/2026). Não é um comunicado oficial ao cidadão. Responda PARAR para opt-out.',
    segment: {
      match: 'OR',
      rules: [
        { field: 'bairro', value: 'Centro' },
        { field: 'bairro', value: 'São José' },
        { field: 'bairro', value: 'Várzea' },
      ],
    },
    kind: 'poc',
    actor,
    ip,
  });
  const opted = (await listPeople(ctx.adapter)).filter((person) => person.optOut && !person.synthetic);
  const hold = await tryHold(ctx.adapter, ctx.config, 'franchise', 100);
  if (!hold.ok) {
    campaign.status = 'bloqueada';
    await ctx.adapter.put('campaigns', campaign.id, campaign);
    throw new HttpError(
      409,
      `O lote de 100 mensagens não cabe na franquia (${hold.remaining} vagas). Autorize pacotes de 100 ou restaure o cenário de demonstração.`,
      'franquia_esgotada',
    );
  }
  const reportId = `rpt_${randomUUID()}`;
  const sent: Message[] = [];
  let rejected = 0;
  for (let index = 0; index < 100; index += 1) {
    const phone = `55379900${String(10001 + index)}`;
    const result = await sendOutbound(ctx, {
      to: phone,
      body: `${campaign.body} Protocolo POC-${String(index + 1).padStart(3, '0')}.`,
      kind: 'poc_batch',
      actor,
      ip,
      campaignId: campaign.id,
      reportId,
      recipientName: `Cidadão Teste ${String(index + 1).padStart(3, '0')}`,
      bairro: BAIRROS[index % BAIRROS.length],
      interesse: INTERESSES[index % INTERESSES.length],
      predioPublico: PREDIOS[index % PREDIOS.length],
      index,
      alreadyHeld: true,
      skipOptOut: true,
    });
    if (!result.message.billable) rejected += 1;
    sent.push(result.message);
  }
  if (rejected) await release(ctx.adapter, ctx.config, 'franchise', rejected);

  const probes: ProbeResult[] = [];
  const probeActor = { id: 'system', role: 'system' };
  const usedBeforeProbes = (await getFranchise(ctx.adapter, ctx.config)).used;
  await recordInbound(ctx, { from: '5537990090001', text: 'Bom dia, qual o horário da UBS?', name: 'Sonda inbound', actor: probeActor });
  const afterInbound = (await getFranchise(ctx.adapter, ctx.config)).used;
  probes.push({
    kind: 'inbound_citizen',
    counted: afterInbound !== usedBeforeProbes,
    franchiseDelta: afterInbound - usedBeforeProbes,
    detail: 'Mensagem iniciada pelo cidadão não altera a franquia.',
  });
  let failAlerts: AlertRecord[] = [];
  try {
    const failProbe = await sendOutbound(ctx, {
      to: '5537990090002',
      body: 'Sonda de recusa da Meta.',
      kind: 'campaign',
      actor: probeActor,
      forceStatus: 'failed',
      probe: true,
      recipientName: 'Sonda Meta',
      reportId,
    });
    failAlerts = failProbe.alerts;
  } catch (error) {
    if (!(error instanceof HttpError) || error.code !== 'franquia_esgotada') throw error;
  }
  const afterFail = (await getFranchise(ctx.adapter, ctx.config)).used;
  probes.push({
    kind: 'meta_rejected',
    counted: afterFail !== afterInbound,
    franchiseDelta: afterFail - afterInbound,
    detail: 'Recusa da Meta não permanece na franquia.',
  });
  const replyPerson = await findPersonByPhone(ctx.adapter, '5537990090001');
  if (replyPerson) {
    replyPerson.lastInboundAt = new Date().toISOString();
    await ctx.adapter.put('people', replyPerson.id, replyPerson);
  } else {
    const created: Citizen = {
      id: `p_${randomUUID()}`,
      name: 'Sonda inbound',
      phone: '5537990090001',
      birthDate: '1980-01-01',
      bairro: 'Centro',
      interesses: ['avisos_gerais'],
      predioPublico: 'Prefeitura Sede',
      publico: 'cidadao',
      optOut: false,
      legalException: false,
      lastInboundAt: new Date().toISOString(),
      synthetic: true,
      createdAt: new Date().toISOString(),
    };
    await ctx.adapter.put('people', created.id, created);
  }
  await sendOutbound(ctx, {
    to: '5537990090001',
    body: 'Resposta humana de teste dentro da janela de 24 horas.',
    kind: 'agent_reply',
    actor: { id: actor.id, role: 'atendente' },
    probe: true,
    reportId,
    skipOptOut: true,
  });
  const afterReply = (await getFranchise(ctx.adapter, ctx.config)).used;
  probes.push({
    kind: 'agent_reply_24h',
    counted: afterReply !== afterFail,
    franchiseDelta: afterReply - afterFail,
    detail: 'Resposta humana dentro da janela de 24 horas não altera a franquia.',
  });

  const counts = emptyStatusCounts();
  for (const message of sent) counts[message.status] += 1;
  const after = (await getFranchise(ctx.adapter, ctx.config)).used;
  const report: DeliveryReport = {
    id: reportId,
    campaignId: campaign.id,
    createdAt: new Date().toISOString(),
    metaMode: ctx.config.metaMode,
    pattern,
    attempted: 100,
    byStatus: counts,
    franchiseBefore: before,
    franchiseAfter: after,
    counted: sent.filter((message) => message.billable).length,
    excluded: sent.filter((message) => !message.billable).length,
    segmentSummary: '100 destinatários de teste distribuídos entre os bairros Centro, São José e Várzea (combinação OU), com os interesses Saúde, Tributos, Educação e Avisos gerais.',
    probes,
    optOutFiltered: opted.slice(0, 8).map((person) => ({
      name: person.name,
      phone: person.phone,
      reason: 'Opt-out ativo. Fora do lote de 100.',
    })),
  };
  campaign.status = 'enviada';
  campaign.dispatchedAt = report.createdAt;
  campaign.reportId = report.id;
  campaign.stats = counts;
  await ctx.adapter.put('campaigns', campaign.id, campaign);
  await ctx.adapter.put('reports', report.id, report);
  await recordAudit(ctx.adapter, {
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'poc_test_batch',
    targetEntity: 'report',
    targetId: report.id,
    ipAddress: ip,
    metadata: {
      attempted: 100,
      counted: report.counted,
      byStatus: counts,
      probes,
    },
  });
  return { report, alerts: [...hold.alerts, ...failAlerts] };
}
