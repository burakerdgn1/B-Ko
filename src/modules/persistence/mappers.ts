/**
 * snake_case DB satırı ↔ camelCase domain nesnesi dönüşümleri.
 *
 * Yalnızca `supabase/*.supabase.repository.ts` tarafından kullanılır (memory
 * driver zaten domain tiplerini doğrudan tutar). Şema referansı:
 * `supabase/migrations/0001_init.sql`; domain tipleri `common/types/domain.ts`.
 */
import {
  AppointmentWatch,
  Analysis,
  AuditEntry,
  Draft,
  DocumentRecord,
  MissingDocument,
  Reminder,
  User,
} from '../../common/types/domain';
import { SealedPiiRecordRow } from './repositories/pii-vault.repository';

// ── tarih yardımcıları ───────────────────────────────────────────────────────

/** Supabase'ten gelen `timestamptz`/`date` değerini `Date`'e çevirir. */
export function toDate(value: string | null | undefined): Date | null {
  return value == null ? null : new Date(value);
}

/** Zorunlu (null olmayan) bir tarih alanı için. */
export function toDateRequired(value: string): Date {
  return new Date(value);
}

/** `Date`'i ISO string'e çevirir (insert/update satırları için). */
export function fromDate(value: Date | null | undefined): string | null {
  return value == null ? null : value.toISOString();
}

// ── users ────────────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  channel: string;
  channel_user_id: string;
  locale: string;
  visa_type: string | null;
  family_status: string | null;
  city: string | null;
  consent_at: string | null;
  ai_disclosure_ack_at: string | null;
  profile_completed_at: string | null;
  delete_after: string | null;
  created_at: string;
  updated_at: string;
}

export function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    channel: row.channel as User['channel'],
    channelUserId: row.channel_user_id,
    locale: row.locale,
    visaType: row.visa_type,
    familyStatus: row.family_status,
    city: row.city,
    consentAt: toDate(row.consent_at),
    aiDisclosureAckAt: toDate(row.ai_disclosure_ack_at),
    profileCompletedAt: toDate(row.profile_completed_at),
    deleteAfter: toDate(row.delete_after),
    createdAt: toDateRequired(row.created_at),
    updatedAt: toDateRequired(row.updated_at),
  };
}

export function userToRow(input: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>) {
  const row: Record<string, unknown> = {};
  if (input.channel !== undefined) row.channel = input.channel;
  if (input.channelUserId !== undefined) row.channel_user_id = input.channelUserId;
  if (input.locale !== undefined) row.locale = input.locale;
  if (input.visaType !== undefined) row.visa_type = input.visaType;
  if (input.familyStatus !== undefined) row.family_status = input.familyStatus;
  if (input.city !== undefined) row.city = input.city;
  if (input.consentAt !== undefined) row.consent_at = fromDate(input.consentAt);
  if (input.aiDisclosureAckAt !== undefined) {
    row.ai_disclosure_ack_at = fromDate(input.aiDisclosureAckAt);
  }
  if (input.profileCompletedAt !== undefined) {
    row.profile_completed_at = fromDate(input.profileCompletedAt);
  }
  if (input.deleteAfter !== undefined) row.delete_after = fromDate(input.deleteAfter);
  return row;
}

// ── documents ────────────────────────────────────────────────────────────────

export interface DocumentRow {
  id: string;
  user_id: string;
  source: string;
  status: string;
  storage_ref: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  masked_text: string | null;
  error_message: string | null;
  delete_after: string | null;
  created_at: string;
  updated_at: string;
}

export function mapDocumentRow(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source as DocumentRecord['source'],
    status: row.status as DocumentRecord['status'],
    storageRef: row.storage_ref,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    maskedText: row.masked_text,
    errorMessage: row.error_message,
    deleteAfter: toDate(row.delete_after),
    createdAt: toDateRequired(row.created_at),
    updatedAt: toDateRequired(row.updated_at),
  };
}

export function documentToRow(
  input: Partial<Omit<DocumentRecord, 'id' | 'createdAt' | 'updatedAt'>>,
) {
  const row: Record<string, unknown> = {};
  if (input.userId !== undefined) row.user_id = input.userId;
  if (input.source !== undefined) row.source = input.source;
  if (input.status !== undefined) row.status = input.status;
  if (input.storageRef !== undefined) row.storage_ref = input.storageRef;
  if (input.mimeType !== undefined) row.mime_type = input.mimeType;
  if (input.sizeBytes !== undefined) row.size_bytes = input.sizeBytes;
  if (input.maskedText !== undefined) row.masked_text = input.maskedText;
  if (input.errorMessage !== undefined) row.error_message = input.errorMessage;
  if (input.deleteAfter !== undefined) row.delete_after = fromDate(input.deleteAfter);
  return row;
}

// ── analyses ─────────────────────────────────────────────────────────────────

export interface AnalysisRow {
  id: string;
  document_id: string;
  authority: string | null;
  request_type: string | null;
  summary: string | null;
  deadline_date: string | null;
  risk_level: string;
  missing_documents: MissingDocument[] | null;
  next_steps: string[] | null;
  raw_model_output: string | null;
  model: string | null;
  confidence: number | null;
  delete_after: string | null;
  created_at: string;
  updated_at: string;
}

