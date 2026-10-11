#!/usr/bin/env node
// ============================================================
// geradordeconvite.js — Triad Academia
// Gerador + decodificador de links de convite
//
// Uso:
//   node geradordeconvite.js gerar --legacyId=1042 --name="João Silva" --phone="+5511999999999"
//   node geradordeconvite.js gerar --legacyId=1042 --name="João" --email="joao@x.com" --ttl=30
//   node geradordeconvite.js gerar-lote --file=clientes.json --ttl=30
//   node geradordeconvite.js decodificar --link="https://.../invite?t=..."
//   node geradordeconvite.js decodificar --token="abc123..."
//   node geradordeconvite.js validar --link="https://.../invite?t=..." (verifica expiração)
//
// Requisitos:
//   - INVITE_SECRET no .env (mín. 32 chars)
//   - Gere com: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
// ============================================================

import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCRIPT_VERSION = '1.0.0';

// ============================================================
// CONFIG
// ============================================================
const TAG = '[geradordeconvite]';
const INVITE_SECRET = process.env.INVITE_SECRET;
const APP_URL = (process.env.APP_URL || 'https://triadacademiatreino.vercel.app').replace(/\/+$/, '');
const INVITE_PATH = process.env.INVITE_PATH || '/invite.html';

// ============================================================
// CORES (simples, sem dependências)
// ============================================================
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
  bRed: '\x1b[91m', bGreen: '\x1b[92m', bYellow: '\x1b[93m',
  bCyan: '\x1b[96m', bWhite: '\x1b[97m',
};
const noColor = !process.stdout.isTTY || process.env.NO_COLOR === '1';
const paint = noColor ? (_c, s) => s : (c, s) => c + s + C.reset;

// ============================================================
// VALIDAÇÕES DE BOOT
// ============================================================
if (!INVITE_SECRET) {
  console.error(paint(C.bRed + C.bold, '\n  X ERRO: INVITE_SECRET não definido no .env\n'));
  console.error('  Gere um segredo forte com:');
  console.error('    node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  console.error('  E adicione ao .env:');
  console.error('    INVITE_SECRET=<valor-gerado>\n');
  process.exit(1);
}

if (INVITE_SECRET.length < 32) {
  console.error(paint(C.bRed + C.bold,
    `\n  X ERRO: INVITE_SECRET muito curto (${INVITE_SECRET.length} chars, mínimo 32)\n`));
  process.exit(1);
}

// ============================================================
// PARSING DE ARGS
// ============================================================
function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--')) {
      const [k, ...rest] = a.slice(2).split('=');
      args[k] = rest.join('=') || true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

// ============================================================
// CORE — geração e verificação
// ============================================================

/**
 * Gera payload assinado com HMAC-SHA256.
 *
 * Estrutura:
 *   base64url(JSON payload) + '.' + base64url(HMAC)
 *
 * O payload contém:
 *   - legacyId:  ID no sistema antigo (chave estável)
 *   - name:      nome do aluno (opcional, só para pré-preencher)
 *   - email:     email (opcional)
 *   - phone:     telefone (opcional)
 *   - iat:       issued-at (timestamp Unix)
 *   - exp:       expires-at (timestamp Unix)
 *   - v:         versão do formato
 *   - nonce:     16 bytes aleatórios (evita colisão e replay)
 */
function generateInviteToken({ legacyId, name, email, phone, ttlDays = 30 }) {
  if (!legacyId) throw new Error('legacyId é obrigatório');

  const now = Math.floor(Date.now() / 1000);
  const exp = now + (ttlDays * 24 * 60 * 60);

  const payload = {
    v: 1,
    legacyId: String(legacyId),
    name: name || undefined,
    email: email || undefined,
    phone: phone || undefined,
    iat: now,
    exp,
    nonce: crypto.randomBytes(16).toString('hex'),
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', INVITE_SECRET)
    .update(payloadB64)
    .digest('base64url');

  return `${payloadB64}.${signature}`;
}

/**
 * Decodifica e valida token.
 * Retorna { valid, expired, payload, error }
 */
function decodeInviteToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'token vazio' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'formato inválido (esperado payload.HMAC)' };
  }

  const [payloadB64, signature] = parts;

  // 1. Recalcula HMAC
  const expected = crypto
    .createHmac('sha256', INVITE_SECRET)
    .update(payloadB64)
    .digest('base64url');

  // 2. Comparação em tempo constante
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, error: 'assinatura inválida (token adulterado)' };
  }

  // 3. Decodifica payload
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, error: 'payload ilegível' };
  }

  // 4. Valida versão
  if (payload.v !== 1) {
    return { valid: false, error: `versão não suportada (v=${payload.v})` };
  }

  // 5. Valida expiração
  const now = Math.floor(Date.now() / 1000);
  const expired = payload.exp < now;

  return {
    valid: true,
    expired,
    payload,
    error: expired ? 'token expirado' : null,
  };
}

/**
 * Monta URL final.
 */
function buildInviteUrl(token) {
  return `${APP_URL}${INVITE_PATH}?t=${token}`;
}

