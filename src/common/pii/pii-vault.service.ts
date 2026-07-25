import { Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../crypto/crypto.service';
import { PiiEntityType, PiiMap, PiiMatch } from './pii.types';

/** Vault'a yazılacak/okunacak şifreli PII kaydı (DB satır karşılığı). */
export interface SealedPiiRecord {
  token: string;
  entityType: PiiEntityType;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
  userId?: string;
  documentId?: string;
  deleteAfter?: Date;
}

export interface VaultScope {
  userId?: string;
  documentId?: string;
}

/**
 * PII eşleme tablosunun kalıcılaştırılması.
 *
 * Kural: orijinal değerler yalnızca AES-256-GCM ciphertext olarak saklanır.
 * AAD olarak kapsam (user/document + token) bağlanır — bir kaydın başka bir
 * bağlama kopyalanması (confused deputy) çözme sırasında hata verir.
 */
@Injectable()
export class PiiVaultService {
  private readonly logger = new Logger(PiiVaultService.name);

  constructor(private readonly crypto: CryptoService) {}

  /** Bir maskeleme haritasını şifreli kayıtlara dönüştürür. */
  seal(
    map: PiiMap,
    scope: VaultScope,
    deleteAfter?: Date,
  ): SealedPiiRecord[] {
    return map.matches.map((match) => {
      const sealed = this.crypto.seal(match.original, this.aad(scope, match.token));
      return {
        token: match.token,
        entityType: match.type,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        keyVersion: sealed.keyVersion,
        userId: scope.userId,
        documentId: scope.documentId,
        deleteAfter,
      };
    });
  }

  /** Şifreli kayıtlardan çalışır bir maskeleme haritası geri kurar. */
  open(records: SealedPiiRecord[], scope: VaultScope): PiiMap {
    const byToken = new Map<string, PiiMatch>();

    for (const r of records) {
      try {
        const original = this.crypto.open(
          {
            ciphertext: r.ciphertext,
            iv: r.iv,
            authTag: r.authTag,
            keyVersion: r.keyVersion,
          },
          this.aad(scope, r.token),
        );
        byToken.set(r.token, {
          original,
          token: r.token,
          type: r.entityType,
          strategy: 'known-value',
        });
      } catch {
        // Değeri ASLA loglama — yalnızca token ve tip.
        this.logger.error(
          `PII vault kaydı çözülemedi (token=${r.token}, type=${r.entityType}). ` +
            'Anahtar rotasyonu veya bozulmuş kayıt olabilir.',
        );
      }
    }

    return { byToken, matches: [...byToken.values()] };
  }

  private aad(scope: VaultScope, token: string): string {
    return `bueko:v1:${scope.userId ?? '-'}:${scope.documentId ?? '-'}:${token}`;
  }
}
