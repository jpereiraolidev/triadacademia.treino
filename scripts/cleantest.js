// scripts/cleanup-all-students.js
// ============================================
// ZERA TODOS os Students + dependências (Checkins, Memberships,
// Payments, WorkoutPlans, Invites).
//
// ⚠️  IRREVERSÍVEL. Faça backup antes.
//
// Uso:
//   node scripts/cleanup-all-students.js            # dry-run
//   node scripts/cleanup-all-students.js --apply    # deleta (com confirmação)
//   node scripts/cleanup-all-students.js --apply --yes  # sem confirmação
//
// Preserva:
//   - Users (admin, staff, professores)
//   - Plans (Mensal, Trimestral...)
//   - Devices (catraca real)
//   - Settings
//   - SystemLog
// ============================================

import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { prisma, disconnect } from '../src/prisma.js';
import { flush } from '../src/logs.js';

const APPLY = process.argv.includes('--apply');
const YES = process.argv.includes('--yes');

async function countAll() {
  const [students, memberships, checkins, payments, workouts, invites] = await Promise.all([
    prisma.student.count(),
    prisma.membership.count(),
    prisma.checkin.count(),
    prisma.payment.count(),
    prisma.workoutPlan.count(),
    prisma.invite.count(),
  ]);
  return { students, memberships, checkins, payments, workouts, invites };
}

async function cleanup() {
  const c = await countAll();

  console.log('\n📊 Dados que serão DELETADOS (TODOS):');
  console.log(`   Students:     ${c.students}`);
  console.log(`   Memberships:  ${c.memberships}`);
  console.log(`   Checkins:     ${c.checkins}`);
  console.log(`   Payments:     ${c.payments}`);
  console.log(`   WorkoutPlans: ${c.workouts}`);
  console.log(`   Invites:      ${c.invites}`);
  const total = c.students + c.memberships + c.checkins + c.payments + c.workouts + c.invites;
  console.log(`\n   Total: ${total} linhas`);

  console.log('\n✅ PRESERVADOS (não serão tocados):');
  console.log(`   Users, Plans, Devices, Settings, SystemLog`);

  if (total === 0) {
    console.log('\n✅ Nada para limpar.');
    return;
  }

  if (!APPLY) {
    console.log('\n🔍 DRY-RUN — nada foi deletado.');
    console.log('   Para deletar: node scripts/cleanup-all-students.js --apply');
    return;
  }

  if (!YES) {
    const rl = readline.createInterface({ input, output });
    const a = await rl.question('\n⚠️  IRREVERSÍVEL. Confirma deletar TODOS os students? (digite "ZERAR"): ');
    rl.close();
    if (a.trim() !== 'ZERAR') { console.log('❌ Cancelado.'); return; }
  }

  console.log('\n🗑️  Deletando (ordem respeita FKs Restrict)...');

  const r = await prisma.$transaction(async (tx) => {
    const out = {};
    // 1. Checkins (FK Student Restrict)
    out.checkins = (await tx.checkin.deleteMany()).count;
    // 2. Memberships (FK Student Restrict)
    out.memberships = (await tx.membership.deleteMany()).count;
    // 3. Payments (FK Student Restrict)
    out.payments = (await tx.payment.deleteMany()).count;
    // 4. WorkoutPlans (FK Student Restrict) — cascade deleta WorkoutExercise
    out.workouts = (await tx.workoutPlan.deleteMany()).count;
    // 5. Invites (FK Student SetNull)
    out.invites = (await tx.invite.deleteMany()).count;
    // 6. Students (por último)
    out.students = (await tx.student.deleteMany()).count;
    return out;
  }, { timeout: 60000 });

  console.log('\n✅ Limpeza concluída:');
  for (const [k, v] of Object.entries(r)) if (v > 0) console.log(`   ${k}: ${v} deletado(s)`);

  // Confirma o que sobrou
  const [users, plans, devices, settings] = await Promise.all([
    prisma.user.findMany({ select: { email: true, role: true, active: true } }),
    prisma.plan.findMany({ select: { name: true, active: true } }),
    prisma.device.findMany({ select: { name: true, identifier: true, active: true } }),
    prisma.settings.findUnique({ where: { id: 1 } }),
  ]);

  console.log(`\n👤 Users preservados (${users.length}):`);
  for (const u of users) console.log(`   ${u.role.padEnd(10)} ${u.email}  active=${u.active}`);

  console.log(`\n📋 Plans preservados (${plans.length}):`);
  for (const p of plans) console.log(`   ${p.name}  active=${p.active}`);

  console.log(`\n🔑 Devices preservados (${devices.length}):`);
  for (const d of devices) console.log(`   ${d.name} (${d.identifier})  active=${d.active}`);

  console.log(`\n⚙️  Settings preservado: ${settings?.nomeAcademia || '(não existe)'}`);
}

async function main() {
  console.log('🧹 Triad Academia — ZERAR TODOS os Students');
  console.log(`   Modo: ${APPLY ? '⚠️  APPLY (vai deletar)' : '🔍 DRY-RUN (só mostra)'}`);
  console.log(`   Data: ${new Date().toISOString()}`);

  try { await cleanup(); }
  catch (err) {
    console.error('\n💥 Erro:', err.message);
    if (err.code) console.error(`   code=${err.code}`);
    process.exitCode = 1;
  } finally {
    await flush(3000);
    await disconnect();
  }
}

main();