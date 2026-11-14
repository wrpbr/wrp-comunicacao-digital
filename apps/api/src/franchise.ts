import type { Bucket, MessageKind } from './types.js';

export type Classification = {
  billable: boolean;
  bucket: Bucket;
  exclusionReason?: string;
};

export function classifyOutbound(input: {
  kind: MessageKind;
  withinServiceWindow: boolean;
  metaRejected: boolean;
}): Classification {
  if (input.kind === 'inbound_citizen') {
    return {
      billable: false,
      bucket: 'none',
      exclusionReason: 'Mensagem iniciada pelo cidadão. Não entra na franquia.',
    };
  }
  if (input.metaRejected) {
    return {
      billable: false,
      bucket: 'none',
      exclusionReason: 'Mensagem recusada pela Meta. Não entra na franquia.',
    };
  }
  if (input.kind === 'urgency') {
    return { billable: false, bucket: 'reserve' };
  }
  if (input.kind === 'ooh_autoreply') {
    return {
      billable: false,
      bucket: 'none',
      exclusionReason: 'Resposta automática de fora do expediente, dentro da janela de 24 horas. Não entra na franquia.',
    };
  }
  if (input.kind === 'admin_alert') {
    return {
      billable: false,
      bucket: 'none',
      exclusionReason: 'Alerta operacional ao gestor. Fora da franquia de comunicação com o cidadão.',
    };
  }
  if ((input.kind === 'agent_reply' || input.kind === 'transfer_notice') && input.withinServiceWindow) {
    return {
      billable: false,
      bucket: 'none',
      exclusionReason: 'Resposta humana dentro da janela de 24 horas de atendimento. Não entra na franquia.',
    };
  }
  return { billable: true, bucket: 'franchise' };
}

export function capacityOf(monthly: number, packs: number, packSize: number, override?: number): number {
  const base = override ?? monthly;
  return base + packs * packSize;
}

export function thresholdFlags(used: number, cap: number): { hit80: boolean; hit100: boolean; ratio: number } {
  const ratio = cap <= 0 ? 1 : used / cap;
  return { hit80: ratio >= 0.8, hit100: ratio >= 1, ratio };
}
