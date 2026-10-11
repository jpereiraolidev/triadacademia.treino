// ============================================
// config.js — Configuração compartilhada
// Triad Academia · v2.3
//
// Este arquivo:
//   1. Carrega .env
//   2. Importa o prisma de ./prisma.js (re-exporta)
//   3. Exporta JWT_SECRET, PORT, INVITE_SECRET e constantes
//   4. Exporta helpers (HttpError, asyncHandler, validate)
//   5. Exporta funções de auth (hash, verify, sign, verifyToken)
//   6. Exporta helpers de convite (id, nonce, hmac, url)
//   7. Exporta todos os schemas Zod
//
// Mudanças v2.3 (sobre v2.2):
//   - PrismaClient foi movido para ./prisma.js
//   - Aqui só re-exportamos `prisma` para manter compatibilidade
//   - connection_limit=1 + retry agora vivem no prisma.js
//
// Se algo falhar aqui, procure por "[config.js]" no log.
// ============================================

const TAG = '[config.js]';
console.log(`${TAG} ▶ carregando...`);

// ============================================
// 1. DOTENV
// ============================================
try {
  await import('dotenv/config');
  console.log(`${TAG} ✔ dotenv carregado`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao carregar 'dotenv/config'.`);
  console.error(`${TAG}    Verifique: npm install dotenv`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// ============================================
// 2. DEPENDÊNCIAS
// ============================================
let z, argon2, jwt, crypto;
try {
  z = (await import('zod')).z;
  console.log(`${TAG} ✔ zod carregado`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar 'zod'. Verifique: npm install zod`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}
try {
  argon2 = (await import('argon2')).default;
  console.log(`${TAG} ✔ argon2 carregado`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar 'argon2'. Verifique: npm install argon2`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}
try {
  jwt = (await import('jsonwebtoken')).default;
  console.log(`${TAG} ✔ jsonwebtoken carregado`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar 'jsonwebtoken'. Verifique: npm install jsonwebtoken`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}
try {
  crypto = (await import('node:crypto')).default;
  console.log(`${TAG} ✔ node:crypto carregado`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar 'node:crypto' (módulo nativo).`);
  console.error(`${TAG}    Isso não deveria acontecer. Node.js ${process.version}.`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// ============================================
// 3. PRISMA (agora vem de ./prisma.js)
// ============================================
// O PrismaClient foi movido para ./prisma.js, que agora é
// responsável por:
//   - Singleton global
//   - connection_limit=1 na URL (serverless)
//   - safeQuery() com retry + backoff (contra pooler zumbi)
//   - warmupDb() para acordar a conexão
//
// Aqui só re-exportamos para manter compatibilidade com
// quem importa `prisma` de `./config.js` (auth.js, api.js, routers.js).
let prisma;
try {
  const prismaMod = await import('./prisma.js');
  prisma = prismaMod.prisma;
  if (!prisma) {
    console.error(`${TAG} 💥 ./prisma.js não exportou 'prisma'.`);
    process.exit(1);
  }
  console.log(`${TAG} ✔ prisma re-exportado de ./prisma.js`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar './prisma.js'.`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// ============================================
// 4. VARIÁVEIS DE AMBIENTE
// ============================================
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const DEVICE_KEY_PEPPER = process.env.DEVICE_KEY_PEPPER || '';
const PORT = Number(process.env.PORT || 3333);

// --- INVITE ---
const INVITE_SECRET = process.env.INVITE_SECRET;
const APP_URL = (process.env.APP_URL || 'https://triadacademiatreino.vercel.app').replace(/\/+$/, '');
const INVITE_PATH = process.env.INVITE_PATH || '/i';

if (!JWT_SECRET) {
  console.error(`${TAG} 💥 JWT_SECRET não definido no .env.`);
  console.error(`${TAG}    Gere com: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`);
  process.exit(1);
}
if (JWT_SECRET.length < 32) {
  console.error(`${TAG} 💥 JWT_SECRET muito curto (${JWT_SECRET.length} chars). Mínimo: 32.`);
  process.exit(1);
}
console.log(`${TAG} ✔ JWT_SECRET ok (${JWT_SECRET.length} chars, expira em ${JWT_EXPIRES_IN})`);

if (!DEVICE_KEY_PEPPER) {
  console.warn(`${TAG} ⚠ DEVICE_KEY_PEPPER vazio — chaves de device ficam sem pepper.`);
} else {
  console.log(`${TAG} ✔ DEVICE_KEY_PEPPER ok (${DEVICE_KEY_PEPPER.length} chars)`);
}

if (!INVITE_SECRET) {
  console.error(`${TAG} 💥 INVITE_SECRET não definido no .env.`);
  console.error(`${TAG}    Gere com: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`);
  process.exit(1);
}
if (INVITE_SECRET.length < 32) {
  console.error(`${TAG} 💥 INVITE_SECRET muito curto (${INVITE_SECRET.length} chars). Mínimo: 32.`);
  process.exit(1);
}
console.log(`${TAG} ✔ INVITE_SECRET ok (${INVITE_SECRET.length} chars)`);
console.log(`${TAG} ✔ APP_URL=${APP_URL}`);
console.log(`${TAG} ✔ INVITE_PATH=${INVITE_PATH}`);

console.log(`${TAG} ✔ PORT=${PORT}`);

if (process.env.DATABASE_URL) {
  const masked = process.env.DATABASE_URL.replace(/(:\/\/[^:]+:)[^@]+@/, '$1****@');
  console.log(`${TAG} ✔ DATABASE_URL: ${masked}`);
} else {
  console.warn(`${TAG} ⚠ DATABASE_URL não definida — Prisma vai falhar em runtime.`);
}

// ============================================
// 5. HELPERS
// ============================================
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: 'Dados inválidos',
      issues: result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  req.validated = result.data;
  next();
};

export const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true,
};

export function hashDeviceKey(rawKey) {
  return crypto
    .createHash('sha256')
    .update(DEVICE_KEY_PEPPER + rawKey)
    .digest('hex');
}

export function generateDeviceKey() {
  return crypto.randomBytes(32).toString('hex');
}

// ============================================
// 6. AUTH — Argon2id + JWT
// ============================================
const argonOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain) {
  return argon2.hash(plain, argonOptions);
}

export async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
}

