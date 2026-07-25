import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { AppConfigService } from '../../config/config.service';

export interface SealedValue {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
  keyVersion: number;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM için önerilen 96-bit nonce
const KEY_VERSION = 1;

/**
 * PII vault için AES-256-GCM zarf şifreleme.
 *
 * Kural (ARCHITECTURE §6): orijinal PII değerleri hiçbir yerde düz metin persist
 * edilmez. Bu servis, vault'a yazılacak her değeri mühürler ve yalnızca
 * uygulama içinde çözer.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly masterKey: Buffer;

  constructor(private readonly config: AppConfigService) {
    this.masterKey = this.resolveMasterKey();
  }

  /** Değeri mühürler. Her çağrı yeni bir IV üretir (aynı girdi ≠ aynı ciphertext). */
  seal(plaintext: string, aad?: string): SealedValue {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
    if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: KEY_VERSION,
    };
  }

  /** Mührü açar. Bozulmuş/oynanmış veri `Error` fırlatır (GCM auth). */
  open(sealed: SealedValue, aad?: string): string {
    const decipher = createDecipheriv(
      ALGORITHM,
      this.masterKey,
      Buffer.from(sealed.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
    if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));

    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Deterministik, geri döndürülemez parmak izi. PII değerlerini
   * *loglamadan* karşılaştırmak/deduplike etmek için (ör. aynı isim iki kez
   * geçtiğinde aynı token'ı vermek).
   */
  fingerprint(value: string): string {
    return createHmac('sha256', this.masterKey)
      .update(value.normalize('NFKC').toLowerCase())
      .digest('hex')
      .slice(0, 32);
  }

  /** Sabit zamanlı karşılaştırma (webhook secret vb. için). */
  safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  private resolveMasterKey(): Buffer {
    const configured = this.config.piiMasterKey;
    if (configured) return Buffer.from(configured, 'hex');

    if (this.config.isProduction) {
      // env.schema zaten engelliyor; bu ikinci savunma hattı.
      throw new Error(
        'PII_MASTER_KEY üretimde zorunludur — dev anahtarına düşülemez.',
      );
    }

    this.logger.warn(
      'DEV-ONLY PII anahtarı türetiliyor (PII_MASTER_KEY yok). Üretimde ASLA kullanılmaz.',
    );
    // Sabit, deterministik dev anahtarı — testlerin tekrarlanabilir olması için.
    return Buffer.from(
      hkdfSync('sha256', 'bueko-dev-only-master-key', 'bueko-dev-salt', 'pii-vault', 32),
    );
  }
}
