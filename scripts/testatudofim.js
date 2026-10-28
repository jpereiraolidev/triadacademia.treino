// ============================================
// testatudo.js — Teste end-to-end do backend TRIAD
// Roda: auth, users, students, plans, memberships,
//       checkins, exercises, workouts, evolution,
//       settings, products, sales, payments,
//       summary, health, _ping + testes negativos.
//
// Uso:
//   node testatudo.js
//
// Env (opcional):
//   API_URL=http://localhost:3333
//   ADMIN_EMAIL=admin@triad.com
//   ADMIN_PASSWORD=admin12345
// ============================================

const API_URL = process.env.API_URL || 'http://localhost:3333';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@triad.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';
const BASE = `${API_URL}/api/v1`;

// ---------- Cores ----------
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', gray: '\x1b[90m',
};

// ---------- Estado ----------
const ctx = {
  token: null,
  userId: null,
  alunoId: null,
  planoId: null,
  matriculaId: null,
  checkinId: null,
  exercicioId: null,
  treinoId: null,
  produtoId: null,
  vendaId: null,
  pagamentoId: null,
};

const results = { passed: 0, failed: 0, skipped: 0, failures: [] };

// ---------- Helpers ----------
function log(msg) {
  console.log(`${C.gray}[${new Date().toISOString().slice(11, 19)}]${C.reset} ${msg}`);
}

function section(title) {
  console.log(`\n${C.magenta}${C.bold}═══ ${title} ═══${C.reset}\n`);
}

async function req(method, path, { body, token, headers = {} } = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const init = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...headers,
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, ok: res.ok, json };
}

function expect(name, condition, detail) {
  if (condition) {
    results.passed++;
    console.log(`  ${C.green}✔${C.reset} ${name}`);
  } else {
    results.failed++;
    results.failures.push({ name, detail });
    console.log(`  ${C.red}✘${C.reset} ${name}`);
    if (detail !== undefined) {
      const s = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
      console.log(`    ${C.dim}${s.slice(0, 500)}${C.reset}`);
    }
  }
  return condition;
}

// ============================================
// TESTES
// ============================================

async function testarHealth() {
  section('HEALTH & PING (público)');

  const h = await req('GET', `${API_URL}/health`);
  expect('GET /health → 200', h.status === 200, h);
  expect('  responde status ok', h.json?.status === 'ok', h.json);

  const hw = await req('GET', `${API_URL}/health?warm=1`);
  expect('GET /health?warm=1 → 200', hw.status === 200, hw);
  expect('  banco respondeu (warmup.ok=true)', hw.json?.warmup?.ok === true, hw.json);

  const ping = await req('GET', '/_ping');
  expect('GET /api/v1/_ping → 200', ping.status === 200, ping);
  expect('  responde ok=true', ping.json?.ok === true, ping.json);
}

async function testarAuth() {
  section('AUTH');

  // Login com senha errada (deve falhar)
  const bad = await req('POST', '/auth/login', {
    body: { email: ADMIN_EMAIL, password: 'senha_errada_123' },
  });
  expect('POST /auth/login senha errada → 401', bad.status === 401, bad);

  // Login correto
  const login = await req('POST', '/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!expect('POST /auth/login → 200', login.status === 200, login)) {
    throw new Error('Login falhou — abortando testes (rode seed-admin.js antes)');
  }
  expect('  retorna token', typeof login.json?.token === 'string', login.json);
  expect('  retorna user.role=ADMIN', login.json?.user?.role === 'ADMIN', login.json);
  ctx.token = login.json.token;
  ctx.userId = login.json.user?.id;

  // /auth/me
  const me = await req('GET', '/auth/me', { token: ctx.token });
  expect('GET /auth/me → 200', me.status === 200, me);
  expect('  me.id == user.id', me.json?.id === ctx.userId, me.json);

  // /auth/me sem token
  const noToken = await req('GET', '/auth/me');
  expect('GET /auth/me sem token → 401', noToken.status === 401, noToken);
}

async function testarUsers() {
  section('USERS');

  const list = await req('GET', '/users', { token: ctx.token });
  expect('GET /users → 200', list.status === 200, list);
  expect('  retorna array', Array.isArray(list.json), list.json);
  expect('  contém admin', list.json?.some((u) => u.email === ADMIN_EMAIL), list.json);

  // Sem token
  const noAuth = await req('GET', '/users');
  expect('GET /users sem token → 401', noAuth.status === 401, noAuth);
}

