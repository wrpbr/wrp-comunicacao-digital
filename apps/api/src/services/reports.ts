import type { AppConfig } from '../config.js';
import { buildPdf } from '../pdf.js';
import type { DocAdapter } from '../store/types.js';
import { computeAvailability } from '../sla.js';
import { currentMonthKey, zonedParts } from '../time.js';
import type { DeliveryReport, Heartbeat, Message, Unit } from '../types.js';
import { getFranchise } from './franchise.js';

/**
 * Rótulos do PDF, que é lido por pessoas: os mesmos do painel (apps/web/src/lib/labels.ts).
 * CSV e JSON continuam com os valores originais, para quem processa o arquivo.
 */
const INTEREST_LABELS: Record<string, string> = {
  saude: 'Saúde',
  educacao: 'Educação',
  tributos: 'Tributos',
  avisos_gerais: 'Avisos gerais',
};

/** Estados de entrega da Cloud API da Meta, com o termo original entre parênteses. */
const DELIVERY_LABELS: Record<string, string> = {
  queued: 'Na fila (queued)',
  sent: 'Enviada (sent)',
  delivered: 'Entregue (delivered)',
  read: 'Lida (read)',
  failed: 'Falhou (failed)',
};

const PROBE_LABELS: Record<string, string> = {
  inbound_citizen: 'Mensagem enviada pelo cidadão',
  meta_rejected: 'Recusa da Meta',
  agent_reply_24h: 'Resposta humana em 24 horas',
};

function labelOf(table: Record<string, string>, value: string | undefined): string {
  return value ? (table[value] ?? value) : '';
}

