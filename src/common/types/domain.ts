/**
 * Paylaşılan alan (domain) tipleri — TEK doğruluk kaynağı.
 *
 * Tüm modüller (persistence, llm, analysis, channels, drafts, reminders)
 * bu dosyadan import eder. Modüller kendi kopyalarını tanımlamaz; sözleşme
 * kaymasını (contract drift) önlemek için değişiklikler burada yapılır.
 *
 * Not: 0001_init.sql içindeki enum'larla birebir hizalıdır.
 */

// ── Enum'lar (DB ile hizalı) ────────────────────────────────────────────────

export type ChannelKind = 'telegram' | 'whatsapp' | 'mock';

export type DocumentStatus =
  | 'received'
  | 'processing'
  | 'analyzed'
  | 'failed'
  | 'deleted';

export type DocumentSource = 'photo' | 'pdf' | 'text';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Human-in-the-loop akışı. 'sent' ASLA otomatik atanmaz (CLAUDE.md §7). */
export type DraftStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'sent';

export type ReminderKind = 'deadline' | 'followup' | 'appointment';
export type ReminderStatus = 'scheduled' | 'sent' | 'cancelled';
export type WatchStatus = 'active' | 'paused' | 'found' | 'error';

// ── Varlıklar ───────────────────────────────────────────────────────────────

export interface User {
  id: string;
  channel: ChannelKind;
  channelUserId: string;
  locale: string;

  visaType?: string | null;
  familyStatus?: string | null;
  city?: string | null;

  consentAt?: Date | null;
  aiDisclosureAckAt?: Date | null;
  /**
   * Onboarding profili tamamlandı (veya kullanıcı atladı) işareti.
   * Profil DEĞERLERİ burada değil — `pii_vault`'ta şifreli (D-027).
   */
  profileCompletedAt?: Date | null;

  deleteAfter?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentRecord {
  id: string;
  userId: string;
  source: DocumentSource;
  status: DocumentStatus;

  storageRef?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;

  /** YALNIZCA maskeli metin. Ham metin asla persist edilmez. */
  maskedText?: string | null;

  errorMessage?: string | null;
  deleteAfter?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Analiz çıktısındaki tek bir eksik belge kalemi. */
export interface MissingDocument {
  /** Almanca resmi ad, ör. 'Aktueller Mietvertrag'. */
  label: string;
  /** Kullanıcının anlayacağı kısa açıklama. */
  explanation?: string;
  /** Nereden temin edilir. */
  whereToGet?: string;
  required: boolean;
}

export interface Analysis {
  id: string;
  documentId: string;

  authority?: string | null;
  requestType?: string | null;
  /** MASKELİ özet (token içerir; kullanıcıya gösterilirken unmask edilir). */
  summary?: string | null;
  deadlineDate?: Date | null;
  riskLevel: RiskLevel;
  missingDocuments: MissingDocument[];
  nextSteps: string[];

  /** Denetim izi — MASKELİ hâliyle saklanır (D-004). */
  rawModelOutput?: string | null;
  model?: string | null;
  confidence?: number | null;

  deleteAfter?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Draft {
  id: string;
  analysisId: string;

  content: string;
  subject?: string | null;
  language: string;
  status: DraftStatus;

  approvedAt?: Date | null;
  rejectedAt?: Date | null;
  sentAt?: Date | null;
  rejectReason?: string | null;

  deleteAfter?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Reminder {
  id: string;
  userId: string;
  analysisId?: string | null;

  kind: ReminderKind;
  dueDate: Date;
  message?: string | null;
  status: ReminderStatus;
  sentAt?: Date | null;

  deleteAfter?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditEntry {
  id: string;
  userId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  /** ASLA ham PII içermez — yalnızca token/id. */
  detail: Record<string, unknown>;
  createdAt: Date;
}

export interface AppointmentWatch {
  id: string;
  userId: string;

  authorityKey: string;
  targetUrl: string;
  serviceLabel?: string | null;
  status: WatchStatus;

  lastCheckedAt?: Date | null;
  lastResult: Record<string, unknown>;
  foundAt?: Date | null;
  checkCount: number;
  errorMessage?: string | null;

  deleteAfter?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── LLM analiz sözleşmesi ───────────────────────────────────────────────────

/**
 * Modelin belge analizinden döndürmesi beklenen yapı.
 *
 * ÖNEMLİ: Model MASKELİ metin görür; bu yüzden buradaki tüm string alanlar
 * yer tutucu (`[[DATE_3]]` gibi) içerebilir. Değerler kullanıcıya/DB'ye
 * gitmeden önce `PiiService.unmaskDeep()` ile çözülür.
 *
 * Deadline, gerçek tarih yerine bir DATE token'ı olarak döner (D-009):
 * model hangi tarihin son tarih olduğunu *bağlamdan* seçer, takvim değerini
 * bilmesine gerek yoktur.
 */
export interface LlmAnalysisResult {
  /** Belgeyi gönderen kurum, ör. 'Ausländerbehörde Berlin'. */
  authority: string | null;
  /** Talep türü, ör. 'Unterlagennachforderung'. */
  requestType: string | null;
  /** 2-4 cümlelik, sade dilde özet. */
  summary: string;
  /** Son tarihi işaret eden DATE token'ı, ör. '[[DATE_2]]'. Yoksa null. */
  deadlineToken: string | null;
  riskLevel: RiskLevel;
  missingDocuments: MissingDocument[];
  nextSteps: string[];
  /** 0..1 — modelin kendi güven tahmini. */
  confidence: number;
  /** Belgenin kapsam içinde olup olmadığı (v1: Ausländerbehörde odaklı). */
  inScope: boolean;
}

/** Taslak mektup üretimi sözleşmesi. */
export interface LlmDraftResult {
  subject: string;
  /** Beamtendeutsch üslubunda resmi mektup gövdesi (token içerebilir). */
  body: string;
  /** Kullanıcının doldurması/eklemesi gereken noktalar. */
  placeholders: string[];
}
