// ============================================
// api/index.js — Bootstrap do servidor
// Triad Academia · v3.0
// ============================================

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';

import { log as rootLog } from '../src/logs.js';
import { warmupDb, disconnect } from '../src/prisma.js';
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

app.use(helmet());
app.use(securityExtra);

try {
  const rawOrigin = process.env.CORS_ORIGIN;
  const corsOrigin = rawOrigin
    ? rawOrigin.split(',').map((s) => s.trim()).filter(Boolean)
    : '*';

  app.use(cors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 'Authorization', 'X-Device-Key',
      'X-Cron-Secret', 'X-Request-Id',
    ],
  }));
  log.info(`cors aplicado (origin=${Array.isArray(corsOrigin) ? corsOrigin.join(',') : corsOrigin})`);
} catch (err) {
  log.fatal(`falha ao aplicar CORS: ${err.message}`);
  throw err;
}

app.use(express.json({ limit: '1mb' }));

app.use(requestId);
app.use(requestLogger);
app.use(apiLimiter);
app.use(warmupGlobal);

// ---------- HEALTH ----------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.get('/health/warm', noCache, async (req, res) => {
  const t0 = Date.now();
  const result = await warmupDb(5000);
  const ms = Date.now() - t0;
  res.json({
    status: result.ok ? 'ok' : 'degraded',
    warmup: { ok: result.ok, ms, error: result.error || null },
    ts: new Date().toISOString(),
  });
});

// ---------- /api/v1 ----------
app.use('/api/v1', router);

// ---------- 404 + ERROR ----------
app.use(notFound);
app.use(errorLogger);
app.use(errorHandler);

// ---------- CRASH GUARDS ----------
process.on('uncaughtException', (err) => {
  log.fatal('uncaughtException', { msg: err?.message });
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  log.fatal('unhandledRejection', { msg });
});

// ---------- START (fora da Vercel) ----------
if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log('');
    console.log('============================================================');
    console.log('🚀 Triad Academia API · v3.0');
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
      try { await disconnect(); } catch {}
      process.exit(0);
    });

    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

// ---------- EXPORT VERCEL ----------
export default app;