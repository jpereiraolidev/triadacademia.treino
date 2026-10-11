// ============================================
// prisma.js — Singleton do Prisma + SafeQuery com Retry & Warmup
// Triad Academia · v2.3
//
// Este arquivo:
//   1. Cria o PrismaClient (singleton)
//   2. Aplica connection_limit=1 na URL (serverless)
//   3. warmupDb() — SELECT 1 para acordar conexão
//   4. safeQuery() — wrapper com retry inteligente + backoff
//
// Retry inteligente: só re-tenta se o erro for de CONEXÃO
// (P1001, P1002, P1008, P1017, P2024) ou se a query demorou
// >8s. Erros de lógica (P2002, P2025, validação) NÃO re-tentam.
//
// Entre tentativas, força $disconnect() + $connect() para
// descartar a conexão travada (pooler zumbi).
//
// Se algo falhar aqui, procure por "[prisma.js]" no log.
// ============================================

const TAG = '[prisma.js]';
console.log(`${TAG} ▶ carregando...`);

import { PrismaClient } from '@prisma/client';

// ============================================
// 1. CONFIGURAÇÃO
// ============================================
const IS_PROD = process.env.NODE_ENV === 'production';
const IS_DEV = process.env.NODE_ENV === 'development';

const TENTATIVAS_MAX = 2;        // 1 original + 1 retry
const BACKOFF_MS = 1500;         // espera entre tentativas
const LIMIAR_LENTO_MS = 8000;    // acima disso, considera "pooler zumbi"
const TIMEOUT_TOTAL_MS = 25000;  // desiste e propaga erro

// Códigos do Prisma que indicam problema de CONEXÃO (vale retry)
const ERROS_CONEXAO = new Set([
  'P1000', // autenticação falhou
  'P1001', // não conseguiu conectar
  'P1002', // timeout ao conectar
  'P1008', // timeout na operação
  'P1010', // acesso negado
  'P1017', // conexão encerrada
  'P2024', // pool esgotado
]);

// ============================================
// 2. URL — aplica connection_limit=1 se não tiver
// ============================================
function formatDatabaseUrl(url) {
  if (!url) return url;
  if (url.includes('connection_limit')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connection_limit=1&pool_timeout=10&connect_timeout=10`;
}

const dbUrl = formatDatabaseUrl(process.env.DATABASE_URL);

if (!process.env.DATABASE_URL) {
  console.warn(`${TAG} ⚠ DATABASE_URL não definida — Prisma vai falhar em runtime.`);
} else if (process.env.DATABASE_URL !== dbUrl) {
  console.log(`${TAG} ✔ connection_limit=1 + pool_timeout=10 + connect_timeout=10 aplicados`);
} else {
  console.log(`${TAG} ✔ connection_limit já presente (respeitando .env)`);
}

// ============================================
// 3. PRISMA CLIENT (singleton)
// ============================================
const globalForPrisma = globalThis;

export const prisma = globalForPrisma.prisma || new PrismaClient({
  datasources: dbUrl ? { db: { url: dbUrl } } : undefined,
  log: IS_DEV ? ['error', 'warn'] : ['error'],
});

if (!IS_PROD) {
  globalForPrisma.prisma = prisma;
}

console.log(`${TAG} ✔ PrismaClient criado (singleton)`);

// ============================================
// 4. HELPERS INTERNOS
// ============================================
function now() {
  return Date.now();
}

function log(nivel, msg) {
  if (nivel === 'debug' && !IS_DEV) return;
  const prefixo = `${TAG} ${msg}`;
  if (nivel === 'error') console.error(prefixo);
  else if (nivel === 'warn') console.warn(prefixo);
  else console.log(prefixo);
}

/**
 * Verifica se o erro é de conexão (vale retry).
 * Erros de lógica (P2002, P2025, etc.) retornam false.
 */
function ehErroDeConexao(err) {
  if (!err) return false;
  if (err.code && ERROS_CONEXAO.has(err.code)) return true;
  if (err.message && /timeout|timed out|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up/i.test(err.message)) {
    return true;
  }
  return false;
}

/**
 * Descarta a conexão travada e abre uma nova.
 * É ISSO que destrava o pooler zumbi entre retries.
 */
async function forcarReconexao() {
  try {
    await prisma.$disconnect();
    log('debug', '🔄 $disconnect executado');
  } catch (err) {
    log('warn', `⚠️ $disconnect falhou (ignorando): ${err.message}`);
  }
  try {
    await prisma.$connect();
    log('debug', '🔄 $connect executado');
  } catch (err) {
    log('warn', `⚠️ $connect falhou (ignorando): ${err.message}`);
  }
}

// ============================================
// 5. WARM-UP — SELECT 1 com timeout curto
// ============================================
/**
 * Roda SELECT 1 para "acordar" a conexão antes de uma query real.
 *
 * @param {number} timeoutMs - timeout do SELECT 1 (default 3000)
 * @returns {Promise<{ok: boolean, ms: number, error?: string}>}
 */
export async function warmupDb(timeoutMs = 3000) {
  const t0 = now();
  const label = 'warmupDb';
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`warmup timeout ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
    const ms = now() - t0;
    log('debug', `🔥 ${label} → ok em ${ms}ms`);
    return { ok: true, ms };
  } catch (err) {
    const ms = now() - t0;
    log('warn', `⚠️ ${label} → falhou em ${ms}ms: ${err.message}`);
    return { ok: false, ms, error: err.message };
  }
}