export function mapAnalysisRow(row: AnalysisRow): Analysis {
  return {
    id: row.id,
    documentId: row.document_id,
    authority: row.authority,
    requestType: row.request_type,
    summary: row.summary,
    deadlineDate: toDate(row.deadline_date),
    riskLevel: row.risk_level as Analysis['riskLevel'],
    missingDocuments: row.missing_documents ?? [],
    nextSteps: row.next_steps ?? [],
    rawModelOutput: row.raw_model_output,
    model: row.model,
    confidence: row.confidence,
    deleteAfter: toDate(row.delete_after),
    createdAt: toDateRequired(row.created_at),
    updatedAt: toDateRequired(row.updated_at),
  };
}

export function analysisToRow(
  input: Partial<Omit<Analysis, 'id' | 'createdAt' | 'updatedAt'>>,
) {
  const row: Record<string, unknown> = {};
  if (input.documentId !== undefined) row.document_id = input.documentId;
  if (input.authority !== undefined) row.authority = input.authority;
  if (input.requestType !== undefined) row.request_type = input.requestType;
  if (input.summary !== undefined) row.summary = input.summary;
  if (input.deadlineDate !== undefined) {
    row.deadline_date = input.deadlineDate ? toDateOnly(input.deadlineDate) : null;
  }
  if (input.riskLevel !== undefined) row.risk_level = input.riskLevel;
  if (input.missingDocuments !== undefined) row.missing_documents = input.missingDocuments;
  if (input.nextSteps !== undefined) row.next_steps = input.nextSteps;
  if (input.rawModelOutput !== undefined) row.raw_model_output = input.rawModelOutput;
  if (input.model !== undefined) row.model = input.model;
  if (input.confidence !== undefined) row.confidence = input.confidence;
  if (input.deleteAfter !== undefined) row.delete_after = fromDate(input.deleteAfter);
  return row;
}

/** `deadline_date` sütunu `date` tipinde (saat bileşeni yok) — YYYY-MM-DD. */
function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// ── drafts ───────────────────────────────────────────────────────────────────

export interface DraftRow {
  id: string;
  analysis_id: string;
  content: string;
  subject: string | null;
  language: string;
  status: string;
  approved_at: string | null;
  rejected_at: string | null;
  sent_at: string | null;
  reject_reason: string | null;
  delete_after: string | null;
  created_at: string;
  updated_at: string;
}

export function mapDraftRow(row: DraftRow): Draft {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    content: row.content,
    subject: row.subject,
    language: row.language,
    status: row.status as Draft['status'],
    approvedAt: toDate(row.approved_at),
    rejectedAt: toDate(row.rejected_at),
    sentAt: toDate(row.sent_at),
    rejectReason: row.reject_reason,
    deleteAfter: toDate(row.delete_after),
    createdAt: toDateRequired(row.created_at),
    updatedAt: toDateRequired(row.updated_at),
  };
}

export function draftToRow(input: Partial<Omit<Draft, 'id' | 'createdAt' | 'updatedAt'>>) {
  const row: Record<string, unknown> = {};
  if (input.analysisId !== undefined) row.analysis_id = input.analysisId;
  if (input.content !== undefined) row.content = input.content;
  if (input.subject !== undefined) row.subject = input.subject;
  if (input.language !== undefined) row.language = input.language;
  if (input.status !== undefined) row.status = input.status;
  if (input.approvedAt !== undefined) row.approved_at = fromDate(input.approvedAt);
  if (input.rejectedAt !== undefined) row.rejected_at = fromDate(input.rejectedAt);
  if (input.sentAt !== undefined) row.sent_at = fromDate(input.sentAt);
  if (input.rejectReason !== undefined) row.reject_reason = input.rejectReason;
  if (input.deleteAfter !== undefined) row.delete_after = fromDate(input.deleteAfter);
  return row;
}

// ── reminders ────────────────────────────────────────────────────────────────

export interface ReminderRow {
  id: string;
  user_id: string;
  analysis_id: string | null;
  kind: string;
  due_date: string;
  message: string | null;
  status: string;
  sent_at: string | null;
  delete_after: string | null;
  created_at: string;
  updated_at: string;
}

export function mapReminderRow(row: ReminderRow): Reminder {
  return {
    id: row.id,
    userId: row.user_id,
    analysisId: row.analysis_id,
    kind: row.kind as Reminder['kind'],
    dueDate: toDateRequired(row.due_date),
    message: row.message,
    status: row.status as Reminder['status'],
    sentAt: toDate(row.sent_at),
    deleteAfter: toDate(row.delete_after),
    createdAt: toDateRequired(row.created_at),
    updatedAt: toDateRequired(row.updated_at),
  };
}

