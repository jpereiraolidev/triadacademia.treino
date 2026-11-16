// scripts/testatudoreal.js
// ============================================
// Teste geral contra PRODUÇÃO (https://triadacademiatreino.vercel.app)
//
// Diferente do mastertestquebratudo.js:
//   - NÃO toca no banco direto (só fetch HTTP)
//   - NÃO cria dados (sem POST /students, import, bulk)
//   - Testa só o que é seguro: health, auth, 4xx, rate limit, correlação
//
// Uso:
//   node scripts/testatudoreal.js
//
// Requer no .env:
//   SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD  (admin de PRODUÇÃO)
//   SMOKE_BASE_URL (opcional, default https://triadacademiatreino.vercel.app)
// ============================================

import 'dotenv/config';

const BASE = process.env.SMOKE_BASE_URL || 'https://triadacademiatreino.vercel.app';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('❌ defina SMOKE_ADMIN_EMAIL/SMOKE_ADMIN_PASSWORD (ou ADMIN_EMAIL/ADMIN_PASSWORD) no .env');
  console.error('   Use o admin de PRODUÇÃO (o mesmo que existe no banco da Vercel).');
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
  console.log('🌐 TESTE DE PRODUÇÃO — Triad Academia');
  console.log(`   BASE=${BASE}`);
  console.log(`   Data=${new Date().toISOString()}`);
  console.log(`   ⚠️  Este teste NÃO cria dados. Só valida o que está no ar.\n`);

  // ============================================
  // 1. HEALTH
  // ============================================
  section('1. Health');

  // 1.1 /health
  {
    const r = await jfetch('/health');
    if (r.status === 200 && r.body?.status === 'ok') {
      ok('GET /health', `status=200 uptime=${r.body.uptime}s ms=${r.ms}`);
    } else if (r.status === 503) {
      fail('GET /health', `status=503 (degraded) — banco fora?`);
    } else {
      fail('GET /health', `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
    }
  }

  // 1.2 /health/warm (toca no banco — acorda o Prisma Postgres)
  {
    const r = await jfetch('/health/warm');
    if (r.status === 200 && r.body?.warmup?.ok === true) {
      ok('GET /health/warm', `ok=true ms=${r.body.warmup.ms} (cold start?)`);
    } else if (r.status === 503) {
      fail('GET /health/warm', `503 — ${JSON.stringify(r.body.warmup || r.body).slice(0, 200)}`);
    } else {
      fail('GET /health/warm', `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
    }
  }

  // ============================================
  // 2. ROTAS BÁSICAS
  // ============================================
  section('2. Rotas básicas');

  // 2.1 /_ping (sem banco)
  {
    const r = await jfetch('/api/v1/_ping');
    if (r.status === 200 && r.body?.ok === true) {
      ok('GET /_ping', `ok=true ms=${r.ms}`);
    } else {
      fail('GET /_ping', `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
    }
  }

  // 2.2 404 com reqId
  {
    const r = await jfetch('/api/v1/inexistente');
    if (r.status === 404 && r.body?.reqId) {
      ok('GET /inexistente', `404 reqId=${r.body.reqId} ms=${r.ms}`);
    } else {
      fail('GET /inexistente', `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
    }
  }

  // 2.3 X-Request-Id ecoado
  {
    const r = await jfetch('/health', { headers: { 'x-request-id': 'teste-deploy-123' } });
    const echoed = r.headers?.get('x-request-id');
    if (echoed === 'teste-deploy-123') {
      ok('X-Request-Id ecoado', `ok`);
    } else {
      fail('X-Request-Id ecoado', `veio "${echoed}"`);
    }
  }

  // ============================================
  // 3. AUTH
  // ============================================
  section('3. Auth');

  // 3.1 login admin (produção)
  let token = null;
  {
    const r = await jfetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    if (r.status === 200 && r.body?.token) {
      token = r.body.token;
      ok('POST /auth/login (admin)', `200 role=${r.body.user?.role} ms=${r.ms}`);
    } else if (r.status === 401) {
      fail('POST /auth/login (admin)', `401 — credenciais erradas (admin existe no banco de prod?)`);
    } else if (r.status === 503) {
      fail('POST /auth/login (admin)', `503 — P2024 pool timeout (PRISMA_CONNECTION_LIMIT=3 na Vercel?)`);
    } else if (r.status === 504) {
      fail('POST /auth/login (admin)', `504 — cold start > timeout (WARMUP_GLOBAL=1?)`);
    } else {
      fail('POST /auth/login (admin)', `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
    }
  }

  // 3.2 login com senha errada
  {
    const r = await jfetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: 'senha-errada-' + Date.now() }),
    });
    if (r.status === 401) ok('POST /auth/login (errada)', `401 ms=${r.ms}`);
    else fail('POST /auth/login (errada)', `status=${r.status} (esperado 401)`);
  }

  // 3.3 GET /auth/me
  if (token) {
    const r = await jfetch('/api/v1/auth/me', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (r.status === 200 && r.body?.email === ADMIN_EMAIL) {
      ok('GET /auth/me', `200 email=${r.body.email} role=${r.body.role}`);
    } else {
      fail('GET /auth/me', `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
    }
  }

  // 3.4 GET /users sem token
  {
    const r = await jfetch('/api/v1/users');
    if (r.status === 401) ok('GET /users (sem token)', `401 ms=${r.ms}`);
    else fail('GET /users (sem token)', `status=${r.status} (esperado 401)`);
  }

  // 3.5 GET /users com token lixo
  {
    const r = await jfetch('/api/v1/users', {
      headers: { authorization: 'Bearer lixo.invalido.aqui' },
    });
    if (r.status === 401) ok('GET /users (token lixo)', `401 ms=${r.ms}`);
    else fail('GET /users (token lixo)', `status=${r.status} (esperado 401)`);
  }

  // ============================================
  // 4. ENDPOINTS DE LEITURA (com token)
  // ============================================
  section('4. Leitura (com token)');

  if (token) {
    const auth = { authorization: `Bearer ${token}` };

    for (const path of ['/api/v1/users', '/api/v1/students', '/api/v1/plans', '/api/v1/devices']) {
      const r = await jfetch(path, { headers: auth });
      if (r.status === 200 && Array.isArray(r.body)) {
        ok(`GET ${path}`, `200 array[${r.body.length}] ms=${r.ms}`);
      } else {
        fail(`GET ${path}`, `status=${r.status} body=${JSON.stringify(r.body).slice(0, 120)}`);
      }
    }
  } else {
    console.log('  ⏭️  leitura pulada (sem token)');
  }

  // ============================================
  // 5. ESCRITAS — SÓ 4xx (sem criar dados)
  // ============================================
  section('5. Escritas inválidas (esperado 400/404, sem criar nada)');

  if (token) {
    const authJson = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    // 5.1 POST /students vazio
    {
      const r = await jfetch('/api/v1/students', { method: 'POST', headers: authJson, body: '{}' });
      if (r.status === 400) ok('POST /students vazio', `400 zod ms=${r.ms}`);
      else fail('POST /students vazio', `status=${r.status} (esperado 400)`);
    }

    // 5.2 POST /students campo extra
    {
      const r = await jfetch('/api/v1/students', {
        method: 'POST', headers: authJson,
        body: JSON.stringify({ name: 'X', foo: 'bar' }),
      });
      if (r.status === 400) ok('POST /students campo extra', `400 strict ms=${r.ms}`);
      else fail('POST /students campo extra', `status=${r.status} (esperado 400)`);
    }

    // 5.3 POST /students JSON malformado
    {
      const r = await jfetch('/api/v1/students', {
        method: 'POST', headers: authJson, body: '{ name: "quebrado"',
      });
      if (r.status === 400) ok('POST /students JSON malformado', `400 ms=${r.ms}`);
      else fail('POST /students JSON malformado', `status=${r.status} (esperado 400)`);
    }

    // 5.4 POST /students email inválido
    {
      const r = await jfetch('/api/v1/students', {
        method: 'POST', headers: authJson,
        body: JSON.stringify({ name: 'X', email: 'nao-e-email' }),
      });
      if (r.status === 400) ok('POST /students email inválido', `400 zod ms=${r.ms}`);
      else fail('POST /students email inválido', `status=${r.status} (esperado 400)`);
    }

    // 5.5 POST /memberships aluno inexistente (404, sem criar)
    {
      const r = await jfetch('/api/v1/memberships', {
        method: 'POST', headers: authJson,
        body: JSON.stringify({
          studentId: 'cm_inexistente_prod',
          planId: 'cm_inexistente_prod',
          startDate: new Date().toISOString(),
        }),
      });
      if (r.status === 404) ok('POST /memberships aluno inexistente', `404 limpo ms=${r.ms}`);
      else fail('POST /memberships aluno inexistente', `status=${r.status} (esperado 404)`);
    }

    // 5.6 PATCH /students/:id inexistente (404, sem criar)
    {
      const r = await jfetch('/api/v1/students/cm_nao_existe_prod', {
        method: 'PATCH', headers: authJson,
        body: JSON.stringify({ name: 'X' }),
      });
      if (r.status === 404) ok('PATCH /students/:id inexistente', `404 limpo ms=${r.ms}`);
      else fail('PATCH /students/:id inexistente', `status=${r.status} (esperado 404)`);
    }

    // 5.7 POST /checkins/device sem X-Device-Key (401, sem criar)
    {
      const r = await jfetch('/api/v1/checkins/device', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentId: '123', type: 'ENTRADA' }),
      });
      if (r.status === 401) ok('POST /checkins/device sem device key', `401 ms=${r.ms}`);
      else fail('POST /checkins/device sem device key', `status=${r.status} (esperado 401)`);
    }
  } else {
    console.log('  ⏭️  escritas inválidas puladas (sem token)');
  }

  // ============================================
  // 6. RATE LIMIT
  // ============================================
  section('6. Rate limit (login em rajada)');

  let count429 = 0;
  let count401 = 0;
  for (let i = 0; i < 35; i++) {
    const r = await jfetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: `errada-${i}-${Date.now()}` }),
    });
    if (r.status === 429) count429++;
    else if (r.status === 401) count401++;
  }
  if (count429 > 0) ok('rate limit login disparou', `${count429}× 429, ${count401}× 401`);
  else if (count401 > 0) console.log(`  ⏭️  rate limit — ${count401}× 401, 0× 429 (RATE_LIMIT_DISABLED=1?)`);
  else fail('rate limit login', `nenhum 401/429 — algo errado`);

  // ============================================
  // 7. CORS (preflight)
  // ============================================
  section('7. CORS (preflight OPTIONS)');

  {
    const r = await jfetch('/api/v1/auth/login', {
      method: 'OPTIONS',
      headers: {
        'origin': 'https://seu-front.vercel.app',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,authorization',
      },
    });
    const allowOrigin = r.headers?.get('access-control-allow-origin');
    if (allowOrigin) {
      ok('OPTIONS preflight', `access-control-allow-origin=${allowOrigin}`);
    } else {
      console.log(`  ⚠️  OPTIONS sem access-control-allow-origin (CORS_ORIGIN na Vercel?)`);
    }
  }

  // ============================================
  // RESULTADO
  // ============================================
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
    console.log('  🛡️  Produção resistiu a todos os testes.');
  }
  console.log('='.repeat(64));
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\n💥 teste crashou:', err);
  process.exit(1);
});