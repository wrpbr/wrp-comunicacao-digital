import type { AppConfig } from '../config.js';
import { HttpError } from '../http.js';

export async function forwardMetaToChatwoot(
  config: AppConfig,
  body: string,
  signature: string,
  phoneNumber: string,
): Promise<void> {
  const target = new URL(`/webhooks/whatsapp/${encodeURIComponent(phoneNumber)}`, config.chatwootBaseUrl);
  let response: Response;
  try {
    response = await fetch(target, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
        'x-forwarded-proto': new URL(config.chatwootPublicUrl).protocol.slice(0, -1),
      },
      body,
    });
  } catch {
    throw new HttpError(502, 'Chatwoot indisponível; a Meta deve repetir a entrega.', 'chatwoot_indisponivel');
  }
  await response.body?.cancel();
  if (!response.ok) {
    throw new HttpError(502, 'Chatwoot não confirmou a entrega; a Meta deve repeti-la.', 'chatwoot_recusou_webhook');
  }
}
