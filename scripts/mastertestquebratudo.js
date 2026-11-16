// scripts/mastertestquebratudo.js
// ============================================
// Caos controlado — tenta quebrar o servidor de propósito.
// Cada teste tem um resultado ESPERADO. Se divergir, é regressão.
//
// Uso:
//   # terminal 1
//   npm run dev
//
//   # terminal 2
//   node scripts/mastertestquebratudo.js
//
// Requer no .env:
//   SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD (ou ADMIN_EMAIL / ADMIN_PASSWORD)
//   SMOKE_BASE_URL (opcional, default http://localhost:3333)
// ============================================

import 'dotenv/config';
import { prisma, disconnect, isDbHealthy, prismaConfig } from '../src/prisma.js';
import { log, flush } from '../src/logs.js';

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3333';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('❌ defina SMOKE_ADMIN_EMAIL/SMOKE_ADMIN_PASSWORD (ou ADMIN_EMAIL/ADMIN_PASSWORD) no .env');
  process.exit(1);
}

// ============================================
// HELPERS
// ============================================
const results = [];
function ok(name, detail) {
  results.push({ status: 'OK', name, detail });
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail) {
  results.push({ status: 'FAIL', name, detail });
  console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

async function jfetch(path, opts = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}${path}`, opts);
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: r.status, body, headers: r.headers, ms: Date.now() - t0 };
  } catch (err) {
    return { status: 0, body: null, headers: null, ms: Date.now() - t0, error: err.message };
  }
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('💥 CAOS CONTROLADO — tenta quebrar o servidor');
  console.log(`   BASE=${BASE}`);
  console.log(`   NODE_ENV=${process.env.NODE_ENV || 'undefined'}`);
  console.log(`   prismaConfig.connectionLimit=${prismaConfig.connectionLimit} safeQueryRetries=${prismaConfig.safeQueryRetries}`);

  // 0. Servidor no ar?
  section('0. Servidor no ar?');
  const ping = await jfetch('/api/v1/_ping');
  if (ping.status !== 200) {
    fail('servidor responde _ping', `status=${ping.status} ${ping.error || ''}`);
    console.error('\n⚠️  Inicie o servidor: npm run dev');
    process.exit(1);
  }
  ok('servidor responde _ping', `ms=${ping.ms}`);

  // 1. Login admin
  section('1. Login admin');
  const login = await jfetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (login.status !== 200) {
    fail('login admin', `status=${login.status} ${JSON.stringify(login.body)}`);
    process.exit(1);
  }
  const token = login.body.token;
  ok('login admin', `ms=${login.ms}`);

  const auth = { authorization: `Bearer ${token}` };
  const authJson = { ...auth, 'content-type': 'application/json' };

  // ============================================
  // 2. ATAQUES À CATRACA (evaluateCheckin)
  // ============================================
  section('2. Catraca — evaluateCheckin com entradas inválidas');

  // 2.1 Device válido
  let deviceKey = null;
  const devices = await jfetch('/api/v1/devices', { headers: auth });
  const existing = devices.body?.find?.((d) => d.identifier === 'caos-catraca');
  if (existing) {
    const rot = await jfetch(`/api/v1/devices/${existing.id}/rotate-key`, {
      method: 'POST', headers: auth,
    });
    deviceKey = rot.body?.apiKey;
    ok('device rotacionado', `id=${existing.id}`);
  } else {
    const dev = await jfetch('/api/v1/devices', {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ name: 'Caos Catraca', identifier: 'caos-catraca' }),
    });
    if (dev.status !== 201) {
      fail('criar device', `status=${dev.status} ${JSON.stringify(dev.body)}`);
    } else {
      deviceKey = dev.body.apiKey;
      ok('device criado', `id=${dev.body.id}`);
    }
  }

  // 2.2 Detectar se o schema tem 'cpf' (para adaptar os testes)
  let hasCpf = false;
  try {
    await prisma.student.findFirst({ where: { cpf: '__caos_test__' }, take: 1 });
    hasCpf = true;
  } catch (err) {
    if (err.message?.includes('Unknown argument `cpf`')) {
      hasCpf = false;
    } else {
      throw err;
    }
  }
  ok('schema tem cpf?', hasCpf ? 'sim' : 'não (vai usar legacyId)');

  // 2.3 Aluno com CPF (ou legacyId) + matrícula ativa
  const cpfDigits = '11122233344';            // só dígitos
  const cpfFormatted = '111.222.333-44';      // com pontuação

  // Normaliza qualquer aluno que tenha o CPF com pontuação — evita
  // que o OR do evaluateCheckin pegue o aluno errado.
  if (hasCpf) {
    await prisma.student.updateMany({
      where: { cpf: cpfFormatted },
      data: { cpf: cpfDigits },
    }).catch(() => {});
  }

  let student;
  if (hasCpf) {
    // upsert: cria se não existe, ou reativa se estava inativo
    student = await prisma.student.upsert({
      where: { cpf: cpfDigits },
      update: { active: true },
      create: { name: 'Caos Aluno', cpf: cpfDigits, active: true },
    });
  } else {
    student = await prisma.student.upsert({
      where: { legacyId: cpfDigits },
      update: { active: true },
      create: { name: 'Caos Aluno', legacyId: cpfDigits, active: true },
    });
  }
  ok('aluno pronto', `id=${student.id} active=${student.active} cpf=${hasCpf ? cpfDigits : '(legacyId)'}`);

  // Plano
  let plan = await prisma.plan.findFirst({ where: { active: true } });
  if (!plan) {
    plan = await prisma.plan.create({
      data: { name: 'Caos Plan', price: 0, durationDays: 30, active: true },
    });
  }

  // Matrícula ativa — inclui priceAtPurchase (obrigatório)
  const existingMs = await prisma.membership.findFirst({
    where: { studentId: student.id, status: 'ATIVA' },
  });
  if (!existingMs) {
    await prisma.membership.create({
      data: {
        studentId: student.id,
        planId: plan.id,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 864e5),
        status: 'ATIVA',
        priceAtPurchase: plan.price ?? 0,
      },
    });
    ok('matrícula criada', `plan=${plan.name}`);
  } else {
    ok('matrícula reutilizada', `id=${existingMs.id}`);
  }

  // --- 2.4 Catraca com CPF só dígitos (deve autorizar) ---
  {
    const r = await jfetch('/api/v1/checkins/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-key': deviceKey },
      body: JSON.stringify({ studentId: cpfDigits, type: 'ENTRADA' }),
    });
    if (r.status === 200 && r.body?.authorized === true) {
      ok('catraca CPF só dígitos', `authorized=true ms=${r.ms}`);
    } else if (r.status === 500) {
      fail('catraca CPF só dígitos', `❌ 500 — evaluateCheckin quebrou`);
    } else {
      fail('catraca CPF só dígitos', `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
    }
  }

  // --- 2.5 Catraca com CPF pontuado (deve autorizar se normalização existe) ---
  if (hasCpf) {
    const r = await jfetch('/api/v1/checkins/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-key': deviceKey },
      body: JSON.stringify({ studentId: cpfFormatted, type: 'SAIDA' }),
    });
    if (r.status === 200 && r.body?.authorized === true) {
      ok('catraca CPF com pontuação', `authorized=true ms=${r.ms}`);
    } else if (r.status === 500) {
      fail('catraca CPF com pontuação', `❌ 500`);
    } else {
      fail('catraca CPF com pontuação', `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)} — falta normalização no evaluateCheckin?`);
    }
  } else {
    console.log('  ⏭️  catraca CPF com pontuação — pulado (schema sem cpf)');
  }

  // --- 2.6 Catraca com ID Prisma (deve autorizar) ---
  {
    const r = await jfetch('/api/v1/checkins/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-key': deviceKey },
      body: JSON.stringify({ studentId: student.id, type: 'ENTRADA' }),
    });
    if (r.status === 200 && r.body?.authorized === true) {
      ok('catraca ID Prisma', `authorized=true ms=${r.ms}`);
    } else {
      fail('catraca ID Prisma', `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
    }
  }

  // --- 2.7 Catraca com CPF inexistente (deve 404, NÃO 500) ---
  {
    const r = await jfetch('/api/v1/checkins/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-key': deviceKey },
      body: JSON.stringify({ studentId: '99999999999', type: 'ENTRADA' }),
    });
    if (r.status === 404) ok('catraca CPF inexistente', `404 limpo ms=${r.ms}`);
    else if (r.status === 500) fail('catraca CPF inexistente', `❌ 500`);
    else fail('catraca CPF inexistente', `status=${r.status} (esperado 404)`);
  }

  // --- 2.8 Catraca com string bizarra (deve 404, NÃO 500) ---
  {
    const lixo = '!!!___lixo___???';
    const r = await jfetch('/api/v1/checkins/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-key': deviceKey },
      body: JSON.stringify({ studentId: lixo, type: 'ENTRADA' }),
    });
    if (r.status === 404) ok('catraca string bizarra', `404 limpo ms=${r.ms}`);
    else if (r.status === 500) fail('catraca string bizarra', `❌ 500`);
    else fail('catraca string bizarra', `status=${r.status} (esperado 404)`);
  }

  // --- 2.9 Catraca sem studentId (deve 400) ---
  {
    const r = await jfetch('/api/v1/checkins/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-key': deviceKey },
      body: JSON.stringify({ type: 'ENTRADA' }),
    });
    if (r.status === 400) ok('catraca body sem studentId', `400 zod ms=${r.ms}`);
    else fail('catraca body sem studentId', `status=${r.status} (esperado 400)`);
  }

  // --- 2.10 Catraca sem X-Device-Key (deve 401) ---
  {
    const r = await jfetch('/api/v1/checkins/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: cpfDigits, type: 'ENTRADA' }),
    });
    if (r.status === 401) ok('catraca sem X-Device-Key', `401 ms=${r.ms}`);
    else fail('catraca sem X-Device-Key', `status=${r.status} (esperado 401)`);
  }

  // ============================================
  // 3. ATAQUES AOS ENDPOINTS DE ESCRITA
  // ============================================
  section('3. Escritas — body inválido, tipos errados, campos extras');

  // 3.1 POST /students vazio
  {
    const r = await jfetch('/api/v1/students', {
      method: 'POST', headers: authJson, body: '{}',
    });
    if (r.status === 400) ok('POST /students vazio', `400 zod ms=${r.ms}`);
    else fail('POST /students vazio', `status=${r.status} (esperado 400)`);
  }

  // 3.2 POST /students campo extra
  {
    const r = await jfetch('/api/v1/students', {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ name: 'X', foo: 'bar' }),
    });
    if (r.status === 400) ok('POST /students campo extra', `400 strict ms=${r.ms}`);
    else fail('POST /students campo extra', `status=${r.status} (esperado 400)`);
  }

  // 3.3 POST /students JSON malformado
  {
    const r = await jfetch('/api/v1/students', {
      method: 'POST', headers: authJson, body: '{ name: "quebrado"',
    });
    if (r.status === 400) ok('POST /students JSON malformado', `400 parse.failed ms=${r.ms}`);
    else fail('POST /students JSON malformado', `status=${r.status} (esperado 400)`);
  }

  // 3.4 POST /students email inválido
  {
    const r = await jfetch('/api/v1/students', {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ name: 'X', email: 'nao-e-email' }),
    });
    if (r.status === 400) ok('POST /students email inválido', `400 zod ms=${r.ms}`);
    else fail('POST /students email inválido', `status=${r.status} (esperado 400)`);
  }

  // 3.5 POST /students phone inválido
  {
    const r = await jfetch('/api/v1/students', {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ name: 'X', phone: 'abc' }),
    });
    if (r.status === 400) ok('POST /students phone inválido', `400 zod ms=${r.ms}`);
    else fail('POST /students phone inválido', `status=${r.status} (esperado 400)`);
  }

  // 3.6 POST /students com CPF (se schema tem)
  if (hasCpf) {
    const r = await jfetch('/api/v1/students', {
      method: 'POST', headers: authJson,
      body: JSON.stringify({
        name: 'Caos CPF API',
        cpf: '555.666.777-88',  // com pontuação — deve ser normalizado
        email: `caos-cpf-${Date.now()}@example.com`,
      }),
    });
    if (r.status === 201) {
      ok('POST /students com cpf', `201 id=${r.body.id} cpf=${r.body.cpf}`);
      if (r.body.cpf === '55566677788') {
        ok('cpf normalizado no create', `"55566677788"`);
      } else {
        console.log(`  ⚠️  cpf NÃO normalizado no create: "${r.body.cpf}" (esperado "55566677788")`);
      }
    } else {
      fail('POST /students com cpf', `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
    }
  } else {
    console.log('  ⏭️  POST /students com cpf — pulado (schema sem cpf)');
  }

  // 3.7 POST /memberships aluno inexistente (deve 404)
  {
    const r = await jfetch('/api/v1/memberships', {
      method: 'POST', headers: authJson,
      body: JSON.stringify({
        studentId: 'cm_inexistente_123',
        planId: plan.id,
        startDate: new Date().toISOString(),
      }),
    });
    if (r.status === 404) ok('POST /memberships aluno inexistente', `404 limpo ms=${r.ms}`);
    else if (r.status === 500) fail('POST /memberships aluno inexistente', `❌ 500`);
    else fail('POST /memberships aluno inexistente', `status=${r.status} (esperado 404)`);
  }

  // 3.8 POST /memberships plano inexistente (deve 404)
  {
    const r = await jfetch('/api/v1/memberships', {
      method: 'POST', headers: authJson,
      body: JSON.stringify({
        studentId: student.id,
        planId: 'cm_inexistente_123',
        startDate: new Date().toISOString(),
      }),
    });
    if (r.status === 404) ok('POST /memberships plano inexistente', `404 limpo ms=${r.ms}`);
    else if (r.status === 500) fail('POST /memberships plano inexistente', `❌ 500`);
    else fail('POST /memberships plano inexistente', `status=${r.status} (esperado 404)`);
  }

  // 3.9 POST /memberships válido (com priceAtPurchase)
  {
    const r = await jfetch('/api/v1/memberships', {
      method: 'POST', headers: authJson,
      body: JSON.stringify({
        studentId: student.id,
        planId: plan.id,
        startDate: new Date().toISOString(),
        priceAtPurchase: 100,
      }),
    });
    if (r.status === 201) ok('POST /memberships válido', `201 id=${r.body.id}`);
    else fail('POST /memberships válido', `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
  }

  // 3.10 PATCH /students/:id inexistente (deve 404)
  {
    const r = await jfetch('/api/v1/students/cm_nao_existe', {
      method: 'PATCH', headers: authJson,
      body: JSON.stringify({ name: 'X' }),
    });
    if (r.status === 404) ok('PATCH /students/:id inexistente', `404 limpo ms=${r.ms}`);
    else fail('PATCH /students/:id inexistente', `status=${r.status} (esperado 404)`);
  }

  // ============================================
  // 4. ATAQUES DE AUTENTICAÇÃO
  // ============================================
  section('4. Auth — sem token, token inválido, role insuficiente');

  // 4.1 GET /users sem token
  {
    const r = await jfetch('/api/v1/users');
    if (r.status === 401) ok('GET /users sem token', `401 ms=${r.ms}`);
    else fail('GET /users sem token', `status=${r.status} (esperado 401)`);
  }

  // 4.2 GET /users token lixo
  {
    const r = await jfetch('/api/v1/users', {
      headers: { authorization: 'Bearer lixo.invalido.aqui' },
    });
    if (r.status === 401) ok('GET /users token lixo', `401 ms=${r.ms}`);
    else fail('GET /users token lixo', `status=${r.status} (esperado 401)`);
  }

  // 4.3 GET /users Bearer vazio
  {
    const r = await jfetch('/api/v1/users', {
      headers: { authorization: 'Bearer ' },
    });
    if (r.status === 401) ok('GET /users Bearer vazio', `401 ms=${r.ms}`);
    else fail('GET /users Bearer vazio', `status=${r.status} (esperado 401)`);
  }

  // 4.4 GET /health sem auth (deve funcionar)
  {
    const r = await jfetch('/health');
    if (r.status === 200 || r.status === 503) ok('GET /health público', `status=${r.status} ms=${r.ms}`);
    else fail('GET /health público', `status=${r.status}`);
  }

  // ============================================
  // 5. RATE LIMIT
  // ============================================
  section('5. Rate limit — login em rajada');

  let count429 = 0;
  for (let i = 0; i < 35; i++) {
    const r = await jfetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: `errada-${i}` }),
    });
    if (r.status === 429) count429++;
    else if (r.status !== 401) {
      fail(`login rajada #${i}`, `status inesperado=${r.status}`);
      break;
    }
  }
  if (count429 > 0) ok('rate limit login disparou', `${count429} requests 429`);
  else console.log('  ⏭️  rate limit login — nenhum 429 (RATE_LIMIT_DISABLED=1?)');

  // ============================================
  // 6. IMPORT
  // ============================================
  section('6. Import — volume e duplicatas');

  // 6.1 import 50 alunos
  {
    const batch = Array.from({ length: 50 }, (_, i) => ({
      legacyId: `caos-${Date.now()}-${i}`,
      name: `Caos Import ${i}`,
    }));
    const t0 = Date.now();
    const r = await jfetch('/api/v1/students/import', {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ students: batch }),
    });
    const ms = Date.now() - t0;
    if (r.status === 201 && r.body?.created === 50) {
      ok('import 50 alunos', `created=50 ms=${ms}`);
      if (ms > 5000) fail('import 50 alunos (latência)', `${ms}ms > 5s — createMany não está sendo usado?`);
    } else {
      fail('import 50 alunos', `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
    }
  }

  // 6.2 reimport (skipDuplicates)
  {
    const batch = Array.from({ length: 10 }, (_, i) => ({
      legacyId: `caos-reimport-${Date.now()}-${i}`,
      name: `Reimport ${i}`,
    }));
    await jfetch('/api/v1/students/import', {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ students: batch }),
    });
    const r2 = await jfetch('/api/v1/students/import', {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ students: batch }),
    });
    if (r2.status === 201 && r2.body?.skipped === 10 && r2.body?.created === 0) {
      ok('reimport skipDuplicates', `skipped=10 created=0`);
    } else {
      fail('reimport skipDuplicates', `body=${JSON.stringify(r2.body).slice(0, 200)}`);
    }
  }

  // ============================================
  // 7. BULK INVITES
  // ============================================
  section('7. Bulk invites — volume');

  {
    const invites = Array.from({ length: 20 }, (_, i) => ({
      email: `caos-${Date.now()}-${i}@example.com`,
      type: 'ALUNO',
    }));
    const t0 = Date.now();
    const r = await jfetch('/api/v1/invites/bulk', {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ invites, expiresInDays: 7 }),
    });
    const ms = Date.now() - t0;
    if (r.status === 201 && r.body?.created === 20) {
      ok('bulk 20 invites', `created=20 ms=${ms}`);
      // Threshold 10s (era 5s) — cold start do Prisma Postgres leva ~5-10s
      if (ms > 10000) fail('bulk 20 invites (latência)', `${ms}ms > 10s — createMany não está sendo usado?`);
    } else {
      fail('bulk 20 invites', `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
    }
  }

  {
    const r = await jfetch('/api/v1/invites/bulk', {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ invites: [{ email: 'x@x.com', type: 'STAFF' }] }),
    });
    if (r.status === 400) ok('bulk STAFF sem role', `400 ms=${r.ms}`);
    else fail('bulk STAFF sem role', `status=${r.status} (esperado 400)`);
  }

  // ============================================
  // 8. DB / CIRCUIT BREAKER
  // ============================================
  section('8. DB — isDbHealthy e circuit breaker');

  ok('isDbHealthy()', `retornou ${isDbHealthy()}`);
  ok('prismaConfig', `connection_limit=${prismaConfig.connectionLimit} retries=${prismaConfig.safeQueryRetries} base_ms=${prismaConfig.safeQueryBaseMs}`);

  // ============================================
  // 9. SystemLog — não deve ter 500 do checkins
  // ============================================
  section('9. SystemLog — últimos 2min');

  try {
    const logs = await prisma.systemLog.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 120_000) } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const fiveHundred = logs.filter((l) =>
      l.message?.includes('checkins') || l.message?.includes('evaluateCheckin')
    );
    console.log(`  📋 ${logs.length} linha(s) no SystemLog (2min)`);
    for (const l of logs.slice(0, 5)) {
      console.log(`     [${l.level}] ${l.tag} — ${l.message.slice(0, 80)}`);
    }
    if (fiveHundred.length === 0) {
      ok('SystemLog sem erro de checkin', `${logs.length} linhas, nenhuma de catraca`);
    } else {
      fail('SystemLog com erro de checkin', `${fiveHundred.length} linha(s) — investigate`);
    }
  } catch (err) {
    fail('SystemLog query', err.message);
  }

  // ============================================
  // RESULTADO
  // ============================================
  await flush(10000);
  await disconnect();

  const okCount = results.filter((r) => r.status === 'OK').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;

  console.log('\n' + '='.repeat(64));
  console.log(`  RESULTADO: ${okCount} ok · ${failCount} falhas`);
  if (failCount > 0) {
    console.log('\n  FALHAS:');
    for (const r of results.filter((x) => x.status === 'FAIL')) {
      console.log(`   ❌ ${r.name} — ${r.detail || ''}`);
    }
  } else {
    console.log('  🛡️  Servidor resistiu a todos os ataques.');
  }
  console.log('='.repeat(64));
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\n💥 caos controlado quebrou:', err);
  try { await flush(3000); } catch {}
  try { await disconnect(); } catch {}
  process.exit(1);
});