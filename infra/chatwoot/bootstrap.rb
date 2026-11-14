# frozen_string_literal: true

# Deixa o Chatwoot Community Edition do POC pronto para o atendimento humano:
# conta do município, atendentes, filas por unidade, caixa de entrada do webchat com expediente
# e texto fixo de fora do expediente, respostas prontas e o webhook assinado para a API do WRP.
#
# Roda no serviço `chatwoot-bootstrap` do compose, antes de o Chatwoot subir, e pode ser repetido
# (`npm run chatwoot:bootstrap`). A senha vale na criação de cada pessoa; repetir não troca senha.
# Não cria robô, agente de IA nem automação de resposta: o atendimento é só humano.

def required(name)
  value = ENV.fetch(name, '').strip
  abort("Variável #{name} ausente. Este roteiro roda pelo serviço chatwoot-bootstrap do docker-compose.yml.") if value.empty?
  value
end

ACCOUNT_NAME = required('WRP_CW_ACCOUNT_NAME')
PASSWORD = required('WRP_CW_PASSWORD')
# Neste POC a página do webchat é a do próprio Chatwoot (FRONTEND_URL/widget).
WEBSITE_URL = required('FRONTEND_URL')
WEBSITE_TOKEN = required('WRP_CW_WEBSITE_TOKEN')
WEBHOOK_URL = required('WRP_CW_WEBHOOK_URL')
WEBHOOK_SECRET = required('WRP_CW_WEBHOOK_SECRET')
TIMEZONE = 'America/Sao_Paulo'

# As mesmas pessoas do painel do WRP, com o mesmo e-mail.
PEOPLE = [
  { email: 'admin@pompeu.mg.gov.br', name: 'Helena Prado', role: :administrator, super_admin: true },
  { email: 'gestor@pompeu.mg.gov.br', name: 'Paulo Henrique Dutra', role: :administrator, super_admin: false },
  { email: 'atendente@pompeu.mg.gov.br', name: 'Ana Cláudia Moura', role: :agent, super_admin: false }
].freeze

# Cada equipe é a fila de uma unidade. O Chatwoot guarda o nome em minúsculas.
TEAMS = [
  { name: 'ubs centro', description: 'Fila da UBS Centro (Saúde).', members: %w[atendente@pompeu.mg.gov.br admin@pompeu.mg.gov.br] },
  { name: 'atendimento geral', description: 'Fila do Atendimento Geral.', members: %w[atendente@pompeu.mg.gov.br gestor@pompeu.mg.gov.br] },
  { name: 'prefeitura sede', description: 'Fila do protocolo da Prefeitura Sede.', members: %w[gestor@pompeu.mg.gov.br admin@pompeu.mg.gov.br] }
].freeze

# Mesmos textos das respostas prontas do painel do WRP (apps/api/src/store/seed.ts).
CANNED = {
  'ubs-horario' => 'A UBS Centro atende de segunda a sexta, das 8h às 17h. Traga documento com foto.',
  'ubs-vacina' => 'A vacinação de rotina ocorre na UBS Centro. Procure a sala de vacinas com a caderneta.',
  'iptu' => 'Para IPTU, informe o número do cadastro imobiliário. O atendimento humano segue no expediente.',
  'transferencia' => 'Vou transferir seu atendimento para o setor responsável. O histórico desta conversa permanece com o próximo servidor.',
  'opt-out' => 'Para deixar de receber campanhas, responda PARAR. O atendimento que você iniciou continua disponível.'
}.freeze

OUT_OF_OFFICE = 'A Prefeitura de Pompéu recebeu sua mensagem. O atendimento humano funciona de segunda a sexta, ' \
                'das 8h às 17h. Um servidor público responde no próximo expediente. ' \
                'Esta é uma resposta automática de horário, sem robô de atendimento.'

# Segunda a sexta, das 8h às 17h. No Chatwoot o domingo é o dia 0.
WORKING_HOURS = (0..6).map do |day|
  if (1..5).cover?(day)
    { 'day_of_week' => day, 'closed_all_day' => false, 'open_all_day' => false,
      'open_hour' => 8, 'open_minutes' => 0, 'close_hour' => 17, 'close_minutes' => 0 }
  else
    { 'day_of_week' => day, 'closed_all_day' => true, 'open_all_day' => false }
  end
