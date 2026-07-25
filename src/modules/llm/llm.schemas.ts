import { z } from 'zod';
import {
  LlmAnalysisResult,
  LlmDraftResult,
  MissingDocument,
  RiskLevel,
} from '../../common/types/domain';

/**
 * `domain.ts`'teki LLM sözleşmelerinin Zod karşılıkları.
 *
 * Bu şemalar, modelden dönen JSON'un yapısını doğrulamak için kullanılır
 * (görev talimatı §"Yapılandırılmış çıktı"). `satisfies z.ZodType<...>` ile
 * şemanın `domain.ts`'teki tipten SAPMADIĞI derleme zamanında garanti edilir —
 * iki dosya arasında sözleşme kayması (contract drift) olursa `tsc` hata verir.
 */

const riskLevelSchema = z.enum([
  'low',
  'medium',
  'high',
  'critical',
]) satisfies z.ZodType<RiskLevel>;

const missingDocumentSchema = z.object({
  label: z.string().min(1),
  explanation: z.string().optional(),
  whereToGet: z.string().optional(),
  required: z.boolean(),
}) satisfies z.ZodType<MissingDocument>;

/**
 * `[[TYPE_n]]` biçimindeki bir yer tutucu ya da `null` (D-009).
 * Not: tip olarak herhangi bir `[[TYPE_n]]` kabul edilir (yalnızca DATE değil) —
 * model başka bir alanı (ör. AKTENZEICHEN) deadline olarak seçerse bile
 * yapısal olarak geçerli sayılır; asıl doğruluk denetimi analiz-pipeline'ının
 * sorumluluğundadır, bu şema yalnızca "gerçek veri değil, token" invaryantını
 * korur.
 */
const deadlineTokenSchema = z
  .string()
  .regex(
    /^\[\[[A-Z]+_\d+\]\]$/,
    'deadlineToken "[[TYPE_n]]" biçiminde bir yer tutucu olmalı, gerçek tarih OLMAMALI',
  )
  .nullable();

export const llmAnalysisResultSchema = z.object({
  authority: z.string().nullable(),
  requestType: z.string().nullable(),
  summary: z.string().min(1),
  deadlineToken: deadlineTokenSchema,
  riskLevel: riskLevelSchema,
  missingDocuments: z.array(missingDocumentSchema),
  nextSteps: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  inScope: z.boolean(),
}) satisfies z.ZodType<LlmAnalysisResult>;

export const llmDraftResultSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  placeholders: z.array(z.string()),
}) satisfies z.ZodType<LlmDraftResult>;