async function testarStudents() {
  section('STUDENTS');

  const nome = `Teste ${Date.now()}`;
  const email = `teste${Date.now()}@triad.com`;

  const create = await req('POST', '/students', {
    token: ctx.token,
    body: { name: nome, email, phone: '11999998888', birthDate: '1995-05-10' },
  });
  if (!expect('POST /students → 201', create.status === 201, create)) return;
  ctx.alunoId = create.json.id;

  const list = await req('GET', '/students', { token: ctx.token });
  expect('GET /students → 200', list.status === 200, list);
  expect('  contém aluno criado', list.json?.some((s) => s.id === ctx.alunoId), list.json);

  const get1 = await req('GET', `/students/${ctx.alunoId}`, { token: ctx.token });
  expect('GET /students/:id → 200', get1.status === 200, get1);

  const missing = await req('GET', `/students/nao_existe_xyz`, { token: ctx.token });
  expect('GET /students/inexistente → 404', missing.status === 404, missing);

  const invalid = await req('POST', '/students', {
    token: ctx.token,
    body: { name: '' },
  });
  expect('POST /students payload inválido → 400', invalid.status === 400, invalid);
}

async function testarPlans() {
  section('PLANS');

  const create = await req('POST', '/plans', {
    token: ctx.token,
    body: { name: `Mensal ${Date.now()}`, description: 'Padrão', price: 99.9, durationDays: 30 },
  });
  if (!expect('POST /plans → 201', create.status === 201, create)) return;
  ctx.planoId = create.json.id;

  const list = await req('GET', '/plans', { token: ctx.token });
  expect('GET /plans → 200', list.status === 200, list);
  expect('  contém plano criado', list.json?.some((p) => p.id === ctx.planoId), list.json);
}

