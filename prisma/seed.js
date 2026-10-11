// ============================================================
// prisma/seed.js — Triad Academia
// Popula o banco com dados de teste usando as MESMAS funções
// do config.js (argon2id, hashDeviceKey, signInvite).
//
// Uso:
//   npx prisma db seed
//   node prisma/seed.js
// ============================================================

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

const TAG = '[seed]';
const log  = (...a) => console.log(TAG, ...a);
const ok   = (m) => console.log(`${TAG} ✔ ${m}`);
const warn = (m) => console.warn(`${TAG} ⚠ ${m}`);

// ============================================================
// MESMAS OPÇÕES DO config.js
// ============================================================
const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

async function hashPassword(plain) {
  return argon2.hash(plain, ARGON_OPTS);
}

function hashDeviceKey(rawKey) {
  const pepper = process.env.DEVICE_KEY_PEPPER || '';
  return crypto.createHash('sha256').update(pepper + rawKey).digest('hex');
}

// ============================================================
// HELPERS DE INVITE (iguais ao config.js)
// ============================================================
function generateInviteId() {
  return crypto.randomBytes(12).toString('base64url'); // 16 chars
}

function generateInviteNonce() {
  return crypto.randomBytes(4).toString('hex'); // 8 chars
}

function signInvite({ id, exp, nonce }) {
  const secret = process.env.INVITE_SECRET;
  if (!secret) throw new Error('INVITE_SECRET ausente no .env');
  const payload = `${id}:${exp}:${nonce}`;
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest()
    .subarray(0, 10)
    .toString('base64url');
}

function buildInviteUrl(token) {
  const base = (process.env.APP_URL || 'https://triadacademiatreino.vercel.app').replace(/\/+$/, '');
  const path = process.env.INVITE_PATH || '/i';
  return `${base}${path}/${token}`;
}

