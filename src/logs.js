// ============================================
// src/logs.js — Logger + email (Resend SDK) + DB + flush
// Triad Academia · v3.4
//
// Mudanças v3.4 (sobre v3.3):
//   - flush() público para aguardar email + DB em testes/shutdown
//   - trackPromise rastreia persistLog e sendEmailAlert
//   - Confirmação de email enviado no stderr (id do Resend)
//   - Exports organizados no final (evita erro de ordem)
//
// Uso:
//   import { log, flush, newReqId, redact, requestContext } from './logs.js';
//   log.error('banco caiu', { code: 'P1001' });   // email + DB
//   await flush(10000);                           // espera pendências
// ============================================

import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Resend } from 'resend';

// ============================================
// CONFIG
// ============================================
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const LEVEL_NAMES = { 10: 'DEBUG', 20: 'INFO', 30: 'WARN', 40: 'ERROR', 50: 'FATAL' };

const isDev = process.env.NODE_ENV !== 'production';
const minLevel =
  LEVELS[(process.env.LOG_LEVEL || (isDev ? 'debug' : 'info')).toLowerCase()] ??
  LEVELS.info;

const COLORS = {
  reset: '\x1b[0m', gray: '\x1b[90m', cyan: '\x1b[36m', green: '\x1b[32m',
  yellow: '\x1b[33m', red: '\x1b[31m', magenta: '\x1b[35m', bold: '\x1b[1m',
};
const LEVEL_COLORS = {
  DEBUG: COLORS.gray, INFO: COLORS.cyan, WARN: COLORS.yellow,
  ERROR: COLORS.red, FATAL: COLORS.magenta,
};

// ============================================
// ALERTAS — CONFIG
// ============================================
const ALERT = {
  resendApi: process.env.RESEND_API || '',
  fromEmail: process.env.ALERT_FROM_EMAIL || 'Triad Alerts <onboarding@resend.dev>',
  toEmails: (process.env.ALERT_TO_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  cooldownMs: Number(process.env.ALERT_COOLDOWN_MS || 5 * 60 * 1000),
  maxPerMinute: Number(process.env.ALERT_MAX_PER_MINUTE || 5),
  timeoutMs: Number(process.env.ALERT_TIMEOUT_MS || 8000),
  disableDb: process.env.ALERT_DISABLE_DB === '1',
  persistAll: process.env.ALERT_PERSIST_ALL === '1',
};

const emailEnabled = Boolean(ALERT.resendApi && ALERT.toEmails.length > 0);
const resend = emailEnabled ? new Resend(ALERT.resendApi) : null;

if (isDev) {
  console.log(
    `[logs.js] email alerts: ${emailEnabled ? 'ON' : 'OFF'} ` +
    `(${ALERT.toEmails.length} destinatários)`
  );
  console.log(`[logs.js] DB persist: ${ALERT.disableDb ? 'OFF' : 'ON'}`);
  if (emailEnabled) {
    console.log(`[logs.js] resend key: ${ALERT.resendApi.slice(0, 6)}…`);
  }
}

// ============================================
// PRISMA — LAZY IMPORT (evita circular)
// ============================================
let prismaRef = null;
async function getPrisma() {
  if (prismaRef) return prismaRef;
  try {
    const mod = await import('./prisma.js');
    prismaRef = mod.prisma;
    return prismaRef;
  } catch (err) {
    process.stderr.write(`[logs.js] não consegui importar prisma: ${err.message}\n`);
    return null;
  }
}

// ============================================
// REDACTION
// ============================================
const SENSITIVE_KEYS = [
  'password', 'senha', 'token', 'authorization', 'apikey', 'api_key',
  'secret', 'cookie', 'hmac', 'nonce', 'jwt', 'bearer',
  'cpf', 'cnpj', 'card', 'cvv', 'device_key', 'x-device-key',
  'x-cron-secret', 'credential', 'resend_api', 'resend_key',
];

function shouldRedact(key) {
  const k = String(key).toLowerCase();
  return SENSITIVE_KEYS.some((s) => k.includes(s));
}

function redact(value, depth = 0) {
  if (value == null) return value;
  if (depth > 5) return '[DEPTH_LIMIT]';

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.code && { code: value.code }),
      ...(value.status && { status: value.status }),
      ...(isDev && value.stack && { stack: value.stack.split('\n').slice(0, 5).join('\n') }),
    };
  }

  if (typeof value === 'object' && typeof value.toNumber === 'function') {
    try { return value.toNumber(); } catch { return String(value); }
  }

  if (value instanceof Date) return value.toISOString();
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
// ASYNC LOCAL STORAGE (reqId automático)
// ============================================
export const requestContext = new AsyncLocalStorage();