// ============================================
// 7. INVITE — helpers (Versão B1)
// ============================================
// Formato do token: <id>.<hmac>
//   - id:   12 bytes → base64url → 16 chars
//   - hmac: HMAC-SHA256(id + ":" + exp + ":" + nonce) truncado em 10 bytes → base64url → 14 chars
//   - token completo: ~31 chars
// ============================================

export function generateInviteId() {
  return crypto.randomBytes(12).toString('base64url'); // 16 chars
}

export function generateInviteNonce() {
  return crypto.randomBytes(4).toString('hex'); // 8 chars
}

export function signInvite({ id, exp, nonce }) {
  const payload = `${id}:${exp}:${nonce}`;
  return crypto
    .createHmac('sha256', INVITE_SECRET)
    .update(payload)
    .digest()
    .subarray(0, 10)              // 10 bytes
    .toString('base64url');        // 14 chars
}

export function buildInviteUrl(token) {
  return `${APP_URL}${INVITE_PATH}/${token}`;
}

// ============================================
// 8. LOG — sanitização
// ============================================
export function redactForLog(obj, depth = 0) {
  if (depth > 5 || obj == null) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.slice(0, 20).map((v) => redactForLog(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const lk = k.toLowerCase();
    if (lk.includes('password') || lk.includes('token') ||
        lk.includes('authorization') || lk.includes('apikey') ||
        lk.includes('api_key') || lk.includes('secret') || lk.includes('cookie') ||
        lk.includes('hmac')) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactForLog(v, depth + 1);
    }
  }
  return out;
}