// ============================================================
// SEED
// ============================================================
async function main() {
  log('▶ iniciando seed...\n');

  // ----------------------------------------------------------
  // 1. LIMPEZA (ordem respeita FK)
  // ----------------------------------------------------------
  log('🧹 limpando dados antigos...');
  await prisma.checkin.deleteMany();
  await prisma.workoutExercise.deleteMany();
  await prisma.workoutPlan.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.invite.deleteMany();
  await prisma.student.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.device.deleteMany();
  await prisma.user.deleteMany();
  ok('banco limpo\n');

  // ----------------------------------------------------------
  // 2. USERS (staff + aluno)
  // ----------------------------------------------------------
  const SENHA_PADRAO = 'senha123456';
  const passwordHash = await hashPassword(SENHA_PADRAO);

  const admin = await prisma.user.create({
    data: {
      name: 'Admin Tríade',
      email: 'admin@triad.com',
      password: passwordHash,
      role: 'ADMIN',
      active: true,
    },
  });
  ok(`admin criado: ${admin.email}`);

  const professor = await prisma.user.create({
    data: {
      name: 'Carlos Personal',
      email: 'professor@triad.com',
      password: passwordHash,
      role: 'PROFESSOR',
      active: true,
    },
  });
  ok(`professor criado: ${professor.email}`);

  const recepcao = await prisma.user.create({
    data: {
      name: 'Ana Recepção',
      email: 'recepcao@triad.com',
      password: passwordHash,
      role: 'RECEPCAO',
      active: true,
    },
  });
  ok(`recepção criada: ${recepcao.email}`);

  // Aluno com conta (role ALUNO)
  const alunoUser = await prisma.user.create({
    data: {
      name: 'Aluno Tríade',
      email: 'aluno@triad.com',
      password: passwordHash,
      role: 'ALUNO',
      active: true,
    },
  });
  ok(`aluno user criado: ${alunoUser.email}`);

  console.log('');

  // ----------------------------------------------------------
  // 3. PLANS
  // ----------------------------------------------------------
  const planoMensal = await prisma.plan.create({
    data: {
      name: 'Plano Mensal Standard',
      description: 'Acesso livre à musculação de segunda a sábado.',
      price: 120.00,
      durationDays: 30,
      active: true,
    },
  });
  ok(`plano criado: ${planoMensal.name}`);

  const planoAnual = await prisma.plan.create({
    data: {
      name: 'Plano Anual VIP',
      description: 'Acesso total + avaliações físicas mensais.',
      price: 1000.00,
      durationDays: 365,
      active: true,
    },
  });
  ok(`plano criado: ${planoAnual.name}`);

  console.log('');

  // ----------------------------------------------------------
  // 4. STUDENTS (legados + vinculado ao user ALUNO)
  // ----------------------------------------------------------
  const aluno1 = await prisma.student.create({
    data: {
      name: 'João Silva (Legado)',
      email: 'joao.silva@legado.com',
      phone: '+5511999990001',
      legacyId: 'LEGADO_1042',
      legacyData: { sistemaAntigo: 'v1', ultimaVisita: '2026-09-01' },
      active: true,
    },
  });
  ok(`student criado: ${aluno1.name}`);

  const aluno2 = await prisma.student.create({
    data: {
      name: 'Maria Souza (Legado)',
      email: 'maria.souza@legado.com',
      phone: '+5511999990002',
      legacyId: 'LEGADO_1043',
      legacyData: { sistemaAntigo: 'v1', ultimaVisita: '2026-09-15' },
      active: true,
    },
  });
  ok(`student criado: ${aluno2.name}`);

  // Vincula o user ALUNO a um Student
  const aluno3 = await prisma.student.create({
    data: {
      name: 'Aluno Tríade',
      email: alunoUser.email,
      phone: '+5511999990003',
      userId: alunoUser.id,      // ← vínculo 1:1
      active: true,
    },
  });
  ok(`student criado e vinculado a user: ${aluno3.name}`);

  console.log('');

  // ----------------------------------------------------------
  // 5. MEMBERSHIPS
  // ----------------------------------------------------------
  const now = new Date();
  const plus30  = new Date(now.getTime() + 30  * 86400000);
  const plus365 = new Date(now.getTime() + 365 * 86400000);

  await prisma.membership.create({
    data: {
      studentId: aluno1.id,
      planId: planoMensal.id,
      startDate: now,
      endDate: plus30,
      priceAtPurchase: 120.00,
      status: 'ATIVA',
    },
  });
  ok(`membership ATIVA: ${aluno1.name} → ${planoMensal.name}`);

  await prisma.membership.create({
    data: {
      studentId: aluno3.id,
      planId: planoAnual.id,
      startDate: now,
      endDate: plus365,
      priceAtPurchase: 1000.00,
      status: 'ATIVA',
    },
  });
  ok(`membership ATIVA: ${aluno3.name} → ${planoAnual.name}`);

  console.log('');

  // ----------------------------------------------------------
  // 6. DEVICE (catraca) — com PEPPER correto
  // ----------------------------------------------------------
  const apiKeyRaw = 'catraca_secreta_123';
  const apiKeyHash = hashDeviceKey(apiKeyRaw); // ← usa DEVICE_KEY_PEPPER

  const device = await prisma.device.create({
    data: {
      name: 'Catraca Entrada Principal',
      identifier: 'CATRACA-01',
      apiKeyHash,
      active: true,
    },
  });
  ok(`device criado: ${device.name}`);
  console.log(`       X-Device-Key: ${apiKeyRaw}`);

  console.log('');

  // ----------------------------------------------------------
  // 7. INVITES (PENDING + SENT + ACCEPTED)
  // ----------------------------------------------------------
  const inviteScenarios = [
    { student: aluno2, status: 'PENDING', sent: false, accepted: false, label: 'PENDING' },
    { student: aluno1, status: 'SENT',    sent: true,  accepted: false, label: 'SENT'    },
  ];

  const invites = [];
  for (const sc of inviteScenarios) {
    const id    = generateInviteId();
    const nonce = generateInviteNonce();
    const expiresAt = new Date(Date.now() + 30 * 86400000);
    const exp   = Math.floor(expiresAt.getTime() / 1000);
    const hmac  = signInvite({ id, exp, nonce });
    const token = `${id}.${hmac}`;

    const invite = await prisma.invite.create({
      data: {
        id,
        token,
        hmac,
        createdById: admin.id,
        studentId: sc.student.id,
        email: sc.student.email,
        phone: sc.student.phone,
        name: sc.student.name,
        type: 'ALUNO',
        status: sc.status,
        expiresAt,
        sentAt:   sc.sent ? new Date() : null,
        sentVia:  sc.sent ? 'whatsapp' : null,
      },
    });
    invites.push({ invite, url: buildInviteUrl(token) });
    ok(`invite ${sc.label}: ${sc.student.name}`);
    console.log(`       ${buildInviteUrl(token)}`);
  }

  console.log('');

  // ----------------------------------------------------------
  // 8. SUMÁRIO
  // ----------------------------------------------------------
  const counts = {
    users:       await prisma.user.count(),
    students:    await prisma.student.count(),
    plans:       await prisma.plan.count(),
    memberships: await prisma.membership.count(),
    devices:     await prisma.device.count(),
    invites:     await prisma.invite.count(),
  };

  console.log('════════════════════════════════════════════════════════════');
  console.log('  SEED CONCLUÍDO');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  Users      : ${counts.users}`);
  console.log(`  Students   : ${counts.students}`);
  console.log(`  Plans      : ${counts.plans}`);
  console.log(`  Memberships: ${counts.memberships}`);
  console.log(`  Devices    : ${counts.devices}`);
  console.log(`  Invites    : ${counts.invites}`);
  console.log('════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  🔑 CREDENCIAIS (senha: senha123456)');
  console.log('     admin@triad.com      → ADMIN');
  console.log('     professor@triad.com  → PROFESSOR');
  console.log('     recepcao@triad.com   → RECEPCAO');
  console.log('     aluno@triad.com      → ALUNO');
  console.log('');
  console.log('  🚪 DEVICE');
  console.log(`     X-Device-Key: ${apiKeyRaw}`);
  console.log('');
  console.log('  ✉️  INVITES');
  for (const { invite, url } of invites) {
    console.log(`     [${invite.status}] ${url}`);
  }
  console.log('');
}

// ============================================================
// RUN
// ============================================================
main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\n${TAG} 💥 erro:`, err);
    await prisma.$disconnect();
    process.exit(1);
  });