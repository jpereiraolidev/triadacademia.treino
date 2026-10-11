// ============================================
// auth.js — Middlewares de autenticação e autorização
// Triad Academia · v2.1 (logs de diagnóstico)
//
// Este arquivo:
//   1. Carrega express-rate-limit
//   2. Define requireAuth, requireRole, requireDevice
//   3. Define loginLimiter, apiLimiter, deviceLimiter
//
// Se algo falhar aqui, procure por "[auth.js]" no log.
// ============================================

const TAG = '[auth.js]';
console.log(`${TAG} ▶ carregando...`);

// ============================================
// 1. IMPORTAR CONFIG.JS (necessário para Prisma, JWT, etc.)
// ============================================
let config;
try {
  config = await import('./config.js');
  const required = ['prisma', 'userSelect', 'HttpError', 'asyncHandler', 'verifyToken', 'hashDeviceKey'];
  const missing = required.filter((k) => config[k] === undefined);
  if (missing.length) {
    console.error(`${TAG} 💥 config.js não exportou: ${missing.join(', ')}`);
    console.error(`${TAG}    Verifique se config.js está completo.`);
    process.exit(1);
  }
  console.log(`${TAG} ✔ config.js carregado`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar './config.js'`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

const {
  prisma, userSelect, HttpError, asyncHandler,
  verifyToken, hashDeviceKey,
} = config;

// ============================================
// 2. IMPORTAR EXPRESS-RATE-LIMIT
// ============================================
let rateLimit;
try {
  rateLimit = (await import('express-rate-limit')).default;
  if (typeof rateLimit !== 'function') {
    console.error(`${TAG} 💥 'express-rate-limit' não exportou uma função.`);
    console.error(`${TAG}    Verifique a versão: npm ls express-rate-limit`);
    process.exit(1);
  }
  console.log(`${TAG} ✔ express-rate-limit carregado`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar 'express-rate-limit'.`);
  console.error(`${TAG}    Causa provável: pacote não instalado.`);
  console.error(`${TAG}    Rode: npm install express-rate-limit`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// ============================================
// 3. AUTH — Bearer JWT
// ============================================
export const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new HttpError(401, 'Token ausente ou inválido');
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    // Se o erro for por expiração, é útil saber
    if (err.name === 'TokenExpiredError') {
      throw new HttpError(401, 'Token expirado');
    }
    throw new HttpError(401, 'Token inválido ou expirado');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: userSelect,
  });

  if (!user || !user.active) {
    throw new HttpError(401, 'Usuário não encontrado ou inativo');
  }

  req.user = user;
  next();
});

// ============================================
// 4. AUTH — Role
// ============================================
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) throw new HttpError(401, 'Não autenticado');
  if (!roles.includes(req.user.role)) {
    throw new HttpError(403, 'Sem permissão para esta ação');
  }
  next();
};

// ============================================
// 5. AUTH — Device
// ============================================
export const requireDevice = asyncHandler(async (req, res, next) => {
  const rawKey = req.headers['x-device-key'];
  if (!rawKey || typeof rawKey !== 'string') {
    throw new HttpError(401, 'X-Device-Key ausente');
  }

  const hash = hashDeviceKey(rawKey);
  const device = await prisma.device.findUnique({ where: { apiKeyHash: hash } });

  if (!device || !device.active) {
    throw new HttpError(401, 'Device inválido ou inativo');
  }

  req.device = device;
  next();
});

// ============================================
// 6. RATE LIMITERS
// ============================================
const rateLimitDisabled = () => process.env.RATE_LIMIT_DISABLED === '1';

// --- loginLimiter ---
let loginLimiter;
try {
  const windowMs = 15 * 60 * 1000;
  const max = Number(process.env.LOGIN_RATE_MAX || 30);

  loginLimiter = rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
    skipSuccessfulRequests: true,
    skip: rateLimitDisabled,
  });

  console.log(`${TAG} ✔ loginLimiter criado (max=${max}, windowMs=${windowMs}, disabled=${rateLimitDisabled()})`);
  if (rateLimitDisabled()) {
    console.warn(`${TAG} ⚠ RATE_LIMIT_DISABLED=1 → loginLimiter está DESLIGADO.`);
    console.warn(`${TAG}    Remova RATE_LIMIT_DISABLED do .env para reativar.`);
  }
} catch (err) {
  console.error(`${TAG} 💥 Falha ao criar loginLimiter.`);
  console.error(`${TAG}    Causa provável: 'express-rate-limit' ausente ou versão incompatível.`);
  console.error(`${TAG}    Verifique: npm ls express-rate-limit`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// --- apiLimiter ---
let apiLimiter;
try {
  const windowMs = 60 * 1000;
  const max = Number(process.env.API_RATE_MAX || 300);

  apiLimiter = rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Muitas requisições. Aguarde um momento.' },
    skip: rateLimitDisabled,
  });
  console.log(`${TAG} ✔ apiLimiter criado (max=${max}, windowMs=${windowMs})`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao criar apiLimiter.`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// --- deviceLimiter ---
let deviceLimiter;
try {
  const windowMs = 60 * 1000;
  const max = Number(process.env.DEVICE_RATE_MAX || 60);

  deviceLimiter = rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Muitas requisições do dispositivo.' },
    skip: rateLimitDisabled,
  });
  console.log(`${TAG} ✔ deviceLimiter criado (max=${max}, windowMs=${windowMs})`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao criar deviceLimiter.`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// ============================================
// 7. EXPORTS
// ============================================
export {
  loginLimiter,
  apiLimiter,
  deviceLimiter,
};

console.log(`${TAG} ✅ carregado com sucesso`);