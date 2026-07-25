import { Injectable, Logger } from '@nestjs/common';
import { KnownPiiProfile } from '../../common/pii/pii.types';
import { PiiVaultService } from '../../common/pii/pii-vault.service';
import { PiiVaultRepository } from '../persistence/repositories/pii-vault.repository';
import { UserRepository } from '../persistence/repositories/user.repository';
import { AuditRepository } from '../persistence/repositories/audit.repository';

/**
 * Onboarding profili — "bilinen-değer maskeleme"nin yakıtı (D-027).
 *
 * Kullanıcının KENDİ kimlik bilgileri burada toplanır ve `pii_vault` içinde
 * **AES-256-GCM ile şifreli** saklanır. `users` tablosuna düz PII YAZILMAZ;
 * orada yalnızca "onboarding tamamlandı" damgası tutulur.
 *
 * Bu profil sayesinde, belgedeki kullanıcıya ait isim/adres gibi değerler —
 * yapısal bir deseni olmasa bile — maskelenebilir (D-024'ün kapatılması).
 */
@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly vault: PiiVaultService,
    private readonly vaultRepo: PiiVaultRepository,
    private readonly users: UserRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Profili şifreleyip kalıcılaştırır ve kullanıcıyı "profil tamamlandı"
   * olarak işaretler. Var olan profil kayıtları önce temizlenir (güncelleme).
   */
  async save(userId: string, profile: KnownPiiProfile): Promise<void> {
    await this.clearProfileRecords(userId);

    const records = this.vault.sealProfile(profile, userId);
    if (records.length > 0) {
      await this.vaultRepo.saveMany(records);
    }

    await this.users.update(userId, { profileCompletedAt: new Date() });

    await this.audit.append({
      userId,
      action: 'profile.saved',
      entityType: 'user',
      entityId: userId,
      // ASLA değer yazma — yalnızca hangi alanların doldurulduğu ve adedi.
      detail: {
        fieldCount: records.length,
        fields: records.map((r) => r.token.replace('profile:', '')),
      },
    });

    this.logger.debug(`Profil kaydedildi (userId=${userId}, alan=${records.length})`);
  }

  /**
   * Kullanıcının profilini çözer. Profil yoksa `undefined` döner —
   * bu durumda maskeleme yalnızca yapısal desenlerle çalışır.
   */
  async load(userId: string): Promise<KnownPiiProfile | undefined> {
    const records = await this.vaultRepo.findByUser(userId);
    const profileRecords = records.filter((r) => r.token.startsWith('profile:'));
    if (profileRecords.length === 0) return undefined;

    const profile = this.vault.openProfile(profileRecords, userId);
    return Object.keys(profile).length > 0 ? profile : undefined;
  }

  /**
   * Kullanıcı profil vermeyi REDDEDEBİLİR (gizlilik tercihi).
   * Onboarding tamamlanmış sayılır ama profil boş kalır.
   */
  async skip(userId: string): Promise<void> {
    await this.users.update(userId, { profileCompletedAt: new Date() });
    await this.audit.append({
      userId,
      action: 'profile.skipped',
      entityType: 'user',
      entityId: userId,
      detail: {},
    });
  }

  /** Yalnızca profil kayıtlarını siler (belge kayıtlarına dokunmaz). */
  async clearProfileRecords(userId: string): Promise<number> {
    const records = await this.vaultRepo.findByUser(userId);
    const profileRecords = records.filter((r) => r.token.startsWith('profile:'));

    for (const record of profileRecords) {
      await this.vaultRepo.delete(record.id);
    }
    return profileRecords.length;
  }
}
