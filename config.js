// ============================================
// config.js — Configuração compartilhada
// Triad Academia · v2.1 (logs de diagnóstico)
//
// Este arquivo:
//   1. Carrega .env
//   2. Cria o PrismaClient (singleton)
//   3. Exporta JWT_SECRET, PORT e constantes
//   4. Exporta helpers (HttpError, asyncHandler, validate)
//   5. Exporta funções de auth (hash, verify, sign, verifyToken)
//   6. Exporta todos os schemas Zod
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
let z, argon2, jwt, crypto, PrismaClient;
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
try {
  const prismaMod = await import('@prisma/client');
  PrismaClient = prismaMod.PrismaClient;
  if (typeof PrismaClient !== 'function') {
    console.error(`${TAG} 💥 '@prisma/client' não exportou PrismaClient.`);
    console.error(`${TAG}    Rode: npx prisma generate`);
    process.exit(1);
  }
  console.log(`${TAG} ✔ @prisma/client carregado`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar '@prisma/client'.`);
  console.error(`${TAG}    Causa provável: Prisma Client não foi gerado.`);
  console.error(`${TAG}    Rode: npx prisma generate`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// ============================================
// 3. PRISMA (singleton)
// ============================================
let prisma;
try {
  const globalForPrisma = globalThis;
  prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
  console.log(`${TAG} ✔ PrismaClient criado (singleton)`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao criar PrismaClient.`);
  console.error(`${TAG}    Causa provável: DATABASE_URL inválida, .env ausente, ou Prisma Client não gerado.`);
  console.error(`${TAG}    Rode: npx prisma generate`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// ============================================
// 4. VARIÁVEIS DE AMBIENTE
// ============================================
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const DEVICE_KEY_PEPPER = process.env.DEVICE_KEY_PEPPER || '';
const PORT = Number(process.env.PORT || 3333);

if (!JWT_SECRET) {
  console.error(`${TAG} 💥 JWT_SECRET não definido no .env.`);
  console.error(`${TAG}    Gere um segredo com:`);
  console.error(`${TAG}    node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`);
  process.exit(1);
}
if (JWT_SECRET.length < 32) {
  console.error(`${TAG} 💥 JWT_SECRET muito curto (${JWT_SECRET.length} chars).`);
  console.error(`${TAG}    Exigido: >= 32 chars. Atual: ${JWT_SECRET.length}.`);
  process.exit(1);
}
console.log(`${TAG} ✔ JWT_SECRET ok (${JWT_SECRET.length} chars, expira em ${JWT_EXPIRES_IN})`);

if (!DEVICE_KEY_PEPPER) {
  console.warn(`${TAG} ⚠ DEVICE_KEY_PEPPER vazio — chaves de device ficam sem pepper.`);
  console.warn(`${TAG}    Recomendado: adicionar um segredo longo no .env.`);
} else {
  console.log(`${TAG} ✔ DEVICE_KEY_PEPPER ok (${DEVICE_KEY_PEPPER.length} chars)`);
}

console.log(`${TAG} ✔ PORT=${PORT}`);

// Log da URL do banco (mascarada) — ajuda a diagnosticar P1001/P2024
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
// 7. LOG — sanitização
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
        lk.includes('api_key') || lk.includes('secret') || lk.includes('cookie')) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactForLog(v, depth + 1);
    }
  }
  return out;
}

// ============================================
// 8. SCHEMAS (Zod) — todos com .strict()
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
  };

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
// 9. EXPORTS
// ============================================
export { prisma, JWT_SECRET, JWT_EXPIRES_IN, DEVICE_KEY_PEPPER, PORT };
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
} = schemas;

console.log(`${TAG} ✅ carregado com sucesso`);