#!/usr/bin/env node
// ============================================================
// limpar-testes.js — Triad Academia
// Remove dados de teste que ficaram em produção.
//
// Uso:
//   node limpar-testes.js              → DRY-RUN (só mostra)
//   node limpar-testes.js --execute    → DELETA de verdade
//
// Requer no .env:
//   DATABASE_URL=...
// ============================================================

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const EXECUTE = process.argv.includes('--execute');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
  bRed: '\x1b[91m', bGreen: '\x1b[92m', bYellow: '\x1b[93m',
  bCyan: '\x1b[96m', bWhite: '\x1b[97m',
};
const paint = (c, s) => c + s + C.reset;

// ============================================================
// PADRÕES DE TESTE (ajuste conforme necessário)
// ============================================================
const PATTERNS = {
  exercises: {
    label: 'Exercícios de teste',
    where: {
      OR: [
        { name: { startsWith: '__TEST__' } },
        { name: { contains: 'DROP TABLE' } },
        { name: { in: ['Teste', 'Exercício Teste ZZ', 'Exercise URL inválida'] } },
      ],
    },
  },
  students: {
    label: 'Alunos de teste',
    where: {
      OR: [
        { name: { startsWith: 'Import Test' } },
        { name: { startsWith: 'Dup Test' } },
        { name: { startsWith: 'Mass Assignment' } },
        { name: { startsWith: 'Testerotas' } },
        { name: { startsWith: 'Bulk ' } },
        { name: { startsWith: 'Aluno Teste' } },
        { email: { startsWith: 'imp-b-' } },
        { email: { startsWith: 'bulk-' } },
        { email: { startsWith: 'aluno-teste-' } },
        { email: { startsWith: 'grupoj-' } },
      ],
    },
  },
  users: {
    label: 'Users de teste',
    where: {
      OR: [
        { email: { startsWith: 'aluno-teste-' } },
        { email: { startsWith: 'grupoj-' } },
        { email: { startsWith: 'bulk-' } },
        { email: { startsWith: 'test-' } },
        { email: { startsWith: 'teste-' } },
      ],
    },
  },
  invites: {
    label: 'Invites de teste',
    where: {
      OR: [
        { phone: { startsWith: '+5511900' } },
        { phone: { startsWith: '+5511999990' } },
        { phone: { startsWith: '+5511999999' } },
        { phone: { startsWith: '+5511977770' } },
        { email: { startsWith: 'bulk-' } },
        { email: { startsWith: 'aluno-teste-' } },
        { email: { startsWith: 'outro-' } },
        { email: { startsWith: 'grupoj-' } },
        { name:  { startsWith: 'Testerotas' } },
        { name:  { startsWith: 'Bulk ' } },
      ],
    },
  },
  plans: {
    label: 'Planos de teste',
    where: {
      OR: [
        { name: { startsWith: 'Plano Teste' } },
        { name: { in: ['x', 'Plano x'] } },
      ],
    },
  },
};

// ============================================================
// HELPERS
// ============================================================
function hr(len = 72) { return '─'.repeat(len); }

async function preview(model, key) {
  const cfg = PATTERNS[key];
  if (!cfg) return null;

  const items = await prisma[model].findMany({
    where: cfg.where,
    select: model === 'exercise' ? { id: true, name: true, active: true, createdAt: true }
          : model === 'student'  ? { id: true, name: true, email: true, createdAt: true }
          : model === 'user'     ? { id: true, name: true, email: true, role: true, createdAt: true }
          : model === 'invite'   ? { id: true, phone: true, email: true, name: true, status: true, createdAt: true }
          : model === 'plan'     ? { id: true, name: true, price: true, active: true, createdAt: true }
          : { id: true },
    orderBy: { createdAt: 'desc' },
  });

  return { key, model, label: cfg.label, items, count: items.length };
}

