import { describe, expect, it } from 'vitest';
import { classifyOutbound, capacityOf } from '../src/franchise.js';
import { formatCallName, matchesSegment, optOutBlocks, optOutKeyword } from '../src/domain.js';
import { currentMonthKey, formatSaoPaulo, isBirthdayOn, zonedParts } from '../src/time.js';
import { buildPdf } from '../src/pdf.js';
import { encryptString, decryptString } from '../src/crypto.js';
import { SCHEMA_SQL } from '../src/store/types.js';
import { openApiYaml } from '../src/openapi.js';
import { simulateDelivery } from '../src/meta.js';
import { MemoryAdapter } from '../src/store/memory.js';

describe('domínio', () => {
  it('segmenta por bairro, interesse e combinação AND/OR', () => {
    const people = [
      { bairro: 'Centro', interesses: ['saude'], predioPublico: 'UBS Centro', publico: 'cidadao' as const },
      { bairro: 'Centro', interesses: ['tributos'], predioPublico: 'Prefeitura Sede', publico: 'cidadao' as const },
      { bairro: 'São José', interesses: ['saude'], predioPublico: 'UBS Centro', publico: 'cidadao' as const },
    ];
    const and = { match: 'AND' as const, rules: [{ field: 'bairro' as const, value: 'Centro' }, { field: 'interesse' as const, value: 'saude' }] };
    const or = { match: 'OR' as const, rules: [{ field: 'bairro' as const, value: 'São José' }, { field: 'interesse' as const, value: 'tributos' }] };
    expect(people.filter((person) => matchesSegment(person, and))).toHaveLength(1);
    expect(people.filter((person) => matchesSegment(person, or))).toHaveLength(2);
  });

  it('reduz o nome sem partícula', () => {
    expect(formatCallName('Maria Aparecida Silva', 'reduced')).toBe('Maria S.');
    expect(formatCallName('Maria da Silva', 'reduced')).toBe('Maria S.');
    expect(formatCallName('Maria Aparecida Silva', 'full')).toBe('Maria Aparecida Silva');
  });

  it('reconhece PARAR, SAIR e OPT-OUT', () => {
    expect(optOutKeyword('  parar ')).toBe('PARAR');
    expect(optOutKeyword('Sair')).toBe('SAIR');
    expect(optOutKeyword('opt-out')).toBe('OPT-OUT');
    expect(optOutKeyword('parar agora')).toBeNull();
  });

  it('bloqueia opt-out e libera exceção legal marcada', () => {
    expect(optOutBlocks({ optOut: true, legalException: false }, true)).toBe(true);
    expect(optOutBlocks({ optOut: true, legalException: true }, true)).toBe(false);
    expect(optOutBlocks({ optOut: true, legalException: true }, false)).toBe(true);
  });

  it('exclui inbound, recusa da Meta, resposta humana em 24h e fora do expediente', () => {
    expect(classifyOutbound({ kind: 'inbound_citizen', withinServiceWindow: true, metaRejected: false }).billable).toBe(false);
    expect(classifyOutbound({ kind: 'campaign', withinServiceWindow: false, metaRejected: true }).billable).toBe(false);
    expect(classifyOutbound({ kind: 'agent_reply', withinServiceWindow: true, metaRejected: false }).billable).toBe(false);
    expect(classifyOutbound({ kind: 'ooh_autoreply', withinServiceWindow: true, metaRejected: false }).billable).toBe(false);
    expect(classifyOutbound({ kind: 'transfer_notice', withinServiceWindow: true, metaRejected: false }).billable).toBe(false);
    expect(classifyOutbound({ kind: 'urgency', withinServiceWindow: false, metaRejected: false }).bucket).toBe('reserve');
    expect(classifyOutbound({ kind: 'campaign', withinServiceWindow: false, metaRejected: false }).billable).toBe(true);
    expect(classifyOutbound({ kind: 'agent_reply', withinServiceWindow: false, metaRejected: false }).billable).toBe(true);
  });

  it('calcula capacidade com pacotes de 100', () => {
    expect(capacityOf(5000, 2, 100)).toBe(5200);
    expect(capacityOf(5000, 0, 100, 80)).toBe(80);
  });

  it('usa o calendário de São Paulo', () => {
    const night = new Date('2026-11-13T02:30:00.000Z');
    expect(zonedParts(night).day).toBe('12');
    expect(currentMonthKey(night)).toBe('2026-11');
    expect(formatSaoPaulo(night)).toContain('-03:00');
    expect(isBirthdayOn('1982-11-12', night)).toBe(true);
    expect(isBirthdayOn('1982-11-13', night)).toBe(false);
  });

  it('criptografa token com AES-256-GCM', () => {
    const secret = 'chave-de-teste';
    const cipher = encryptString('EAAG-token-waba', secret);
    expect(cipher).not.toContain('EAAG');
    expect(decryptString(cipher, secret)).toBe('EAAG-token-waba');
  });

  it('PDF quebra a linha longa em vez de cortar o texto', () => {
    const long = `${Array.from({ length: 40 }, (_, index) => `palavra${index}`).join(' ')} FIM-DA-LINHA`;
    const text = buildPdf([long]).toString('latin1');
    const lines = [...text.matchAll(/\((.*)\) Tj/g)].map((match) => match[1] ?? '');
    expect(lines.length).toBeGreaterThan(1);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(100);
    expect(lines.join(' ')).toBe(long);
  });

  it('PDF mostra todas as linhas: cada uma com Tj e o T* sozinho entre elas', () => {
    const text = buildPdf(['primeira', 'segunda', 'terceira']).toString('latin1');
    const stream = text.slice(text.indexOf('stream\n') + 7, text.indexOf('\nendstream'));
    expect(stream.split('\n')).toEqual(['BT', '/F1 10 Tf', '48 800 Td', '13 TL', '(primeira) Tj', 'T*', '(segunda) Tj', 'T*', '(terceira) Tj', 'ET']);
  });

  it('gera PDF e padrão determinístico do simulador', () => {
    const pdf = buildPdf(['Relatório de Pompéu', 'Ação']);
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    const statuses = Array.from({ length: 100 }, (_, index) => simulateDelivery({ index, phone: '5537990010001', pattern: 'pattern' }).status);
    expect(statuses.filter((status) => status === 'failed')).toHaveLength(6);
  });

  it('declara a trilha de auditoria imutável e a OpenAPI 3.1', () => {
    expect(SCHEMA_SQL).toContain('audit_logs is immutable');
    expect(openApiYaml.startsWith('openapi: 3.1.0')).toBe(true);
    for (const path of [
      '/api/v1/messages/send',
      '/api/v1/messages/{id}/status',
      '/api/v1/campaigns/test-batch',
      '/api/v1/reports/delivery',
      '/api/v1/audit-logs/export',
      '/api/v1/opt-out',
      '/api/v1/tv/{unitSlug}/call',
      '/api/v1/tv/{unitSlug}/stream',
      '/api/v1/tv/{unitSlug}/heartbeat',
    ]) {
      expect(openApiYaml).toContain(path);
    }
  });

  it('recusa atualização da auditoria em memória', async () => {
    const adapter = new MemoryAdapter();
    await expect(adapter.put('audit_logs', 'x', { id: 'x' })).rejects.toThrow(/immutable/);
  });
});
