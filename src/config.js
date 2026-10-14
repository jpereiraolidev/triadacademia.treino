// ============================================
// src/config.js — Configuração compartilhada
// Triad Academia · v3.0
// ============================================

import 'dotenv/config';
import { z } from 'zod';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { log as rootLog } from './logs.js';
import { prisma } from './prisma.js';

const log = rootLog.child('[config.js] ');
log.info('carregando...');

// ============================================
// 1. VALIDAÇÃO DE ENV
// ============================================
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const DEVICE_KEY_PEPPER = process.env.DEVICE_KEY_PEPPER || '';
const PORT = Number(process.env.PORT || 3333);
const INVITE_SECRET = process.env.INVITE_SECRET;
const APP_URL = (process.env.APP_URL || 'https://triadacademiatreino.vercel.app').replace(/\/+$/, '');
const INVITE_PATH = process.env.INVITE_PATH || '/i';
const CRON_SECRET = process.env.CRON_SECRET || '';

function fail(msg) { log.fatal(msg); throw new Error(msg); }

if (!JWT_SECRET) fail('JWT_SECRET não definido no .env');
if (JWT_SECRET.length < 32) fail(`JWT_SECRET muito curto (${JWT_SECRET.length} chars). Mínimo: 32.`);
log.info(`JWT_SECRET ok (${JWT_SECRET.length} chars, expira em ${JWT_EXPIRES_IN})`);

if (!INVITE_SECRET) fail('INVITE_SECRET não definido no .env');
if (INVITE_SECRET.length < 32) fail(`INVITE_SECRET muito curto (${INVITE_SECRET.length} chars). Mínimo: 32.`);
log.info(`INVITE_SECRET ok (${INVITE_SECRET.length} chars)`);

if (!DEVICE_KEY_PEPPER) {
  log.warn('DEVICE_KEY_PEPPER vazio — chaves de device sem pepper.');
} else {
  log.info(`DEVICE_KEY_PEPPER ok (${DEVICE_KEY_PEPPER.length} chars)`);
}

if (!CRON_SECRET) {
  log.warn('CRON_SECRET não definido — /api/v1/cron/ping ficará desabilitado.');
} else {
  log.info(`CRON_SECRET ok (${CRON_SECRET.length} chars)`);
}

log.info(`APP_URL=${APP_URL}`);
log.info(`INVITE_PATH=${INVITE_PATH}`);
log.info(`PORT=${PORT}`);

if (process.env.DATABASE_URL) {
  const masked = process.env.DATABASE_URL.replace(/(:\/\/[^:]+:)[^@]+@/, '$1****@');
  log.info(`DATABASE_URL: ${masked}`);
} else {
  log.warn('DATABASE_URL não definida — Prisma vai falhar em runtime.');
}

// ============================================
// 2. HELPERS HTTP
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
  id: true, name: true, email: true, role: true, active: true,
  createdAt: true, updatedAt: true,
};

// ============================================
// 3. DEVICE KEY HELPERS
// ============================================
export function hashDeviceKey(rawKey) {
  return crypto.createHash('sha256').update(DEVICE_KEY_PEPPER + rawKey).digest('hex');
}

export function generateDeviceKey() {
  return crypto.randomBytes(32).toString('hex');
}

// ============================================
// 4. AUTH — Argon2id + JWT
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
  try { return await argon2.verify(hash, plain); } catch { return false; }
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
// 5. INVITE HELPERS
// ============================================
export function generateInviteId() {
  return crypto.randomBytes(12).toString('base64url');
}

export function generateInviteNonce() {
  return crypto.randomBytes(4).toString('hex');
}

export function signInvite({ id, exp, nonce }) {
  const payload = `${id}:${exp}:${nonce}`;
  return crypto.createHmac('sha256', INVITE_SECRET).update(payload).digest().subarray(0, 10).toString('base64url');
}

export function buildInviteUrl(token) {
  return `${APP_URL}${INVITE_PATH}/${token}`;
}

export function verifyInviteHmac({ id, exp, nonce, hmac }) {
  const expected = signInvite({ id, exp, nonce });
  if (expected.length !== hmac.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hmac));
  } catch { return false; }
}

// ============================================
// 6. REDACT FOR LOG
// ============================================
const SENSITIVE_KEYS = [
  'password', 'senha', 'token', 'authorization', 'apikey', 'api_key',
  'secret', 'cookie', 'hmac', 'nonce', 'jwt', 'bearer',
];

function shouldRedact(key) {
  const k = String(key).toLowerCase();
  return SENSITIVE_KEYS.some((s) => k.includes(s));
}

export function redactForLog(value, depth = 0) {
  if (depth > 5 || value == null) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactForLog(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = shouldRedact(k) ? '[REDACTED]' : redactForLog(v, depth + 1);
  }
  return out;
}

// ============================================
// 7. SCHEMAS ZOD
// ============================================
const cuid = z.string().min(1);
const emailSchema = z.string().trim().toLowerCase().email('Email inválido').max(160);
const phoneSchema = z.string().trim().regex(/^[+\d\s()-]{8,20}$/, 'Telefone inválido').max(20);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Senha obrigatória').max(200),
}).strict();

