export const DEMO_SECRET_PASSPHRASE = 'demo-poc-pompeu-nao-usar-em-producao';
export const DEMO_WEBHOOK_SECRET = 'demo-webhook-pompeu';
export const DEMO_PASSWORD = 'Pompeu#089';
export const DEMO_TOTP_SECRET = 'OBQWIZLOOQZGS4DZ';
/** Versão da Graph API da Meta usada quando META_GRAPH_VERSION não é informada. */
export const DEFAULT_GRAPH_VERSION = 'v26.0';

export type AppConfig = {
  host: string;
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  demoMode: boolean;
  /** Mostra a senha, o segredo e o código TOTP de demonstração na tela de login. Desligue em endereço público. */
  demoHints: boolean;
  databaseUrl?: string;
  redisUrl?: string;
  secretsKey: string;
  metaMode: 'simulator' | 'live';
  simulatorPattern: 'random' | 'pattern';
  metaPhoneNumberId?: string;
  metaAccessToken?: string;
  metaGraphVersion: string;
  metaVerifyToken?: string;
  metaAppSecret?: string;
  /** Modelo aprovado na Meta, usado quando o órgão inicia a conversa fora da janela de 24 horas. */
  metaTemplateName?: string;
  metaTemplateLanguage: string;
  /** O modelo recebe o texto da mensagem como única variável do corpo. Desligue para modelo sem variável. */
  metaTemplateBodyParam: boolean;
  webhookSecret: string;
  franchiseMonthly: number;
  franchisePackSize: number;
  technicalReserve: number;
  /** Endereço que a API usa para consultar o Chatwoot (rede interna no compose). */
  chatwootBaseUrl: string;
  /** Endereço que o navegador do servidor público abre. */
  chatwootPublicUrl: string;
  chatwootWhatsappRelay: boolean;
  /** Token da caixa de entrada Website do Chatwoot. Com ele o painel oferece o link do webchat do cidadão. */
  chatwootWebsiteToken?: string;
  chatwootApiToken?: string;
  adminAlertPhone?: string;
  alertWebhookUrl?: string;
  alertEmail: string;
  rateLimit: boolean;
  passwordCost: number;
  demoPassword: string;
  demoTotpSecret: string;
  corsOrigin: string;
  birthdayAutorun: boolean;
  oohSender: 'wrp' | 'chatwoot';
  trustProxy: boolean;
};

export type ConfigOverrides = Partial<AppConfig> & { allowDemoProduction?: boolean };

