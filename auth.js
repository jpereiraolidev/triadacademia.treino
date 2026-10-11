// ============================================
// auth.js — Middlewares de autenticação e autorização
// Triad Academia · v2.3
//
// Este arquivo:
//   1. Carrega express-rate-limit
//   2. Define requireAuth, requireRole, requireAluno, requireDevice
//   3. Define optionalAuth (rotas públicas com contexto opcional)
//   4. Define loginLimiter, apiLimiter, deviceLimiter
//
// Mudanças v2.3 (sobre 2.2):
//   - Limiters aceitam trust proxy da Vercel sem reclamar (validate relaxado)
//   - Corrige 403 fantasma em alg=none quando trust proxy=1
//
// Se algo falhar aqui, procure por "[auth.js]" no log.
// ============================================

const TAG = '[auth.js]';
console.log(`${TAG} ▶ carregando...`);

// ============================================
// 1. IMPORTAR CONFIG.JS
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
// 3. HELPERS INTERNOS
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
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: userSelect,
  });
  if (!user || !user.active) return null;
  return user;
}

// ============================================
// 4. AUTH — Bearer JWT (obrigatório)
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
    if (err.name === 'TokenExpiredError') {
      throw new HttpError(401, 'Token expirado');
    }
    // cobre: JsonWebTokenError, NotBeforeError, alg=none, signature inválida, etc
    throw new HttpError(401, 'Token inválido ou expirado');
  }

  const user = await fetchActiveUser(payload);
  if (!user) {
    throw new HttpError(401, 'Usuário não encontrado ou inativo');
  }

  req.user = user;
  next();
});

// ============================================
// 5. AUTH — Bearer JWT (opcional)
// ============================================
export const optionalAuth = asyncHandler(async (req, res, next) => {
  const payload = extractBearerPayload(req);
  if (!payload) return next();

  const user = await fetchActiveUser(payload);
  if (user) req.user = user;

  next();
});

// ============================================
// 6. AUTH — Role (com asyncHandler)
// ============================================
export const requireRole = (...roles) => asyncHandler((req, res, next) => {
  if (!req.user) {
    throw new HttpError(401, 'Não autenticado');
  }
  if (!roles.includes(req.user.role)) {
    throw new HttpError(403, 'Sem permissão para esta ação');
  }
  next();
});

// ============================================
// 7. AUTH — Aluno (role ALUNO + Student vinculado)
// ============================================
export const requireAluno = asyncHandler(async (req, res, next) => {
  if (!req.user) {
    throw new HttpError(401, 'Não autenticado');
  }
  if (req.user.role !== 'ALUNO') {
    throw new HttpError(403, 'Acesso restrito a alunos');
  }

  const student = await prisma.student.findUnique({
    where: { userId: req.user.id },
    select: { id: true, name: true, email: true, phone: true, active: true },
  });

  if (!student || !student.active) {
    throw new HttpError(403, 'Conta de aluno inativa ou não vinculada');
  }

  req.student = student;
  next();
});

// ============================================
// 8. AUTH — Device
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
// 9. RATE LIMITERS
// ============================================
const rateLimitDisabled = () => process.env.RATE_LIMIT_DISABLED === '1';

// Configuração compartilhada: aceita trust proxy=1 da Vercel sem reclamar.
// Sem isso, o express-rate-limit v8 retorna 403 quando detecta trust proxy
// mas não encontra X-Forwarded-For "confiável" (comportamento da Vercel).
const rateLimitValidate = {
  trustProxy: false,           // aceita app.set('trust proxy', 1)
  xForwardedForHeader: false,  // não valida formato do X-Forwarded-For
  default: true,               // mantém as outras validações padrão
};

// --- loginLimiter (30/15min por IP) ---
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
    validate: rateLimitValidate,
  });

  console.log(`${TAG} ✔ loginLimiter criado (max=${max}, windowMs=${windowMs}, disabled=${rateLimitDisabled()})`);
  if (rateLimitDisabled()) {
    console.warn(`${TAG} ⚠ RATE_LIMIT_DISABLED=1 → loginLimiter está DESLIGADO.`);
  }
} catch (err) {
  console.error(`${TAG} 💥 Falha ao criar loginLimiter.`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// --- apiLimiter (300/min por IP) ---
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
    validate: rateLimitValidate,
  });
  console.log(`${TAG} ✔ apiLimiter criado (max=${max}, windowMs=${windowMs}, disabled=${rateLimitDisabled()})`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao criar apiLimiter.`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// --- deviceLimiter (60/min por IP) ---
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
    validate: rateLimitValidate,
  });
  console.log(`${TAG} ✔ deviceLimiter criado (max=${max}, windowMs=${windowMs}, disabled=${rateLimitDisabled()})`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao criar deviceLimiter.`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// ============================================
// 10. EXPORTS
// ============================================
export {
  loginLimiter,
  apiLimiter,
  deviceLimiter,
};

console.log(`${TAG} ✅ carregado com sucesso`);