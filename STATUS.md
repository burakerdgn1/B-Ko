# STATUS.md — Şu An Neredeyiz

**Güncelleme:** Faz 3 & 5 paralel yürütülüyor
**Genel durum:** 🟢 Çekirdek ürün akışı ÇALIŞIYOR ve testli

## Tek cümlede
Bir Behördenbrief metni sisteme girdiğinde; maskeleniyor, (mock veya gerçek) Claude ile
analiz ediliyor, son tarih ve risk çıkarılıyor, eksik belgeler listeleniyor, hatırlatmalar
kuruluyor ve tüm bunlar veritabanına **ham kimlik bilgisi yazılmadan** kaydediliyor.

## Sayılar
- **298 test geçiyor** (23 suite), `tsc --noEmit` temiz, uygulama anahtarsız ayağa kalkıyor
- 5 commit, ana dal `main`

## Tamamlanan
- **Faz 0** — Scaffold, NestJS/TS/Jest, bağımlılıklar kurulu
- **Faz 1** — Veri modeli (8 tablo, onay kapısı trigger'ı, GDPR purge fonksiyonu),
  Zod config, AES-256-GCM crypto, **PII maskeleme moat'ı**, persistence (memory+supabase),
  Claude sarmalayıcı (fail-closed sızıntı denetimi), Telegram/mock kanal adaptörleri
- **Faz 2** — 8 sentetik Behördenbrief fixture'ı, **AnalysisPipeline** (çekirdek akış),
  deadline/risk çıkarımı, uçtan uca test

## Şu an paralel yürüyen (4 subagent)
- F3a Taslak mektup üretimi + insan onayı durum makinesi
- F3b Playwright randevu izleme PoC (mock sayfalarla)
- F5.1 Hatırlatma cron'u + GDPR silme cron'u
- F5.3 Docker / CI / deployment

## Sıradaki adım
1. Yukarıdaki 4 iş bitince entegrasyon + bağımsız doğrulama (ana oturum)
2. F4.1 Telegram UX akışı (onboarding → consent → belge → analiz → onay) — botu
   pipeline'a bağlayan son halka
3. F5.4 README + demo senaryosu
4. F5.5 DoD doğrulaması

## Bulunan ve kapatılan gerçek güvenlik açıkları
Subagent raporları doğrulanmadan kabul edilmedi; bağımsız testler **4 gerçek hata** buldu:
- **D-011** Türkçe `ı`/`I` case-folding → soyadları maskelenmiyordu
- **D-013** Aynı dosya numarası ikinci etiketle ("Verwendungszweck") maskesiz kalıyordu
- **D-014** Onay kapısı tek çağrıda aşılabiliyordu (insan onayı atlanabilirdi)
- **D-015** Profil yalnızca tam ad içerdiğinde "Sehr geehrter Herr Yılmaz" hitabındaki
  **soyadı maskelenmiyordu** — neredeyse her Alman resmi mektubunda gerçekleşirdi

## Engel
Yok — her şey mock/stub arkasında otonom ilerliyor.
Gerçek anahtarlar için: `MANUAL_ACTIONS_REQUIRED.md`.