export function getReqIdFromContext() {
  return requestContext.getStore()?.reqId;
}

// ============================================
// FORMATTERS
// ============================================
function formatDev(level, tag, msg, meta, reqId) {
  const color = LEVEL_COLORS[level] || '';
  const ts = new Date().toISOString().slice(11, 23);
  const levelPad = level.padEnd(5);
  const tagStr = tag ? `${COLORS.bold}${tag}${COLORS.reset} ` : '';
  const rid = reqId ? `${COLORS.gray}[${reqId}]${COLORS.reset} ` : '';
  let line = `${COLORS.gray}${ts}${COLORS.reset} ${color}${levelPad}${COLORS.reset} ${rid}${tagStr}${msg}`;
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

function writeStream(levelNum, line) {
  const stream = levelNum >= LEVELS.warn ? process.stderr : process.stdout;
  try { stream.write(line + '\n'); } catch { /* não dá pra logar o log */ }
}

// ============================================
// ANTI-SPAM
// ============================================
const alertState = { lastByKey: new Map(), minuteWindow: [] };

function shouldSendAlert(key) {
  const now = Date.now();
  const last = alertState.lastByKey.get(key) || 0;
  if (now - last < ALERT.cooldownMs) return false;

  alertState.minuteWindow = alertState.minuteWindow.filter((t) => now - t < 60_000);
  if (alertState.minuteWindow.length >= ALERT.maxPerMinute) return false;

  alertState.lastByKey.set(key, now);
  alertState.minuteWindow.push(now);

  if (alertState.lastByKey.size > 200) {
    for (const [k, t] of alertState.lastByKey) {
      if (now - t > ALERT.cooldownMs * 2) alertState.lastByKey.delete(k);
    }
  }
  return true;
}

// ============================================
// TRACKING DE PROMISES (para flush)
// ============================================
const pendingTasks = new Set();

function trackPromise(p) {
  pendingTasks.add(p);
  p.finally(() => pendingTasks.delete(p));
  return p;
}

export async function flush(timeoutMs = 10000) {
  if (pendingTasks.size === 0) return;
  const timeout = new Promise((r) => setTimeout(r, timeoutMs));
  await Promise.race([Promise.allSettled([...pendingTasks]), timeout]);
}

// ============================================
// EMAIL — PAYLOAD
// ============================================
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmailPayload(level, tag, msg, meta, reqId) {
  const env = process.env.NODE_ENV || 'development';
  const app = process.env.APP_NAME || 'Triad Academia';
  const ts = new Date().toISOString();
  const emoji = level === 'FATAL' ? '🔥' : '❌';

  const metaClean = meta ? redact(meta) : {};
  const metaStr = Object.keys(metaClean).length
    ? JSON.stringify(metaClean, null, 2)
    : '';

  const subject = `${emoji} [${level}] ${app} — ${msg.slice(0, 120)}`;

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#f9fafb">
      <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e5e7eb">
        <div style="display:inline-block;padding:4px 10px;border-radius:6px;background:${level === 'FATAL' ? '#9c0006' : '#e74c3c'};color:#fff;font-size:12px;font-weight:600;margin-bottom:12px">
          ${level}
        </div>
        <h2 style="margin:0 0 8px;font-size:18px;color:#111">${escapeHtml(msg)}</h2>
        <p style="margin:0 0 16px;color:#6b7280;font-size:13px">
          ${app} · ${env} · ${ts}
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          ${tag ? `<tr><td style="padding:6px 0;color:#6b7280;width:100px">tag</td><td style="padding:6px 0;color:#111"><code>${escapeHtml(tag.trim())}</code></td></tr>` : ''}
          ${reqId ? `<tr><td style="padding:6px 0;color:#6b7280">reqId</td><td style="padding:6px 0;color:#111"><code>${escapeHtml(reqId)}</code></td></tr>` : ''}
        </table>
        ${metaStr ? `
          <details style="margin-top:16px">
            <summary style="cursor:pointer;color:#2563eb;font-size:13px;font-weight:600">Detalhes (meta)</summary>
            <pre style="background:#111827;color:#f9fafb;padding:16px;border-radius:8px;overflow:auto;font-size:12px;margin-top:8px">${escapeHtml(metaStr)}</pre>
          </details>
        ` : ''}
      </div>
      <p style="text-align:center;color:#9ca3af;font-size:11px;margin-top:16px">
        Triad Academia · sistema de alertas
      </p>
    </div>
  `;

  const text = [
    `[${level}] ${app} — ${env}`,
    `Quando: ${ts}`,
    `Mensagem: ${msg}`,
    tag ? `Tag: ${tag.trim()}` : '',
    reqId ? `reqId: ${reqId}` : '',
    metaStr ? `\nMeta:\n${metaStr}` : '',
  ].filter(Boolean).join('\n');

  return {
    from: ALERT.fromEmail,
    to: ALERT.toEmails,
    subject,
    html,
    text,
  };
}

// ============================================
// EMAIL — ENVIO (SDK Resend, fire-and-forget)
// ============================================
function sendEmailAlert(level, tag, msg, meta, reqId) {
  if (!emailEnabled || !resend) return;

  const payload = buildEmailPayload(level, tag, msg, meta, reqId);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`resend timeout após ${ALERT.timeoutMs}ms`)), ALERT.timeoutMs)
  );

  const p = Promise.race([resend.emails.send(payload), timeoutPromise])
    .then((result) => {
      if (result?.error) {
        process.stderr.write(
          `[logs.js] resend erro: ${JSON.stringify(result.error).slice(0, 300)}\n`
        );
      } else {
        process.stderr.write(`[logs.js] email enviado id=${result?.data?.id || '?'}\n`);
      }
    })
    .catch((err) => {
      process.stderr.write(`[logs.js] email alert falhou: ${err.message}\n`);
    });

  trackPromise(p);
}

// ============================================
// PERSISTÊNCIA — DB (fire-and-forget)
// ============================================
function persistLog(level, tag, msg, meta, reqId) {
  if (ALERT.disableDb) return;

  const p = (async () => {
    try {
      const prisma = await getPrisma();
      if (!prisma) return;
      await prisma.systemLog.create({
        data: {
          level,
          tag: tag ? tag.trim() : null,
          message: String(msg).slice(0, 2000),
          reqId: reqId || null,
          meta: meta ? redact(meta) : null,
          env: process.env.NODE_ENV || 'development',
        },
      });
    } catch (err) {
      process.stderr.write(`[logs.js] persist systemLog falhou: ${err.message}\n`);
    }
  })();

  trackPromise(p);
}

// ============================================
// CORE
// ============================================
function emit(levelNum, levelName, tag, msg, meta, reqId, forceAlert = false) {
  const finalReqId = reqId || getReqIdFromContext();

  if (levelNum >= minLevel) {
    const line = isDev
      ? formatDev(levelName, tag, msg, meta, finalReqId)
      : formatProd(levelName, tag, msg, meta, finalReqId);
    writeStream(levelNum, line);
  }

  const isCritical = forceAlert || levelNum >= LEVELS.error;
  if (!isCritical && !ALERT.persistAll) return;

  const key = `${levelName}|${tag}|${msg}`;
  const canEmail = shouldSendAlert(key);

  if (isCritical) persistLog(levelName, tag, msg, meta, finalReqId);
  if (isCritical && canEmail) sendEmailAlert(levelName, tag, msg, meta, finalReqId);
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
    alert: (msg, meta) => emit(LEVELS.error, 'ERROR', tag, msg, meta, undefined, true),
    child: (childTag) => makeLogger(childTag ? `${tag}${childTag}` : tag),
    async timed(level, msg, meta, fn) {
      const t0 = Date.now();
      try {
        const result = await fn();
        const ms = Date.now() - t0;
        emit(LEVELS[level] ?? LEVELS.info, (level || 'info').toUpperCase(), tag, msg, { ...meta, ms });
        return result;
      } catch (err) {
        const ms = Date.now() - t0;
        emit(LEVELS.error, 'ERROR', tag, `${msg} (falhou)`, { ...meta, ms, err });
        throw err;
      }
    },
  };
}

// ============================================
// EXPORTS (no final, na ordem certa)
// ============================================
export const log = makeLogger('');
export function newReqId() { return crypto.randomBytes(8).toString('hex'); }
export { redact };

log.info('logs.js carregado', {
  level: Object.keys(LEVELS).find((k) => LEVELS[k] === minLevel) || 'info',
  env: process.env.NODE_ENV || 'development',
  format: isDev ? 'dev' : 'json',
  email: emailEnabled ? `on (${ALERT.toEmails.length} dest.)` : 'off',
  db: ALERT.disableDb ? 'off' : 'on',
});