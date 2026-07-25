/**
 * `tesseract.js` için minimal ambient tip bildirimi.
 *
 * Bu paket OPSİYONEL bir bağımlılıktır ve bu depoda KURULU DEĞİLDİR (bkz.
 * `ocr.provider.ts` → `LocalOcrProvider` ve çıktı raporundaki "ana oturumun
 * yapması gerekenler" bölümü — `package.json`'a `optionalDependencies` olarak
 * eklenmesi ana oturumun sorumluluğu). Bu bildirim olmadan `tsc` derlemesi,
 * paket kurulu olmadığı için tip bulamayıp hata verir; `LocalOcrProvider` ise
 * paketi zaten LAZY `import()` ile yüklüyor ve kurulu değilse çalışma
 * zamanında anlamlı bir hata fırlatıyor (derleme zamanı ayrı, çalışma zamanı
 * ayrı bir kaygı).
 *
 * Gerçek `tesseract.js` kurulduğunda, kendi tip tanımlarını getirir ve bu
 * dosya (module augmentation için "declare module" bildirimi TypeScript'te
 * son tanım kazanır kuralına göre) sorunsuzca gölgelenir/uyumlu kalır —
 * yalnızca burada kullanılan minimal yüzeyi (`recognize`) kapsar.
 */
declare module 'tesseract.js' {
  export interface RecognizeResult {
    data: {
      text: string;
      [key: string]: unknown;
    };
  }

  export function recognize(
    image: Buffer | string,
    langs?: string,
    options?: Record<string, unknown>,
  ): Promise<RecognizeResult>;
}
