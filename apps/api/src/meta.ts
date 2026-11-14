import type { AppConfig } from './config.js';
import type { DeliveryStatus } from './types.js';

export type MetaSendInput = {
  to: string;
  body: string;
  /** Modelo aprovado escolhido para este envio. Sem ele vale o modelo padrão da configuração. */
  templateName?: string;
  /**
   * O cidadão escreveu há menos de 24 horas. Dentro dessa janela a Meta aceita texto livre;
   * fora dela só entrega modelo aprovado.
   */
  withinServiceWindow?: boolean;
  index?: number;
  forceStatus?: DeliveryStatus;
};

type MetaPayload = Record<string, unknown>;

/** Corpo do `POST /{Phone-Number-ID}/messages` da WhatsApp Cloud API: modelo aprovado ou texto livre. */
export function buildMetaPayload(config: AppConfig, input: MetaSendInput): MetaPayload {
  const templateName = input.templateName ?? (input.withinServiceWindow ? undefined : config.metaTemplateName);
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: input.to };
  if (!templateName) {
    return { ...base, type: 'text', text: { preview_url: false, body: input.body } };
  }
  return {
    ...base,
    type: 'template',
    template: {
      name: templateName,
      language: { code: config.metaTemplateLanguage },
      ...(config.metaTemplateBodyParam
        ? { components: [{ type: 'body', parameters: [{ type: 'text', text: input.body.slice(0, 900) }] }] }
        : {}),
    },
  };
}

export type MetaSendResult = {
  ok: boolean;
  status: DeliveryStatus;
  metaRejected: boolean;
  wamid?: string;
  raw: unknown;
  error?: string;
};

export function simulateDelivery(input: {
  index?: number;
  phone: string;
  pattern: 'random' | 'pattern';
  forceStatus?: DeliveryStatus;
}): { status: DeliveryStatus; metaRejected: boolean } {
  if (input.forceStatus) {
    return { status: input.forceStatus, metaRejected: input.forceStatus === 'failed' };
  }
  if (input.pattern === 'pattern') {
    if (input.index === undefined) {
      const rejected = input.phone.endsWith('0000');
      return rejected
        ? { status: 'failed', metaRejected: true }
        : { status: 'delivered', metaRejected: false };
    }
    if (input.index % 17 === 0) return { status: 'failed', metaRejected: true };
    const cycle: DeliveryStatus[] = ['sent', 'delivered', 'read'];
    return { status: cycle[input.index % 3] ?? 'sent', metaRejected: false };
  }
  const roll = Math.random();
  if (roll < 0.06) return { status: 'failed', metaRejected: true };
  if (roll < 0.22) return { status: 'sent', metaRejected: false };
  if (roll < 0.62) return { status: 'delivered', metaRejected: false };
  return { status: 'read', metaRejected: false };
}

export async function sendWhatsApp(config: AppConfig, input: MetaSendInput): Promise<MetaSendResult> {
  if (config.metaMode === 'simulator') {
    const simulated = simulateDelivery({
      index: input.index,
      phone: input.to,
      pattern: config.simulatorPattern,
      forceStatus: input.forceStatus,
    });
    const wamid = simulated.metaRejected ? undefined : `wamid.sim.${input.to}.${input.index ?? 'x'}.${simulated.status}`;
    return {
      ok: !simulated.metaRejected,
      status: simulated.status,
      metaRejected: simulated.metaRejected,
      wamid,
      raw: {
        simulator: true,
        messaging_product: 'whatsapp',
        contacts: [{ input: input.to, wa_id: input.to }],
        messages: wamid ? [{ id: wamid }] : [],
        error: simulated.metaRejected ? { message: 'Simulated Meta rejection', code: 131026 } : undefined,
      },
      error: simulated.metaRejected ? 'Recusa simulada da Meta (código 131026).' : undefined,
    };
  }

  if (input.forceStatus) {
    throw new Error('forceStatus só existe no META_MODE=simulator.');
  }
  if (!config.metaAccessToken || !config.metaPhoneNumberId) {
    return {
      ok: false,
      status: 'failed',
      metaRejected: true,
      raw: { error: 'missing_credentials' },
      error: 'Credenciais da WhatsApp Cloud API ausentes. Defina META_ACCESS_TOKEN e META_PHONE_NUMBER_ID ou use META_MODE=simulator.',
    };
  }

  const url = `https://graph.facebook.com/${config.metaGraphVersion}/${config.metaPhoneNumberId}/messages`;
  const payload = buildMetaPayload(config, input);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.metaAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    // Sem resposta da Meta a mensagem não foi aceita: fica como falha e não consome a franquia.
    const reason = error instanceof Error ? error.message : 'erro de rede';
    return {
      ok: false,
      status: 'failed',
      metaRejected: true,
      raw: { error: 'network_error', reason },
      error: `A Meta não respondeu (${reason}). A mensagem não foi enviada.`,
    };
  }
  const raw = (await response.json().catch(() => ({}))) as {
    messages?: { id?: string }[];
    error?: { message?: string; code?: number; error_data?: { details?: string } };
  };
  if (!response.ok) {
    const details = raw.error?.error_data?.details;
    const reason = raw.error?.message ?? `Meta HTTP ${response.status}`;
    return {
      ok: false,
      status: 'failed',
      metaRejected: true,
      raw,
      error: details ? `${reason} ${details}` : reason,
    };
  }
  return {
    ok: true,
    status: 'sent',
    metaRejected: false,
    wamid: raw.messages?.[0]?.id,
    raw,
  };
}
