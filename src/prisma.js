// ============================================
// src/prisma.js — Conexão única + safeQuery + safeTx + warmup
// Triad Academia · v3.2
//
// Mudanças v3.2 (sobre v3.1):
//   - connection_limit default 1 → 3 (evita serialização total)
//   - safeQueryRetries default 1 → 2 (retry real)
//   - safeQueryBaseMs default 500 → 300 (backoff mais ágil)
//   - RETRYABLE_CODES expandido (P1000, P1010, P1011, P2028)
//   - NOVO safeTx(): retry + warm-up para $transaction
//   - fastWarmup com fallback para warmupDb lento (1×)
//   - Circuit breaker leve (isDbHealthy)
//   - buildDatabaseUrl respeita params já presentes na URL
//   - disconnect idempotente
//   - prismaConfig expõe effectiveUrl mascarada
//   - recordFailure chama log.alert (email + DB) quando abre circuit breaker
//
// Uso:
//   import { safeQuery, safeTx, warmupDb, disconnect, prisma, isDbHealthy, prismaConfig } from './prisma.js';
// ============================================

import { PrismaClient } from '@prisma/client';
import { log as rootLog } from './logs.js';

const log = rootLog.child('[prisma.js] ');
log.info('carregando...');

// ============================================
// 1. CONFIGURAÇÕES (via env, com defaults seguros)
// ============================================
const CONFIG = {
  // 3 conexões absorvem concorrência sem estourar o pooler do Prisma Postgres.
  // 1 conexão serializa TUDO — foi a causa raiz de requests "travando".
  connectionLimit: process.env.PRISMA_CONNECTION_LIMIT || '3',
  poolTimeout: process.env.PRISMA_POOL_TIMEOUT || '30',
  connectTimeout: process.env.PRISMA_CONNECT_TIMEOUT || '30',
  // 2 tentativas = 1 tentativa + 1 retry real. 1 = sem retry.
  safeQueryRetries: Number(process.env.SAFE_QUERY_RETRIES || 2),
  // Backoff base 300ms → 300ms, 600ms. Ágil o suficiente para blips.
  safeQueryBaseMs: Number(process.env.SAFE_QUERY_BASE_MS || 300),
  warmupTimeoutMs: Number(process.env.SAFE_QUERY_WARMUP_MS || 800),
  // Quantas falhas consecutivas antes de marcar DB como unhealthy
  unhealthyAfter: Number(process.env.SAFE_QUERY_UNHEALTHY_AFTER || 3),
  // Quanto tempo (ms) considerar unhealthy antes de tentar de novo
  unhealthyCooldownMs: Number(process.env.SAFE_QUERY_UNHEALTHY_COOLDOWN_MS || 5000),
  logQueries: process.env.PRISMA_LOG === '1',
};

// ============================================
// 2. AJUSTAR A URL DO BANCO
// ============================================
function maskUrl(rawUrl) {
  if (!rawUrl) return '(vazia)';
  return String(rawUrl).replace(/(:\/\/[^:]+:)[^@]+@/, '$1****@');
}

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

  // Respeita o que já vier na URL (não sobrescreve)
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', CONFIG.connectionLimit);
  }
  if (!url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', CONFIG.poolTimeout);
  }
  if (!url.searchParams.has('connect_timeout')) {
    url.searchParams.set('connect_timeout', CONFIG.connectTimeout);
  }
  // pgbouncer=true: habilita modo compatível com pooler externo.
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
// 5. CIRCUIT BREAKER LEVE
// ============================================
let consecutiveFailures = 0;
let unhealthyUntil = 0;

export function isDbHealthy() {
  return Date.now() >= unhealthyUntil;
}

function recordSuccess() {
  consecutiveFailures = 0;
  unhealthyUntil = 0;
}

function recordFailure() {
  consecutiveFailures++;
  if (consecutiveFailures >= CONFIG.unhealthyAfter) {
    unhealthyUntil = Date.now() + CONFIG.unhealthyCooldownMs;
    // v3.2: log.alert dispara email + DB (via logs.js)
    log.alert('circuit breaker aberto', {
      consecutiveFailures,
      cooldownMs: CONFIG.unhealthyCooldownMs,
      unhealthyUntil: new Date(unhealthyUntil).toISOString(),
    });
  }
}