function printPreview(p) {
  console.log('');
  console.log(paint(C.bCyan + C.bold, `  ${hr(72)}`));
  console.log(paint(C.bCyan + C.bold, `  ${p.label}`) +
    paint(C.gray, ` (${p.count} encontrado${p.count === 1 ? '' : 's'})`));
  console.log(paint(C.bCyan + C.bold, `  ${hr(72)}`));

  if (p.count === 0) {
    console.log(paint(C.green, '  ✓ Nada para limpar'));
    return;
  }

  for (const item of p.items) {
    const created = item.createdAt ? new Date(item.createdAt).toISOString().slice(0, 10) : '?';
    const main = item.name || item.email || item.phone || item.id;

    if (p.model === 'exercise') {
      const activeTag = item.active ? paint(C.bGreen, 'ativo') : paint(C.gray, 'inativo');
      console.log(`  ${paint(C.bRed, '✗')} [${created}] ${main} ${paint(C.gray, `(${activeTag})`)}`);
    } else if (p.model === 'student') {
      const email = item.email ? paint(C.gray, ` <${item.email}>`) : '';
      console.log(`  ${paint(C.bRed, '✗')} [${created}] ${main}${email}`);
    } else if (p.model === 'user') {
      console.log(`  ${paint(C.bRed, '✗')} [${created}] ${main} ${paint(C.gray, `(${item.role})`)}`);
    } else if (p.model === 'invite') {
      const status = paint(C.gray, `[${item.status}]`);
      const target = item.phone || item.email || item.name || item.id;
      console.log(`  ${paint(C.bRed, '✗')} [${created}] ${status} ${target}`);
    } else if (p.model === 'plan') {
      const activeTag = item.active ? paint(C.bGreen, 'ativo') : paint(C.gray, 'inativo');
      console.log(`  ${paint(C.bRed, '✗')} [${created}] ${main} R$ ${item.price} ${paint(C.gray, `(${activeTag})`)}`);
    } else {
      console.log(`  ${paint(C.bRed, '✗')} ${main}`);
    }
  }

  if (p.count > 30) {
    console.log(paint(C.gray, `  ... e mais ${p.count - 30}`));
  }
}

async function execute(p) {
  if (p.count === 0) return 0;

  const deleted = await prisma[p.model].deleteMany({ where: PATTERNS[p.key].where });
  return deleted.count;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('');
  console.log(paint(C.bCyan + C.bold, '  ╔══════════════════════════════════════════════════════════════════════╗'));
  console.log(paint(C.bCyan + C.bold, '  ║  LIMPEZA DE DADOS DE TESTE — Triad Academia                           ║'));
  console.log(paint(C.bCyan + C.bold, '  ╚══════════════════════════════════════════════════════════════════════╝'));
  console.log('');

  // Modo
  if (EXECUTE) {
    console.log(paint(C.bRed + C.bold, '  ⚠  MODO EXECUTE — os dados serão DELETADOS permanentemente.'));
  } else {
    console.log(paint(C.bYellow, '  ℹ  MODO DRY-RUN — nada será deletado.'));
    console.log(paint(C.gray, '     Rode com --execute para aplicar de verdade.'));
  }

  // Banco
  if (process.env.DATABASE_URL) {
    const masked = process.env.DATABASE_URL.replace(/(:\/\/[^:]+:)[^@]+@/, '$1****@');
    console.log(paint(C.gray, `  Banco: ${masked.slice(0, 90)}`));
  }
  console.log('');

  // Confirma ambiente
  const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
  const isPooled = /pooled\.db\.prisma\.io/.test(process.env.DATABASE_URL || '');
  if (isPooled) {
    console.log(paint(C.bRed + C.bold, '  ⚠  ATENÇÃO: DATABASE_URL aponta para o banco POOLED (produção)'));
  } else if (isLocal) {
    console.log(paint(C.bGreen, '  ✓ Banco LOCAL'));
  }
  console.log('');

  // Preview de cada modelo
  const previews = [];
  previews.push(await preview('exercise', 'exercises'));
  previews.push(await preview('student',  'students'));
  previews.push(await preview('user',     'users'));
  previews.push(await preview('invite',   'invites'));
  previews.push(await preview('plan',     'plans'));

  for (const p of previews) printPreview(p);

  // Total
  const total = previews.reduce((a, p) => a + p.count, 0);

  console.log('');
  console.log(paint(C.bCyan + C.bold, `  ${hr(72)}`));
  console.log(paint(C.bWhite + C.bold, `  Total a deletar: ${total} registros`));
  console.log(paint(C.bCyan + C.bold, `  ${hr(72)}`));
  console.log('');

  // Execução
  if (EXECUTE) {
    if (total === 0) {
      console.log(paint(C.green, '  ✓ Nada para deletar.'));
      return;
    }

    console.log(paint(C.bRed + C.bold, `  ⚠  Deletando ${total} registros...`));
    console.log('');

    const results = [];
    // Ordem importa: filhos antes dos pais (FK constraints)
    for (const key of ['invites', 'users', 'students', 'exercises', 'plans']) {
      const p = previews.find(x => x.key === key);
      if (!p || p.count === 0) continue;

      try {
        const count = await execute(p);
        results.push({ label: p.label, count });
        console.log(paint(C.green, `  ✓ ${p.label}: ${count} deletados`));
      } catch (err) {
        console.log(paint(C.bRed, `  ✗ ${p.label}: ${err.message}`));
      }
    }

    console.log('');
    const totalDeleted = results.reduce((a, r) => a + r.count, 0);
    console.log(paint(C.bGreen + C.bold, `  ✅ ${totalDeleted} registros deletados.`));
  } else {
    console.log(paint(C.bYellow, `  Rode com --execute para deletar esses ${total} registros.`));
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
    console.error(`\n  💥 Erro: ${err.message}\n`);
    await prisma.$disconnect();
    process.exit(1);
  });