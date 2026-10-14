// ============================================
// src/prisma.js — Conexão única + safeQuery + warmup
// Triad Academia · v3.1
//
// Mudanças v3.1 (sobre v3.0):
//   - warmupDb agora é chamado automaticamente na 1ª query (800ms)
//     em vez de esperar o timeout de 5s do pooler
//   - SAFE_QUERY_RETRIES default caiu de 3 para 1
//   - PRISMA_POOL_TIMEOUT default subiu de 20 para 30
//   - PRISMA_CONNECT_TIMEOUT default subiu de 10 para 30
//   - Detecção explícita de cold start + log
//   - Log de duração total do safeQuery
//
// Impacto esperado:
//   Antes: /auth/login = 14850ms em ciclos alternados (timeout × 3)
//   Depois: /auth/login = ~1500-2000ms (warm-up + 1 query)
//
// Uso:
//   import { safeQuery, warmupDb, disconnect, prisma } from './prisma.js';
// ============================================

import { PrismaClient } from '@prisma/client';
import { log as rootLog } from './logs.js';

const log = rootLog.child('[prisma.js] ');
log.info('carregando...');

// ============================================
// 1. CONFIGURAÇÕES (via env, com defaults seguros)
// ============================================
const CONFIG = {
  connectionLimit: process.env.PRISMA_CONNECTION_LIMIT || '1',
  poolTimeout: process.env.PRISMA_POOL_TIMEOUT || '30',      // era 20
  connectTimeout: process.env.PRISMA_CONNECT_TIMEOUT || '30', // era 10
  safeQueryRetries: Number(process.env.SAFE_QUERY_RETRIES || 1), // era 3
  safeQueryBaseMs: Number(process.env.SAFE_QUERY_BASE_MS || 500), // era 300
  warmupTimeoutMs: Number(process.env.SAFE_QUERY_WARMUP_MS || 800),
  logQueries: process.env.PRISMA_LOG === '1',
};

// ============================================
// 2. AJUSTAR A URL DO BANCO
// ============================================
function buildDatabaseUrl(rawUrl) {
  if (!rawUrl) {
    log.warn('DATABASE_URL não definida — Prisma vai falhar em runtime.');
    return rawUrl;
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    log.warn('DATABASE_URL não é URL padrão — usando como veio.');
    return rawUrl;
  }

  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', CONFIG.connectionLimit);
  }
  if (!url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', CONFIG.poolTimeout);
  }
  if (!url.searchParams.has('connect_timeout')) {
    url.searchParams.set('connect_timeout', CONFIG.connectTimeout);
  }
  if (!url.searchParams.has('pgbouncer')) {
    url.searchParams.set('pgbouncer', 'true');
  }

  return url.toString();
}

const finalUrl = buildDatabaseUrl(process.env.DATABASE_URL);

// ============================================
// 3. SINGLETON GLOBAL
// ============================================
const GLOBAL_KEY = '__triadPrisma';

let prisma;
let bootedAt = Date.now();
let isFirstQuery = true;
let warmupDone = false;

if (globalThis[GLOBAL_KEY]) {
  prisma = globalThis[GLOBAL_KEY].prisma;
  bootedAt = globalThis[GLOBAL_KEY].bootedAt;
  isFirstQuery = globalThis[GLOBAL_KEY].isFirstQuery;
  warmupDone = globalThis[GLOBAL_KEY].warmupDone ?? false;
  log.info(`reutilizando PrismaClient global (boot há ${Date.now() - bootedAt}ms)`);
} else {
  prisma = new PrismaClient({
    datasources: { db: { url: finalUrl } },
    log: CONFIG.logQueries
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ]
      : [],
  });

  if (CONFIG.logQueries) {
    prisma.$on('query', (e) => {
      log.debug('prisma.query', {
        ms: e.duration,
        query: e.query?.slice(0, 200),
      });
    });
    prisma.$on('warn', (e) => log.warn(`prisma.warn: ${e.message}`));
    prisma.$on('error', (e) => log.error(`prisma.error: ${e.message}`));
  }

  globalThis[GLOBAL_KEY] = { prisma, bootedAt, isFirstQuery, warmupDone };
  log.info('PrismaClient criado (primeira vez neste processo)');
}

// Persiste estado atualizado no global
function persistState() {
  if (globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY].isFirstQuery = isFirstQuery;
    globalThis[GLOBAL_KEY].warmupDone = warmupDone;
  }
}

// ============================================
// 4. COLD START DETECTION
// ============================================
function markQueryExecuted() {
  if (isFirstQuery) {
    isFirstQuery = false;
    persistState();
    const ms = Date.now() - bootedAt;
    log.warn(`cold start detectado — primeira query ${ms}ms após boot da lambda`);
  }
}