// ============================================
// 9. SCHEMAS (Zod) — todos com .strict()
// ============================================
let schemas;
try {
  const cuid = z.string().min(1);

  const emailSchema = z.string().trim().toLowerCase().email('Email inválido').max(160);
  const phoneSchema = z
    .string()
    .trim()
    .regex(/^[+\d\s()-]{8,20}$/, 'Telefone inválido')
    .max(20);

  schemas = {
    loginSchema: z.object({
      email: emailSchema,
      password: z.string().min(1, 'Senha obrigatória').max(200),
    }).strict(),

    userCreateSchema: z.object({
      name: z.string().trim().min(1, 'Nome obrigatório').max(120),
      email: emailSchema,
      password: z.string().min(8, 'Senha mínima de 8 caracteres').max(100),
      role: z.enum(['ADMIN', 'PROFESSOR', 'RECEPCAO']).optional(),
    }).strict(),

    userUpdateSchema: z.object({
      name: z.string().trim().min(1).max(120).optional(),
      role: z.enum(['ADMIN', 'PROFESSOR', 'RECEPCAO']).optional(),
      active: z.boolean().optional(),
    }).strict(),

    userPasswordSchema: z.object({
      password: z.string().min(8, 'Senha mínima de 8 caracteres').max(100),
    }).strict(),

    exerciseCreateSchema: z.object({
      name: z.string().trim().min(1, 'Nome obrigatório').max(120),
      description: z.string().trim().max(2000).nullish(),
      muscleGroup: z.string().trim().max(60).nullish(),
      videoUrl: z.string().trim().url('URL inválida').max(500).nullish().or(z.literal('')),
      active: z.boolean().optional(),
    }).strict(),

    studentCreateSchema: z.object({
      name: z.string().trim().min(1, 'Nome obrigatório').max(120),
      email: emailSchema.nullish(),
      phone: phoneSchema.nullish(),
      birthDate: z.coerce.date().nullish(),
      active: z.boolean().optional(),
    }).strict(),

    planCreateSchema: z.object({
      name: z.string().trim().min(1, 'Nome obrigatório').max(80),
      description: z.string().trim().max(2000).nullish(),
      price: z.number().nonnegative('Preço não pode ser negativo'),
      durationDays: z.number().int().positive('Duração deve ser positiva').max(3650),
      active: z.boolean().optional(),
    }).strict(),

    membershipCreateSchema: z.object({
      studentId: cuid,
      planId: cuid,
      startDate: z.coerce.date(),
      endDate: z.coerce.date().optional(),
      priceAtPurchase: z.number().nonnegative().optional(),
      status: z.enum(['ATIVA', 'VENCIDA', 'CANCELADA', 'SUSPENSA']).optional(),
    }).strict(),

    membershipUpdateSchema: z.object({
      endDate: z.coerce.date().optional(),
      status: z.enum(['ATIVA', 'VENCIDA', 'CANCELADA', 'SUSPENSA']).optional(),
      priceAtPurchase: z.number().nonnegative().optional(),
    }).strict(),

    deviceCreateSchema: z.object({
      name: z.string().trim().min(1, 'Nome obrigatório').max(80),
      identifier: z.string().trim().min(1, 'Identificador obrigatório').max(80),
      active: z.boolean().optional(),
    }).strict(),

    deviceUpdateSchema: z.object({
      name: z.string().trim().min(1).max(80).optional(),
      identifier: z.string().trim().min(1).max(80).optional(),
      active: z.boolean().optional(),
    }).strict(),

    checkinCreateSchema: z.object({
      studentId: cuid,
      type: z.enum(['ENTRADA', 'SAIDA']),
      reason: z.string().trim().max(500).nullish(),
    }).strict(),

    checkinManualSchema: z.object({
      studentId: cuid,
      type: z.enum(['ENTRADA', 'SAIDA']),
      status: z.enum(['AUTORIZADO', 'NEGADO']),
      reason: z.string().trim().max(500).nullish(),
    }).strict(),

    checkinQuerySchema: z.object({
      studentId: z.string().min(1).optional(),
      deviceId: z.string().min(1).optional(),
      status: z.enum(['AUTORIZADO', 'NEGADO']).optional(),
      type: z.enum(['ENTRADA', 'SAIDA']).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      limit: z.coerce.number().int().positive().max(500).optional(),
    }).strict(),

    workoutCreateSchema: z.object({
      name: z.string().trim().min(1, 'Nome obrigatório').max(120),
      description: z.string().trim().max(2000).nullish(),
      startDate: z.coerce.date(),
      endDate: z.coerce.date().nullish(),
      exercises: z
        .array(
          z.object({
            exerciseId: cuid,
            order: z.number().int().nonnegative().optional(),
            sets: z.number().int().positive().max(100).nullish(),
            repetitions: z.string().max(40).nullish(),
            weight: z.number().nonnegative().nullish(),
            restSeconds: z.number().int().nonnegative().max(3600).nullish(),
            notes: z.string().max(1000).nullish(),
          }).strict()
        )
        .max(100, 'Máximo de 100 exercícios por treino')
        .optional(),
    }).strict(),

    workoutUpdateSchema: z.object({
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().max(2000).nullish(),
      status: z.enum(['ATIVO', 'FINALIZADO', 'ARQUIVADO']).optional(),
      startDate: z.coerce.date().optional(),
      endDate: z.coerce.date().nullish(),
    }).strict(),

    workoutExerciseCreateSchema: z.object({
      exerciseId: cuid,
      order: z.number().int().nonnegative().optional(),
      sets: z.number().int().positive().max(100).nullish(),
      repetitions: z.string().max(40).nullish(),
      weight: z.number().nonnegative().nullish(),
      restSeconds: z.number().int().nonnegative().max(3600).nullish(),
      notes: z.string().max(1000).nullish(),
    }).strict(),

    // ============================================
    // INVITE schemas (v2.2)
    // ============================================
    inviteCreateSchema: z.object({
      studentId: z.string().min(1).optional(),
      email: emailSchema.optional(),
      phone: phoneSchema.optional(),
      name: z.string().trim().min(1).max(120).optional(),
      type: z.enum(['ALUNO', 'STAFF']).default('ALUNO'),
      role: z.enum(['ADMIN', 'PROFESSOR', 'RECEPCAO']).optional(),
      expiresInDays: z.number().int().min(1).max(90).default(30),
    }).strict(),

    inviteBulkSchema: z.object({
      invites: z.array(
        z.object({
          studentId: z.string().min(1).optional(),
          email: emailSchema.optional(),
          phone: phoneSchema.optional(),
          name: z.string().trim().min(1).max(120).optional(),
          type: z.enum(['ALUNO', 'STAFF']).default('ALUNO'),
          role: z.enum(['ADMIN', 'PROFESSOR', 'RECEPCAO']).optional(),
        }).strict()
      ).min(1).max(500),
      expiresInDays: z.number().int().min(1).max(90).default(30),
    }).strict(),

    inviteAcceptSchema: z.object({
      password: z.string().min(8, 'Senha mínima de 8 caracteres').max(100),
      email: emailSchema.optional(),
    }).strict(),

    inviteMarkSentSchema: z.object({
      via: z.enum(['whatsapp', 'sms', 'email']),
    }).strict(),

    // ============================================
    // STUDENT IMPORT (v2.2)
    // ============================================
    studentImportSchema: z.object({
      students: z.array(
        z.object({
          legacyId: z.string().trim().min(1).max(80),
          name: z.string().trim().min(1).max(120),
          email: emailSchema.optional().nullable(),
          phone: phoneSchema.optional().nullable(),
          birthDate: z.coerce.date().optional().nullable(),
        }).strict()
      ).min(1).max(1000),
    }).strict(),
  };

  // derivados (partial)
  schemas.exerciseUpdateSchema = schemas.exerciseCreateSchema.partial();
  schemas.studentUpdateSchema = schemas.studentCreateSchema.partial();
  schemas.planUpdateSchema = schemas.planCreateSchema.partial();
  schemas.workoutExerciseUpdateSchema = schemas.workoutExerciseCreateSchema
    .omit({ exerciseId: true })
    .partial();

  console.log(`${TAG} ✔ schemas Zod definidos (${Object.keys(schemas).length})`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao montar schemas Zod.`);
  console.error(`${TAG}    Causa provável: versão incompatível do zod ou erro de sintaxe.`);
  console.error(`${TAG}    Verifique: npm install zod`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// ============================================
// 10. EXPORTS
// ============================================
export {
  prisma,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  DEVICE_KEY_PEPPER,
  PORT,
  INVITE_SECRET,
  APP_URL,
  INVITE_PATH,
};

export const {
  loginSchema,
  userCreateSchema,
  userUpdateSchema,
  userPasswordSchema,
  exerciseCreateSchema,
  exerciseUpdateSchema,
  studentCreateSchema,
  studentUpdateSchema,
  planCreateSchema,
  planUpdateSchema,
  membershipCreateSchema,
  membershipUpdateSchema,
  deviceCreateSchema,
  deviceUpdateSchema,
  checkinCreateSchema,
  checkinManualSchema,
  checkinQuerySchema,
  workoutCreateSchema,
  workoutUpdateSchema,
  workoutExerciseCreateSchema,
  workoutExerciseUpdateSchema,
  inviteCreateSchema,
  inviteBulkSchema,
  inviteAcceptSchema,
  inviteMarkSentSchema,
  studentImportSchema,
} = schemas;

console.log(`${TAG} ✅ carregado com sucesso`);