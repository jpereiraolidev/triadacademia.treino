// ============================================
// prisma/seed.js — Seed idempotente
// Triad Academia · v3.0
//
// Popula o banco com 3 usuários admin para teste.
//
// Idempotente: usa upsert por chave única (email).
// Rodar N vezes não duplica.
//
// Uso:
//   npx prisma db seed
//   # ou
//   node prisma/seed.js
// ============================================

import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
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

function log(emoji, msg) {
  console.log(`${emoji} ${msg}`);
}

// ============================================
// SEED
// ============================================

async function main() {
  log('▶', 'Iniciando seed...');

  // ------------------------------------------
  // USERS
  // ------------------------------------------
  log('▶', 'Criando users...');

  const users = [
    {
      name: 'Admin Master',
      email: 'adminmaster@triad.com',
      password: 'admin12345',
      role: 'ADMIN',
    },
    {
      name: 'JP Dev',
      email: 'jpdev@triad.com',
      password: 'jpdev12345',
      role: 'ADMIN',
    },
    {
      name: 'Isak Dev',
      email: 'isakdev@triad.com',
      password: 'isakdev12345',
      role: 'ADMIN',
    },
       {
      name: 'MARCIO APARECIDO',
      email: 'marcioapcfilho@hotmail.com',
      password: 'marcio12345',
      role: 'ADMIN',
    }
  ];

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        name: u.name,
        email: u.email,
        password: await hashPassword(u.password),
        role: u.role,
        active: true,
      },
    });
    log('✔', `user: ${user.email} (role=${user.role}, senha: ${u.password})`);
  }

  // ------------------------------------------
  // RESUMO
  // ------------------------------------------
  log('', '');
  log('✅', 'Seed concluído com sucesso!');
  log('', '');
  log('📋', 'Credenciais para teste:');
  for (const u of users) {
    log('   ', `${u.role.padEnd(8)} → ${u.email} / ${u.password}`);
  }
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