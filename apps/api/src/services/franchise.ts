import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { capacityOf, thresholdFlags } from '../franchise.js';
import type { DocAdapter } from '../store/types.js';
import { currentMonthKey } from '../time.js';
import type { AlertRecord, FranchiseMonth, Message, NotificationLog } from '../types.js';
import { HttpError } from '../http.js';
import { recordAudit } from './audit.js';

export type FranchiseView = FranchiseMonth & {
  capacity: number;
  reserveSize: number;
  ratio: number;
  remaining: number;
  reserveRemaining: number;
  blocked: boolean;
  contractualMonthly: number;
};

export type HoldResult =
  | { ok: true; alerts: AlertRecord[] }
  | { ok: false; used: number; capacity: number; remaining: number };

function blank(month: string): FranchiseMonth {
  return {
    id: month,
    used: 0,
    reserveUsed: 0,
    packsAuthorized: 0,
    alerted80: false,
    alerted100: false,
    alertedReserve80: false,
    alertedReserve100: false,
  };
}

async function load(adapter: DocAdapter, month: string): Promise<FranchiseMonth> {
  return (await adapter.get<FranchiseMonth>('franchise_months', month)) ?? blank(month);
}

export function presentFranchise(state: FranchiseMonth, config: AppConfig): FranchiseView {
  const capacity = capacityOf(
    config.franchiseMonthly,
    state.packsAuthorized,
    config.franchisePackSize,
    state.allowanceOverride,
  );
  const reserveSize = state.reserveSize ?? config.technicalReserve;
  const ratio = capacity <= 0 ? 1 : state.used / capacity;
  const remaining = Math.max(0, capacity - state.used);
  const reserveRemaining = Math.max(0, reserveSize - state.reserveUsed);
  return {
    ...state,
    capacity,
    reserveSize,
    ratio,
    remaining,
    reserveRemaining,
    blocked: state.used >= capacity,
    contractualMonthly: config.franchiseMonthly,
  };
}

export async function getFranchise(adapter: DocAdapter, config: AppConfig, month = currentMonthKey()): Promise<FranchiseView> {
  const state = await load(adapter, month);
  return presentFranchise(state, config);
}

async function writeAlerts(
  adapter: DocAdapter,
  config: AppConfig,
  state: FranchiseMonth,
  kind: 'franchise' | 'reserve',
): Promise<AlertRecord[]> {
  const created: AlertRecord[] = [];
  const view = presentFranchise(state, config);
  const flags =
    kind === 'franchise'
      ? thresholdFlags(state.used, view.capacity)
      : thresholdFlags(state.reserveUsed, view.reserveSize);

  const maybe = async (level: AlertRecord['level'], already: boolean, message: string) => {
    if (already) return;
    const alert: AlertRecord = {
      id: `alt_${randomUUID()}`,
      month: state.id,
      level,
      message,
      createdAt: new Date().toISOString(),
      ratio: flags.ratio,
    };
    await adapter.put('alerts', alert.id, alert);
    const channels: NotificationLog['channel'][] = ['in_app', 'webhook', 'email', 'whatsapp'];
    for (const channel of channels) {
      const destination =
        channel === 'email'
          ? config.alertEmail
          : channel === 'whatsapp'
            ? (config.adminAlertPhone ?? '')
            : channel === 'webhook'
              ? (config.alertWebhookUrl ?? '')
              : 'painel';
      const status: NotificationLog['status'] =
        channel === 'in_app'
          ? 'registrado'
          : channel === 'webhook' && !config.alertWebhookUrl
            ? 'nao_configurado'
            : channel === 'email'
              ? 'registrado'
              : channel === 'whatsapp' && config.adminAlertPhone
                ? 'registrado'
                : 'nao_configurado';
      const log: NotificationLog = {
        id: `ntf_${randomUUID()}`,
        channel,
        month: state.id,
        level,
        destination,
        status,
        payload: { message, ratio: flags.ratio, used: state.used, capacity: view.capacity },
        createdAt: alert.createdAt,
      };
      await adapter.put('notification_logs', log.id, log);
    }
    created.push(alert);
    await recordAudit(adapter, {
      actorUserId: 'system',
      actorRole: 'system',
      action: 'franchise_alert',
      targetEntity: 'franchise',
      targetId: state.id,
      metadata: { level, message, ratio: flags.ratio },
    });
  };

  if (kind === 'franchise') {
    if (flags.hit80 && !state.alerted80) {
      state.alerted80 = true;
      await maybe(
        '80',
        false,
        `A franquia mensal atingiu 80% (${state.used} de ${view.capacity}). Campanhas regulares seguem liberadas até 100%.`,
      );
    }
    if (flags.hit100 && !state.alerted100) {
      state.alerted100 = true;
      await maybe(
        '100',
        false,
        `A franquia mensal atingiu 100% (${state.used} de ${view.capacity}). Campanhas regulares bloqueadas até a autorização de um pacote de ${config.franchisePackSize} mensagens. Alertas de urgência continuam na reserva técnica.`,
      );
    }
  } else {
    if (flags.hit80 && !state.alertedReserve80) {
      state.alertedReserve80 = true;
      await maybe('reserve80', false, `A reserva técnica atingiu 80% (${state.reserveUsed} de ${view.reserveSize}).`);
    }
    if (flags.hit100 && !state.alertedReserve100) {
      state.alertedReserve100 = true;
      await maybe('reserve100', false, `A reserva técnica atingiu 100% (${state.reserveUsed} de ${view.reserveSize}).`);
    }
  }
  return created;
}