// ============================================
// 5. WARM-UP RÁPIDO (v3.1)
// ============================================
// Executa SELECT 1 com timeout curto (800ms).
// Silencioso: se falhar, segue em frente sem bloquear.
// Roda apenas UMA vez por instância da lambda.
//
// Por que 800ms:
//   - O handshake real do pooler do Prisma Postgres leva ~5s.
//   - 800ms é tempo suficiente para "acordar" a conexão TCP
//     sem pagar os 5s completos do timeout do pooler.
//   - Se falhar, a query real vai retentar (com backoff).
//
// Não gasta cota significativa: 1 SELECT 1 por instância.
// ============================================
async function fastWarmup() {
  if (warmupDone) return;

  const t0 = Date.now();
  let timer;

  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`warmup rápido timeout após ${CONFIG.warmupTimeoutMs}ms`)),
          CONFIG.warmupTimeoutMs
        );
      }),
    ]);

    clearTimeout(timer);
    warmupDone = true;
    persistState();
    const ms = Date.now() - t0;
    log.debug('warmup rápido ok', { ms });
  } catch (err) {
    clearTimeout(timer);
    // Silencioso: warmup rápido não é obrigatório
    const ms = Date.now() - t0;
    if (process.env.NODE_ENV === 'development') {
      log.debug('warmup rápido falhou (segue sem ele)', { ms, msg: err.message });
    }
  }
}

// ============================================
// 6. safeQuery (v3.1)
// ============================================
// Mudanças sobre v3.0:
//   - Warm-up rápido antes da 1ª query da instância
//   - Retries default = 1 (era 3)
//   - Base de backoff default = 500ms (era 300ms)
//   - Log de duração total (warmup + query)
//
// Uso:
//   const users = await safeQuery(
//     () => prisma.user.findMany(),
//     'users.list'
//   );
//
// Config (env):
//   SAFE_QUERY_RETRIES=1        (tentativas totais)
//   SAFE_QUERY_BASE_MS=500      (base do backoff exponencial)
//   SAFE_QUERY_WARMUP_MS=800    (timeout do warm-up rápido)
// ============================================
const RETRYABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function safeQuery(fn, op = 'unknown') {
  const totalStart = Date.now();
  let lastErr;

  // Warm-up rápido na primeira query da instância
  if (isFirstQuery) {
    await fastWarmup();
  }

  for (let attempt = 1; attempt <= CONFIG.safeQueryRetries; attempt++) {
    const attemptStart = Date.now();

    try {
      const result = await fn();
      markQueryExecuted();

      const attemptMs = Date.now() - attemptStart;
      const totalMs = Date.now() - totalStart;

      if (attempt > 1) {
        log.info('safeQuery ok após retry', {
          op,
          attempt,
          attemptMs,
          totalMs,
        });
      } else {
        log.debug('safeQuery ok', { op, attemptMs, totalMs });
      }
      return result;
    } catch (err) {
      lastErr = err;
      const code = err?.code;
      const retryable = RETRYABLE_CODES.has(code);
      const attemptMs = Date.now() - attemptStart;

      if (!retryable || attempt === CONFIG.safeQueryRetries) {
        log.error('safeQuery falhou', {
          op,
          attempt,
          attemptMs,
          totalMs: Date.now() - totalStart,
          code,
          msg: err.message,
          retryable,
        });
        throw err;
      }

      const backoff = CONFIG.safeQueryBaseMs * Math.pow(2, attempt - 1);
      log.warn('safeQuery retry', {
        op,
        attempt,
        attemptMs,
        code,
        backoffMs: backoff,
        msg: err.message,
      });
      await sleep(backoff);
    }
  }

  throw lastErr;
}

// ============================================
// 7. warmupDb (para diagnóstico manual — /health/warm)
// ============================================
// Uso APENAS pelo /health/warm para diagnóstico.
// O cron NÃO deve usar isso.
// ============================================
export async function warmupDb(timeoutMs = 5000) {
  const t0 = Date.now();
  let timer;

  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`warmup timeout após ${timeoutMs}ms`)),
        timeoutMs
      );
    });

    await Promise.race([prisma.$queryRaw`SELECT 1`, timeoutPromise]);
    clearTimeout(timer);

    const ms = Date.now() - t0;
    markQueryExecuted();
    warmupDone = true;
    persistState();
    log.debug('warmupDb ok', { ms });
    return { ok: true, ms, error: null };
  } catch (err) {
    clearTimeout(timer);
    const ms = Date.now() - t0;
    log.warn(`warmupDb falhou (${ms}ms): ${err.message}`);
    return { ok: false, ms, error: err.message };
  }
}

// ============================================
// 8. disconnect (graceful shutdown)
// ============================================
export async function disconnect() {
  try {
    await prisma.$disconnect();
    log.info('Prisma desconectado');
  } catch (err) {
    log.error(`Falha ao desconectar Prisma: ${err.message}`);
  }
}

// ============================================
// 9. EXPORTS
// ============================================
export { prisma };
export const prismaBootedAt = bootedAt;
export const prismaConfig = {
  connectionLimit: CONFIG.connectionLimit,
  poolTimeout: CONFIG.poolTimeout,
  connectTimeout: CONFIG.connectTimeout,
  safeQueryRetries: CONFIG.safeQueryRetries,
  safeQueryBaseMs: CONFIG.safeQueryBaseMs,
  warmupTimeoutMs: CONFIG.warmupTimeoutMs,
};

log.info('configurações aplicadas', {
  pool_timeout: CONFIG.poolTimeout,
  connect_timeout: CONFIG.connectTimeout,
  safe_query_retries: CONFIG.safeQueryRetries,
  warmup_ms: CONFIG.warmupTimeoutMs,
});

log.info('carregado com sucesso');