/**
 * Converte timestamp Unix para string legível.
 */
function fmtTs(ts) {
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

// ============================================================
// COMANDOS
// ============================================================

function cmdGerar(args) {
  const legacyId = args.legacyId || args.id;
  const name = args.name;
  const email = args.email;
  const phone = args.phone;
  const ttlDays = Number(args.ttl || 30);

  if (!legacyId) {
    console.error(paint(C.bRed, '  X --legacyId é obrigatório'));
    console.error('    Exemplo: node geradordeconvite.js gerar --legacyId=1042 --name="João" --phone="+5511999999999"');
    process.exit(1);
  }

  const token = generateInviteToken({ legacyId, name, email, phone, ttlDays });
  const url = buildInviteUrl(token);
  const decoded = decodeInviteToken(token);

  console.log('');
  console.log(paint(C.bCyan + C.bold, '  ┌─── CONVITE GERADO ──────────────────────────────────────────'));
  console.log(paint(C.bCyan, '  │'));
  console.log(paint(C.bCyan, '  │ ') + paint(C.bWhite, 'Legacy ID : ') + paint(C.bGreen, String(legacyId)));
  if (name)  console.log(paint(C.bCyan, '  │ ') + paint(C.bWhite, 'Nome      : ') + name);
  if (email) console.log(paint(C.bCyan, '  │ ') + paint(C.bWhite, 'Email     : ') + email);
  if (phone) console.log(paint(C.bCyan, '  │ ') + paint(C.bWhite, 'Telefone  : ') + phone);
  console.log(paint(C.bCyan, '  │ ') + paint(C.bWhite, 'Expira em : ') + paint(C.bYellow, fmtTs(decoded.payload.exp)));
  console.log(paint(C.bCyan, '  │ ') + paint(C.bWhite, 'TTL       : ') + `${ttlDays} dia(s)`);
  console.log(paint(C.bCyan, '  │'));
  console.log(paint(C.bCyan, '  ├─── TOKEN ──────────────────────────────────────────────────'));
  console.log(paint(C.bCyan, '  │'));
  console.log('  ' + paint(C.gray, token));
  console.log(paint(C.bCyan, '  │'));
  console.log(paint(C.bCyan, '  ├─── LINK ───────────────────────────────────────────────────'));
  console.log(paint(C.bCyan, '  │'));
  console.log('  ' + paint(C.bGreen + C.bold, url));
  console.log(paint(C.bCyan, '  │'));
  console.log(paint(C.bCyan + C.bold, '  └─────────────────────────────────────────────────────────────'));
  console.log('');
}

function cmdDecodificar(args) {
  let token = args.token;

  if (!token && args.link) {
    try {
      const u = new URL(args.link);
      token = u.searchParams.get('t');
    } catch {
      console.error(paint(C.bRed, '  X --link inválido'));
      process.exit(1);
    }
  }

  if (!token) {
    console.error(paint(C.bRed, '  X forneça --token ou --link'));
    process.exit(1);
  }

  const result = decodeInviteToken(token);

  console.log('');
  if (!result.valid) {
    console.log(paint(C.bRed + C.bold, '  ✗ TOKEN INVÁLIDO'));
    console.log('  ' + paint(C.bRed, result.error));
    console.log('');
    process.exit(2);
  }

  if (result.expired) {
    console.log(paint(C.bYellow + C.bold, '  ⚠ TOKEN EXPIRADO'));
  } else {
    console.log(paint(C.bGreen + C.bold, '  ✓ TOKEN VÁLIDO'));
  }
  console.log('');
  console.log(paint(C.bCyan, '  ─── PAYLOAD ──────────────────────────────────────────────────'));
  console.log('  ' + paint(C.bWhite, 'Versão    : ') + result.payload.v);
  console.log('  ' + paint(C.bWhite, 'Legacy ID : ') + paint(C.bGreen, result.payload.legacyId));
  if (result.payload.name)  console.log('  ' + paint(C.bWhite, 'Nome      : ') + result.payload.name);
  if (result.payload.email) console.log('  ' + paint(C.bWhite, 'Email     : ') + result.payload.email);
  if (result.payload.phone) console.log('  ' + paint(C.bWhite, 'Telefone  : ') + result.payload.phone);
  console.log('  ' + paint(C.bWhite, 'Emitido   : ') + fmtTs(result.payload.iat));
  console.log('  ' + paint(C.bWhite, 'Expira    : ') + paint(C.bYellow, fmtTs(result.payload.exp)));
  console.log('  ' + paint(C.bWhite, 'Nonce     : ') + paint(C.gray, result.payload.nonce));
  console.log('');
}

function cmdGerarLote(args) {
  const file = args.file;
  if (!file) {
    console.error(paint(C.bRed, '  X --file é obrigatório'));
    process.exit(1);
  }

  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error(paint(C.bRed, `  X arquivo não encontrado: ${abs}`));
    process.exit(1);
  }

  const ttlDays = Number(args.ttl || 30);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    console.error(paint(C.bRed, `  X JSON inválido: ${err.message}`));
    process.exit(1);
  }

  if (!Array.isArray(raw)) {
    console.error(paint(C.bRed, '  X o arquivo deve conter um array JSON'));
    process.exit(1);
  }

  const results = raw.map((item, idx) => {
    const legacyId = item.legacyId || item.id;
    if (!legacyId) {
      return { error: `linha ${idx + 1}: legacyId ausente`, raw: item };
    }
    const token = generateInviteToken({
      legacyId,
      name: item.name,
      email: item.email,
      phone: item.phone,
      ttlDays,
    });
    return {
      legacyId,
      name: item.name,
      email: item.email,
      phone: item.phone,
      token,
      url: buildInviteUrl(token),
    };
  });

  const ok = results.filter(r => !r.error);
  const fail = results.filter(r => r.error);

  // JSON para stdout (pipe-friendly)
  if (args.json) {
    process.stdout.write(JSON.stringify({
      generatedAt: new Date().toISOString(),
      ttlDays,
      total: results.length,
      ok: ok.length,
      failed: fail.length,
      invites: ok,
      errors: fail,
    }, null, 2) + '\n');
    return;
  }

  console.log('');
  console.log(paint(C.bCyan + C.bold, `  ─── LOTE: ${ok.length} convite(s) gerado(s) ─────────────────────`));
  console.log('');
  for (const r of ok) {
    console.log(paint(C.bGreen, '  ✓ ') + paint(C.bWhite, r.legacyId) +
      (r.name ? paint(C.gray, ` (${r.name})`) : ''));
    console.log('    ' + paint(C.cyan, r.url));
    console.log('');
  }

  if (fail.length) {
    console.log(paint(C.bRed + C.bold, `  ─── ${fail.length} falha(s) ─────────────────────────────────────`));
    for (const f of fail) {
      console.log(paint(C.bRed, '  ✗ ') + f.error);
    }
    console.log('');
  }
}

