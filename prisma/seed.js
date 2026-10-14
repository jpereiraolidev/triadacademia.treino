// ============================================
// prisma/seed.js — Seed idempotente
// Triad Academia · v3.0
//
// Popula o banco com dados mínimos para:
//   - Login de admin
//   - Testar CRUD de alunos, planos, matrículas
//   - Testar check-in via device
//   - Testar criação de treinos
//   - Testar convites
//
// Idempotente: usa upsert por chave única (email, identifier,
// legacyId, token). Rodar N vezes não duplica.
//
// Uso:
//   npx prisma db seed
//   # ou
//   node prisma/seed.js
// ============================================

import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import 'dotenv/config';

const prisma = new PrismaClient();

// ============================================
// HELPERS
// ============================================

const argonOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

async function hashPassword(plain) {
  return argon2.hash(plain, argonOptions);
}

function generateDeviceKey() {
  return crypto.randomBytes(32).toString('hex');
}

function hashDeviceKey(rawKey, pepper = '') {
  return crypto
    .createHash('sha256')
    .update(pepper + rawKey)
    .digest('hex');
}

function log(emoji, msg) {
  console.log(`${emoji} ${msg}`);
}

// ============================================
// SEED
// ============================================

async function main() {
  log('▶', 'Iniciando seed...');

  const PEPPER = process.env.DEVICE_KEY_PEPPER || '';
  if (!PEPPER) {
    log('⚠', 'DEVICE_KEY_PEPPER vazio — chaves de device sem pepper (ok em dev).');
  }

  // ------------------------------------------
  // 1. USERS (admin, professor, recepção)
  // ------------------------------------------
  log('▶', 'Criando users...');

  const adminPassword = 'admin12345';
  const professorPassword = 'prof12345';
  const recepcaoPassword = 'recep12345';

  const admin = await prisma.user.upsert({
    where: { email: 'admin@triad.com' },
    update: {},
    create: {
      name: 'Admin Triad',
      email: 'admin@triad.com',
      password: await hashPassword(adminPassword),
      role: 'ADMIN',
      active: true,
    },
  });
  log('✔', `admin: ${admin.email} (senha: ${adminPassword})`);

  const professor = await prisma.user.upsert({
    where: { email: 'professor@triad.com' },
    update: {},
    create: {
      name: 'Professor Triad',
      email: 'professor@triad.com',
      password: await hashPassword(professorPassword),
      role: 'PROFESSOR',
      active: true,
    },
  });
  log('✔', `professor: ${professor.email} (senha: ${professorPassword})`);

  const recepcao = await prisma.user.upsert({
    where: { email: 'recepcao@triad.com' },
    update: {},
    create: {
      name: 'Recepção Triad',
      email: 'recepcao@triad.com',
      password: await hashPassword(recepcaoPassword),
      role: 'RECEPCAO',
      active: true,
    },
  });
  log('✔', `recepcao: ${recepcao.email} (senha: ${recepcaoPassword})`);

  // ------------------------------------------
  // 2. ALUNOS (um com User, um legado sem User)
  // ------------------------------------------
  log('▶', 'Criando alunos...');

  // Aluno 1 — legado, sem User vinculado
  const alunoLegado = await prisma.student.upsert({
    where: { legacyId: 'LEG-0001' },
    update: {},
    create: {
      legacyId: 'LEG-0001',
      name: 'João Aluno Legado',
      email: 'joao.legado@example.com',
      phone: '+55 11 99999-0001',
      birthDate: new Date('1990-05-15'),
      active: true,
    },
  });
  log('✔', `aluno legado: ${alunoLegado.name} (legacyId=${alunoLegado.legacyId})`);

  // Aluno 2 — com User vinculado (role ALUNO)
  const alunoUser = await prisma.user.upsert({
    where: { email: 'aluno@triad.com' },
    update: {},
    create: {
      name: 'Maria Aluna',
      email: 'aluno@triad.com',
      password: await hashPassword('aluno12345'),
      role: 'ALUNO',
      active: true,
    },
  });

  const alunoComUser = await prisma.student.upsert({
    where: { email: 'aluno@triad.com' },
    update: { userId: alunoUser.id },
    create: {
      name: 'Maria Aluna',
      email: 'aluno@triad.com',
      phone: '+55 11 99999-0002',
      birthDate: new Date('1995-08-22'),
      userId: alunoUser.id,
      active: true,
    },
  });
  log('✔', `aluno com user: ${alunoComUser.name} (userId=${alunoComUser.userId})`);

  // ------------------------------------------
  // 3. PLANOS
  // ------------------------------------------
  log('▶', 'Criando planos...');

  const planoMensal = await prisma.plan.upsert({
    where: { id: 'plan-mensal-001' },
    update: {},
    create: {
      id: 'plan-mensal-001',
      name: 'Mensal',
      description: 'Acesso livre por 30 dias',
      price: 149.9,
      durationDays: 30,
      active: true,
    },
  });
  log('✔', `plano: ${planoMensal.name} (R$ ${planoMensal.price})`);

  const planoTri = await prisma.plan.upsert({
    where: { id: 'plan-tri-001' },
    update: {},
    create: {
      id: 'plan-tri-001',
      name: 'Trimestral',
      description: 'Acesso livre por 90 dias',
      price: 399.9,
      durationDays: 90,
      active: true,
    },
  });
  log('✔', `plano: ${planoTri.name} (R$ ${planoTri.price})`);

  // ------------------------------------------
  // 4. MATRÍCULAS
  // ------------------------------------------
  log('▶', 'Criando matrículas...');

  const hoje = new Date();
  const fimMensal = new Date(hoje);
  fimMensal.setDate(fimMensal.getDate() + 30);

  const matricula = await prisma.membership.create({
    data: {
      studentId: alunoComUser.id,
      planId: planoMensal.id,
      startDate: hoje,
      endDate: fimMensal,
      priceAtPurchase: planoMensal.price,
      status: 'ATIVA',
    },
  });
  log('✔', `matrícula ativa para ${alunoComUser.name} até ${fimMensal.toLocaleDateString('pt-BR')}`);

  // ------------------------------------------
  // 5. DEVICE (catraca)
  // ------------------------------------------
  log('▶', 'Criando device...');

  const rawDeviceKey = generateDeviceKey();
  const deviceHash = hashDeviceKey(rawDeviceKey, PEPPER);

  const device = await prisma.device.upsert({
    where: { identifier: 'CATRACA-01' },
    update: {},
    create: {
      name: 'Catraca Principal',
      identifier: 'CATRACA-01',
      apiKeyHash: deviceHash,
      active: true,
    },
  });
  log('✔', `device: ${device.name} (identifier=${device.identifier})`);
  log('🔑', `API KEY (guarde, não será exibida novamente): ${rawDeviceKey}`);

  // ------------------------------------------
  // 6. EXERCÍCIOS
  // ------------------------------------------
  log('▶', 'Criando exercícios...');

  const exercicios = [
    { id: 'ex-supino', name: 'Supino Reto', muscleGroup: 'Peito', description: 'Barra, banco reto' },
    { id: 'ex-agachamento', name: 'Agachamento Livre', muscleGroup: 'Pernas', description: 'Barra, livre' },
    { id: 'ex-remada', name: 'Remada Curvada', muscleGroup: 'Costas', description: 'Barra' },
    { id: 'ex-desenvolvimento', name: 'Desenvolvimento Militar', muscleGroup: 'Ombros', description: 'Barra' },
    { id: 'ex-rosca', name: 'Rosca Direta', muscleGroup: 'Bíceps', description: 'Barra W' },
    { id: 'ex-triceps', name: 'Tríceps Testa', muscleGroup: 'Tríceps', description: 'Barra W' },
  ];

  for (const ex of exercicios) {
    await prisma.exercise.upsert({
      where: { id: ex.id },
      update: {},
      create: { ...ex, active: true },
    });
    log('✔', `exercício: ${ex.name} (${ex.muscleGroup})`);
  }

  // ------------------------------------------
  // 7. TREINO DE EXEMPLO (com 3 exercícios)
  // ------------------------------------------
  log('▶', 'Criando treino de exemplo...');

  const treino = await prisma.workoutPlan.create({
    data: {
      studentId: alunoComUser.id,
      createdBy: professor.id,
      name: 'Treino A — Peito/Tríceps',
      description: 'Treino inicial de adaptação',
      status: 'ATIVO',
      startDate: hoje,
      endDate: new Date(hoje.getTime() + 60 * 24 * 60 * 60 * 1000), // +60 dias
      exercises: {
        create: [
          {
            exerciseId: 'ex-supino',
            order: 0,
            sets: 4,
            repetitions: '10-12',
            weight: 40,
            restSeconds: 60,
          },
          {
            exerciseId: 'ex-desenvolvimento',
            order: 1,
            sets: 3,
            repetitions: '10',
            weight: 20,
            restSeconds: 60,
          },
          {
            exerciseId: 'ex-triceps',
            order: 2,
            sets: 3,
            repetitions: '12',
            weight: 15,
            restSeconds: 45,
          },
        ],
      },
    },
    include: { exercises: true },
  });
  log('✔', `treino: ${treino.name} (${treino.exercises.length} exercícios)`);

  // ------------------------------------------
  // 8. CHECK-IN DE EXEMPLO (via device)
  // ------------------------------------------
  log('▶', 'Criando check-in de exemplo...');

  const checkin = await prisma.checkin.create({
    data: {
      studentId: alunoComUser.id,
      membershipId: matricula.id,
      deviceId: device.id,
      type: 'ENTRADA',
      status: 'AUTORIZADO',
      reason: 'Matrícula ativa',
    },
  });
  log('✔', `check-in: ${checkin.status} (${checkin.type})`);

  // ------------------------------------------
  // 9. CONVITE DE EXEMPLO (com nonce persistido)
  // ------------------------------------------
  log('▶', 'Criando convite de exemplo...');

  const INVITE_SECRET = process.env.INVITE_SECRET;
  if (!INVITE_SECRET) {
    log('⚠', 'INVITE_SECRET ausente — pulando convite de exemplo.');
  } else {
    const inviteId = crypto.randomBytes(12).toString('base64url');
    const nonce = crypto.randomBytes(4).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const exp = Math.floor(expiresAt.getTime() / 1000);

    const hmac = crypto
      .createHmac('sha256', INVITE_SECRET)
      .update(`${inviteId}:${exp}:${nonce}`)
      .digest()
      .subarray(0, 10)
      .toString('base64url');

    const token = `${inviteId}.${hmac}`;

    const invite = await prisma.invite.upsert({
      where: { token },
      update: {},
      create: {
        id: inviteId,
        token,
        hmac,
        nonce,
        createdById: admin.id,
        studentId: alunoLegado.id,
        name: alunoLegado.name,
        email: alunoLegado.email,
        phone: alunoLegado.phone,
        type: 'ALUNO',
        status: 'PENDING',
        expiresAt,
      },
    });

    const APP_URL = (process.env.APP_URL || 'https://triadacademiatreino.vercel.app').replace(/\/+$/, '');
    const INVITE_PATH = process.env.INVITE_PATH || '/i';

    log('✔', `convite criado para ${alunoLegado.name}`);
    log('🔗', `URL: ${APP_URL}${INVITE_PATH}/${invite.token}`);
  }

  // ------------------------------------------
  // RESUMO
  // ------------------------------------------
  log('', '');
  log('✅', 'Seed concluído com sucesso!');
  log('', '');
  log('📋', 'Credenciais para teste:');
  log('   ', `ADMIN     → admin@triad.com     / ${adminPassword}`);
  log('   ', `PROFESSOR → professor@triad.com / ${professorPassword}`);
  log('   ', `RECEPCAO  → recepcao@triad.com  / ${recepcaoPassword}`);
  log('   ', `ALUNO     → aluno@triad.com     / aluno12345`);
  log('', '');
  log('🔑', 'Device API Key (use no header X-Device-Key):');
  log('   ', rawDeviceKey);
  log('', '');
}

// ============================================
// EXECUÇÃO
// ============================================

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error('💥 Seed falhou:', err);
    await prisma.$disconnect();
    process.exit(1);
  });