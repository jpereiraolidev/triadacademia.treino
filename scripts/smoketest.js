// scripts/smoke-test.js
// Uso: node scripts/smoke-test.js
//
// Percorre todas as camadas alteradas (logs, prisma, middleware, api)
// e reporta inconsistências. NÃO substitui testes unitários.
//
// Requer: .env com RESEND_API, ALERT_TO_EMAILS, JWT_SECRET, DATABASE_URL

import 'dotenv/config';

const results = [];
let failures = 0;

function ok(name, detail) {
  results.push({ status: 'OK', name, detail });
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail) {
  results.push({ status: 'FAIL', name, detail });
  failures++;
  console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
}
function skip(name, detail) {
  results.push({ status: 'SKIP', name, detail });
  console.log(`  ⏭️  ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

async function main() {
  console.log('🔥 Smoke test — Triad Academia');
  console.log(`   NODE_ENV=${process.env.NODE_ENV || 'undefined'}`);

  // ============================================
  // 1. ENV
  // ============================================
  section('1. ENV');
  const envChecks = [
    ['DATABASE_URL', Boolean(process.env.DATABASE_URL)],
    ['JWT_SECRET', Boolean(process.env.JWT_SECRET)],
    ['INVITE_SECRET', Boolean(process.env.INVITE_SECRET)],
    ['RESEND_API', Boolean(process.env.RESEND_API)],
    ['ALERT_TO_EMAILS', Boolean(process.env.ALERT_TO_EMAILS)],
    ['ALERT_FROM_EMAIL', Boolean(process.env.ALERT_FROM_EMAIL)],
  ];
  for (const [k, okv] of envChecks) {
    if (okv) ok(`env ${k}`, 'presente');
    else fail(`env ${k}`, 'AUSENTE');
  }
  if (!process.env.RESEND_API || !process.env.ALERT_TO_EMAILS) {
    skip('email alert', 'RESEND_API ou ALERT_TO_EMAILS ausente');
  }

  // ============================================
  // 2. logs.js
  // ============================================
  section('2. logs.js');
  let logs;
  try {
    logs = await import('../src/logs.js');
  } catch (err) {
    fail('import logs.js', err.message);
    return finish();
  }
  const logsExports = ['log', 'flush', 'redact', 'requestContext', 'newReqId', 'getReqIdFromContext'];
  for (const name of logsExports) {
    if (typeof logs[name] !== 'undefined') ok(`logs.${name}`, 'exportado');
    else fail(`logs.${name}`, 'NÃO exportado');
  }

  // redact
  try {
    const clean = logs.redact({
      password: 'segredo',
      cpf: '123.456.789-00',
      token: 'abc',
      resend_api: 're_xxx',
      ok: 'visivel',
      nested: { senha: 'x', foo: 1 },
    });
    const mustHide = ['password', 'cpf', 'token', 'resend_api'];
    const mustShow = ['ok'];
    let redactOk = true;
    for (const k of mustHide) {
      if (clean[k] !== '[REDACTED]') { redactOk = false; fail(`redact.${k}`, `esperava [REDACTED], veio ${JSON.stringify(clean[k])}`); }
    }
    for (const k of mustShow) {
      if (clean[k] !== 'visivel') { redactOk = false; fail(`redact.${k}`, `esperava "visivel", veio ${JSON.stringify(clean[k])}`); }
    }
    if (clean.nested?.senha !== '[REDACTED]') { redactOk = false; fail('redact.nested.senha', 'não redacted'); }
    if (redactOk) ok('redact', 'campos sensíveis escondidos');
  } catch (err) {
    fail('redact', err.message);
  }

  // redact Error
  try {
    const e = new Error('boom');
    e.code = 'X123';
    const clean = logs.redact({ err: e });
    if (clean.err?.message === 'boom' && clean.err?.code === 'X123') ok('redact(Error)', 'name/message/code preservados');
    else fail('redact(Error)', JSON.stringify(clean.err));
  } catch (err) {
    fail('redact(Error)', err.message);
  }

  // flush
  try {
    logs.log.error('SMOKE TEST — log.error (email + DB)', { op: 'smoke' });
    const t0 = Date.now();
    await logs.flush(10000);
    ok('flush', `resolveu em ${Date.now() - t0}ms`);
  } catch (err) {
    fail('flush', err.message);
  }

  // requestContext
  try {
    let captured = null;
    logs.requestContext.run({ reqId: 'smoke-req-123' }, () => {
      captured = logs.getReqIdFromContext();
    });
    if (captured === 'smoke-req-123') ok('requestContext.run', 'reqId propagado');
    else fail('requestContext.run', `veio ${captured}`);
  } catch (err) {
    fail('requestContext.run', err.message);
  }

  // ============================================
  // 3. prisma.js
  // ============================================
  section('3. prisma.js');
  let prismaMod;
  try {
    prismaMod = await import('../src/prisma.js');
  } catch (err) {
    fail('import prisma.js', err.message);
    return finish();
  }
  const prismaExports = ['prisma', 'safeQuery', 'safeTx', 'warmupDb', 'isDbHealthy', 'disconnect', 'prismaConfig'];
  for (const name of prismaExports) {
    if (typeof prismaMod[name] !== 'undefined') ok(`prisma.${name}`, 'exportado');
    else fail(`prisma.${name}`, 'NÃO exportado');
  }

  // isDbHealthy
  try {
    const h = prismaMod.isDbHealthy();
    if (typeof h === 'boolean') ok('isDbHealthy()', `retornou ${h}`);
    else fail('isDbHealthy()', `retornou ${typeof h}`);
  } catch (err) {
    fail('isDbHealthy()', err.message);
  }

  // warmupDb
  try {
    const r = await prismaMod.warmupDb(3000);
    if (r && typeof r.ok === 'boolean') {
      ok('warmupDb()', `ok=${r.ok} ms=${r.ms} ${r.ok ? '' : `error=${r.error}`}`);
    } else {
      fail('warmupDb()', `retorno inesperado: ${JSON.stringify(r)}`);
    }
  } catch (err) {
    fail('warmupDb()', err.message);
  }

  // safeQuery SELECT 1
  let dbUp = false;
  try {
    const r = await prismaMod.safeQuery(
      () => prismaMod.prisma.$queryRaw`SELECT 1 as ok`,
      'smoke.select1'
    );
    dbUp = true;
    ok('safeQuery(SELECT 1)', `retornou ${JSON.stringify(r)}`);
  } catch (err) {
    fail('safeQuery(SELECT 1)', `code=${err.code} msg=${err.message}`);
  }

  // SystemLog insert (se DB de pé)
  if (dbUp) {
    try {
      const created = await prismaMod.prisma.systemLog.create({
        data: {
          level: 'INFO',
          tag: '[smoke-test]',
          message: 'smoke test — linha de teste',
          env: 'test',
        },
      });
      ok('SystemLog.create', `id=${created.id}`);
      // cleanup
      await prismaMod.prisma.systemLog.delete({ where: { id: created.id } });
      ok('SystemLog.delete', 'limpou');
    } catch (err) {
      fail('SystemLog.create', `code=${err.code} msg=${err.message}`);
    }
  } else {
    skip('SystemLog.create', 'DB fora');
  }

  // safeTx
  if (dbUp) {
    try {
      const r = await prismaMod.safeTx(
        async (tx) => tx.$queryRaw`SELECT 2 as ok`,
        'smoke.safeTx',
        { timeout: 5000 }
      );
      ok('safeTx()', `retornou ${JSON.stringify(r)}`);
    } catch (err) {
      fail('safeTx()', `code=${err.code} msg=${err.message}`);
    }
  } else {
    skip('safeTx()', 'DB fora');
  }

  // ============================================
  // 4. middleware.js
  // ============================================
  section('4. middleware.js');
  let mw;
  try {
    mw = await import('../api/middleware.js');
  } catch (err) {
    fail('import middleware.js', err.message);
    return finish();
  }
  const mwExports = ['requestId', 'requestLogger', 'noCache', 'securityExtra', 'warmupGlobal', 'cronAuth', 'notFound', 'errorLogger', 'errorHandler'];
  for (const name of mwExports) {
    if (typeof mw[name] === 'function') ok(`middleware.${name}`, 'exportado');
    else fail(`middleware.${name}`, 'NÃO exportado');
  }

  // requestId + requestContext
  try {
    const req = { headers: {} };
    const res = { setHeader: () => {} };
    let captured = null;
    await new Promise((resolve) => {
      mw.requestId(req, res, () => {
        captured = logs.getReqIdFromContext();
        resolve();
      });
    });
    if (req.id && captured === req.id) ok('requestId', `req.id=${req.id} ALS ok`);
    else fail('requestId', `req.id=${req.id} ALS=${captured}`);
  } catch (err) {
    fail('requestId', err.message);
  }

  // errorHandler — 500
  try {
    const req = { id: 'smoke-err', method: 'POST', path: '/x' };
    const res = makeMockRes();
    mw.errorHandler(new Error('boom'), req, res, () => {});
    if (res.statusCode === 500 && res.body?.reqId === 'smoke-err') {
      ok('errorHandler(500)', `status=${res.statusCode} reqId=${res.body.reqId}`);
    } else {
      fail('errorHandler(500)', JSON.stringify({ status: res.statusCode, body: res.body }));
    }
  } catch (err) {
    fail('errorHandler(500)', err.message);
  }

  // errorHandler — P2002 → 409
  try {
    const e = new Error('dup'); e.code = 'P2002';
    const req = { id: 'smoke-p2002', method: 'POST', path: '/x' };
    const res = makeMockRes();
    mw.errorHandler(e, req, res, () => {});
    if (res.statusCode === 409) ok('errorHandler(P2002)', 'status=409');
    else fail('errorHandler(P2002)', `status=${res.statusCode}`);
  } catch (err) {
    fail('errorHandler(P2002)', err.message);
  }

  // errorHandler — P1001 → 503
  try {
    const e = new Error('db down'); e.code = 'P1001';
    const req = { id: 'smoke-p1001', method: 'GET', path: '/x' };
    const res = makeMockRes();
    mw.errorHandler(e, req, res, () => {});
    if (res.statusCode === 503) ok('errorHandler(P1001)', 'status=503');
    else fail('errorHandler(P1001)', `status=${res.statusCode}`);
  } catch (err) {
    fail('errorHandler(P1001)', err.message);
  }

  // errorHandler — HttpError
  try {
    const { HttpError } = await import('../src/config.js');
    const req = { id: 'smoke-http', method: 'POST', path: '/x' };
    const res = makeMockRes();
    mw.errorHandler(new HttpError(422, 'unprocessable'), req, res, () => {});
    if (res.statusCode === 422) ok('errorHandler(HttpError)', 'status=422');
    else fail('errorHandler(HttpError)', `status=${res.statusCode}`);
  } catch (err) {
    fail('errorHandler(HttpError)', err.message);
  }

  // ============================================
  // 5. api/index.js + HTTP
  // ============================================
  section('5. api/index.js + HTTP');
  let app;
  try {
    const mod = await import('../api/index.js');
    app = mod.default;
    if (typeof app === 'function') ok('export default app', 'Express app');
    else fail('export default app', `typeof=${typeof app}`);
  } catch (err) {
    fail('import api/index.js', err.message);
    return finish();
  }

  // Sobe o app numa porta efêmera
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  ok('app.listen', `porta efêmera ${port}`);

  try {
    // /health
    const health = await fetch(`${base}/health`);
    const healthBody = await health.json();
    if ([200, 503].includes(health.status)) ok('GET /health', `status=${health.status} body=${JSON.stringify(healthBody)}`);
    else fail('GET /health', `status=${health.status}`);

    // /health/warm
    const warm = await fetch(`${base}/health/warm`);
    const warmBody = await warm.json();
    if (warmBody.status && warmBody.warmup) ok('GET /health/warm', `status=${warm.status} ok=${warmBody.warmup.ok}`);
    else fail('GET /health/warm', JSON.stringify(warmBody));

    // X-Request-Id ecoado
    const withId = await fetch(`${base}/health`, { headers: { 'x-request-id': 'smoke-http-123' } });
    if (withId.headers.get('x-request-id') === 'smoke-http-123') ok('X-Request-Id ecoado', 'ok');
    else fail('X-Request-Id ecoado', `veio ${withId.headers.get('x-request-id')}`);

    // /api/v1/_ping
    const ping = await fetch(`${base}/api/v1/_ping`);
    const pingBody = await ping.json();
    if (pingBody.ok === true) ok('GET /_ping', 'ok=true');
    else fail('GET /_ping', JSON.stringify(pingBody));

    // 404 com reqId
    const nf = await fetch(`${base}/api/v1/inexistente`);
    const nfBody = await nf.json();
    if (nf.status === 404 && nfBody.reqId) ok('GET 404', `reqId=${nfBody.reqId}`);
    else fail('GET 404', `status=${nf.status} body=${JSON.stringify(nfBody)}`);

    // login sem body → 400
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (login.status === 400) ok('POST /auth/login vazio', 'status=400');
    else fail('POST /auth/login vazio', `status=${login.status}`);

    // Catraca: CPF inválido → NÃO deve dar 500
    // Esperado: 401 (device key inválida) OU 400 (schema) OU 404 (aluno não encontrado)
    const catraca = await fetch(`${base}/api/v1/checkins/device`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-key': 'invalida' },
      body: JSON.stringify({ studentId: '123.456.789-00', type: 'ENTRADA' }),
    });
    if (catraca.status === 500) {
      fail('POST /checkins/device (CPF)', 'status=500 — bug do evaluateCheckin ainda presente');
    } else {
      ok('POST /checkins/device (CPF)', `status=${catraca.status} (não-500)`);
    }
  } catch (err) {
    fail('HTTP requests', err.message);
  } finally {
    server.close();
  }

  // ============================================
  // 6. flush final (email/DB pendentes)
  // ============================================
  section('6. flush final');
  await logs.flush(15000);
  ok('flush final', 'email + DB concluídos');

  // disconnect
  try {
    await prismaMod.disconnect();
    ok('disconnect()', 'prisma fechado');
  } catch (err) {
    fail('disconnect()', err.message);
  }

  finish();
}

function makeMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    headersSent: false,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.headersSent = true; return this; },
    send(b) { this.body = b; this.headersSent = true; return this; },
  };
  return res;
}

function finish() {
  const okCount = results.filter((r) => r.status === 'OK').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  const skipCount = results.filter((r) => r.status === 'SKIP').length;

  console.log('\n' + '='.repeat(64));
  console.log(`  RESULTADO: ${okCount} ok · ${failCount} falhas · ${skipCount} pulados`);
  if (failCount > 0) {
    console.log('\n  FALHAS:');
    for (const r of results.filter((x) => x.status === 'FAIL')) {
      console.log(`   ❌ ${r.name} — ${r.detail || ''}`);
    }
  }
  console.log('='.repeat(64));
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\n💥 smoke test crashou:', err);
  process.exit(1);
});