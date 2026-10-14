// ============================================
// src/prisma.js — Conexão única + safeQuery + warmup
// Triad Academia · v3.0
// ============================================

import { PrismaClient } from '@prisma/client';
import { log as rootLog } from './logs.js';

const log = rootLog.child('[prisma.js] ');
log.info('carregando...');

function buildDatabaseUrl(rawUrl) {
  if (!rawUrl) {
    log.warn('DATABASE_URL não definida — Prisma vai falhar em runtime.');
    return rawUrl;
  }
  let url;
  try { url = new URL(rawUrl); } catch {
    log.warn('DATABASE_URL não é URL padrão — usando como veio.');
    return rawUrl;
  }
  const connectionLimit = process.env.PRISMA_CONNECTION_LIMIT || '1';
  const poolTimeout = process.env.PRISMA_POOL_TIMEOUT || '20';
  const connectTimeout = process.env.PRISMA_CONNECT_TIMEOUT || '10';
  if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', connectionLimit);
  if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', poolTimeout);
  if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', connectTimeout);
  if (!url.searchParams.has('pgbouncer')) url.searchParams.set('pgbouncer', 'true');
  return url.toString();
}

const finalUrl = buildDatabaseUrl(process.env.DATABASE_URL);

const GLOBAL_KEY = '__triadPrisma';

let prisma;
let bootedAt = Date.now();
let isFirstQuery = true;

if (globalThis[GLOBAL_KEY]) {
  prisma = globalThis[GLOBAL_KEY].prisma;
  bootedAt = globalThis[GLOBAL_KEY].bootedAt;
  isFirstQuery = globalThis[GLOBAL_KEY].isFirstQuery;
  log.info(`reutilizando PrismaClient global (boot há ${Date.now() - bootedAt}ms)`);
} else {
  prisma = new PrismaClient({
    datasources: { db: { url: finalUrl } },
    log: process.env.PRISMA_LOG === '1'
      ? [{ emit: 'event', level: 'query' }, { emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
      : [],
  });
  if (process.env.PRISMA_LOG === '1') {
    prisma.$on('query', (e) => log.debug('prisma.query', { ms: e.duration, query: e.query?.slice(0, 200) }));
    prisma.$on('warn', (e) => log.warn(`prisma.warn: ${e.message}`));
    prisma.$on('error', (e) => log.error(`prisma.error: ${e.message}`));
  }
  globalThis[GLOBAL_KEY] = { prisma, bootedAt, isFirstQuery };
  log.info('PrismaClient criado (primeira vez neste processo)');
}

function markQueryExecuted() {
  if (isFirstQuery) {
    isFirstQuery = false;
    globalThis[GLOBAL_KEY].isFirstQuery = false;
    const ms = Date.now() - bootedAt;
    log.warn(`cold start detectado — primeira query ${ms}ms após boot da lambda`);
  }
}

const RETRIES = Number(process.env.SAFE_QUERY_RETRIES || 3);
const BASE_MS = Number(process.env.SAFE_QUERY_BASE_MS || 300);
const RETRYABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export async function safeQuery(fn, op = 'unknown') {
  let lastErr;
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const result = await fn();
      markQueryExecuted();
      const elapsed = Date.now() - startedAt;
      if (attempt > 1) log.info('safeQuery ok após retry', { op, attempt, ms: elapsed });
      else log.debug('safeQuery ok', { op, ms: elapsed });
      return result;
    } catch (err) {
      lastErr = err;
      const code = err?.code;
      const retryable = RETRYABLE_CODES.has(code);
      if (!retryable || attempt === RETRIES) {
        log.error('safeQuery falhou', { op, attempt, code, msg: err.message, retryable });
        throw err;
      }
      const backoff = BASE_MS * Math.pow(2, attempt - 1);
      log.warn('safeQuery retry', { op, attempt, code, backoffMs: backoff, msg: err.message });
      await sleep(backoff);
    }
  }
  throw lastErr;
}

export async function warmupDb(timeoutMs = 5000) {
  const t0 = Date.now();
  let timer;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`warmup timeout após ${timeoutMs}ms`)), timeoutMs);
    });
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeoutPromise]);
    clearTimeout(timer);
    const ms = Date.now() - t0;
    markQueryExecuted();
    log.debug('warmupDb ok', { ms });
    return { ok: true, ms, error: null };
  } catch (err) {
    clearTimeout(timer);
    const ms = Date.now() - t0;
    log.warn(`warmupDb falhou (${ms}ms): ${err.message}`);
    return { ok: false, ms, error: err.message };
  }
}

export async function disconnect() {
  try {
    await prisma.$disconnect();
    log.info('Prisma desconectado');
  } catch (err) {
    log.error(`Falha ao desconectar Prisma: ${err.message}`);
  }
}

export { prisma };
export const prismaBootedAt = bootedAt;

log.info('carregado com sucesso');