end.freeze

account = Account.find_by(name: ACCOUNT_NAME) || Account.create!(name: ACCOUNT_NAME, locale: 'pt_BR')
Current.account = account

users = PEOPLE.to_h do |person|
  user = User.find_by(email: person[:email])
  if user.nil?
    user = User.new(name: person[:name], email: person[:email], password: PASSWORD, password_confirmation: PASSWORD)
    user.type = 'SuperAdmin' if person[:super_admin]
    user.skip_confirmation!
    user.save!
  end
  AccountUser.find_or_create_by!(account_id: account.id, user_id: user.id) { |link| link.role = person[:role] }
  [person[:email], user]
end

# Com o administrador criado, a tela pública de primeira configuração deixa de existir.
Redis::Alfred.delete(Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING)

channel = Channel::WebWidget.find_by(account_id: account.id, website_token: WEBSITE_TOKEN)
if channel.nil?
  channel = Channel::WebWidget.create!(
    account_id: account.id,
    website_token: WEBSITE_TOKEN,
    website_url: WEBSITE_URL,
    welcome_title: 'Prefeitura de Pompéu',
    welcome_tagline: 'Atendimento humano, de segunda a sexta, das 8h às 17h.',
    widget_color: '#102033'
  )
  Inbox.create!(account_id: account.id, name: 'Site da Prefeitura', channel: channel, timezone: TIMEZONE)
end
channel.website_url = WEBSITE_URL
# O texto fixo de fora do expediente sai em nome da caixa de entrada. Sem isto o webchat o assina como "Robôs".
channel.use_inbox_avatar_for_bot = true
# Este POC não tem servidor de e-mail: o webchat não promete aviso nem cópia da conversa por e-mail.
channel.continuity_via_email = false
channel.save!
inbox = channel.inbox
inbox.update!(
  timezone: TIMEZONE,
  working_hours_enabled: true,
  out_of_office_message: OUT_OF_OFFICE,
  greeting_enabled: false,
  enable_email_collect: false
)
inbox.update_working_hours(WORKING_HOURS)
users.each_value { |user| InboxMember.find_or_create_by!(inbox_id: inbox.id, user_id: user.id) }

TEAMS.each do |spec|
  team = Team.find_or_create_by!(account_id: account.id, name: spec[:name]) do |record|
    record.description = spec[:description]
    record.allow_auto_assign = false
  end
  spec[:members].each { |email| TeamMember.find_or_create_by!(team_id: team.id, user_id: users.fetch(email).id) }
end

CANNED.each do |short_code, content|
  reply = CannedResponse.find_or_initialize_by(account_id: account.id, short_code: short_code)
  reply.content = content
  reply.save!
end

webhook = Webhook.find_or_initialize_by(account_id: account.id, url: WEBHOOK_URL)
webhook.name = 'WRP Comunicação Digital'
webhook.subscriptions = %w[message_created conversation_updated]
webhook.secret = WEBHOOK_SECRET
webhook.save!

# O resumo sai do que ficou gravado, não do que este roteiro pediu.
open_days = inbox.reload.working_hours.order(:day_of_week).reject(&:closed_all_day).map do |day|
  format('%<dow>d %<oh>02d:%<om>02d-%<ch>02d:%<cm>02d', dow: day.day_of_week, oh: day.open_hour, om: day.open_minutes,
                                                     ch: day.close_hour, cm: day.close_minutes)
end
puts "WRP: conta #{account.name} (id #{account.id}), idioma #{account.locale}."
puts "WRP: pessoas #{account.users.order(:id).pluck(:email).join(', ')}."
puts "WRP: webchat #{inbox.name} (id #{inbox.id}), fuso #{inbox.timezone}, expediente [#{open_days.join(' | ')}] (0 = domingo)."
puts "WRP: filas #{account.teams.order(:id).pluck(:name).join(', ')}."
puts "WRP: respostas prontas #{account.canned_responses.order(:id).pluck(:short_code).join(', ')}."
puts "WRP: webhook #{webhook.url} (#{webhook.subscriptions.join(', ')})."
puts "WRP: tela de primeira configuração #{Redis::Alfred.get(Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING) ? 'ABERTA' : 'fechada'}."