export async function tryHold(
  adapter: DocAdapter,
  config: AppConfig,
  bucket: 'franchise' | 'reserve',
  count: number,
  month = currentMonthKey(),
): Promise<HoldResult> {
  return adapter.lock(async () => {
    const state = await load(adapter, month);
    const view = presentFranchise(state, config);
    if (bucket === 'franchise') {
      if (state.used + count > view.capacity) {
        return { ok: false, used: state.used, capacity: view.capacity, remaining: view.remaining };
      }
      state.used += count;
      const alerts = await writeAlerts(adapter, config, state, 'franchise');
      await adapter.put('franchise_months', state.id, state);
      return { ok: true, alerts };
    }
    if (state.reserveUsed + count > view.reserveSize) {
      return { ok: false, used: state.reserveUsed, capacity: view.reserveSize, remaining: view.reserveRemaining };
    }
    state.reserveUsed += count;
    const alerts = await writeAlerts(adapter, config, state, 'reserve');
    await adapter.put('franchise_months', state.id, state);
    return { ok: true, alerts };
  });
}

export async function release(
  adapter: DocAdapter,
  config: AppConfig,
  bucket: 'franchise' | 'reserve',
  count: number,
  month = currentMonthKey(),
): Promise<void> {
  await adapter.lock(async () => {
    const state = await load(adapter, month);
    if (bucket === 'franchise') state.used = Math.max(0, state.used - count);
    else state.reserveUsed = Math.max(0, state.reserveUsed - count);
    await adapter.put('franchise_months', state.id, state);
  });
}

export async function countBillable(adapter: DocAdapter, month: string): Promise<number> {
  const messages = await adapter.list<Message>('messages');
  return messages.filter((message) => message.billable && message.bucket === 'franchise' && message.month === month && !message.probe)
    .length;
}

export async function authorizePacks(
  adapter: DocAdapter,
  config: AppConfig,
  count: number,
  actor: { id: string; role: string },
  ip?: string,
): Promise<FranchiseView> {
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new HttpError(400, 'Informe de 1 a 50 pacotes de 100 mensagens.', 'pacote_invalido');
  }
  return adapter.lock(async () => {
    const month = currentMonthKey();
    const state = await load(adapter, month);
    state.packsAuthorized += count;
    const view = presentFranchise(state, config);
    if (view.ratio < 1) state.alerted100 = false;
    if (view.ratio < 0.8) state.alerted80 = false;
    await adapter.put('franchise_months', state.id, state);
    await recordAudit(adapter, {
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'franchise_pack',
      targetEntity: 'franchise',
      targetId: state.id,
      ipAddress: ip,
      metadata: { packsAdded: count, packsAuthorized: state.packsAuthorized, capacity: view.capacity },
    });
    return presentFranchise(state, config);
  });
}

export async function setReserveSize(
  adapter: DocAdapter,
  config: AppConfig,
  size: number,
  actor: { id: string; role: string },
  ip?: string,
): Promise<FranchiseView> {
  if (!Number.isInteger(size) || size < 0 || size > 5000) {
    throw new HttpError(400, 'Reserva técnica inválida.', 'reserva_invalida');
  }
  return adapter.lock(async () => {
    const state = await load(adapter, currentMonthKey());
    state.reserveSize = size;
    await adapter.put('franchise_months', state.id, state);
    await recordAudit(adapter, {
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'franchise_reserve',
      targetEntity: 'franchise',
      targetId: state.id,
      ipAddress: ip,
      metadata: { reserveSize: size },
    });
    return presentFranchise(state, config);
  });
}

