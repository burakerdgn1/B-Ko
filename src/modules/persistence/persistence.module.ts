import { Module, Provider } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { AnalysisMemoryRepository } from './memory/analysis.memory.repository';
import { AppointmentWatchMemoryRepository } from './memory/appointment-watch.memory.repository';
import { AuditMemoryRepository } from './memory/audit.memory.repository';
import { DocumentMemoryRepository } from './memory/document.memory.repository';
import { DraftMemoryRepository } from './memory/draft.memory.repository';
import { PiiVaultMemoryRepository } from './memory/pii-vault.memory.repository';
import { ReminderMemoryRepository } from './memory/reminder.memory.repository';
import { UserMemoryRepository } from './memory/user.memory.repository';
import { AnalysisRepository } from './repositories/analysis.repository';
import { AppointmentWatchRepository } from './repositories/appointment-watch.repository';
import { AuditRepository } from './repositories/audit.repository';
import { DocumentRepository } from './repositories/document.repository';
import { DraftRepository } from './repositories/draft.repository';
import { PiiVaultRepository } from './repositories/pii-vault.repository';
import { ReminderRepository } from './repositories/reminder.repository';
import { UserRepository } from './repositories/user.repository';
import { AnalysisSupabaseRepository } from './supabase/analysis.supabase.repository';
import { AppointmentWatchSupabaseRepository } from './supabase/appointment-watch.supabase.repository';
import { AuditSupabaseRepository } from './supabase/audit.supabase.repository';
import { DocumentSupabaseRepository } from './supabase/document.supabase.repository';
import { DraftSupabaseRepository } from './supabase/draft.supabase.repository';
import { PiiVaultSupabaseRepository } from './supabase/pii-vault.supabase.repository';
import { ReminderSupabaseRepository } from './supabase/reminder.supabase.repository';
import { SupabaseClientProvider } from './supabase/supabase-client.provider';
import { UserSupabaseRepository } from './supabase/user.supabase.repository';

/**
 * Bir abstract-class token'ı için driver'a göre implementasyon seçen factory
 * provider üretir. `SupabaseClientProvider` her zaman DI graf'ında bulunur
 * (tembel kurulumu sayesinde memory modda hiç dokunulmaz — bkz. o dosyadaki not);
 * bu yüzden `inject` listesinde koşulsuz yer alabilir.
 */
function repositoryProvider<TToken extends abstract new (...args: never[]) => unknown>(
  token: TToken,
  MemoryImpl: new () => InstanceType<TToken>,
  SupabaseImpl: new (supabase: SupabaseClientProvider) => InstanceType<TToken>,
): Provider {
  return {
    provide: token,
    useFactory: (config: AppConfigService, supabase: SupabaseClientProvider) =>
      config.dbDriver === 'supabase' ? new SupabaseImpl(supabase) : new MemoryImpl(),
    inject: [AppConfigService, SupabaseClientProvider],
  };
}

const repositoryProviders: Provider[] = [
  repositoryProvider(UserRepository, UserMemoryRepository, UserSupabaseRepository),
  repositoryProvider(
    DocumentRepository,
    DocumentMemoryRepository,
    DocumentSupabaseRepository,
  ),
  repositoryProvider(
    AnalysisRepository,
    AnalysisMemoryRepository,
    AnalysisSupabaseRepository,
  ),
  repositoryProvider(DraftRepository, DraftMemoryRepository, DraftSupabaseRepository),
  repositoryProvider(
    ReminderRepository,
    ReminderMemoryRepository,
    ReminderSupabaseRepository,
  ),
  repositoryProvider(
    PiiVaultRepository,
    PiiVaultMemoryRepository,
    PiiVaultSupabaseRepository,
  ),
  repositoryProvider(AuditRepository, AuditMemoryRepository, AuditSupabaseRepository),
  repositoryProvider(
    AppointmentWatchRepository,
    AppointmentWatchMemoryRepository,
    AppointmentWatchSupabaseRepository,
  ),
];

/**
 * Persistence katmanı — `AppConfigService.dbDriver` değerine göre `memory`
 * ya da `supabase` repository implementasyonlarını bağlayan dinamik modül.
 *
 * KASITLI OLARAK `@Global()` DEĞİL: ihtiyaç duyan her modül (documents,
 * analysis, drafts, reminders, watcher, ...) `PersistenceModule`'ü kendi
 * `imports`'una eklemeli. Bu, hangi modülün persistence'a bağımlı olduğunu
 * dosya üzerinden açıkça görünür kılar.
 */
@Module({
  providers: [SupabaseClientProvider, ...repositoryProviders],
  exports: [
    UserRepository,
    DocumentRepository,
    AnalysisRepository,
    DraftRepository,
    ReminderRepository,
    PiiVaultRepository,
    AuditRepository,
    AppointmentWatchRepository,
  ],
})
export class PersistenceModule {}
