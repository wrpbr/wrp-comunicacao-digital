export type Role = 'admin' | 'gestor' | 'atendente' | 'lancador_fila' | 'auditor';

export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export type MessageKind =
  | 'campaign'
  | 'birthday'
  | 'servidor'
  | 'urgency'
  | 'poc_batch'
  | 'agent_reply'
  | 'ooh_autoreply'
  | 'admin_alert'
  | 'transfer_notice'
  | 'inbound_citizen';

export type Bucket = 'franchise' | 'reserve' | 'none';

export type Publico = 'cidadao' | 'servidor';

export type CallNameMode = 'full' | 'reduced';

export type DisplayMode = 'media' | 'tickets' | 'split';

export type SegmentField = 'bairro' | 'interesse' | 'predio_publico' | 'publico';

export type SegmentRule = {
  field: SegmentField;
  value: string;
};

export type Segment = {
  match: 'AND' | 'OR';
  rules: SegmentRule[];
};

export type UserRecord = {
  id: string;
  name: string;
  email: string;
  role: Role;
  passwordHash: string;
  totpEnabled: boolean;
  totpSecretCipher?: string;
  active: boolean;
  createdAt: string;
};

export type SessionRecord = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

export type Citizen = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  birthDate: string;
  bairro: string;
  interesses: string[];
  predioPublico: string;
  publico: Publico;
  optOut: boolean;
  legalException: boolean;
  legalExceptionBasis?: string;
  lastInboundAt?: string;
  lastOohOn?: string;
  cargo?: string;
  unitSlug?: string;
  synthetic?: boolean;
  createdAt: string;
};

export type Campaign = {
  id: string;
  name: string;
  body: string;
  kind: 'segmentada' | 'aniversario' | 'servidores' | 'poc';
  segment: Segment;
  allowLegalExceptions: boolean;
  status: 'rascunho' | 'enviada' | 'bloqueada';
  createdBy: string;
  createdAt: string;
  dispatchedAt?: string;
  reportId?: string;
  stats?: StatusCounts;
};

export type StatusCounts = Record<DeliveryStatus, number>;

export type Message = {
  id: string;
  month: string;
  direction: 'outbound' | 'inbound';
  kind: MessageKind;
  bucket: Bucket;
  billable: boolean;
  exclusionReason?: string;
  metaRejected: boolean;
  withinServiceWindow?: boolean;
  probe: boolean;
  synthetic: boolean;
  campaignId?: string;
  reportId?: string;
  citizenId?: string;
  recipientName: string;
  recipientPhone: string;
  bairro?: string;
  interesse?: string;
  predioPublico?: string;
  body: string;
  status: DeliveryStatus;
  statusHistory: { status: DeliveryStatus; at: string }[];
  wamid?: string;
  metaMode: 'simulator' | 'live';
  error?: string;
  refunded?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AuditLog = {
  id: string;
  timestampUtc: string;
  timestampSaoPaulo: string;
  actorUserId: string;
  actorRole: string;
  action: string;
  targetEntity: string;
  targetId: string;
  recipient: string;
  deliveryStatus: string;
  ipAddress: string;
  metadata: Record<string, unknown>;
};

export type OptOutRecord = {
  id: string;
  phone: string;
  citizenId?: string;
  active: boolean;
  source: 'admin' | 'keyword' | 'api' | 'seed';
  keyword?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  actorUserId?: string;
};

export type BusinessHours = {
  timezone: 'America/Sao_Paulo';
  days: number[];
  start: string;
  end: string;
};

export type PlaylistItem = {
  id: string;
  type: 'image' | 'youtube' | 'text';
  title: string;
  durationSec: number;
  imageUrl?: string;
  youtubeId?: string;
  text?: string;
  subtitle?: string;
};

export type Unit = {
  slug: string;
  name: string;
  prefix: string;
  sequence: number;
  callNameMode: CallNameMode;
  displayMode: DisplayMode;
  serviceLabel: string;
  businessHours: BusinessHours;
  oohMessage: string;
  playlist: PlaylistItem[];
  displayTokenCipher: string;
  desk: string;
};

export type Ticket = {
  id: string;
  unitSlug: string;
  number: string;
  citizenName: string;
  service: string;
  status: 'waiting' | 'called' | 'done';
  createdAt: string;
  calledAt?: string;
  calledBy?: string;
  desk?: string;
};

export type Heartbeat = {
  id: string;
  unitSlug: string;
  at: string;
  mode: DisplayMode;
  playerVersion: string;
  userAgent?: string;
  source: 'player' | 'seed';
};

export type FranchiseMonth = {
  id: string;
  used: number;
  reserveUsed: number;
  packsAuthorized: number;
  reserveSize?: number;
  allowanceOverride?: number;
  allowanceOverrideReason?: string;
  alerted80: boolean;
  alerted100: boolean;
  alertedReserve80: boolean;
  alertedReserve100: boolean;
};

export type AlertRecord = {
  id: string;
  month: string;
  level: '80' | '100' | 'reserve80' | 'reserve100';
  message: string;
  createdAt: string;
  ratio: number;
};

export type NotificationLog = {
  id: string;
  channel: 'in_app' | 'webhook' | 'email' | 'whatsapp';
  month: string;
  level: string;
  destination: string;
  status: 'registrado' | 'enviado' | 'nao_configurado' | 'falhou';
  payload: Record<string, unknown>;
  createdAt: string;
};

export type MediaAsset = {
  id: string;
  title: string;
  kind: 'image' | 'text' | 'youtube';
  url?: string;
  dataUrl?: string;
  text?: string;
  youtubeId?: string;
  tags: string[];
  createdAt: string;
};

export type DeliveryReport = {
  id: string;
  campaignId: string;
  createdAt: string;
  metaMode: 'simulator' | 'live';
  pattern: 'random' | 'pattern';
  attempted: number;
  byStatus: StatusCounts;
  franchiseBefore: number;
  franchiseAfter: number;
  counted: number;
  excluded: number;
  segmentSummary: string;
  probes: ProbeResult[];
  optOutFiltered: { name: string; phone: string; reason: string }[];
};

export type ProbeResult = {
  kind: string;
  counted: boolean;
  detail: string;
  franchiseDelta: number;
};

export type CannedReply = {
  id: string;
  sector: string;
  shortCode: string;
  content: string;
};

export type JobMarker = {
  id: string;
  ranAt: string;
  campaignId?: string;
  sent: number;
};

export type WabaSettings = {
  id: 'waba';
  tokenCipher?: string;
  phoneNumberId?: string;
  last4?: string;
  updatedAt?: string;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export const ROLES: Role[] = ['admin', 'gestor', 'atendente', 'lancador_fila', 'auditor'];

export const TOTP_ROLES: Role[] = ['admin', 'gestor'];
