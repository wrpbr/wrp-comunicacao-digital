import type { BusinessHours, Segment, SegmentField } from './types.js';
import { zonedParts } from './time.js';

const PARTICLES = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);

export function formatCallName(fullName: string, mode: 'full' | 'reduced'): string {
  const clean = fullName.trim().replace(/\s+/g, ' ');
  if (!clean || mode === 'full') return clean;
  const parts = clean.split(' ');
  if (parts.length === 1) return parts[0] ?? clean;
  const surname = [...parts].reverse().find((part) => !PARTICLES.has(part.toLowerCase())) ?? parts[parts.length - 1] ?? '';
  const initial = surname.charAt(0).toLocaleUpperCase('pt-BR');
  return `${parts[0]} ${initial}.`;
}

export type SegmentPerson = {
  bairro: string;
  interesses: string[];
  predioPublico: string;
  publico: 'cidadao' | 'servidor';
};

export function matchesSegment(person: SegmentPerson, segment: Segment): boolean {
  if (!segment.rules.length) return true;
  const checks = segment.rules.map((rule) => matchRule(person, rule.field, rule.value));
  return segment.match === 'AND' ? checks.every(Boolean) : checks.some(Boolean);
}

function matchRule(person: SegmentPerson, field: SegmentField, value: string): boolean {
  if (field === 'interesse') return person.interesses.includes(value);
  if (field === 'bairro') return person.bairro === value;
  if (field === 'predio_publico') return person.predioPublico === value;
  if (field === 'publico') return person.publico === value;
  return false;
}

export function isOpen(hours: BusinessHours, now = new Date()): boolean {
  const z = zonedParts(now, hours.timezone);
  if (!hours.days.includes(z.isoWeekday)) return false;
  const current = z.hour * 60 + z.minute;
  const [sh, sm] = hours.start.split(':').map(Number);
  const [eh, em] = hours.end.split(':').map(Number);
  return current >= sh * 60 + sm && current < eh * 60 + em;
}

const OPT_OUT = new Set(['PARAR', 'SAIR', 'OPT-OUT', 'OPT OUT', 'OPTOUT']);

export function optOutKeyword(text: string): string | null {
  const normalized = text.trim().toUpperCase().replace(/\s+/g, ' ');
  return OPT_OUT.has(normalized) ? normalized : null;
}

export function optOutBlocks(
  person: { optOut: boolean; legalException: boolean } | null | undefined,
  honorLegalException: boolean,
): boolean {
  if (!person?.optOut) return false;
  if (person.legalException && honorLegalException) return false;
  return true;
}

export function normalizePhone(input: string): string {
  return input.replace(/\D/g, '');
}

/**
 * Chave para comparar dois telefones brasileiros. A Cloud API pode devolver o identificador do
 * WhatsApp sem o nono dígito do celular (55 + DDD + 8 dígitos); com ou sem ele é o mesmo assinante.
 */
export function phoneKey(input: string): string {
  const digits = normalizePhone(input);
  if (digits.startsWith('55') && digits.length === 13 && digits.charAt(4) === '9') {
    return digits.slice(0, 4) + digits.slice(5);
  }
  return digits;
}

export function samePhone(a: string, b: string): boolean {
  return phoneKey(a) === phoneKey(b);
}

export function assertBrazilianPhone(input: string): string {
  const digits = normalizePhone(input);
  if (!digits.startsWith('55') || digits.length < 12 || digits.length > 13) {
    throw new Error('Telefone deve estar em E.164 brasileiro (55 + DDD + número).');
  }
  return digits;
}

export function emptyStatusCounts(): Record<'queued' | 'sent' | 'delivered' | 'read' | 'failed', number> {
  return { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
}

export function demoDisplayToken(slug: string): string {
  return `demo.${slug}.painel`;
}