export function makeConfig(env: NodeJS.ProcessEnv = process.env, overrides: ConfigOverrides = {}): AppConfig {
  const nodeEnv = overrides.nodeEnv ?? env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const demoDefault = isProduction ? 'false' : 'true';
  const demoFromEnv = (env.DEMO_MODE ?? demoDefault) === 'true';
  const demoMode = overrides.demoMode ?? demoFromEnv;
  const secretsKey = overrides.secretsKey ?? env.SECRETS_KEY ?? (demoMode ? DEMO_SECRET_PASSPHRASE : '');

  if (isProduction && demoMode && env.ALLOW_DEMO_MODE !== 'true' && overrides.allowDemoProduction !== true) {
    throw new Error('DEMO_MODE=true em produção exige ALLOW_DEMO_MODE=true. Desligue o modo demonstração antes de expor o serviço.');
  }
  if (!demoMode && (!secretsKey || secretsKey === DEMO_SECRET_PASSPHRASE)) {
    throw new Error('SECRETS_KEY obrigatória fora do modo demonstração. Não use a chave do POC.');
  }
  if (!secretsKey) throw new Error('SECRETS_KEY ausente.');

  const metaMode = overrides.metaMode ?? (env.META_MODE === 'live' ? 'live' : 'simulator');
  const simulatorPattern = overrides.simulatorPattern ?? (env.SIMULATOR_PATTERN === 'pattern' ? 'pattern' : 'random');
  const chatwootBaseUrl = overrides.chatwootBaseUrl ?? env.CHATWOOT_BASE_URL ?? 'http://127.0.0.1:3309';

  const config: AppConfig = {
    host: overrides.host ?? env.HOST ?? '0.0.0.0',
    port: overrides.port ?? Number(env.PORT ?? 43110),
    nodeEnv,
    isProduction,
    demoMode,
    demoHints: demoMode && (overrides.demoHints ?? env.DEMO_HINTS !== 'false'),
    databaseUrl: overrides.databaseUrl ?? (env.DATABASE_URL || undefined),
    redisUrl: overrides.redisUrl ?? (env.REDIS_URL || undefined),
    secretsKey,
    metaMode,
    simulatorPattern,
    metaPhoneNumberId: overrides.metaPhoneNumberId ?? (env.META_PHONE_NUMBER_ID || undefined),
    metaAccessToken: overrides.metaAccessToken ?? (env.META_ACCESS_TOKEN || undefined),
    metaGraphVersion: overrides.metaGraphVersion ?? (env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION),
    metaVerifyToken: overrides.metaVerifyToken ?? (env.META_VERIFY_TOKEN || undefined),
    metaAppSecret: overrides.metaAppSecret ?? (env.META_APP_SECRET || undefined),
    metaTemplateName: overrides.metaTemplateName ?? (env.META_TEMPLATE_NAME || undefined),
    metaTemplateLanguage: overrides.metaTemplateLanguage ?? (env.META_TEMPLATE_LANGUAGE || 'pt_BR'),
    metaTemplateBodyParam: overrides.metaTemplateBodyParam ?? env.META_TEMPLATE_BODY_PARAM !== 'false',
    webhookSecret: overrides.webhookSecret ?? env.WEBHOOK_SECRET ?? (demoMode ? DEMO_WEBHOOK_SECRET : ''),
    franchiseMonthly: overrides.franchiseMonthly ?? Number(env.FRANCHISE_MONTHLY ?? 5000),
    franchisePackSize: overrides.franchisePackSize ?? Number(env.FRANCHISE_PACK_SIZE ?? 100),
    technicalReserve: overrides.technicalReserve ?? Number(env.TECHNICAL_RESERVE ?? 200),
    chatwootBaseUrl,
    chatwootPublicUrl: overrides.chatwootPublicUrl ?? (env.CHATWOOT_PUBLIC_URL || chatwootBaseUrl),
    chatwootWhatsappRelay: overrides.chatwootWhatsappRelay ?? env.CHATWOOT_WHATSAPP_RELAY === 'true',
    chatwootWebsiteToken: overrides.chatwootWebsiteToken ?? (env.CHATWOOT_WEBSITE_TOKEN || undefined),
    chatwootApiToken: overrides.chatwootApiToken ?? (env.CHATWOOT_API_TOKEN || undefined),
    adminAlertPhone: overrides.adminAlertPhone ?? (env.ADMIN_ALERT_PHONE || '5537990000999'),
    alertWebhookUrl: overrides.alertWebhookUrl ?? (env.ALERT_WEBHOOK_URL || undefined),
    alertEmail: overrides.alertEmail ?? env.ALERT_EMAIL ?? 'gestor@pompeu.mg.gov.br',
    rateLimit: overrides.rateLimit ?? env.RATE_LIMIT !== 'false',
    passwordCost: overrides.passwordCost ?? (isProduction ? 16384 : 8192),
    demoPassword: overrides.demoPassword ?? env.DEMO_PASSWORD ?? DEMO_PASSWORD,
    demoTotpSecret: overrides.demoTotpSecret ?? env.DEMO_TOTP_SECRET ?? DEMO_TOTP_SECRET,
    corsOrigin: overrides.corsOrigin ?? env.CORS_ORIGIN ?? 'http://127.0.0.1:43123,http://localhost:43123',
    birthdayAutorun: overrides.birthdayAutorun ?? env.BIRTHDAY_AUTORUN !== 'false',
    oohSender: overrides.oohSender ?? (env.OOH_SENDER === 'chatwoot' ? 'chatwoot' : 'wrp'),
    trustProxy: true,
  };

  if (!demoMode && !config.webhookSecret) {
    throw new Error('WEBHOOK_SECRET obrigatório fora do modo demonstração.');
  }
  // Dicas desligadas indicam endereço público. Os valores de demonstração estão no repositório público:
  // com eles qualquer visitante entraria como administrador.
  if (demoMode && !config.demoHints) {
    const publicDefaults = [
      ['SECRETS_KEY', config.secretsKey === DEMO_SECRET_PASSPHRASE],
      ['WEBHOOK_SECRET', config.webhookSecret === DEMO_WEBHOOK_SECRET],
      ['DEMO_PASSWORD', config.demoPassword === DEMO_PASSWORD],
      ['DEMO_TOTP_SECRET', config.demoTotpSecret === DEMO_TOTP_SECRET],
    ].filter(([, isDefault]) => isDefault);
    if (publicDefaults.length > 0) {
      throw new Error(
        `DEMO_HINTS=false exige segredos próprios. Troque no .env: ${publicDefaults.map(([name]) => name).join(', ')}.`,
      );
    }
  }
  return config;
}
