// ============================================
// src/auth.js — Autenticação e autorização
// Triad Academia · v3.0
//
// Responsabilidades:
//   1. requireAuth / optionalAuth (JWT Bearer)
//   2. requireRole / requireAluno / requireDevice
//   3. Rate limiters (login, api, device)
// ============================================

import rateLimit from 'express-rate-limit';
import { log as rootLog } from './logs.js';
import { safeQuery } from './prisma.js';
import {
  prisma, userSelect, HttpError, asyncHandler,
  verifyToken, hashDeviceKey,
} from './config.js';

const log = rootLog.child('[auth.js] ');
log.info('carregando...');

// ============================================
// 1. HELPERS INTERNOS
// ============================================
function extractBearerPayload(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

async function fetchActiveUser(payload) {
  if (!payload?.sub) return null;
  const user = await safeQuery(
    () => prisma.user.findUnique({ where: { id: payload.sub }, select: userSelect }),
    'auth.fetchActiveUser'
  );
  if (!user || !user.active) return null;
  return user;
}

// ============================================
// 2. requireAuth (JWT obrigatório)
// ============================================
export const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    log.warn('auth negado: token ausente', { reqId: req.id, path: req.path });
    throw new HttpError(401, 'Token ausente ou inválido');
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      log.warn('auth negado: token expirado', { reqId: req.id });
      throw new HttpError(401, 'Token expirado');
    }
    log.warn('auth negado: token inválido', { reqId: req.id, msg: err.message });
    throw new HttpError(401, 'Token inválido ou expirado');
  }

  const user = await fetchActiveUser(payload);
  if (!user) {
    log.warn('auth negado: usuário inativo/inexistente', { reqId: req.id, sub: payload.sub });
    throw new HttpError(401, 'Usuário não encontrado ou inativo');
  }

  req.user = user;
  next();
});

// ============================================
// 3. optionalAuth
// ============================================
export const optionalAuth = asyncHandler(async (req, res, next) => {
  const payload = extractBearerPayload(req);
  if (!payload) return next();
  const user = await fetchActiveUser(payload);
  if (user) req.user = user;
  next();
});

// ============================================
// 4. requireRole
// ============================================
export const requireRole = (...roles) => asyncHandler((req, res, next) => {
  if (!req.user) throw new HttpError(401, 'Não autenticado');
  if (!roles.includes(req.user.role)) {
    log.warn('auth negado: role insuficiente', {
      reqId: req.id, role: req.user.role, need: roles,
    });
    throw new HttpError(403, 'Sem permissão para esta ação');
  }
  next();
});

// ============================================
// 5. requireAluno
// ============================================
export const requireAluno = asyncHandler(async (req, res, next) => {
  if (!req.user) throw new HttpError(401, 'Não autenticado');
  if (req.user.role !== 'ALUNO') throw new HttpError(403, 'Acesso restrito a alunos');

  const student = await safeQuery(
    () => prisma.student.findUnique({
      where: { userId: req.user.id },
      select: { id: true, name: true, email: true, phone: true, active: true },
    }),
    'auth.requireAluno.findStudent'
  );

  if (!student || !student.active) {
    throw new HttpError(403, 'Conta de aluno inativa ou não vinculada');
  }

  req.student = student;
  next();
});

// ============================================
// 6. requireDevice
// ============================================
export const requireDevice = asyncHandler(async (req, res, next) => {
  const rawKey = req.headers['x-device-key'];
  if (!rawKey || typeof rawKey !== 'string') {
    log.warn('device auth negado: X-Device-Key ausente', { reqId: req.id });
    throw new HttpError(401, 'X-Device-Key ausente');
  }

  const hash = hashDeviceKey(rawKey);
  const device = await safeQuery(
    () => prisma.device.findUnique({ where: { apiKeyHash: hash } }),
    'auth.requireDevice.findDevice'
  );

  if (!device || !device.active) {
    log.warn('device auth negado: inválido/inativo', { reqId: req.id });
    throw new HttpError(401, 'Device inválido ou inativo');
  }

  req.device = device;
  next();
});

// ============================================
// 7. RATE LIMITERS
// ============================================
const rateLimitDisabled = () => process.env.RATE_LIMIT_DISABLED === '1';

const rateLimitValidate = {
  trustProxy: false,
  xForwardedForHeader: false,
  default: true,
};

function makeLimiter(name, windowMs, max, message) {
  const limiter = rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message },
    skip: rateLimitDisabled,
    validate: rateLimitValidate,
    handler: (req, res) => {
      log.warn(`rate limit: ${name}`, { reqId: req.id, ip: req.ip, path: req.path });
      res.status(429).json({ error: message });
    },
  });
  log.info(`limiter criado: ${name} (max=${max}, windowMs=${windowMs}, disabled=${rateLimitDisabled()})`);
  return limiter;
}

export const loginLimiter = makeLimiter(
  'login',
  15 * 60 * 1000,
  Number(process.env.LOGIN_RATE_MAX || 30),
  'Muitas tentativas de login. Tente novamente em 15 minutos.'
);

export const apiLimiter = makeLimiter(
  'api',
  60 * 1000,
  Number(process.env.API_RATE_MAX || 300),
  'Muitas requisições. Aguarde um momento.'
);

export const deviceLimiter = makeLimiter(
  'device',
  60 * 1000,
  Number(process.env.DEVICE_RATE_MAX || 60),
  'Muitas requisições do dispositivo.'
);

log.info('carregado com sucesso');