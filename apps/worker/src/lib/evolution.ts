import axios from 'axios';
import { env } from './env';
import { logger } from './logger';

// Envia texto via Evolution API (WhatsApp) na instância dedicada do OpenRate.
// No-op silencioso se a Evolution não estiver configurada (dev).
export async function sendWhatsApp(toE164: string, text: string): Promise<boolean> {
  if (!env.evolutionApiUrl || !env.evolutionApiKey) {
    logger.warn({ toE164 }, 'Evolution não configurada; pulando envio de WhatsApp');
    return false;
  }
  try {
    await axios.post(
      `${env.evolutionApiUrl}/message/sendText/${env.evolutionInstance}`,
      { number: toE164, text },
      { headers: { apikey: env.evolutionApiKey }, timeout: 15_000 },
    );
    return true;
  } catch (err) {
    // Só a mensagem — o objeto de erro do axios carrega headers com apikey.
    logger.error({ msg_err: err instanceof Error ? err.message : String(err), toE164 }, 'falha ao enviar WhatsApp');
    throw err;
  }
}
