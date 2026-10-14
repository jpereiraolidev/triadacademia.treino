// ============================================
// api/middleware.js — Middlewares customizados
// Triad Academia · v3.0
// ============================================

import { log as rootLog, newReqId } from '../src/logs.js';
import { warmupDb } from '../src/prisma.js';
import { HttpError, redactForLog, CRON_SECRET } from '../src/config.js';

const log = rootLog.child('[middleware] ');

// ============================================
// 1. requestId
// ============================================
export function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && incoming.length <= 64
    ? incoming
    : newReqId();
  res.setHeader('X-Request-Id', req.id);
  next();
}

// ============================================
// 2. requestLogger
// ============================================
export function requestLogger(req, res, next) {
  const t0 = Date.now();

  const silent =
    process.env.NODE_ENV === 'production' &&
    (req.path === '/health' || req.path === '/api/v1/_ping');

  if (!silent) {
    log.info('req.in', {
      reqId: req.id,
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
  }

  const originalEnd = res.end;
  let bytes = 0;
  res.end = function (chunk, encoding) {
    if (chunk) {
      bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, encoding);
    }
    const ms = Date.now() - t0;
    res.end = originalEnd;
    res.end(chunk, encoding);

    if (!silent) {
      const meta = {
        reqId: req.id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms,
        bytes,
      };
      if (res.statusCode >= 500) log.error('req.out', meta);
      else if (res.statusCode >= 400) log.warn('req.out', meta);
      else log.info('req.out', meta);
    }
  };

  next();
}

// ============================================
// 3. noCache
// ============================================
export function noCache(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
}

// ============================================
// 4. securityExtra
// ============================================
export function securityExtra(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
}

// ============================================
// 5. warmupGlobal
// ============================================
export function warmupGlobal(req, res, next) {
  if (process.env.WARMUP_GLOBAL !== '1') return next();

  if (
    req.path === '/health' ||
    req.path === '/api/v1/_ping' ||
    req.path.startsWith('/api/v1/cron')
  ) {
    return next();
  }

  warmupDb(3000).catch((err) => {
    if (process.env.NODE_ENV === 'development') {
      log.debug('warmup background falhou', { reqId: req.id, msg: err.message });
    }
  });

  next();
}

// ============================================
// 6. cronAuth
// ============================================
export function cronAuth(req, res, next) {
  if (!CRON_SECRET) {
    log.warn('cron: CRON_SECRET ausente', { reqId: req.id });
    return res.status(503).json({ error: 'Cron desabilitado (CRON_SECRET ausente)' });
  }
  const secret = req.headers['x-cron-secret'];
  if (secret !== CRON_SECRET) {
    log.warn('cron: secret inválido', { reqId: req.id, ip: req.ip });
    return res.status(401).json({ error: 'Não autorizado' });
  }
  next();
}

// ============================================
// 7. notFound
// ============================================
export function notFound(req, res) {
  res.status(404).json({
    error: 'Rota não encontrada',
    reqId: req.id,
    path: req.path,
  });
}

// ============================================
// 8. errorLogger
// ============================================
export function errorLogger(err, req, res, next) {
  const meta = {
    reqId: req.id,
    method: req.method,
    path: req.path,
    name: err?.name,
    msg: err?.message,
    code: err?.code,
    status: err?.status,
  };

  if (err instanceof HttpError) {
    log.info('erro esperado (HttpError)', meta);
  } else if (err?.code && String(err.code).startsWith('P')) {
    log.error('erro Prisma', meta);
  } else {
    log.error('erro inesperado', meta);
    if (process.env.NODE_ENV === 'development' && err?.stack) {
      log.debug('stack', { reqId: req.id, stack: err.stack });
    }
  }

  next(err);
}

// ============================================
// 9. errorHandler
// ============================================
const PRISMA_ERRORS = {
  P2002: { status: 409, message: 'Registro duplicado' },
  P2025: { status: 404, message: 'Registro não encontrado' },
  P2003: { status: 400, message: 'Operação bloqueada por vínculo com outro registro' },
  P1000: { status: 503, message: 'Banco de dados indisponível' },
  P1001: { status: 503, message: 'Banco de dados indisponível' },
  P1002: { status: 503, message: 'Tempo esgotado ao conectar ao banco' },
  P1008: { status: 503, message: 'Tempo esgotado na operação do banco' },
  P1017: { status: 503, message: 'Conexão com o banco encerrada' },
  P2024: { status: 503, message: 'Pool de conexões esgotado — tente novamente em instantes' },
};

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.message,
      reqId: req.id,
    });
  }

  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
    return res.status(400).json({
      error: 'JSON inválido no corpo da requisição',
      reqId: req.id,
    });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Payload muito grande',
      reqId: req.id,
    });
  }

  if (err.code && PRISMA_ERRORS[err.code]) {
    const { status, message } = PRISMA_ERRORS[err.code];
    return res.status(status).json({
      error: message,
      reqId: req.id,
    });
  }

  res.status(500).json({
    error: 'Erro interno do servidor',
    reqId: req.id,
    ...(process.env.NODE_ENV === 'development' && { detail: err.message }),
  });
}