import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';

/** `/health` yanıt gövdesi — bilinçli olarak MİNİMAL. */
export interface HealthResponse {
  status: 'ok';
  /** Sürecin ayakta olduğu süre (saniye, tam sayı). */
  uptime: number;
}

/**
 * Liveness probe (`GET /health`).
 *
 * Neden var: Railway/Coolify gibi platformlar dağıtımın "canlı" sayılması için bir
 * healthcheck yoluna ihtiyaç duyar. Bu endpoint olmadan Railway kök yolu (`/`)
 * yoklardı ve orası 404 döner — dağıtım "unhealthy" işaretlenip yeniden başlatma
 * döngüsüne girebilirdi.
 *
 * ── Bilinçli kapsam: LIVENESS, readiness DEĞİL ────────────────────────────────
 * Burada Supabase/Anthropic'e KASITLI olarak dokunulmuyor. Sağlayıcı taraflı
 * geçici bir kesinti, çalışan bir süreci öldürüp yeniden başlatma döngüsüne
 * sokmamalı — yeniden başlatmak dış servisin kesintisini düzeltmez, yalnızca
 * bekleyen işleri de kaybettirir. Bağımlılıkların gerçekten çalıştığı ayrıca ve
 * dağıtımdan bağımsız olarak doğrulanıyor: `npm run live:check`.
 *
 * ── Bilinçli kapsam: SIFIR bilgi sızıntısı ────────────────────────────────────
 * Bu endpoint kimlik doğrulaması İSTEMEZ (platform probe'unun anahtarı yoktur),
 * dolayısıyla herkese açıktır. Bu yüzden yanıt yalnızca `status` ve `uptime`
 * içerir: sürüm, ortam adı, sürücü türü, bağımlılık durumu veya yapılandırma
 * ASLA yazılmaz — hepsi saldırgan için keşif bilgisidir.
 */
@Controller('health')
export class HealthController {
  @Get()
  @HttpCode(HttpStatus.OK)
  check(): HealthResponse {
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }
}