function cmdValidar(args) {
  cmdDecodificar(args);
}

// ============================================================
// HELP
// ============================================================
function showHelp() {
  console.log('');
  console.log(paint(C.bCyan + C.bold, `  Gerador de Convites — Triad Academia v${SCRIPT_VERSION}`));
  console.log('');
  console.log(paint(C.bWhite, '  COMANDOS:'));
  console.log('');
  console.log('    ' + paint(C.bGreen, 'gerar') + '            Gera 1 convite avulso');
  console.log('    ' + paint(C.bGreen, 'gerar-lote') + '       Gera vários a partir de um JSON');
  console.log('    ' + paint(C.bGreen, 'decodificar') + '      Valida e mostra o conteúdo de um link/token');
  console.log('    ' + paint(C.bGreen, 'validar') + '          Alias de decodificar');
  console.log('');
  console.log(paint(C.bWhite, '  EXEMPLOS:'));
  console.log('');
  console.log('    # 1 convite para João (30 dias)');
  console.log('    ' + paint(C.gray, 'node geradordeconvite.js gerar --legacyId=1042 --name="João Silva" --phone="+5511999999999"'));
  console.log('');
  console.log('    # 1 convite com email, TTL de 15 dias');
  console.log('    ' + paint(C.gray, 'node geradordeconvite.js gerar --legacyId=1042 --name="João" --email="joao@x.com" --ttl=15'));
  console.log('');
  console.log('    # Lote a partir de clientes.json');
  console.log('    ' + paint(C.gray, 'node geradordeconvite.js gerar-lote --file=clientes.json --ttl=30'));
  console.log('');
  console.log('    # Lote em JSON (para pipes)');
  console.log('    ' + paint(C.gray, 'node geradordeconvite.js gerar-lote --file=clientes.json --json > invites.json'));
  console.log('');
  console.log('    # Decodificar um link');
  console.log('    ' + paint(C.gray, 'node geradordeconvite.js decodificar --link="https://.../invite?t=..."'));
  console.log('');
  console.log(paint(C.bWhite, '  FORMATO DO clientes.json:'));
  console.log('');
  console.log('    ' + paint(C.gray, '['));
  console.log('    ' + paint(C.gray, '  { "legacyId": "1042", "name": "João Silva", "phone": "+5511999999999" },'));
  console.log('    ' + paint(C.gray, '  { "legacyId": "1043", "name": "Maria Souza", "email": "maria@x.com" }'));
  console.log('    ' + paint(C.gray, ']'));
  console.log('');
}

// ============================================================
// MAIN
// ============================================================
(function main() {
  const args = parseArgs(process.argv);
  const cmd = args._[0];

  switch (cmd) {
    case 'gerar':       return cmdGerar(args);
    case 'gerar-lote':  return cmdGerarLote(args);
    case 'decodificar': return cmdDecodificar(args);
    case 'validar':     return cmdValidar(args);
    case '--help':
    case '-h':
    case undefined:
      return showHelp();
    default:
      console.error(paint(C.bRed, `\n  X comando desconhecido: ${cmd}\n`));
      return showHelp();
  }
})();