/** Data e hora no horário de Brasília, como a pessoa lê: 13/11/2026 às 23:34:31. */
function brasiliaDateTime(iso: string): string {
  const z = zonedParts(new Date(iso));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${z.day}/${z.month}/${z.year} às ${pad(z.hour)}:${pad(z.minute)}:${pad(z.second)} (horário de Brasília)`;
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export async function loadReport(adapter: DocAdapter, query: { reportId?: string; campaignId?: string }): Promise<DeliveryReport | null> {
  const reports = await adapter.list<DeliveryReport>('reports');
  if (query.reportId) return reports.find((report) => report.id === query.reportId) ?? null;
  if (query.campaignId) return reports.find((report) => report.campaignId === query.campaignId) ?? null;
  return reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export async function deliveryDocument(
  adapter: DocAdapter,
  report: DeliveryReport,
  format: 'json' | 'csv' | 'pdf',
): Promise<{ body: Buffer | string; contentType: string; filename: string }> {
  const messages = (await adapter.list<Message>('messages'))
    .filter((message) => message.reportId === report.id && !message.probe)
    .sort((a, b) => a.recipientName.localeCompare(b.recipientName, 'pt-BR'));
  if (format === 'json') {
    return {
      body: JSON.stringify({ report, messages }, null, 2),
      contentType: 'application/json; charset=utf-8',
      filename: `${report.id}.json`,
    };
  }
  if (format === 'csv') {
    const header = ['id', 'nome', 'telefone', 'bairro', 'interesse', 'predio_publico', 'status', 'billable', 'motivo_exclusao', 'wamid', 'criado_utc'];
    const lines = [header.join(',')];
    for (const message of messages) {
      lines.push(
        [message.id, message.recipientName, message.recipientPhone, message.bairro ?? '', message.interesse ?? '', message.predioPublico ?? '', message.status, message.billable, message.exclusionReason ?? '', message.wamid ?? '', message.createdAt]
          .map(csvCell)
          .join(','),
      );
    }
    return {
      body: `\uFEFF${lines.join('\n')}\n`,
      contentType: 'text/csv; charset=utf-8',
      filename: `${report.id}.csv`,
    };
  }
  const lines = [
    'Comunicação Digital',
    'Prefeitura Municipal de Pompéu/MG',
    'Pregão Eletrônico nº 089/2026 - Processo 243/2026',
    'CNPJ 66.300.125/0001-45',
    '',
    `Relatório de entrega ${report.id}`,
    `Gerado em ${brasiliaDateTime(report.createdAt)}`,
    `Modo Meta: ${report.metaMode} / padrão ${report.pattern}`,
    report.segmentSummary,
    '',
    `Tentativas: ${report.attempted}`,
    `Enfileiradas: ${report.byStatus.queued}  Enviadas: ${report.byStatus.sent}`,
    `Entregues: ${report.byStatus.delivered}  Lidas: ${report.byStatus.read}  Falhas: ${report.byStatus.failed}`,
    `Contabilizadas na franquia: ${report.counted}`,
    `Excluídas (recusa Meta ou regra): ${report.excluded}`,
    `Franquia antes/depois: ${report.franchiseBefore} -> ${report.franchiseAfter}`,
    '',
    'Sondas de exclusão da franquia:',
    ...report.probes.map((probe) => `- ${labelOf(PROBE_LABELS, probe.kind)}: variação de ${probe.franchiseDelta} na franquia. ${probe.detail}`),
    '',
    'Opt-out conhecido fora do lote:',
    ...(report.optOutFiltered.length ? report.optOutFiltered.map((row) => `- ${row.name} ${row.phone} ${row.reason}`) : ['- nenhum']),
    '',
    'Mensagens do lote (destinatário | bairro | interesse | status de entrega | conta na franquia):',
    ...messages.map(
      (message) =>
        `${message.recipientName} | ${message.bairro ?? ''} | ${labelOf(INTEREST_LABELS, message.interesse)} | ${labelOf(DELIVERY_LABELS, message.status)} | ${message.billable ? 'sim' : 'não'}`,
    ),
  ];
  return {
    body: buildPdf(lines, 'Relatório de entrega — Comunicação Digital'),
    contentType: 'application/pdf',
    filename: `${report.id}.pdf`,
  };
}

export async function franchiseDocument(adapter: DocAdapter, config: AppConfig, format: 'json' | 'csv' | 'pdf', month = currentMonthKey()) {
  const view = await getFranchise(adapter, config, month);
  // No relatório os alertas do mês vêm na ordem em que ocorreram.
  const alerts = (await adapter.list<{ month: string; level: string; message: string; createdAt: string }>('alerts'))
    .filter((alert) => alert.month === month)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const payload = {
    month,
    contrato: {
      franquiaMensal: config.franchiseMonthly,
      pacote: config.franchisePackSize,
      pacotesAutorizados: view.packsAuthorized,
      reservaTecnica: view.reserveSize,
    },
    consumo: {
      usadas: view.used,
      capacidade: view.capacity,
      restantes: view.remaining,
      ratio: view.ratio,
      bloqueada: view.blocked,
      reservaUsada: view.reserveUsed,
      reservaRestante: view.reserveRemaining,
      cotaDemonstracao: view.allowanceOverride ?? null,
      motivoCota: view.allowanceOverrideReason ?? null,
    },
    regrasDeExclusao: [
      'Mensagens iniciadas pelo cidadão',
      'Mensagens recusadas pela Meta',
      'Respostas humanas e avisos de transferência dentro da janela de 24 horas',
      'Resposta automática de fora do expediente dentro da janela de 24 horas',
    ],
    alertas: alerts,
  };
  if (format === 'json') {
    return { body: JSON.stringify(payload, null, 2), contentType: 'application/json; charset=utf-8', filename: `franquia-${month}.json` };
  }
  if (format === 'csv') {
    const lines = [
      'campo,valor',
      `mes,${month}`,
      `franquia_contratual,${config.franchiseMonthly}`,
      `pacotes,${view.packsAuthorized}`,
      `capacidade,${view.capacity}`,
      `usadas,${view.used}`,
      `restantes,${view.remaining}`,
      `bloqueada,${view.blocked}`,
      `reserva_usada,${view.reserveUsed}`,
      `reserva_tamanho,${view.reserveSize}`,
    ];
    return { body: `\uFEFF${lines.join('\n')}\n`, contentType: 'text/csv; charset=utf-8', filename: `franquia-${month}.csv` };
  }
  const lines = [
    'Comunicação Digital — consumo da franquia',
    `Prefeitura Municipal de Pompéu/MG — ${month}`,
    `Cota contratual: ${config.franchiseMonthly} mensagens/mês`,
    `Pacotes de ${config.franchisePackSize} autorizados: ${view.packsAuthorized}`,
    `Capacidade do mês: ${view.capacity}`,
    `Consumidas: ${view.used}`,
    `Restantes: ${view.remaining}`,
    `Bloqueio de campanhas regulares: ${view.blocked ? 'SIM' : 'NÃO'}`,
    `Reserva técnica: ${view.reserveUsed}/${view.reserveSize}`,
    view.allowanceOverride ? `Cota de demonstração: ${view.allowanceOverride}` : 'Sem cota de demonstração',
    '',
    'Excluídas da franquia: mensagem do cidadão, recusa da Meta, resposta humana na janela de 24 horas',
    'e resposta automática de fora do expediente.',
    '',
    alerts.length ? 'Alertas do mês:' : 'Nenhum alerta de franquia neste mês.',
    ...alerts.map((alert) => `- ${brasiliaDateTime(alert.createdAt)}: ${alert.message}`),
  ];
  return { body: buildPdf(lines, 'Franquia — Comunicação Digital'), contentType: 'application/pdf', filename: `franquia-${month}.pdf` };
}

export async function slaDocument(adapter: DocAdapter, format: 'json' | 'csv' | 'pdf', month = currentMonthKey()) {
  const [year, monthNum] = month.split('-').map(Number);
  const from = new Date(Date.UTC(year ?? 2026, (monthNum ?? 1) - 1, 1, 3, 0, 0));
  const z = zonedParts(new Date());
  const to = new Date(`${z.year}-${z.month}-${z.day}T23:59:59-03:00`);
  const units = await adapter.list<Unit>('units');
  const beats = await adapter.list<Heartbeat>('heartbeats');
  const rows = units.map((unit) => {
    const mine = beats.filter((beat) => beat.unitSlug === unit.slug);
    const availability = computeAvailability(mine, from, to);
    return {
      unitSlug: unit.slug,
      name: unit.name,
      heartbeats: mine.length,
      expectedHours: availability.expectedHours,
      onlineHours: availability.onlineHours,
      availability: Number(availability.ratio.toFixed(4)),
      gapHours: availability.gaps.length,
    };
  });
  const payload = {
    month,
    metodologia: 'Cada hora do expediente (segunda a sexta, das 8h às 17h, America/Sao_Paulo) com ao menos um sinal do painel conta como disponível. As horas sem sinal entre o início do mês e hoje entram no denominador.',
    unidades: rows,
  };
  if (format === 'json') return { body: JSON.stringify(payload, null, 2), contentType: 'application/json; charset=utf-8', filename: `sla-${month}.json` };
  if (format === 'csv') {
    const lines = ['unidade,heartbeats,horas_esperadas,horas_online,disponibilidade,lacunas'];
    for (const row of rows) lines.push([row.unitSlug, row.heartbeats, row.expectedHours, row.onlineHours, row.availability, row.gapHours].join(','));
    return { body: `\uFEFF${lines.join('\n')}\n`, contentType: 'text/csv; charset=utf-8', filename: `sla-${month}.csv` };
  }
  const lines = [
    'Comunicação Digital — disponibilidade dos painéis',
    `Referência ${month} — America/Sao_Paulo`,
    payload.metodologia,
    '',
    ...rows.map(
      (row) =>
        `${row.name}: ${(row.availability * 100).toFixed(1).replace('.', ',')}% (${row.onlineHours} de ${row.expectedHours} horas do expediente; horas sem sinal: ${row.gapHours})`,
    ),
  ];
  return { body: buildPdf(lines, 'SLA dos painéis — Comunicação Digital'), contentType: 'application/pdf', filename: `sla-${month}.pdf` };
}