async function testarMemberships() {
  section('MEMBERSHIPS');

  if (!ctx.alunoId || !ctx.planoId) {
    results.skipped++;
    console.log(`  ${C.yellow}⊘${C.reset} Pulado (aluno/plano não criados)`);
    return;
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const create = await req('POST', '/memberships', {
    token: ctx.token,
    body: { studentId: ctx.alunoId, planId: ctx.planoId, startDate: hoje },
  });
  if (!expect('POST /memberships → 201', create.status === 201, create)) return;
  ctx.matriculaId = create.json.id;
  expect('  endDate > startDate', new Date(create.json.endDate) > new Date(hoje), create.json);

  const list = await req('GET', `/memberships?studentId=${ctx.alunoId}`, { token: ctx.token });
  expect('GET /memberships?studentId → 200', list.status === 200, list);
}

async function testarCheckins() {
  section('CHECKINS');

  if (!ctx.alunoId) {
    results.skipped++;
    console.log(`  ${C.yellow}⊘${C.reset} Pulado (aluno não criado)`);
    return;
  }

  const create = await req('POST', '/checkins', {
    token: ctx.token,
    body: { studentId: ctx.alunoId, type: 'ENTRADA', status: 'AUTORIZADO' },
  });
  if (!expect('POST /checkins → 201', create.status === 201, create)) return;
  ctx.checkinId = create.json.id;

  const list = await req('GET', `/checkins?studentId=${ctx.alunoId}`, { token: ctx.token });
  expect('GET /checkins → 200', list.status === 200, list);
  expect('  contém checkin criado', list.json?.some((c) => c.id === ctx.checkinId), list.json);

  // Novo: summary do dia
  const summary = await req('GET', '/checkins/summary/today', { token: ctx.token });
  expect('GET /checkins/summary/today → 200', summary.status === 200, summary);
  expect('  total >= 1', summary.json?.total >= 1, summary.json);
}

async function testarExercises() {
  section('EXERCISES');

  const create = await req('POST', '/exercises', {
    token: ctx.token,
    body: { name: `Supino ${Date.now()}`, muscleGroup: 'Peito', description: 'Teste' },
  });
  if (!expect('POST /exercises → 201', create.status === 201, create)) return;
  ctx.exercicioId = create.json.id;

  const list = await req('GET', '/exercises', { token: ctx.token });
  expect('GET /exercises → 200', list.status === 200, list);
}

async function testarWorkouts() {
  section('WORKOUTS & EVOLUTION');

  if (!ctx.alunoId || !ctx.exercicioId) {
    results.skipped++;
    console.log(`  ${C.yellow}⊘${C.reset} Pulado (aluno/exercício não criados)`);
    return;
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const create = await req('POST', `/students/${ctx.alunoId}/workouts`, {
    token: ctx.token,
    body: {
      name: `Treino ${Date.now()}`,
      startDate: hoje,
      exercises: [
        { exerciseId: ctx.exercicioId, sets: 3, repetitions: '10', weight: 40, order: 0 },
      ],
    },
  });
  if (!expect('POST /students/:id/workouts → 201', create.status === 201, create)) return;
  ctx.treinoId = create.json.id;

  const list = await req('GET', `/students/${ctx.alunoId}/workouts`, { token: ctx.token });
  expect('GET /students/:id/workouts → 200', list.status === 200, list);

  const evo = await req('GET', `/students/${ctx.alunoId}/evolution`, { token: ctx.token });
  expect('GET /students/:id/evolution → 200', evo.status === 200, evo);
  expect('  retorna array', Array.isArray(evo.json), evo.json);
}

async function testarSettings() {
  section('SETTINGS (integracao.js)');

  const get1 = await req('GET', '/settings', { token: ctx.token });
  if (!expect('GET /settings → 200', get1.status === 200, get1)) return;
  expect('  tem nomeAcademia', typeof get1.json?.nomeAcademia === 'string', get1.json);
  expect('  tem corPrincipal', typeof get1.json?.corPrincipal === 'string', get1.json);

  const update = await req('PUT', '/settings', {
    token: ctx.token,
    body: {
      nomeAcademia: 'TRIAD TESTE',
      corPrincipal: '#ff5500',
      valorMensalidadePadrao: '129,90',
      diasTolerancia: '5',
    },
  });
  expect('PUT /settings → 200', update.status === 200, update);
  expect('  nomeAcademia atualizado', update.json?.nomeAcademia === 'TRIAD TESTE', update.json);
  expect('  valorMensalidadePadrao="129,90"', update.json?.valorMensalidadePadrao === '129,90', update.json);

  // Sem token
  const noAuth = await req('GET', '/settings');
  expect('GET /settings sem token → 401', noAuth.status === 401, noAuth);
}

async function testarProducts() {
  section('PRODUCTS (integracao.js)');

  const create = await req('POST', '/products', {
    token: ctx.token,
    body: {
      nome: `Whey ${Date.now()}`,
      categoria: 'Suplemento',
      quantidade: 10,
      valorCompra: 80,
      valorVenda: 150,
    },
  });
  if (!expect('POST /products → 201', create.status === 201, create)) return;
  ctx.produtoId = create.json.id;

  const list = await req('GET', '/products', { token: ctx.token });
  expect('GET /products → 200', list.status === 200, list);
  const prod = list.json?.find((p) => p.id === ctx.produtoId);
  expect('  valorVenda formatado "150,00"', prod?.valorVenda === '150,00', prod);
  expect('  ativo="sim"', prod?.ativo === 'sim', prod);

  const invalid = await req('POST', '/products', {
    token: ctx.token,
    body: { nome: '' },
  });
  expect('POST /products payload inválido → 400', invalid.status === 400, invalid);
}

async function testarSales() {
  section('SALES (integracao.js)');

  if (!ctx.produtoId) {
    results.skipped++;
    console.log(`  ${C.yellow}⊘${C.reset} Pulado (produto não criado)`);
    return;
  }

  const create = await req('POST', '/sales', {
    token: ctx.token,
    body: {
      produtoId: ctx.produtoId,
      quantidade: 2,
      valorUnitario: 150,
      valorRecebido: 300,
      forma: 'PIX',
    },
  });
  if (!expect('POST /sales → 201', create.status === 201, create)) return;
  ctx.vendaId = create.json.venda?.id;

  expect('  total="300,00"', create.json.venda?.total === '300,00', create.json.venda);
  expect('  estoque restante=8', create.json.produto?.quantidade === 8, create.json.produto);

  // Estoque insuficiente
  const over = await req('POST', '/sales', {
    token: ctx.token,
    body: { produtoId: ctx.produtoId, quantidade: 999, valorUnitario: 150 },
  });
  expect('POST /sales estoque insuficiente → 400', over.status === 400, over);

  const list = await req('GET', '/sales', { token: ctx.token });
  expect('GET /sales → 200', list.status === 200, list);
}

async function testarPayments() {
  section('PAYMENTS (integracao.js)');

  if (!ctx.alunoId) {
    results.skipped++;
    console.log(`  ${C.yellow}⊘${C.reset} Pulado (aluno não criado)`);
    return;
  }

  const novoVenc = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const create = await req('POST', '/payments', {
    token: ctx.token,
    body: {
      studentId: ctx.alunoId,
      membershipId: ctx.matriculaId,
      valor: 99.9,
      valorRecebido: 100,
      troco: 0.1,
      forma: 'DINHEIRO',
      novoVencimento: novoVenc,
      origem: 'FINANCEIRO',
    },
  });
  if (!expect('POST /payments → 201', create.status === 201, create)) return;
  ctx.pagamentoId = create.json.pagamento?.id;

  expect('  valor="99,90"', create.json.pagamento?.valor === '99,90', create.json.pagamento);
  expect('  troco="0,10"', create.json.pagamento?.troco === '0,10', create.json.pagamento);

  const list = await req('GET', `/payments?studentId=${ctx.alunoId}`, { token: ctx.token });
  expect('GET /payments → 200', list.status === 200, list);
  expect('  contém pagamento criado', list.json?.some((p) => p.id === ctx.pagamentoId), list.json);

  // Aluno inexistente
  const bad = await req('POST', '/payments', {
    token: ctx.token,
    body: { studentId: 'nao_existe', valor: 10 },
  });
  expect('POST /payments aluno inexistente → 404', bad.status === 404, bad);
}

async function testarSeguranca() {
  section('SEGURANÇA (testes negativos)');

  const noAuth = await req('GET', '/users');
  expect('GET /users sem token → 401', noAuth.status === 401, noAuth);

  const badToken = await req('GET', '/users', { token: 'token_falso_xyz' });
  expect('GET /users token inválido → 401', badToken.status === 401, badToken);

  const badPath = await req('GET', '/rota_que_nao_existe', { token: ctx.token });
  expect('GET rota inexistente → 404', badPath.status === 404, badPath);
}

async function testarCron() {
  section('CRON (opcional)');

  const ping = await req('POST', '/cron/ping');
  // Pode ser 503 (se CRON_SECRET ausente) ou 401 (secret errado) — não é falha
  if (ping.status === 503) {
    results.skipped++;
    console.log(`  ${C.yellow}⊘${C.reset} CRON desabilitado (CRON_SECRET ausente) — ok`);
  } else if (ping.status === 401) {
    results.skipped++;
    console.log(`  ${C.yellow}⊘${C.reset} CRON exige secret — ok`);
  } else {
    expect('POST /cron/ping → 202', ping.status === 202, ping);
  }
}

// ============================================
// RUNNER
// ============================================

async function main() {
  console.log(`${C.cyan}${C.bold}`);
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   TRIAD ACADEMIA — Teste End-to-End          ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`${C.reset}`);
  log(`API_URL: ${C.cyan}${API_URL}${C.reset}`);
  log(`ADMIN_EMAIL: ${ADMIN_EMAIL}`);
  log(`BASE: ${BASE}\n`);

  const t0 = Date.now();

  try {
    await testarHealth();
    await testarAuth();
    await testarUsers();
    await testarStudents();
    await testarPlans();
    await testarMemberships();
    await testarCheckins();
    await testarExercises();
    await testarWorkouts();
    await testarSettings();
    await testarProducts();
    await testarSales();
    await testarPayments();
    await testarSeguranca();
    await testarCron();
  } catch (err) {
    console.error(`\n${C.red}💥 Erro fatal:${C.reset} ${err.message}`);
    console.error(err.stack);
  }

  const ms = Date.now() - t0;
  const total = results.passed + results.failed;

  console.log(`\n${C.bold}═══════════════ RELATÓRIO FINAL ═══════════════${C.reset}\n`);
  console.log(`  ${C.green}✔ Passou:${C.reset}  ${results.passed}/${total}`);
  console.log(`  ${C.red}✘ Falhou:${C.reset}  ${results.failed}`);
  console.log(`  ${C.yellow}⊘ Pulado:${C.reset}  ${results.skipped}`);
  console.log(`  ${C.gray}⏱ Tempo:${C.reset}   ${ms}ms`);
  console.log('');

  if (results.failed > 0) {
    console.log(`${C.red}${C.bold}Falhas detalhadas:${C.reset}\n`);
    results.failures.forEach((f, i) => {
      console.log(`  ${C.red}${i + 1}.${C.reset} ${f.name}`);
      if (f.detail !== undefined) {
        const s = typeof f.detail === 'string' ? f.detail : JSON.stringify(f.detail);
        console.log(`     ${C.dim}${s.slice(0, 300)}${C.reset}\n`);
      }
    });
    process.exit(1);
  } else {
    console.log(`${C.green}${C.bold}🎉 TODOS OS TESTES PASSARAM${C.reset}`);
    console.log(`${C.green}Backend pronto para o frontend consumir.${C.reset}\n`);
    process.exit(0);
  }
}

main();