# ============================================================================
# BüKo — Dockerfile (çok aşamalı build)
#
# Aşamalar:
#   deps      → yalnızca üretim (prod) node_modules
#   builder   → dev bağımlılıklarla TypeScript derleme (nest build → dist/)
#   runtime   → VARSAYILAN hedef: küçük Alpine imajı, root olmayan kullanıcı,
#               dumb-init ile sinyal yönetimi (Nest enableShutdownHooks() ile birlikte
#               SIGTERM'de düzgün kapanış sağlar).
#   with-browsers → OPSİYONEL hedef: Playwright/watcher modülünü gerçekten
#               çalıştırmak isteyenler için Debian tabanlı, Chromium önceden kurulu imaj.
#
# ── Playwright / Alpine kararı (bkz. docs/DEPLOYMENT.md) ──────────────────────
# `playwright` package.json'da optionalDependencies altında (bkz. package.json).
# Playwright'ın indirdiği Chromium/WebKit/Firefox binary'leri glibc'ye bağımlıdır ve
# Alpine'in musl libc'si üzerinde resmi olarak desteklenmez (Microsoft yalnızca
# Debian/Ubuntu tabanlı imajlar için resmi Playwright Docker imajı yayınlıyor).
# Bu yüzden VARSAYILAN üretim imajı (runtime hedefi):
#   1. `npm ci --omit=dev --ignore-scripts` kullanır → playwright'ın postinstall'ı
#      (browser indirme) hiç tetiklenmez, imaj küçük ve hızlı kalır.
#   2. Tarayıcı içermez — WatcherService (Playwright PoC) bu imajda ÇALIŞMAZ.
# Randevu izleme (watcher) özelliğini gerçekten kullanmak isteyenler
# `--target with-browsers` ile ayrı, Debian tabanlı bir imaj üretebilir.
# Bu ayrım imaj boyutunu (~180MB → ~1.5GB+) ana kullanım senaryosundan (Telegram
# bot + LLM analizi) uzak tutar; watcher opsiyonel bir PoC modülüdür (ARCHITECTURE.md §3).
# ============================================================================

# ---- Stage 1: deps — yalnızca üretim bağımlılıkları ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: playwright postinstall (browser indirme) tetiklenmesin.
# --omit=dev: devDependencies (jest, ts-node, nest-cli vb.) imaja girmesin.
RUN npm ci --omit=dev --ignore-scripts

# ---- Stage 2: builder — TypeScript → JavaScript derleme ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- Stage 3: runtime — VARSAYILAN üretim imajı (tarayıcısız, Alpine, küçük) ----
FROM node:22-alpine AS runtime
# dumb-init: PID 1 olarak SIGTERM/SIGINT'i doğru şekilde Node sürecine iletir
# (Nest'in enableShutdownHooks() ile düzgün graceful shutdown yapabilmesi için gerekli;
# çıplak `node` PID 1 olarak sinyalleri doğru forward etmez).
RUN apk add --no-cache dumb-init \
    && addgroup -S bueko \
    && adduser -S bueko -G bueko
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
USER bueko
EXPOSE 3000
# Not: Uygulamada henüz özel bir /health endpoint'i yok (src/app.module.ts'de
# controller tanımlı değil). Bu healthcheck, sürecin HTTP portunu dinlediğini
# doğrular (5xx veya bağlantı hatası dışındaki her yanıt "sağlıklı" sayılır).
# İleride dedike bir /health endpoint'i eklenirse bu komut sadeleştirilebilir.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/',timeout:4000},(r)=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]

# ---- Stage 4 (opsiyonel hedef): with-browsers — Playwright watcher için ----
# `docker build --target with-browsers -t bueko:with-browsers .`
# Microsoft'un resmi Playwright imajını temel alır (Debian/Ubuntu, glibc; Chromium
# ve gerekli sistem kütüphaneleri önceden kurulu). Yalnızca WatcherService'i
# (randevu izleme PoC) gerçekten çalıştırmak isteyenler için.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy AS with-browsers
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY package.json package-lock.json ./
# Burada --ignore-scripts KULLANMIYORUZ: playwright'ın postinstall'ı bu imajda
# zaten önceden kurulu tarayıcılarla uyumlu, ekstra indirme yapmaz/yapsa da
# imaj zaten büyük ve tarayıcı barındırmak bu hedefin amacı.
RUN npm ci --omit=dev
# Root olmayan kullanıcı: temel imajda hazır bir kullanıcı olduğu varsayılmaz,
# burada kendi kullanıcımızı garantiye alıyoruz.
RUN groupadd -r bueko 2>/dev/null || true \
    && useradd -r -g bueko -m -d /home/bueko bueko 2>/dev/null || true \
    && chown -R bueko:bueko /app
USER bueko
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/',timeout:4000},(r)=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/main.js"]
