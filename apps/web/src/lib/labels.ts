/**
 * Rótulos de tela para os identificadores que a API usa em papéis, filtros, origens e modos.
 * A API continua recebendo e devolvendo o identificador; só a exibição muda.
 */

const ROLES: Record<string, string> = {
  admin: 'Administrador',
  gestor: 'Gestor',
  atendente: 'Atendente',
  lancador_fila: 'Lançador de fila',
  auditor: 'Auditor',
  cidadao: 'Cidadão',
  system: 'Sistema',
  meta: 'Meta',
};

/** Os quatro interesses do cadastro, na ordem em que a tela os oferece. */
export const INTERESTS: { value: string; label: string }[] = [
  { value: 'saude', label: 'Saúde' },
  { value: 'educacao', label: 'Educação' },
  { value: 'tributos', label: 'Tributos' },
  { value: 'avisos_gerais', label: 'Avisos gerais' },
];

export const AUDIENCES: { value: string; label: string }[] = [
  { value: 'cidadao', label: 'Cidadão' },
  { value: 'servidor', label: 'Servidor' },
];

export const DISPLAY_MODES: { value: string; label: string }[] = [
  { value: 'media', label: 'Mídia' },
  { value: 'tickets', label: 'Senhas' },
  { value: 'split', label: 'Mídia e senhas' },
];

const TAGS: Record<string, string> = {
  ...Object.fromEntries(INTERESTS.map((item) => [item.value, item.label])),
  upload: 'Enviada pelo painel',
};

const OPT_OUT_SOURCES: Record<string, string> = {
  keyword: 'palavra-chave no WhatsApp',
  admin: 'registrado no painel',
  api: 'pedido pela API',
  seed: 'cadastro de demonstração',
};

/** Estados de entrega da Cloud API da Meta, com o termo original entre parênteses. */
const DELIVERY: Record<string, string> = {
  queued: 'Na fila (queued)',
  sent: 'Enviada (sent)',
  delivered: 'Entregue (delivered)',
  read: 'Lida (read)',
  failed: 'Falhou (failed)',
};

const ALERT_LEVELS: Record<string, string> = {
  '80': 'Franquia em 80%',
  '100': 'Franquia em 100%',
  reserve80: 'Reserva técnica em 80%',
  reserve100: 'Reserva técnica em 100%',
};

/** As três sondas do lote de teste: situações que não podem alterar a franquia. */
const PROBES: Record<string, string> = {
  inbound_citizen: 'Mensagem enviada pelo cidadão',
  meta_rejected: 'Recusa da Meta',
  agent_reply_24h: 'Resposta humana em 24 horas',
};

const labelOf = (table: Record<string, string>) => (value: string) => table[value] ?? value;
const labelIn = (list: { value: string; label: string }[]) => (value: string) =>
  list.find((item) => item.value === value)?.label ?? value;

export const roleLabel = labelOf(ROLES);
export const tagLabel = labelOf(TAGS);
export const optOutSourceLabel = labelOf(OPT_OUT_SOURCES);
export const deliveryLabel = labelOf(DELIVERY);
export const alertLevelLabel = labelOf(ALERT_LEVELS);
export const probeLabel = labelOf(PROBES);
export const audienceLabel = labelIn(AUDIENCES);
export const displayModeLabel = labelIn(DISPLAY_MODES);

const integer = new Intl.NumberFormat('pt-BR');

/** Número inteiro com separador de milhar: 5000 → 5.000. */
export function formatCount(value: number): string {
  return integer.format(value);
}