export function reminderToRow(
  input: Partial<Omit<Reminder, 'id' | 'createdAt' | 'updatedAt'>>,
) {
  const row: Record<string, unknown> = {};
  if (input.userId !== undefined) row.user_id = input.userId;
  if (input.analysisId !== undefined) row.analysis_id = input.analysisId;
  if (input.kind !== undefined) row.kind = input.kind;
  if (input.dueDate !== undefined) row.due_date = fromDate(input.dueDate);
  if (input.message !== undefined) row.message = input.message;
  if (input.status !== undefined) row.status = input.status;
  if (input.sentAt !== undefined) row.sent_at = fromDate(input.sentAt);
  if (input.deleteAfter !== undefined) row.delete_after = fromDate(input.deleteAfter);
  return row;
}

// ── pii_vault ────────────────────────────────────────────────────────────────

export interface PiiVaultRow {
  id: string;
  user_id: string | null;
  document_id: string | null;
  token: string;
  entity_type: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_version: number;
  delete_after: string | null;
  created_at: string;
}

export function mapPiiVaultRow(row: PiiVaultRow): SealedPiiRecordRow {
  return {
    id: row.id,
    userId: row.user_id ?? undefined,
    documentId: row.document_id ?? undefined,
    token: row.token,
    entityType: row.entity_type as SealedPiiRecordRow['entityType'],
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.auth_tag,
    keyVersion: row.key_version,
    deleteAfter: toDate(row.delete_after) ?? undefined,
    createdAt: toDateRequired(row.created_at),
  };
}

export function piiVaultToRow(record: {
  userId?: string;
  documentId?: string;
  token?: string;
  entityType?: string;
  ciphertext?: string;
  iv?: string;
  authTag?: string;
  keyVersion?: number;
  deleteAfter?: Date;
}) {
  const row: Record<string, unknown> = {};
  if (record.userId !== undefined) row.user_id = record.userId;
  if (record.documentId !== undefined) row.document_id = record.documentId;
  if (record.token !== undefined) row.token = record.token;
  if (record.entityType !== undefined) row.entity_type = record.entityType;
  if (record.ciphertext !== undefined) row.ciphertext = record.ciphertext;
  if (record.iv !== undefined) row.iv = record.iv;
  if (record.authTag !== undefined) row.auth_tag = record.authTag;
  if (record.keyVersion !== undefined) row.key_version = record.keyVersion;
  if (record.deleteAfter !== undefined) row.delete_after = fromDate(record.deleteAfter);
  return row;
}

// ── audit_log ────────────────────────────────────────────────────────────────

export interface AuditRow {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export function mapAuditRow(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    userId: row.user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    detail: row.detail ?? {},
    createdAt: toDateRequired(row.created_at),
  };
}

export function auditToRow(input: Partial<Omit<AuditEntry, 'id' | 'createdAt'>>) {
  const row: Record<string, unknown> = {};
  if (input.userId !== undefined) row.user_id = input.userId;
  if (input.action !== undefined) row.action = input.action;
  if (input.entityType !== undefined) row.entity_type = input.entityType;
  if (input.entityId !== undefined) row.entity_id = input.entityId;
  if (input.detail !== undefined) row.detail = input.detail;
  return row;
}

// ── appointment_watches ──────────────────────────────────────────────────────

export interface AppointmentWatchRow {
  id: string;
  user_id: string;
  authority_key: string;
  target_url: string;
  service_label: string | null;
  status: string;
  last_checked_at: string | null;
  last_result: Record<string, unknown> | null;
  found_at: string | null;
  check_count: number;
  error_message: string | null;
  delete_after: string | null;
  created_at: string;
  updated_at: string;
}

export function mapAppointmentWatchRow(row: AppointmentWatchRow): AppointmentWatch {
  return {
    id: row.id,
    userId: row.user_id,
    authorityKey: row.authority_key,
    targetUrl: row.target_url,
    serviceLabel: row.service_label,
    status: row.status as AppointmentWatch['status'],
    lastCheckedAt: toDate(row.last_checked_at),
    lastResult: row.last_result ?? {},
    foundAt: toDate(row.found_at),
    checkCount: row.check_count,
    errorMessage: row.error_message,
    deleteAfter: toDate(row.delete_after),
    createdAt: toDateRequired(row.created_at),
    updatedAt: toDateRequired(row.updated_at),
  };
}

export function appointmentWatchToRow(
  input: Partial<Omit<AppointmentWatch, 'id' | 'createdAt' | 'updatedAt'>>,
) {
  const row: Record<string, unknown> = {};
  if (input.userId !== undefined) row.user_id = input.userId;
  if (input.authorityKey !== undefined) row.authority_key = input.authorityKey;
  if (input.targetUrl !== undefined) row.target_url = input.targetUrl;
  if (input.serviceLabel !== undefined) row.service_label = input.serviceLabel;
  if (input.status !== undefined) row.status = input.status;
  if (input.lastCheckedAt !== undefined) {
    row.last_checked_at = fromDate(input.lastCheckedAt);
  }
  if (input.lastResult !== undefined) row.last_result = input.lastResult;
  if (input.foundAt !== undefined) row.found_at = fromDate(input.foundAt);
  if (input.checkCount !== undefined) row.check_count = input.checkCount;
  if (input.errorMessage !== undefined) row.error_message = input.errorMessage;
  if (input.deleteAfter !== undefined) row.delete_after = fromDate(input.deleteAfter);
  return row;
}