export const userCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(120),
  email: emailSchema,
  password: z.string().min(8, 'Senha mínima de 8 caracteres').max(100),
  role: z.enum(['ADMIN', 'PROFESSOR', 'RECEPCAO']).optional(),
}).strict();

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(['ADMIN', 'PROFESSOR', 'RECEPCAO']).optional(),
  active: z.boolean().optional(),
}).strict();

export const userPasswordSchema = z.object({
  password: z.string().min(8, 'Senha mínima de 8 caracteres').max(100),
}).strict();

export const exerciseCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(120),
  description: z.string().trim().max(2000).nullish(),
  muscleGroup: z.string().trim().max(60).nullish(),
  videoUrl: z.string().trim().url('URL inválida').max(500).nullish().or(z.literal('')),
  active: z.boolean().optional(),
}).strict();

export const exerciseUpdateSchema = exerciseCreateSchema.partial();

export const studentCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(120),
  email: emailSchema.nullish(),
  phone: phoneSchema.nullish(),
  birthDate: z.coerce.date().nullish(),
  active: z.boolean().optional(),
}).strict();

export const studentUpdateSchema = studentCreateSchema.partial();

export const planCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(80),
  description: z.string().trim().max(2000).nullish(),
  price: z.number().nonnegative('Preço não pode ser negativo'),
  durationDays: z.number().int().positive('Duração deve ser positiva').max(3650),
  active: z.boolean().optional(),
}).strict();

export const planUpdateSchema = planCreateSchema.partial();

export const membershipCreateSchema = z.object({
  studentId: cuid,
  planId: cuid,
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  priceAtPurchase: z.number().nonnegative().optional(),
  status: z.enum(['ATIVA', 'VENCIDA', 'CANCELADA', 'SUSPENSA']).optional(),
}).strict();

export const membershipUpdateSchema = z.object({
  endDate: z.coerce.date().optional(),
  status: z.enum(['ATIVA', 'VENCIDA', 'CANCELADA', 'SUSPENSA']).optional(),
  priceAtPurchase: z.number().nonnegative().optional(),
}).strict();

export const deviceCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(80),
  identifier: z.string().trim().min(1, 'Identificador obrigatório').max(80),
  active: z.boolean().optional(),
}).strict();

export const deviceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  identifier: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
}).strict();

export const checkinCreateSchema = z.object({
  studentId: cuid,
  type: z.enum(['ENTRADA', 'SAIDA']),
  reason: z.string().trim().max(500).nullish(),
}).strict();

export const checkinManualSchema = z.object({
  studentId: cuid,
  type: z.enum(['ENTRADA', 'SAIDA']),
  status: z.enum(['AUTORIZADO', 'NEGADO']),
  reason: z.string().trim().max(500).nullish(),
}).strict();

export const checkinQuerySchema = z.object({
  studentId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  status: z.enum(['AUTORIZADO', 'NEGADO']).optional(),
  type: z.enum(['ENTRADA', 'SAIDA']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
}).strict();

export const workoutCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(120),
  description: z.string().trim().max(2000).nullish(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullish(),
  exercises: z.array(
    z.object({
      exerciseId: cuid,
      order: z.number().int().nonnegative().optional(),
      sets: z.number().int().positive().max(100).nullish(),
      repetitions: z.string().max(40).nullish(),
      weight: z.number().nonnegative().nullish(),
      restSeconds: z.number().int().nonnegative().max(3600).nullish(),
      notes: z.string().max(1000).nullish(),
    }).strict()
  ).max(100, 'Máximo de 100 exercícios por treino').optional(),
}).strict();

export const workoutUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullish(),
  status: z.enum(['ATIVO', 'FINALIZADO', 'ARQUIVADO']).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().nullish(),
}).strict();

export const workoutExerciseCreateSchema = z.object({
  exerciseId: cuid,
  order: z.number().int().nonnegative().optional(),
  sets: z.number().int().positive().max(100).nullish(),
  repetitions: z.string().max(40).nullish(),
  weight: z.number().nonnegative().nullish(),
  restSeconds: z.number().int().nonnegative().max(3600).nullish(),
  notes: z.string().max(1000).nullish(),
}).strict();

export const workoutExerciseUpdateSchema = workoutExerciseCreateSchema
  .omit({ exerciseId: true })
  .partial();

export const inviteCreateSchema = z.object({
  studentId: z.string().min(1).optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  type: z.enum(['ALUNO', 'STAFF']).default('ALUNO'),
  role: z.enum(['ADMIN', 'PROFESSOR', 'RECEPCAO']).optional(),
  expiresInDays: z.number().int().min(1).max(90).default(30),
}).strict();

export const inviteBulkSchema = z.object({
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
}).strict();

export const inviteAcceptSchema = z.object({
  password: z.string().min(8, 'Senha mínima de 8 caracteres').max(100),
  email: emailSchema.optional(),
}).strict();

export const inviteMarkSentSchema = z.object({
  via: z.enum(['whatsapp', 'sms', 'email']),
}).strict();

export const studentImportSchema = z.object({
  students: z.array(
    z.object({
      legacyId: z.string().trim().min(1).max(80),
      name: z.string().trim().min(1).max(120),
      email: emailSchema.optional().nullable(),
      phone: phoneSchema.optional().nullable(),
      birthDate: z.coerce.date().optional().nullable(),
    }).strict()
  ).min(1).max(1000),
}).strict();

log.info('schemas Zod definidos');

// ============================================
// 8. EXPORTS
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
  CRON_SECRET,
};

log.info('carregado com sucesso');