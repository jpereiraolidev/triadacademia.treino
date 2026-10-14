// ============================================
// src/logs.js — Logger estruturado
// Triad Academia · v3.0
//
// Responsabilidades:
//   1. Emitir logs em JSON (prod) ou colorido (dev)
//   2. Níveis: debug, info, warn, error, fatal
//   3. Redaction de campos sensíveis (password, token, hmac...)
//   4. Correlação por reqId (X-Request-Id)
//   5. Medir latência de request e de query
//
// NÃO faz: middlewares Express. Isso vive em api/middleware.js.
// Aqui só vive o "como logar".
//
// Uso:
//   import { log } from './logs.js';
//   log.info('msg', { op: 'users.list', ms: 12 });
// ============================================

import crypto from 'node:crypto';

// ============================================
// CONFIG
// ============================================
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const LEVEL_NAMES = { 10: 'DEBUG', 20: 'INFO', 30: 'WARN', 40: 'ERROR', 50: 'FATAL' };

const isDev = process.env.NODE_ENV !== 'production';
const minLevel = LEVELS[(process.env.LOG_LEVEL || (isDev ? 'debug' : 'info')).toLowerCase()] ?? LEVELS.info;

// Cores ANSI (só em dev)
const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
};

const LEVEL_COLORS = {
  DEBUG: COLORS.gray,
  INFO: COLORS.cyan,
  WARN: COLORS.yellow,
  ERROR: COLORS.red,
  FATAL: COLORS.magenta,
};

// ============================================
// REDACTION
// ============================================
const SENSITIVE_KEYS = [
  'password', 'senha', 'token', 'authorization', 'apikey', 'api_key',
  'secret', 'cookie', 'hmac', 'nonce', 'jwt', 'bearer',
];

function shouldRedact(key) {
  const k = String(key).toLowerCase();
  return SENSITIVE_KEYS.some((s) => k.includes(s));
}

function redact(value, depth = 0) {
  if (depth > 5 || value == null) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => redact(v, depth + 1));
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = shouldRedact(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

// ============================================
// FORMATTERS
// ============================================
function formatDev(level, tag, msg, meta) {
  const color = LEVEL_COLORS[level] || '';
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const levelPad = level.padEnd(5);
  const tagStr = tag ? `${COLORS.bold}${tag}${COLORS.reset} ` : '';

  let line = `${COLORS.gray}${ts}${COLORS.reset} ${color}${levelPad}${COLORS.reset} ${tagStr}${msg}`;

  if (meta && Object.keys(meta).length > 0) {
    const clean = redact(meta);
    const metaStr = Object.entries(clean)
      .map(([k, v]) => {
        const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return `${COLORS.gray}${k}=${COLORS.reset}${val}`;
      })
      .join(' ');
    line += `  ${metaStr}`;
  }

  return line;
}

function formatProd(level, tag, msg, meta, reqId) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    ...(tag && { tag }),
    ...(reqId && { reqId }),
    msg,
    ...(meta && Object.keys(meta).length > 0 ? { meta: redact(meta) } : {}),
  };
  return JSON.stringify(entry);
}

// ============================================
// CORE
// ============================================
function emit(levelNum, levelName, tag, msg, meta, reqId) {
  if (levelNum < minLevel) return;

  const line = isDev
    ? formatDev(levelName, tag, msg, meta)
    : formatProd(levelName, tag, msg, meta, reqId);

  // stdout para info/debug, stderr para warn/error/fatal
  const stream = levelNum >= LEVELS.warn ? process.stderr : process.stdout;
  stream.write(line + '\n');
}

// ============================================
// API PÚBLICA
// ============================================
function makeLogger(tag = '') {
  return {
    debug: (msg, meta) => emit(LEVELS.debug, 'DEBUG', tag, msg, meta),
    info: (msg, meta) => emit(LEVELS.info, 'INFO', tag, msg, meta),
    warn: (msg, meta) => emit(LEVELS.warn, 'WARN', tag, msg, meta),
    error: (msg, meta) => emit(LEVELS.error, 'ERROR', tag, msg, meta),
    fatal: (msg, meta) => emit(LEVELS.fatal, 'FATAL', tag, msg, meta),

    /** Cria um logger filho com tag própria */
    child: (childTag) => makeLogger(childTag ? `${tag}${childTag}` : tag),

    /** Mede duração de uma função async e loga o resultado */
    async timed(level, msg, meta, fn) {
      const t0 = Date.now();
      try {
        const result = await fn();
        const ms = Date.now() - t0;
        emit(LEVELS[level] ?? LEVELS.info, (level || 'info').toUpperCase(), tag, msg, { ...meta, ms });
        return result;
      } catch (err) {
        const ms = Date.now() - t0;
        emit(LEVELS.error, 'ERROR', tag, `${msg} (falhou)`, { ...meta, ms, err: err.message });
        throw err;
      }
    },
  };
}

// Logger raiz (sem tag)
export const log = makeLogger('');

// Helper para gerar reqId curto
export function newReqId() {
  return crypto.randomBytes(8).toString('hex');
}

// Exporta redact para uso em outros módulos
export { redact };

// Log de boot
log.info('logs.js carregado', {
  level: Object.keys(LEVELS).find((k) => LEVELS[k] === minLevel) || 'info',
  env: process.env.NODE_ENV || 'development',
  format: isDev ? 'dev' : 'json',
});