// ============================================
// 6. WARM-UP RÁPIDO (v3.2)
// ============================================
async function fastWarmup() {
  if (warmupDone) return;

  // Tentativa 1: rápida (800ms)
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
    log.debug('warmup rápido ok', { ms: Date.now() - t0 });
    return;
  } catch (err) {
    clearTimeout(timer);
    log.debug('warmup rápido falhou, tentando lento (1×)', {
      ms: Date.now() - t0,
      msg: err.message,
    });
  }

  // Tentativa 2: lenta (até 3.2s) — só uma vez por instância
  const t1 = Date.now();
  const slowTimeoutMs = Math.max(CONFIG.warmupTimeoutMs * 4, 3200);
  try {
    let timer2;
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer2 = setTimeout(
          () => reject(new Error(`warmup lento timeout após ${slowTimeoutMs}ms`)),
          slowTimeoutMs
        );
      }),
    ]);
    clearTimeout(timer2);
    warmupDone = true;
    persistState();
    log.info('warmup lento ok', { ms: Date.now() - t1 });
  } catch (err) {
    log.warn('warmup lento também falhou (segue para a query real)', {
      ms: Date.now() - t1,
      msg: err.message,
    });
  }
}

// ============================================
// 7. safeQuery (v3.2)
// ============================================
const RETRYABLE_CODES = new Set([
  'P1000', // auth failed
  'P1001', // can't reach server
  'P1002', // server reached, timeout
  'P1008', // operation timeout
  'P1010', // user access denied
  'P1011', // TLS error
  'P1017', // server closed connection
  'P2024', // pool timeout
  'P2028', // transaction API error / timeout
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function safeQuery(fn, op = 'unknown') {
  const totalStart = Date.now();
  let lastErr;

  if (isFirstQuery) {
    await fastWarmup();
  }

  for (let attempt = 1; attempt <= CONFIG.safeQueryRetries; attempt++) {
    const attemptStart = Date.now();

    try {
      const result = await fn();
      markQueryExecuted();
      recordSuccess();

      const attemptMs = Date.now() - attemptStart;
      const totalMs = Date.now() - totalStart;

      if (attempt > 1) {
        log.info('safeQuery ok após retry', { op, attempt, attemptMs, totalMs });
      } else if (process.env.NODE_ENV === 'development') {
        log.debug('safeQuery ok', { op, attemptMs, totalMs });
      }
      return result;
    } catch (err) {
      lastErr = err;
      const code = err?.code;
      const retryable = RETRYABLE_CODES.has(code);
      const attemptMs = Date.now() - attemptStart;

      if (retryable) {
        recordFailure();
      }

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
// 8. safeTx (v3.2)
// ============================================
export async function safeTx(fn, op = 'unknown', opts = {}) {
  const txOpts = {
    timeout: opts.timeout ?? 15000,
    maxWait: opts.maxWait ?? 5000,
    ...(opts.isolationLevel && { isolationLevel: opts.isolationLevel }),
  };

  return safeQuery(
    () => prisma.$transaction(fn, txOpts),
    op
  );
}

// ============================================
// 9. warmupDb (para diagnóstico manual — /health/warm)
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
    recordSuccess();
    log.debug('warmupDb ok', { ms });
    return { ok: true, ms, error: null };
  } catch (err) {
    clearTimeout(timer);
    const ms = Date.now() - t0;
    recordFailure();
    log.warn(`warmupDb falhou (${ms}ms): ${err.message}`);
    return { ok: false, ms, error: err.message };
  }
}

// ============================================
// 10. disconnect (graceful shutdown, idempotente)
// ============================================
let disconnected = false;
export async function disconnect() {
  if (disconnected) {
    log.debug('disconnect ignorado (já desconectado)');
    return;
  }
  disconnected = true;
  try {
    await prisma.$disconnect();
    log.info('Prisma desconectado');
  } catch (err) {
    log.error(`Falha ao desconectar Prisma: ${err.message}`);
  }
}

// ============================================
// 11. EXPORTS
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
  unhealthyAfter: CONFIG.unhealthyAfter,
  unhealthyCooldownMs: CONFIG.unhealthyCooldownMs,
  effectiveUrl: maskUrl(finalUrl),
};

log.info('configurações aplicadas', {
  connection_limit: CONFIG.connectionLimit,
  pool_timeout: CONFIG.poolTimeout,
  connect_timeout: CONFIG.connectTimeout,
  safe_query_retries: CONFIG.safeQueryRetries,
  safe_query_base_ms: CONFIG.safeQueryBaseMs,
  warmup_ms: CONFIG.warmupTimeoutMs,
  unhealthy_after: CONFIG.unhealthyAfter,
  unhealthy_cooldown_ms: CONFIG.unhealthyCooldownMs,
  url: maskUrl(finalUrl),
});

log.info('carregado com sucesso');