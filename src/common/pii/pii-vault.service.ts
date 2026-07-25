import { Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../crypto/crypto.service';
import { KnownPiiProfile, PiiEntityType, PiiMap, PiiMatch } from './pii.types';

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

  /**
   * Onboarding profilini ŞİFRELİ olarak vault'a hazırlar (D-027).
   *
   * Kullanıcının kendi kimlik bilgileri, "bilinen-değer maskeleme"yi
   * (D-003 adım 1) mümkün kılar. Bu değerler `users` tablosunda DÜZ
   * saklanmaz — burada, kullanıcı kapsamlı (documentId yok) vault
   * kayıtları olarak şifrelenir.
   */
  sealProfile(profile: KnownPiiProfile, userId: string): SealedPiiRecord[] {
    const records: SealedPiiRecord[] = [];

    for (const [field, entityType] of PROFILE_FIELDS) {
      const value = profile[field];
      if (typeof value !== 'string' || value.trim().length === 0) continue;

      const token = profileToken(field);
      const sealed = this.crypto.seal(
        value.trim(),
        this.aad({ userId }, token),
      );
      records.push({
        token,
        entityType,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        keyVersion: sealed.keyVersion,
        userId,
      });
    }
    return records;
  }

  /** Şifreli profil kayıtlarından `KnownPiiProfile` geri kurar. */
  openProfile(records: SealedPiiRecord[], userId: string): KnownPiiProfile {
    const profile: KnownPiiProfile = {};

    for (const record of records) {
      const field = fieldFromToken(record.token);
      if (!field) continue;

      try {
        profile[field] = this.crypto.open(
          {
            ciphertext: record.ciphertext,
            iv: record.iv,
            authTag: record.authTag,
            keyVersion: record.keyVersion,
          },
          this.aad({ userId }, record.token),
        ) as never;
      } catch {
        // Değeri ASLA loglama — yalnızca alan adı.
        this.logger.error(
          `Profil alanı çözülemedi (field=${field}). Anahtar rotasyonu olabilir.`,
        );
      }
    }
    return profile;
  }

  private aad(scope: VaultScope, token: string): string {
    return `bueko:v1:${scope.userId ?? '-'}:${scope.documentId ?? '-'}:${token}`;
  }
}

/** Profil alanı → PII tipi eşlemesi. Vault token'ları bu alanlardan türetilir. */
const PROFILE_FIELDS: Array<[keyof KnownPiiProfile, PiiEntityType]> = [
  ['fullName', PiiEntityType.NAME],
  ['givenName', PiiEntityType.NAME],
  ['familyName', PiiEntityType.NAME],
  ['dateOfBirth', PiiEntityType.DOB],
  ['address', PiiEntityType.ADDRESS],
  ['city', PiiEntityType.ADDRESS],
  ['postalCode', PiiEntityType.POSTALCODE],
  ['email', PiiEntityType.EMAIL],
  ['phone', PiiEntityType.PHONE],
  ['auslaendernummer', PiiEntityType.AUSLNR],
  ['steuerId', PiiEntityType.STEUERID],
  ['passportNumber', PiiEntityType.PASSPORT],
  ['insuranceNumber', PiiEntityType.INSURANCE],
];

const PROFILE_TOKEN_PREFIX = 'profile:';

function profileToken(field: keyof KnownPiiProfile): string {
  return `${PROFILE_TOKEN_PREFIX}${String(field)}`;
}

function fieldFromToken(token: string): keyof KnownPiiProfile | null {
  if (!token.startsWith(PROFILE_TOKEN_PREFIX)) return null;
  const field = token.slice(PROFILE_TOKEN_PREFIX.length) as keyof KnownPiiProfile;
  return PROFILE_FIELDS.some(([f]) => f === field) ? field : null;
}