// ============================================
// 6. SAFE QUERY — retry inteligente com backoff
// ============================================
/**
 * Envolve uma query do Prisma com retry + logs.
 *
 * Retry acontece SOMENTE se:
 *   - o erro for de conexão (P1001, P1002, P1008, P1017, P2024, timeout), OU
 *   - a query demorou mais que LIMIAR_LENTO_MS e falhou depois
 *
 * Erros de lógica (P2002, P2025, validação) NÃO re-tentam.
 * Entre retries, força $disconnect() + $connect().
 *
 * Uso:
 *   const user = await safeQuery(
 *     () => prisma.user.findUnique({ where: { email } }),
 *     'auth.login.findUser'
 *   );
 *
 * @param {Function} queryFn - função async que executa a query
 * @param {string} label - nome para os logs
 * @param {Object} opts - opções extras (tentativas, backoffMs)
 * @returns {Promise<any>} resultado da query
 */
export async function safeQuery(queryFn, label = 'query', opts = {}) {
  const tentativas = opts.tentativas ?? TENTATIVAS_MAX;
  const backoffMs = opts.backoffMs ?? BACKOFF_MS;

  let ultimoErro;
  const t0Total = now();

  for (let i = 1; i <= tentativas; i++) {
    const t0 = now();
    try {
      log('debug', `🔍 ${label} → tentativa ${i}/${tentativas}...`);
      const resultado = await queryFn();
      const ms = now() - t0;

      if (ms > LIMIAR_LENTO_MS) {
        log('warn', `⚠️ ${label} → tentativa ${i} demorou ${ms}ms (>${LIMIAR_LENTO_MS}ms), mas passou`);
      } else {
        log('debug', `✅ ${label} → sucesso em ${ms}ms (tentativa ${i})`);
      }
      return resultado;
    } catch (err) {
      const ms = now() - t0;
      ultimoErro = err;

      const totalMs = now() - t0Total;
      const podeRetry =
        i < tentativas &&
        ehErroDeConexao(err) &&
        totalMs < TIMEOUT_TOTAL_MS;

      if (!podeRetry) {
        log('error', `❌ ${label} → falhou em ${ms}ms (tentativa ${i}/${tentativas}, total ${totalMs}ms): ${err.message}`);
        throw err;
      }

      log('warn', `⚠️ ${label} → tentativa ${i} falhou em ${ms}ms (${err.code || err.message}), retry em ${backoffMs}ms...`);
      await forcarReconexao();
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }

  throw ultimoErro;
}

// ============================================
// 7. WITH RETRY — retry genérico (útil para queries diretas)
// ============================================
/**
 * Retry genérico. Mesma lógica do safeQuery, mas sem envolver query.
 * Útil quando você quer só o retry, sem a semântica de "query".
 */
export async function withRetry(fn, opts = {}) {
  return safeQuery(fn, opts.label || 'withRetry', opts);
}

// ============================================
// 8. EXPORTS
// ============================================
console.log(`${TAG} ✅ carregado com sucesso (retry=${TENTATIVAS_MAX}, backoff=${BACKOFF_MS}ms, limiar=${LIMIAR_LENTO_MS}ms)`);