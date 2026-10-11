// ============================================================
// prisma/seed.js — Triad Academia
// Popula o banco com dados de teste (idempotente)
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
const log = (...a) => console.log(TAG, ...a);
const ok = (msg) => console.log(`${TAG} ✔ ${msg}`);
const warn = (msg) => console.warn(`${TAG} ⚠ ${msg}`);

// ============================================================
// HELPERS
// ============================================================

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

async function hash(pw) {
  return argon2.hash(pw, ARGON_OPTS);
}

function generateInviteId() {
  return crypto.randomBytes(12).toString('base64url');
}

function generateInviteNonce() {
  return crypto.randomBytes(4).toString('hex');
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
// SEED PRINCIPAL
// ============================================================

async function main() {
  log('▶ iniciando seed...\n');

  // ==========================================================
  // 1. USERS (staff + 1 aluno de teste)
  // ==========================================================
  const SENHA_PADRAO = 'senha123456';

  const usersData = [
    { email: 'admin@triad.com',      name: 'Admin Tríade',       role: 'ADMIN' },
    { email: 'professor@triad.com',  name: 'Professor Carlos',   role: 'PROFESSOR' },
    { email: 'recepcao@triad.com',   name: 'Recepção Ana',       role: 'RECEPCAO' },
    { email: 'aluno@triad.com',      name: 'Aluno Teste',        role: 'ALUNO' },
  ];

  const users = {};
  for (const u of usersData) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (existing) {
      warn(`user já existe: ${u.email} — pulando`);
      users[u.role] = existing;
      continue;
    }
    const password = await hash(SENHA_PADRAO);
    const created = await prisma.user.create({
      data: { ...u, password },
    });
    users[u.role] = created;
    ok(`user criado: ${u.email} (${u.role})`);
  }

  log('');

  // ==========================================================
  // 2. PLANS
  // ==========================================================
  const plansData = [
    { name: 'Mensal',     price: 149.90, durationDays: 30  },
    { name: 'Trimestral', price: 399.90, durationDays: 90  },
    { name: 'Anual',      price: 1299.90, durationDays: 365 },
  ];

  const plans = {};
  for (const p of plansData) {
    const existing = await prisma.plan.findFirst({ where: { name: p.name } });
    if (existing) {
      warn(`plano já existe: ${p.name} — pulando`);
      plans[p.name] = existing;
      continue;
    }
    const created = await prisma.plan.create({ data: { ...p, active: true } });
    plans[p.name] = created;
    ok(`plano criado: ${p.name} (R$ ${p.price})`);
  }

  log('');

  // ==========================================================
  // 3. EXERCISES
  // ==========================================================
  const exercisesData = [
    { name: 'Supino Reto',        muscleGroup: 'Peito' },
    { name: 'Supino Inclinado',   muscleGroup: 'Peito' },
    { name: 'Crucifixo',          muscleGroup: 'Peito' },
    { name: 'Puxada Frontal',     muscleGroup: 'Costas' },
    { name: 'Remada Curvada',     muscleGroup: 'Costas' },
    { name: 'Agachamento Livre',  muscleGroup: 'Pernas' },
    { name: 'Leg Press',          muscleGroup: 'Pernas' },
    { name: 'Cadeira Extensora',  muscleGroup: 'Pernas' },
    { name: 'Mesa Flexora',       muscleGroup: 'Pernas' },
    { name: 'Desenvolvimento',    muscleGroup: 'Ombros' },
    { name: 'Elevação Lateral',   muscleGroup: 'Ombros' },
    { name: 'Rosca Direta',       muscleGroup: 'Bíceps' },
    { name: 'Tríceps Testa',      muscleGroup: 'Tríceps' },
    { name: 'Prancha Abdominal',  muscleGroup: 'Core' },
  ];

  const exercises = {};
  for (const e of exercisesData) {
    const existing = await prisma.exercise.findFirst({ where: { name: e.name } });
    if (existing) {
      exercises[e.name] = existing;
      continue;
    }
    const created = await prisma.exercise.create({ data: { ...e, active: true } });
    exercises[e.name] = created;
  }
  ok(`${Object.keys(exercises).length} exercícios garantidos`);

  log('');

  // ==========================================================
  // 4. STUDENTS (legados + novos)
  // ==========================================================
  const studentsData = [
    // legados (com legacyId — vindos do sistema antigo)
    { legacyId: '1042', name: 'João Silva',    email: 'joao@example.com',   phone: '+5511999990001' },
    { legacyId: '1043', name: 'Maria Souza',   email: 'maria@example.com',  phone: '+5511999990002' },
    { legacyId: '1044', name: 'Pedro Costa',   email: 'pedro@example.com',  phone: '+5511999990003' },
    { legacyId: '1045', name: 'Ana Oliveira',  email: 'ana@example.com',    phone: '+5511999990004' },
    { legacyId: '1046', name: 'Lucas Pereira', email: null,                 phone: '+5511999990005' }, // sem email
    { legacyId: '1047', name: 'Carla Mendes',  email: 'carla@example.com',  phone: null },           // sem fone

    // novos (sem legacyId)
    { legacyId: null,   name: 'Aluno Novo 1',  email: 'novo1@example.com',  phone: '+5511999990101' },
  ];

  const students = {};
  for (const s of studentsData) {
    const key = s.legacyId || s.email || s.name;
    const existing = s.legacyId
      ? await prisma.student.findUnique({ where: { legacyId: s.legacyId } })
      : await prisma.student.findFirst({ where: { name: s.name } });

    if (existing) {
      students[key] = existing;
      continue;
    }

    const created = await prisma.student.create({
      data: {
        legacyId: s.legacyId,
        name: s.name,
        email: s.email ?? null,
        phone: s.phone ?? null,
        active: true,
      },
    });
    students[key] = created;
    ok(`aluno criado: ${s.name}` + (s.legacyId ? ` (legacyId: ${s.legacyId})` : ''));
  }

  log('');

  // ==========================================================
  // 5. VINCULAR User ALUNO → Student "Aluno Teste"
  // ==========================================================
  if (users.ALUNO) {
    const alunoTeste = students['Aluno Novo 1'] ||
      Object.values(students).find(s => s.name === 'Aluno Novo 1');
    if (alunoTeste && !alunoTeste.userId) {
      await prisma.student.update({
        where: { id: alunoTeste.id },
        data: { userId: users.ALUNO.id, email: users.ALUNO.email },
      });
      ok(`vinculado ${alunoTeste.name} → ${users.ALUNO.email}`);
    }
  }

  log('');

  // ==========================================================
  // 6. MEMBERSHIPS (matrículas ativas para 3 alunos)
  // ==========================================================
  const planMensal = plans['Mensal'];
  const hoje = new Date();
  const daqui30 = new Date(hoje);
  daqui30.setDate(daqui30.getDate() + 30);

  const membershipsData = [
    { student: students['1042'], status: 'ATIVA' },   // João — ativo
    { student: students['1043'], status: 'ATIVA' },   // Maria — ativa
    { student: students['1044'], status: 'ATIVA' },   // Pedro — ativo
    { student: students['1045'], status: 'VENCIDA' }, // Ana — vencida
  ];

  for (const m of membershipsData) {
    if (!m.student || !planMensal) continue;
    const existing = await prisma.membership.findFirst({
      where: { studentId: m.student.id, planId: planMensal.id },
    });
    if (existing) {
      warn(`matrícula já existe: ${m.student.name} — pulando`);
      continue;
    }
    await prisma.membership.create({
      data: {
        studentId: m.student.id,
        planId: planMensal.id,
        startDate: hoje,
        endDate: m.status === 'VENCIDA' ? new Date(hoje.getTime() - 86400000) : daqui30,
        priceAtPurchase: planMensal.price,
        status: m.status,
      },
    });
    ok(`matrícula criada: ${m.student.name} (${m.status})`);
  }

  log('');

  // ==========================================================
  // 7. CHECKINS (exemplos dos últimos dias)
  // ==========================================================
  const joao = students['1042'];
  if (joao && users.ADMIN) {
    const activeMembership = await prisma.membership.findFirst({
      where: { studentId: joao.id, status: 'ATIVA' },
    });

    const existingCheckins = await prisma.checkin.count({ where: { studentId: joao.id } });
    if (existingCheckins === 0 && activeMembership) {
      const checks = [
        { daysAgo: 0, type: 'ENTRADA', status: 'AUTORIZADO' },
        { daysAgo: 1, type: 'ENTRADA', status: 'AUTORIZADO' },
        { daysAgo: 1, type: 'SAIDA',   status: 'AUTORIZADO' },
        { daysAgo: 3, type: 'ENTRADA', status: 'AUTORIZADO' },
        { daysAgo: 5, type: 'ENTRADA', status: 'NEGADO', reason: 'Sem matrícula ativa' },
      ];
      for (const c of checks) {
        const when = new Date();
        when.setDate(when.getDate() - c.daysAgo);
        when.setHours(10 + Math.floor(Math.random() * 8), 0, 0, 0);
        await prisma.checkin.create({
          data: {
            studentId: joao.id,
            membershipId: c.status === 'AUTORIZADO' ? activeMembership.id : null,
            registeredBy: users.ADMIN.id,
            type: c.type,
            status: c.status,
            reason: c.reason ?? null,
            createdAt: when,
          },
        });
      }
      ok(`${checks.length} check-ins criados para ${joao.name}`);
    } else if (existingCheckins > 0) {
      warn(`check-ins de ${joao.name} já existem (${existingCheckins}) — pulando`);
    }
  }

  log('');

  // ==========================================================
  // 8. INVITES (3 estados diferentes)
  // ==========================================================
  if (!users.ADMIN) {
    warn('sem ADMIN — pulando invites');
  } else {
    const inviteScenarios = [
      {
        label: 'PENDING (aguardando envio)',
        student: students['1043'],       // Maria
        type: 'ALUNO',
        status: 'PENDING',
        ttlDays: 30,
        sent: false,
      },
      {
        label: 'SENT (já enviado)',
        student: students['1044'],       // Pedro
        type: 'ALUNO',
        status: 'SENT',
        ttlDays: 30,
        sent: true,
        sentVia: 'whatsapp',
      },
      {
        label: 'ACCEPTED (já aceito)',
        student: students['1045'],       // Ana
        type: 'ALUNO',
        status: 'ACCEPTED',
        ttlDays: 30,
        sent: true,
        sentVia: 'whatsapp',
        accepted: true,
      },
    ];

    for (const sc of inviteScenarios) {
      if (!sc.student) continue;

      const existing = await prisma.invite.findFirst({
        where: { studentId: sc.student.id },
      });
      if (existing) {
        warn(`invite já existe para ${sc.student.name} — pulando`);
        continue;
      }

      const id = generateInviteId();
      const nonce = generateInviteNonce();
      const expiresAt = new Date(Date.now() + sc.ttlDays * 24 * 60 * 60 * 1000);
      const exp = Math.floor(expiresAt.getTime() / 1000);
      const hmac = signInvite({ id, exp, nonce });
      const token = `${id}.${hmac}`;

      await prisma.invite.create({
        data: {
          id,
          token,
          hmac,
          createdById: users.ADMIN.id,
          studentId: sc.student.id,
          email: sc.student.email,
          phone: sc.student.phone,
          name: sc.student.name,
          type: sc.type,
          status: sc.status,
          expiresAt,
          sentAt: sc.sent ? new Date() : null,
          sentVia: sc.sentVia ?? null,
          acceptedAt: sc.accepted ? new Date() : null,
        },
      });

      ok(`invite [${sc.label}] → ${sc.student.name}`);
      console.log(`      ${buildInviteUrl(token)}`);
    }
  }

  log('');

  // ==========================================================
  // SUMÁRIO
  // ==========================================================
  const counts = {
    users:       await prisma.user.count(),
    students:    await prisma.student.count(),
    plans:       await prisma.plan.count(),
    exercises:   await prisma.exercise.count(),
    memberships: await prisma.membership.count(),
    checkins:    await prisma.checkin.count(),
    invites:     await prisma.invite.count(),
  };

  console.log('\n════════════════════════════════════════════');
  console.log('  SEED CONCLUÍDO');
  console.log('════════════════════════════════════════════');
  console.log(`  Usuários      : ${counts.users}`);
  console.log(`  Alunos        : ${counts.students}`);
  console.log(`  Planos        : ${counts.plans}`);
  console.log(`  Exercícios    : ${counts.exercises}`);
  console.log(`  Matrículas    : ${counts.memberships}`);
  console.log(`  Check-ins     : ${counts.checkins}`);
  console.log(`  Convites      : ${counts.invites}`);
  console.log('════════════════════════════════════════════\n');

  console.log('  Credenciais de teste (senha: senha123456):');
  console.log(`    admin@triad.com     → ADMIN`);
  console.log(`    professor@triad.com → PROFESSOR`);
  console.log(`    recepcao@triad.com  → RECEPCAO`);
  console.log(`    aluno@triad.com     → ALUNO`);
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