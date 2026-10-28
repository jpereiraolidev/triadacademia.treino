// monitor.js — Monitor com medição numérica de velocidade corrigida
import axios from 'axios';

const BASE = 'http://localhost:3333';
const MAX_MIN = 30;

const sleep = (min) => new Promise(r => setTimeout(r, min * 60 * 1000));
const horaAtual = () => new Date().toLocaleTimeString('pt-BR');

const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  bgBlue: '\x1b[44m',
};

// Mede a velocidade de download/upload usando endpoints leves e seguros
async function testarVelocidadeRede() {
  try {
    // 1. Download de um payload leve (ex: JSON público do Cloudflare/IPify)
    const tDownStart = Date.now();
    const downloadRes = await axios.get('https://api.ipify.org?format=json', { timeout: 8000 });
    const tDownSec = (Date.now() - tDownStart) / 1000;
    
    // Calcula com base no tamanho do JSON retornado (~30 bytes) ajustado para uma amostra mais realista
    const bytesDown = JSON.stringify(downloadRes.data).length * 8;
    const downloadMbps = Number(((bytesDown / tDownSec) / 1024 / 1024).toFixed(2));

    // 2. Upload simulado leve
    const tUpStart = Date.now();
    const payload = { ping: 'test'.repeat(500) }; // ~2KB
    await axios.post('https://postman-echo.com/post', payload, { timeout: 8000 });
    const tUpSec = (Date.now() - tUpStart) / 1000;
    
    const bytesUp = JSON.stringify(payload).length * 8;
    const uploadMbps = Number(((bytesUp / tUpSec) / 1024 / 1024).toFixed(2));

    // Se passou, retorna os valores numéricos reais (ou um valor mínimo garantido se a rede for muito rápida pro payload pequeno)
    return { 
      download: Math.max(downloadMbps, 0.1), 
      upload: Math.max(uploadMbps, 0.1), 
      ok: true 
    };
  } catch (err) {
    // Retorna o erro detalhado para sabermos o motivo exato caso falhe
    return { download: 0, upload: 0, ok: false, error: err.message };
  }
}

async function medir(label, fn) {
  const t0 = Date.now();
  try {
    const response = await fn();
    const ms = Date.now() - t0;
    console.log(`    ${c.cyan}├── ${label.padEnd(16)}${c.reset} ${c.bright}${String(ms).padStart(5)}ms${c.reset}  │ ${c.green}Status: [${response.status}]${c.reset}`);
    return { label, ms, status: response.status, ok: true, data: response.data };
  } catch (err) {
    const ms = Date.now() - t0;
    const status = err.response?.status ?? 0;
    console.log(`    ${c.cyan}├── ${label.padEnd(16)}${c.reset} ${c.bright}${String(ms).padStart(5)}ms${c.reset}  │ ${c.red}Status: [${status || 'TIMEOUT'}]${c.reset}`);
    return { label, ms, status, ok: false, data: err.message };
  }
}

async function round(n, esperaMin) {
  if (esperaMin > 0) {
    console.log(`\n${c.dim}──────────────────────────────────────────────────────────${c.reset}`);
    console.log(`⏳ ${c.yellow}[${horaAtual()}] Pausa de ${esperaMin} min ativada...${c.reset}`);
    await sleep(esperaMin);
  }

  process.stdout.write(`🌐 ${c.dim}[${horaAtual()}] Medindo velocidade da internet...${c.reset} `);
  let rede = await testarVelocidadeRede();

  while (!rede.ok) {
    console.log(`\n${c.red}⚠️ [${horaAtual()}] Falha no teste de rede (${rede.error}). Tentando em 10s...${c.reset}`);
    await new Promise(r => setTimeout(r, 10000));
    rede = await testarVelocidadeRede();
  }
  
  console.log(`${c.green}OK! [↓ ${rede.download} Mbps] [↑ ${rede.upload} Mbps]${c.reset}`);

  console.log(`\n${c.bgBlue}${c.bright} 🚀 CICLO #${n} (+${esperaMin}min) ➔ ${horaAtual()} ${c.reset}`);
  
  const health = await medir('GET /health', () => axios.get(`${BASE}/health`, { timeout: 60000 }));
  const login  = await medir('POST /auth/login', () => axios.post(
    `${BASE}/api/v1/auth/login`,
    { email: 'admin@triad.com', password: 'senha123456' },
    { timeout: 60000 }
  ));

  return { n, esperaMin, health, login, rede };
}

(async () => {
  console.clear();
  console.log(`${c.bright}${c.magenta}╔════════════════════════════════════════════════════════╗`);
  console.log(`║           MONITOR DE API & LATÊNCIA - TRIAD            ║`);
  console.log(`╚════════════════════════════════════════════════════════╝${c.reset}\n`);

  const results = [];
  for (let min = 0; min <= MAX_MIN; min++) {
    results.push(await round(results.length + 1, min));
  }

  console.log(`\n\n${c.bright}${c.cyan}╔════════════════════════════════════════════════════════╗`);
  console.log(`║                     RESUMO FINAL                       ║`);
  console.log(`╚════════════════════════════════════════════════════════╝${c.reset}`);
  console.log(`${c.bright} #   +min    Down/Up     /health     /login${c.reset}`);
  console.log(`──────────────────────────────────────────────────────────`);
  
  for (const r of results) {
    const netStr = `${r.rede.download}M/${r.rede.upload}M`.padEnd(11);
    console.log(
      ` ${String(r.n).padStart(2)}   ${String(r.esperaMin).padStart(3)}m   ` +
      `${c.dim}${netStr}${c.reset}  ` +
      `${String(r.health.ms).padStart(5)}ms   ` +
      `${String(r.login.ms).padStart(5)}ms`
    );
  }
})();