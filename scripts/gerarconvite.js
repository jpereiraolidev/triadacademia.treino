#!/usr/bin/env node
// ============================================
// scripts/gerar-convite.js
// Gerador de convites da Triad Academia
//
// Uso:
//   node gerar-convite.js                           # modo interativo
//   node gerar-convite.js --email x@y.com --nome "João"
//   node gerar-convite.js --lote convidados.csv
//
// Requer Node 18+ (fetch nativo).
// ============================================

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

// ============================================
// CONFIG
// ============================================
const API_URL      = process.env.API_URL      || 'https://triadacademiatreino.vercel.app/api/v1';
const FRONT_LOCAL  = process.env.FRONT_LOCAL  || 'http://127.0.0.1:5500';
const FRONT_PROD   = process.env.FRONT_PROD   || 'https://triadacademiatreino.vercel.app';
const USAR_LOCAL   = process.env.USAR_LOCAL !== 'false'; // default: true

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@triad.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';

// ============================================
// CLI PARSER
// ============================================
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

// ============================================
// CORES (ANSI)
// ============================================
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  magenta:'\x1b[35m',
};

const ok   = (m) => console.log(`${c.green}✅ ${m}${c.reset}`);
const err  = (m) => console.log(`${c.red}❌ ${m}${c.reset}`);
const info = (m) => console.log(`${c.yellow}ℹ️  ${m}${c.reset}`);
const step = (n, total, m) => console.log(`\n${c.cyan}[${n}/${total}] ${m}${c.reset}`);

// ============================================
// HTTP HELPER
// ============================================
async function api(pathname, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data.error || `HTTP ${res.status}`;
    const e = new Error(msg);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

// ============================================
// CSV PARSER (simples)
// ============================================
function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim());
    const obj = {};
    headers.forEach((h, i) => (obj[h] = cols[i] || ''));
    return obj;
  });
}