async function synthesize(adapter: DocAdapter, month: string, count: number): Promise<void> {
  const now = new Date().toISOString();
  for (let index = 0; index < count; index += 1) {
    const message: Message = {
      id: `msg_syn_${randomUUID()}`,
      month,
      direction: 'outbound',
      kind: 'campaign',
      bucket: 'franchise',
      billable: true,
      metaRejected: false,
      probe: false,
      synthetic: true,
      recipientName: 'Simulação de limiar da franquia',
      recipientPhone: `553799008${String(1000 + index).padStart(4, '0')}`.slice(0, 13),
      body: 'Registro sintético do cenário de demonstração. Não foi enviado à Meta.',
      status: 'delivered',
      statusHistory: [{ status: 'delivered', at: now }],
      metaMode: 'simulator',
      createdAt: now,
      updatedAt: now,
    };
    await adapter.put('messages', message.id, message);
  }
}

export async function applyDemoScenario(
  adapter: DocAdapter,
  config: AppConfig,
  preset: 'eighty' | 'full' | 'reset',
  actor: { id: string; role: string },
  ip?: string,
): Promise<FranchiseView> {
  if (!config.demoMode) {
    throw new HttpError(403, 'Cenários de demonstração só existem com DEMO_MODE=true.', 'demo_desligado');
  }
  return adapter.lock(async () => {
    const month = currentMonthKey();
    const state = await load(adapter, month);
    if (preset === 'reset') {
      const messages = await adapter.list<Message>('messages');
      for (const message of messages) {
        if (message.synthetic) await adapter.delete('messages', message.id);
      }
      state.allowanceOverride = undefined;
      state.allowanceOverrideReason = undefined;
      state.alerted80 = false;
      state.alerted100 = false;
      state.used = (await adapter.list<Message>('messages')).filter(
        (message) => message.billable && message.bucket === 'franchise' && message.month === month && !message.probe,
      ).length;
      await adapter.put('franchise_months', state.id, state);
    } else if (preset === 'full') {
      const real = (await adapter.list<Message>('messages')).filter(
        (message) => message.billable && message.bucket === 'franchise' && message.month === month && !message.probe && !message.synthetic,
      ).length;
      const target = Math.max(real, 10);
      if (real < target) await synthesize(adapter, month, target - real);
      state.used = target;
      state.allowanceOverride = target;
      state.allowanceOverrideReason = `Cenário de demonstração: cota reduzida para ${target} para evidenciar o bloqueio. A cota contratual permanece ${config.franchiseMonthly.toLocaleString('pt-BR')}.`;
      // Este cenário mostra o bloqueio em 100%: o aviso de 80% não se repete com o consumo já no teto.
      state.alerted80 = true;
      state.alerted100 = false;
      await writeAlerts(adapter, config, state, 'franchise');
      await adapter.put('franchise_months', state.id, state);
    } else {
      const real = (await adapter.list<Message>('messages')).filter(
        (message) => message.billable && message.bucket === 'franchise' && message.month === month && !message.probe && !message.synthetic,
      ).length;
      const targetUsed = Math.max(80, real);
      const override = Math.max(100, Math.floor(targetUsed / 0.8));
      if (real < Math.min(targetUsed, override - 1)) {
        await synthesize(adapter, month, Math.min(targetUsed, override - 1) - real);
      }
      const used = (await adapter.list<Message>('messages')).filter(
        (message) => message.billable && message.bucket === 'franchise' && message.month === month && !message.probe,
      ).length;
      state.used = used;
      state.allowanceOverride = Math.max(override, used + 1);
      state.allowanceOverrideReason = `Cenário de demonstração a 80%. A cota contratual permanece ${config.franchiseMonthly.toLocaleString('pt-BR')}.`;
      state.alerted80 = false;
      state.alerted100 = false;
      await writeAlerts(adapter, config, state, 'franchise');
      await adapter.put('franchise_months', state.id, state);
    }
    await recordAudit(adapter, {
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'franchise_demo_scenario',
      targetEntity: 'franchise',
      targetId: month,
      ipAddress: ip,
      metadata: { preset },
    });
    const fresh = await load(adapter, month);
    return presentFranchise(fresh, config);
  });
}

export async function reconcileFranchise(adapter: DocAdapter, config: AppConfig, month = currentMonthKey()): Promise<FranchiseView> {
  return adapter.lock(async () => {
    const state = await load(adapter, month);
    state.used = await countBillable(adapter, month);
    const messages = await adapter.list<Message>('messages');
    state.reserveUsed = messages.filter((message) => message.bucket === 'reserve' && message.month === month && !message.refunded).length;
    await adapter.put('franchise_months', state.id, state);
    return presentFranchise(state, config);
  });
}
