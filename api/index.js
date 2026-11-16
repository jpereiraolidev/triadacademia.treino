// ============================================
// api/index.js — Bootstrap do servidor
// Triad Academia · v3.1
//
// Mudanças v3.1 (sobre v3.0):
//   - /health retorna 503 quando isDbHealthy() é false
//   - /health dispara log.alert na transição healthy→unhealthy
//   - uncaughtException/unhandledRejection passam { err } (redact trata Error)
//   - flush(3000) nos crash guards (Vercel) para email/DB saírem
//   - shutdown() chama flush(5000) antes de disconnect()
//   - import de flush, isDbHealthy, prismaConfig
// ============================================

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';

import { log as rootLog, flush } from '../src/logs.js';
import { warmupDb, disconnect, isDbHealthy, prismaConfig } from '../src/prisma.js';
import { PORT } from '../src/config.js';
import { apiLimiter } from '../src/auth.js';
import router from '../src/routes.js';
import {
  requestId, requestLogger, noCache, securityExtra,
  warmupGlobal, notFound, errorLogger, errorHandler,
} from './middleware.js';

const log = rootLog.child('[api] ');
log.info('carregando...');

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

// ============================================
// HELMET
// ============================================
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(securityExtra);

// ============================================
// CORS
// ============================================
try {
  const rawOrigin = process.env.CORS_ORIGIN;
  const corsOrigin = rawOrigin
    ? rawOrigin.split(',').map((s) => s.trim()).filter(Boolean)
    : '*';

  app.use(cors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Device-Key',
      'X-Cron-Secret',
      'X-Request-Id',
    ],
    maxAge: 86400,
  }));

  log.info(`cors aplicado (origin=${Array.isArray(corsOrigin) ? corsOrigin.join(',') : corsOrigin})`);
} catch (err) {
  log.fatal('falha ao aplicar CORS', { err });
  throw err;
}

// ============================================
// BODY PARSER
// ============================================
app.use(express.json({ limit: '1mb' }));

// ============================================
// MIDDLEWARES CUSTOM
// ============================================
app.use(requestId);
app.use(requestLogger);
app.use(apiLimiter);
app.use(warmupGlobal);

// ============================================
// HEALTH
// ============================================
// Estado anterior de saúde do DB, para detectar transições
// (healthy → unhealthy → healthy) e disparar alerta só na mudança.
let wasHealthy = true;

app.get('/health', (req, res) => {
  const dbOk = isDbHealthy();

  // Transição healthy → unhealthy: alerta proativo
  if (!dbOk && wasHealthy) {
    log.alert('health: banco caiu (circuit breaker aberto)', { prismaConfig });
    wasHealthy = false;
  } else if (dbOk && !wasHealthy) {
    log.info('health: banco recuperado');
    wasHealthy = true;
  }

  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    uptime: Math.round(process.uptime()),
    ts: new Date().toISOString(),
  });
});

app.get('/health/warm', noCache, async (req, res) => {
  const t0 = Date.now();
  const result = await warmupDb(5000);
  const ms = Date.now() - t0;

  // Se o warmup falhou, também é sinal de banco fora
  if (!result.ok && wasHealthy) {
    log.alert('health/warm: banco inacessível', {
      ms,
      error: result.error,
      prismaConfig,
    });
    wasHealthy = false;
  } else if (result.ok && !wasHealthy) {
    log.info('health/warm: banco recuperado', { ms });
    wasHealthy = true;
  }

  res.status(result.ok ? 200 : 503).json({
    status: result.ok ? 'ok' : 'degraded',
    warmup: { ok: result.ok, ms, error: result.error || null },
    ts: new Date().toISOString(),
  });
});

// ============================================
// /api/v1
// ============================================
app.use('/api/v1', router);

// ============================================
// 404 + ERROR
// ============================================
app.use(notFound);
app.use(errorLogger);
app.use(errorHandler);

// ============================================
// CRASH GUARDS
// ============================================
// Passa { err } (não { msg }) para o redact incluir
// name, message, code, status e (em dev) stack.
process.on('uncaughtException', (err) => {
  log.fatal('uncaughtException', { err });
  // Em serverless, a lambda morre logo após isso.
  // flush(3000) dá tempo do email/DB saírem.
  if (process.env.VERCEL) {
    flush(3000).finally(() => process.exit(1));
  }
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  log.fatal('unhandledRejection', { err });
  if (process.env.VERCEL) {
    flush(3000).finally(() => process.exit(1));
  }
});

// ============================================
// START (fora da Vercel)
// ============================================
if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log('');
    console.log('============================================================');
    console.log('🚀 Triad Academia API · v3.1');
    console.log(`   URL       : http://localhost:${PORT}`);
    console.log(`   Health    : http://localhost:${PORT}/health`);
    console.log(`   Health+   : http://localhost:${PORT}/health/warm`);
    console.log(`   Base      : http://localhost:${PORT}/api/v1`);
    console.log(`   NODE_ENV  : ${process.env.NODE_ENV || 'undefined'}`);
    console.log('============================================================');
    console.log('');
  });

  server.ref();

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} recebido, encerrando...`);

    server.close(async () => {
      // Espera email/DB pendentes antes de fechar o Prisma
      await flush(5000);
      try { await disconnect(); } catch { /* ignore */ }
      process.exit(0);
    });

    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

// ============================================
// EXPORT VERCEL
// ============================================
export default app;