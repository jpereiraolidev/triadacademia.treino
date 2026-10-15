// ============================================
// scripts/medidor.js — Medidor contínuo de latência
// Triad Academia · v3.2
//
// Uso:
//   node scripts/medidor.js                  → 9 ciclos (0 a 8 min) em PROD
//   node scripts/medidor.js --local          → 9 ciclos em LOCAL
//   node scripts/medidor.js --ciclos=30      → 30 ciclos
//   node scripts/medidor.js --intervalo=60   → 60s entre INÍCIOS
//   node scripts/medidor.js --rotas=login,users
//   node scripts/medidor.js --no-warmup      → pula o warm-up inicial
//
// Ciclo 1 → AGORA
// Ciclo 2 → t=60s
// Ciclo N → t=(N-1)*60s
// ============================================

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
};

const IS_LOCAL = args.includes('--local');
const NO_WARMUP = args.includes('--no-warmup');
const CICLOS = Number(getArg('ciclos', 9));
const INTERVALO = Number(getArg('intervalo', 60));
const REPETICOES = Number(getArg('repeticoes', 1));
const FILTRO = getArg('rotas', null)?.split(',').map((s) => s.trim()) || null;

// ============================================
// ⚙️ CONFIGURAÇÃO
// ============================================
const CONFIG = {
  PROD_URL: 'https://triadacademiatreino.vercel.app',
  LOCAL_URL: 'http://localhost:3333',
  USERS: {
    admin: { email: 'admin@triad.com', password: 'admin12345' },
  },
  TIMEOUT_MS: 60000,
};

const BASE = IS_LOCAL ? CONFIG.LOCAL_URL : CONFIG.PROD_URL;

// ============================================
// CORES
// ============================================
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  gray: '\x1b[90m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bgBlue: '\x1b[44m',
};

function cor(ms) {
  if (ms < 150) return C.green;
  if (ms < 300) return C.cyan;
  if (ms < 600) return C.blue;
  if (ms < 1000) return C.yellow;
  return C.red;
}

function hora() {
  return new Date().toLocaleTimeString('pt-BR');
}