// ============================================
// FLUXO PRINCIPAL
// ============================================
async function main() {
  const args = parseArgs(process.argv);

  // ---------- LOGIN ----------
  step(1, 3, 'Fazendo login...');

  let jwt;
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    jwt = data.token;
    ok(`Login OK — ${data.user.name} <${data.user.email}> (${data.user.role})`);
  } catch (e) {
    err(`Falha no login: ${e.message}`);
    process.exit(1);
  }

  // ---------- CRIA CONVITE(S) ----------
  step(2, 3, 'Criando convite(s)...');

  const resultados = [];

  async function criarUm({ email, nome, tipo = 'ALUNO', role, expiresInDays = 7 }) {
    if (!email && !nome) throw new Error('Informe pelo menos email ou nome');
    const body = { type: tipo, expiresInDays };
    if (email) body.email = email;
    if (nome)  body.name  = nome;
    if (tipo === 'STAFF') {
      if (!role) throw new Error('role é obrigatório para STAFF (ADMIN|PROFESSOR|RECEPCAO)');
      body.role = role;
    }

    const res = await api('/invites', { method: 'POST', body, token: jwt });

    const frontBase = USAR_LOCAL ? FRONT_LOCAL : FRONT_PROD;
    const link = `${frontBase}/index.html?token=${res.token}`;

    return {
      id: res.invite.id,
      nome: res.invite.name,
      email: res.invite.email,
      tipo: res.invite.type,
      role: res.invite.role,
      token: res.token,
      link,
      linkApi: res.url,
      expiresAt: res.invite.expiresAt,
    };
  }

  // --- Modo LOTE (CSV) ---
  if (args.lote) {
    const file = path.resolve(args.lote);
    if (!fs.existsSync(file)) {
      err(`Arquivo não encontrado: ${file}`);
      process.exit(1);
    }
    const linhas = parseCsv(fs.readFileSync(file, 'utf-8'));
    info(`CSV carregado: ${linhas.length} linha(s)`);

    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      try {
        const r = await criarUm({
          email: l.email,
          nome: l.nome,
          tipo: l.tipo || 'ALUNO',
          role: l.role || undefined,
        });
        resultados.push(r);
        ok(`[${i + 1}/${linhas.length}] ${l.nome} <${l.email}>`);
      } catch (e) {
        err(`[${i + 1}/${linhas.length}] ${l.email}: ${e.message}`);
      }
    }

  // --- Modo PARÂMETROS ---
  } else if (args.email || args.nome) {
    try {
      const r = await criarUm({
        email: args.email,
        nome: args.nome,
        tipo: args.tipo || 'ALUNO',
        role: args.role,
        expiresInDays: args.dias ? Number(args.dias) : 7,
      });
      resultados.push(r);
      ok('Convite criado!');
    } catch (e) {
      err(`Erro: ${e.message}`);
      if (e.data) console.log(c.dim, JSON.stringify(e.data), c.reset);
      process.exit(1);
    }

  // --- Modo INTERATIVO ---
  } else {
    info('Modo interativo — responda as perguntas abaixo');
    const rl = readline.createInterface({ input, output });

    try {
      const email = (await rl.question('Email do convidado: ')).trim();
      const nome  = (await rl.question('Nome completo do convidado: ')).trim();
      let tipo    = (await rl.question('Tipo (ALUNO|STAFF) [ALUNO]: ')).trim().toUpperCase() || 'ALUNO';
      if (!['ALUNO', 'STAFF'].includes(tipo)) tipo = 'ALUNO';

      let role;
      if (tipo === 'STAFF') {
        role = (await rl.question('Role (ADMIN|PROFESSOR|RECEPCAO): ')).trim().toUpperCase();
      }

      const r = await criarUm({ email, nome, tipo, role });
      resultados.push(r);
      ok('Convite criado!');
    } catch (e) {
      err(`Erro: ${e.message}`);
    } finally {
      rl.close();
    }
  }

  // ---------- OUTPUT ----------
  step(3, 3, 'Resultado');
  console.log(c.dim + '─────────────────────────────────────────────' + c.reset);

  for (const r of resultados) {
    console.log('');
    console.log(`👤 Nome:      ${r.nome}`);
    console.log(`📧 Email:     ${r.email}`);
    console.log(`🎫 Tipo:      ${r.tipo}${r.role ? ` (${r.role})` : ''}`);
    console.log(`⏰ Expira em: ${r.expiresAt}`);
    console.log('');
    console.log(`${c.magenta}🔑 TOKEN:${c.reset}`);
    console.log(`   ${c.magenta}[${r.token}]${c.reset}`);
    console.log(`   (${r.token.length} chars)`);
    console.log('');
    console.log(`${c.cyan}🔗 LINK DO CONVITE:${c.reset}`);
    console.log(`   ${c.cyan}${r.link}${c.reset}`);
    console.log(c.dim + '─────────────────────────────────────────────' + c.reset);
  }

  // ---------- SALVAR ARQUIVOS ----------
  if (resultados.length > 0) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    const csvPath = path.resolve(`convites-${ts}.csv`);
    const header = 'nome,email,tipo,role,link,token,expiresAt\n';
    const rows = resultados.map((r) =>
      [r.nome, r.email, r.tipo, r.role || '', r.link, r.token, r.expiresAt]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(',')
    ).join('\n');
    fs.writeFileSync(csvPath, header + rows, 'utf-8');
    ok(`CSV salvo em: ${csvPath}`);

    const txtPath = path.resolve(`convites-${ts}.txt`);
    fs.writeFileSync(txtPath, resultados.map((r) => r.link).join('\n'), 'utf-8');
    ok(`Links puros em: ${txtPath}`);

    console.log('');
    info('Primeiro link (pra copiar):');
    console.log(`   ${c.bold}${resultados[0].link}${c.reset}`);
  }

  console.log('');
  ok('Concluído!');
}

main().catch((e) => {
  err(`Erro fatal: ${e.message}`);
  process.exit(1);
});