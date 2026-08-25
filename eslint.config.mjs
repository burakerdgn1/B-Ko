// ============================================================================
// BüKo — ESLint flat config (eslint 10 + typescript-eslint 8)
//
// Denetimde bulundu: `eslint` hiçbir zaman devDependency'ye eklenmemişti ve
// hiçbir config dosyası yoktu — `npm run lint` yıllardır çalışmıyordu.
// Bu dosya projeyi ilk kez gerçek statik analizden geçiriyor.
//
// Yaklaşım: TypeScript recommended + type-checked kural setleri (tsconfig'e
// bağlı gerçek tip bilgisiyle çalışan kurallar), ama `strict`/`stylistic`
// setleri DEĞİL — kod tabanı ~130 dosya ve şu ana kadar HİÇ lint edilmemiş,
// çok daha agresif bir set yüzlerce kozmetik hataya yol açardı. Prettier zaten
// biçimlendirmeyi hallediyor; `eslint-config-prettier` çakışan stil
// kurallarını kapatıyor.
// ============================================================================
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'test-fixtures/**',
      '*.traineddata',
    ],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Birden fazla tsconfig: `scripts/**` bilinçli olarak kök
        // `tsconfig.json`'ın include'unda değil (D-048 — `nest build`
        // çıktısını bozar). Tip bilgisiyle çalışan kuralların scripts/ ve
        // jest.setup.ts'i de görebilmesi için ikinci proje eklendi.
        project: ['./tsconfig.json', './tsconfig.scripts.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    rules: {
      // `no-undef` TypeScript'in kendisi tarafından zaten kapsanıyor (tsc
      // bunu derleme hatası olarak yakalar) ve ambient tip bildirimleriyle
      // (ör. @types/jest'in `describe`/`it`/`expect`'i) yanlış pozitif
      // üretir. typescript-eslint projesinin resmi önerisi bu kuralı TS
      // dosyalarında kapatmaktır.
      'no-undef': 'off',

      // Kod tabanında `_`-önekli parametreler bilinçli "kullanılmıyor"
      // işaretidir (ör. Nest lifecycle hook imzaları); bunları hataya
      // çevirmeden izin ver.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ── Repository/Adapter arayüz-uyumluluğu: kasıtlı olarak sync gövdeli
  // async metotlar ────────────────────────────────────────────────────────
  // `@typescript-eslint/require-await` bu üç yerde SİSTEMATİK false-positive
  // üretiyor: in-memory repository'ler (`persistence/memory/**`) ve mock
  // kanal adaptörü (`channels/mock/mock.adapter.ts`), gerçek (Supabase/
  // Telegram) implementasyonlarla AYNI async arayüzü uygulamak ZORUNDA —
  // ama kendi gövdeleri I/O yapmadığı (bellek/dizi işlemi olduğu) için hiç
  // `await` içermiyor. Bu bir hata değil, kasıtlı bir mimari kısıt: arayüz
  // sürücüden bağımsız olmalı ki `persistence.module.ts` DB_DRIVER'a göre
  // ikisi arasında sessizce geçiş yapabilsin. `audit.supabase.repository.ts`
  // içindeki tek satırlık `purgeExpired` stub'ı da aynı nedenle (şemada
  // `delete_after` yok, bkz. dosyadaki not) burada.
  {
    files: [
      'src/modules/persistence/memory/**/*.ts',
      'src/modules/persistence/supabase/**/*.ts',
      'src/modules/channels/mock/mock.adapter.ts',
    ],
    ignores: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },

  // ── Test dosyaları: mock/test-double'larla çalışırken tip-güvenliği ──────
  // Jest testleri gerçek dünyadaki gevşek tipli SDK'ları (grammy'nin Telegram
  // Bot API'si, Supabase client'ı, Anthropic SDK'sı) taklit eden elle
  // yazılmış nesnelerle çalışıyor; bunlar doğası gereği `any` sızdırıyor.
  // `no-unsafe-*` ailesini burada zorlamak üretim kodunu KORUMAZ (test kodu
  // deploy edilmiyor) ve yüzlerce fixture'ı tip-güvenli hale getirmek bu
  // denetimin kapsamının çok ötesinde bir efor gerektirir. `unbound-method`
  // de aynı nedenle: `expect(obj.method).toHaveBeenCalledWith(...)` deseni
  // jest'in spy mekanizmasıyla güvenli ama kural bunu bilmiyor. `require-await`
  // ve `no-require-imports` testlerdeki `jest.mock`/senkron mock helper'ları
  // için aynı şekilde gürültücü.
  {
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // ── D-043 tekrarını önle: scripts/ doğrudan NestFactory boot etmesin ──────
  // `scripts/script-context.ts` içindeki `bootScriptContext()` DIŞINDA hiçbir
  // script `@nestjs/core`'dan `NestFactory` import etmemeli. Bir script
  // yanlışlıkla tüm `AppModule`'ü boot edip üretimdeki Telegram webhook'unu
  // sildiği gerçek bir olaydan sonra eklendi (bkz. DECISIONS.md D-043,
  // scripts/script-context.ts üstündeki açıklama).
  {
    files: ['scripts/**/*.ts'],
    ignores: ['scripts/script-context.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nestjs/core',
              message:
                "Script'ler NestFactory'yi doğrudan kullanmamalı — üretim yan " +
                "etkilerinden (webhook/scheduler) izole olan " +
                "scripts/script-context.ts'teki bootScriptContext()'i kullanın (D-043).",
            },
          ],
        },
      ],
    },
  },

  // Prettier ile çakışan stil kurallarını kapat (Prettier zaten biçimlendiriyor).
  eslintConfigPrettier,
);