function ts() {
  return new Date().toISOString().slice(11, 19);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================
// HTTP
// ============================================
async function req(method, path, opts = {}) {
  const { body, headers = {} } = opts;
  const url = `${BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);
  const t0 = performance.now();

  let status = 0;
  let error = null;
  let data = null;

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    status = res.status;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
  } catch (err) {
    error = err.name === 'AbortError' ? 'TIMEOUT' : err.message;
  } finally {
    clearTimeout(timer);
  }

  return { ms: performance.now() - t0, status, error, data };
}

// ============================================
// ROTAS
// ============================================
const TODAS_ROTAS = [
  { id: 'health',    label: '/health',       method: 'GET',  path: '/health' },
  { id: 'warm',      label: '/health/warm',  method: 'GET',  path: '/health/warm' },
  { id: 'ping',      label: '/_ping',        method: 'GET',  path: '/api/v1/_ping' },
  { id: 'login',     label: '/auth/login',   method: 'POST', path: '/api/v1/auth/login',
    body: CONFIG.USERS.admin, tokenFrom: 'admin' },
  { id: 'me',        label: '/auth/me',      method: 'GET',  path: '/api/v1/auth/me',  needsAuth: true },
  { id: 'exercises', label: '/exercises',    method: 'GET',  path: '/api/v1/exercises' },
  { id: 'users',     label: '/users',        method: 'GET',  path: '/api/v1/users',     needsAuth: true },
  { id: 'students',  label: '/students',     method: 'GET',  path: '/api/v1/students',  needsAuth: true },
];

const ROTAS = FILTRO ? TODAS_ROTAS.filter((r) => FILTRO.includes(r.id)) : TODAS_ROTAS;

// ============================================
// ESTADO
// ============================================
const state = { token: null };
const historico = {};
const temposInicio = [];
for (const r of ROTAS) historico[r.id] = [];

function buildHeaders(route) {
  const h = {};
  if (route.needsAuth && state.token) h.Authorization = `Bearer ${state.token}`;
  return h;
}

async function medirRota(route) {
  const times = [];
  const statuses = {};

  for (let i = 0; i < REPETICOES; i++) {
    const r = await req(route.method, route.path, {
      body: route.body,
      headers: buildHeaders(route),
    });

    if (route.tokenFrom && r.data?.token) state.token = r.data.token;

    times.push(r.ms);
    statuses[r.status] = (statuses[r.status] || 0) + 1;
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return { ms: avg, status: Object.keys(statuses)[0] };
}

async function rodarCiclo(n, minutosDecorridos) {
  const t0 = Date.now();
  temposInicio.push({ n, t: t0, minutosDecorridos });

  console.log(`\n${C.bgBlue}${C.bold} ⏱  CICLO ${n}/${CICLOS}  ➔  ${hora()}  (+${minutosDecorridos}min)  ${C.reset}`);
  console.log(`${C.dim}   início do ciclo: ${ts()}${C.reset}`);

  for (const route of ROTAS) {
    const r = await medirRota(route);
    historico[route.id].push({ ciclo: n, minutosDecorridos, ms: r.ms, status: r.status });

    const corMs = cor(r.ms);
    const statusStr = String(r.status).padStart(3);
    const msStr = `${r.ms.toFixed(0)}ms`.padStart(7);

    console.log(`   ${corMs}${msStr}${C.reset}  [${statusStr}]  ${route.label}`);
  }

  const duracao = Date.now() - t0;
  console.log(`${C.dim}   fim do ciclo: ${ts()}  (duração: ${(duracao / 1000).toFixed(1)}s)${C.reset}`);
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function stats(times) {
  if (!times.length) return null;
  const s = [...times].sort((a, b) => a - b);
  return {
    min: s[0],
    max: s[s.length - 1],
    avg: s.reduce((a, b) => a + b, 0) / s.length,
    p50: pct(s, 0.5),
    p95: pct(s, 0.95),
  };
}

// ============================================
// WARM-UP
// ============================================
async function warmup() {
  console.log(`${C.dim}🔥 Warm-up (DNS + TLS + conexão)...${C.reset}`);

  // 1. DNS + TLS warm (só /health, rápido)
  const t0 = Date.now();
  const h = await req('GET', '/health');
  const dnsMs = Date.now() - t0;
  console.log(`   ${C.gray}/health${C.reset}         ${h.status} em ${dnsMs.toFixed(0)}ms`);

  // 2. Login warm (Argon2 + DB)
  const t1 = Date.now();
  const login = await req('POST', '/api/v1/auth/login', { body: CONFIG.USERS.admin });
  const loginMs = Date.now() - t1;
  if (login.data?.token) state.token = login.data.token;
  console.log(`   ${C.gray}/auth/login${C.reset}     ${login.status} em ${loginMs.toFixed(0)}ms`);

  // 3. Cada rota uma vez (descarta resultado)
  for (const route of ROTAS) {
    const t = Date.now();
    const r = await req(route.method, route.path, {
      body: route.body,
      headers: buildHeaders(route),
    });
    if (route.tokenFrom && r.data?.token) state.token = r.data.token;
    const ms = Date.now() - t;
    const color = r.status >= 200 && r.status < 300 ? C.green : C.red;
    console.log(`   ${C.gray}${route.label.padEnd(14)}${C.reset}  ${color}${r.status}${C.reset} em ${ms.toFixed(0)}ms`);
  }

  console.log(`${C.green}✔ Warm-up concluído${C.reset}\n`);
}

// ============================================
// MAIN
// ============================================
(async () => {
  console.clear();
  console.log(`${C.bold}${C.magenta}╔══════════════════════════════════════════════════════════════════════╗`);
  console.log(`║      MEDIDOR CONTÍNUO DE LATÊNCIA — TRIAD ACADEMIA · v3.2            ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════════╝${C.reset}\n`);

  console.log(`  ${C.bold}Alvo        :${C.reset} ${C.cyan}${BASE}${C.reset}`);
  console.log(`  ${C.bold}Modo        :${C.reset} ${IS_LOCAL ? 'LOCAL' : 'PRODUÇÃO'}`);
  console.log(`  ${C.bold}Ciclos      :${C.reset} ${CICLOS} (0 a ${CICLOS - 1} min)`);
  console.log(`  ${C.bold}Intervalo   :${C.reset} ${INTERVALO}s entre INÍCIOS de ciclo`);
  console.log(`  ${C.bold}Repetições  :${C.reset} ${REPETICOES}x por rota por ciclo`);
  console.log(`  ${C.bold}Rotas       :${C.reset} ${ROTAS.length}`);
  console.log(`  ${C.bold}Warm-up     :${C.reset} ${NO_WARMUP ? 'desligado' : 'ligado'}`);
  console.log(`  ${C.bold}Duração     :${C.reset} ~${Math.round(((CICLOS - 1) * INTERVALO) / 60)} min\n`);

  // Warm-up (opcional)
  if (!NO_WARMUP) {
    await warmup();
  } else {
    // Sem warm-up, faz pelo menos o login inicial
    console.log(`${C.dim}🔑 Login inicial (warm-up desligado)...${C.reset}`);
    const loginInit = await req('POST', '/api/v1/auth/login', { body: CONFIG.USERS.admin });
    if (loginInit.data?.token) {
      state.token = loginInit.data.token;
      console.log(`${C.green}✔${C.reset} Token admin obtido (${loginInit.ms.toFixed(0)}ms)\n`);
    } else {
      console.log(`${C.red}✖${C.reset} Falha no login inicial (status=${loginInit.status})\n`);
    }
  }

  // Ciclos
  const tInicio = Date.now();
  for (let n = 1; n <= CICLOS; n++) {
    const minutosDecorridos = ((n - 1) * INTERVALO) / 60;
    const alvoInicio = tInicio + (n - 1) * INTERVALO * 1000;
    const esperaMs = alvoInicio - Date.now();

    if (esperaMs > 0) {
      console.log(`${C.dim}   ⏳ aguardando ${(esperaMs / 1000).toFixed(1)}s até o ciclo ${n}...${C.reset}`);
      await sleep(esperaMs);
    }

    await rodarCiclo(n, minutosDecorridos.toFixed(0));
  }

  // ============================================
  // RELATÓRIO
  // ============================================
  console.log(`\n\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════════════╗`);
  console.log(`║                       TABELA CICLO A CICLO                           ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════════╝${C.reset}\n`);

  const header = ['Ciclo', '+min', ...ROTAS.map((r) => r.label.padStart(10))].join('  ');
  console.log(`  ${C.bold}${header}${C.reset}`);
  console.log(`  ${'─'.repeat(header.length)}`);

  for (let n = 1; n <= CICLOS; n++) {
    const minutosDecorridos = ((n - 1) * INTERVALO) / 60;
    const cells = ROTAS.map((r) => {
      const h = historico[r.id].find((x) => x.ciclo === n);
      if (!h) return '     —    ';
      return `${String(h.ms.toFixed(0)).padStart(7)}ms `;
    });
    console.log(`  ${String(n).padStart(5)}  ${String(minutosDecorridos.toFixed(0)).padStart(4)}m  ${cells.join('  ')}`);
  }

  // Cadência
  console.log(`\n${C.bold}${C.cyan}▶ Cadência dos ciclos${C.reset}\n`);
  for (let i = 1; i < temposInicio.length; i++) {
    const deltaMs = temposInicio[i].t - temposInicio[i - 1].t;
    const deltaS = (deltaMs / 1000).toFixed(1);
    const diff = Math.abs(deltaMs / 1000 - INTERVALO);
    const corDiff = diff < 2 ? C.green : diff < 10 ? C.yellow : C.red;
    console.log(
      `  Ciclo ${i} → ${i + 1}: ${deltaS}s ${C.dim}(esperado ${INTERVALO}s, diff ${diff.toFixed(1)}s)${C.reset} ${corDiff}${diff < 2 ? '✔' : '⚠'}${C.reset}`
    );
  }

  // ============================================
  // ESTATÍSTICAS
  // ============================================
  console.log(`\n\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════════════╗`);
  console.log(`║                      ESTATÍSTICAS POR ROTA                           ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════════╝${C.reset}\n`);

  console.log(`  ${C.bold}Rota              min     p50     p95     avg     max   Status${C.reset}`);
  console.log(`  ${'─'.repeat(75)}`);

  for (const route of ROTAS) {
    const h = historico[route.id];
    if (!h.length) continue;
    const times = h.map((x) => x.ms);
    const s = stats(times);
    const statusList = [...new Set(h.map((x) => x.status))].join(',');
    const corAvg = cor(s.avg);

    console.log(
      `  ${route.label.padEnd(16)} ` +
      `${String(s.min.toFixed(0)).padStart(5)}ms ` +
      `${String(s.p50.toFixed(0)).padStart(5)}ms ` +
      `${String(s.p95.toFixed(0)).padStart(5)}ms ` +
      `${corAvg}${String(s.avg.toFixed(0)).padStart(5)}ms${C.reset} ` +
      `${String(s.max.toFixed(0)).padStart(5)}ms ` +
      `${C.gray}${statusList}${C.reset}`
    );
  }

  console.log(`\n${C.bold}${C.cyan}▶ Análise temporal${C.reset}\n`);

  for (const route of ROTAS) {
    const h = historico[route.id];
    if (h.length < 3) continue;

    const primeiraMetade = h.slice(0, Math.floor(h.length / 2));
    const segundaMetade = h.slice(Math.floor(h.length / 2));
    const avg1 = primeiraMetade.reduce((a, x) => a + x.ms, 0) / primeiraMetade.length;
    const avg2 = segundaMetade.reduce((a, x) => a + x.ms, 0) / segundaMetade.length;
    const diff = ((avg2 - avg1) / avg1) * 100;

    let tendencia = 'estável';
    if (diff < -15) tendencia = `${C.green}melhorou ${Math.abs(diff).toFixed(0)}%${C.reset}`;
    else if (diff > 15) tendencia = `${C.red}piorou ${diff.toFixed(0)}%${C.reset}`;

    const max = Math.max(...h.map((x) => x.ms));
    const min = Math.min(...h.map((x) => x.ms));
    const spread = max - min;

    console.log(
      `  ${route.label.padEnd(16)}  ` +
      `1ª metade=${avg1.toFixed(0)}ms  2ª metade=${avg2.toFixed(0)}ms  ` +
      `tendência=${tendencia}  ` +
      `${C.dim}(spread=${spread.toFixed(0)}ms)${C.reset}`
    );
  }

  console.log('');
})();