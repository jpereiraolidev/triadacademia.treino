// ============================================
// api.js — Bootstrap do servidor
// Triad Academia · v2.1 (logs de diagnóstico)
//
// Este arquivo:
//   1. Importa config.js, auth.js, routers.js
//   2. Monta o app Express
//   3. Aplica middlewares globais
//   4. Monta /api/v1
//   5. Registra 404 e error handler
//   6. Inicia o servidor
//
// Se algo falhar aqui, procure por "[api.js]" no log.
// ============================================

const TAG = '[api.js]';
console.log(`${TAG} ▶ carregando...`);

// ---------- IMPORTS (protegidos) ----------
let express, cors, helmet;
let config, auth, router;

try {
  express = (await import('express')).default;
  console.log(`${TAG} ✔ express carregado`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar 'express'. Verifique: npm install express`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

try {
  cors = (await import('cors')).default;
  console.log(`${TAG} ✔ cors carregado`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar 'cors'. Verifique: npm install cors`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

try {
  helmet = (await import('helmet')).default;
  console.log(`${TAG} ✔ helmet carregado`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar 'helmet'. Verifique: npm install helmet`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// ---------- config.js ----------
try {
  config = await import('./config.js');
  const required = ['prisma', 'PORT', 'redactForLog', 'HttpError'];
  const missing = required.filter((k) => config[k] === undefined);
  if (missing.length) {
    console.error(`${TAG} 💥 config.js carregou, mas não exportou: ${missing.join(', ')}`);
    console.error(`${TAG}    Verifique se config.js está completo.`);
    process.exit(1);
  }
  console.log(`${TAG} ✔ config.js carregado (prisma, PORT=${config.PORT}, HttpError)`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar './config.js'`);
  console.error(`${TAG}    Causa provável: config.js não existe, tem erro de sintaxe,`);
  console.error(`${TAG}    ou não conseguiu conectar no banco (Prisma/Postgres).`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// ---------- auth.js ----------
try {
  auth = await import('./auth.js');
  const required = ['requireAuth', 'requireRole', 'requireDevice', 'apiLimiter', 'loginLimiter', 'deviceLimiter'];
  const missing = required.filter((k) => auth[k] === undefined);
  if (missing.length) {
    console.error(`${TAG} 💥 auth.js carregou, mas não exportou: ${missing.join(', ')}`);
    console.error(`${TAG}    Verifique se auth.js está completo e se 'express-rate-limit' está instalado:`);
    console.error(`${TAG}    npm install express-rate-limit`);
    process.exit(1);
  }
  console.log(`${TAG} ✔ auth.js carregado (requireAuth, requireRole, requireDevice, limiters)`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar './auth.js'`);
  console.error(`${TAG}    Causa provável: auth.js não existe, tem erro de sintaxe,`);
  console.error(`${TAG}    ou 'express-rate-limit' não está instalado.`);
  console.error(`${TAG}    Tente: npm install express-rate-limit`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// ---------- routers.js ----------
try {
  router = (await import('./routers.js')).default;
  if (!router || typeof router !== 'function') {
    console.error(`${TAG} 💥 routers.js não exportou um Router válido (export default router)`);
    process.exit(1);
  }
  console.log(`${TAG} ✔ routers.js carregado`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar './routers.js'`);
  console.error(`${TAG}    Causa provável: routers.js não existe, tem erro de sintaxe,`);
  console.error(`${TAG}    ou faltam schemas/middlewares exportados por config.js/auth.js.`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}

const { prisma, PORT, redactForLog, HttpError } = config;

// ============================================
// PROTEÇÃO CONTRA CRASH SILENCIOSO
// ============================================
process.on('uncaughtException', (err) => {
  console.error(`${TAG} 💥 uncaughtException: ${err.message}`);
  if (process.env.NODE_ENV === 'development' && err.stack) console.error(err.stack);
});
process.on('unhandledRejection', (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`${TAG} 💥 unhandledRejection: ${msg}`);
  if (process.env.NODE_ENV === 'development' && err instanceof Error && err.stack) {
    console.error(err.stack);
  }
});

// ============================================
// APP
// ============================================
const app = express();
console.log(`${TAG} ✔ app criado`);

app.disable('x-powered-by');
app.use(helmet());
console.log(`${TAG} ✔ helmet aplicado`);

try {
  const corsOrigin = process.env.CORS_ORIGIN?.split(',') ?? '*';
  app.use(cors({ origin: corsOrigin, credentials: true }));
  console.log(`${TAG} ✔ cors aplicado (origin=${Array.isArray(corsOrigin) ? corsOrigin.join(',') : corsOrigin})`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao aplicar CORS — verifique CORS_ORIGIN no .env`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

app.use(express.json({ limit: '1mb' }));
console.log(`${TAG} ✔ express.json aplicado (limit=1mb)`);

try {
  app.use(auth.apiLimiter);
  console.log(`${TAG} ✔ apiLimiter aplicado globalmente`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao aplicar apiLimiter — verifique auth.js`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// ---------- /health ----------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
console.log(`${TAG} ✔ rota /health registrada`);

// ---------- /api/v1 ----------
app.use('/api/v1', router);
console.log(`${TAG} ✔ router montado em /api/v1`);

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});
console.log(`${TAG} ✔ handler 404 registrado`);

// ============================================
// ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
  // 1. HttpError é erro esperado — responde sem logar como 💥
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }

  // 2. Erros de parsing/limite do body-parser
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
    return res.status(400).json({ error: 'JSON inválido no corpo da requisição' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload muito grande' });
  }

  // 3. Erros conhecidos do Prisma
  const prismaErrors = {
    P2002: { status: 409, message: 'Registro duplicado' },
    P2025: { status: 404, message: 'Registro não encontrado' },
    P2003: { status: 400, message: 'Operação bloqueada por vínculo com outro registro' },
    // Conexão com o banco
    P1000: { status: 503, message: 'Banco de dados indisponível' },
    P1001: { status: 503, message: 'Banco de dados indisponível' },
    P1002: { status: 503, message: 'Tempo esgotado ao conectar ao banco' },
    P1008: { status: 503, message: 'Tempo esgotado na operação do banco' },
    P1017: { status: 503, message: 'Conexão com o banco encerrada' },
    P2024: { status: 503, message: 'Pool de conexões esgotado — tente novamente em instantes' },
  };
  if (err.code && prismaErrors[err.code]) {
    const { status, message } = prismaErrors[err.code];
    if (process.env.NODE_ENV === 'development') {
      console.error(`${TAG} 💥 Prisma ${err.code}: ${err.message}`);
      console.error(`${TAG}    path=${req.method} ${req.path}`);
    }
    return res.status(status).json({ error: message });
  }

  // 4. Erro inesperado — aí sim loga como 💥
  if (process.env.NODE_ENV === 'development') {
    console.error(`${TAG} 💥 Erro inesperado em ${req.method} ${req.path}`);
    console.error(`${TAG}    message: ${err.message}`);
    if (err.code) console.error(`${TAG}    code: ${err.code}`);
    if (err.type) console.error(`${TAG}    type: ${err.type}`);
    console.error(`${TAG}    body (sanitizado):`, redactForLog(req.body));
    if (err.stack) console.error(err.stack);
  }

  res.status(500).json({
    error: 'Erro interno do servidor',
    ...(process.env.NODE_ENV === 'development' && { detail: err.message }),
  });
});
console.log(`${TAG} ✔ error handler registrado`);

// ============================================
// START (apenas fora da Vercel)
// ============================================
// A variável VERCEL é injetada automaticamente pela plataforma.
// Localmente ela não existe, então o servidor sobe normalmente.
if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log('');
    console.log('============================================================');
    console.log(`🚀 Triad Academia API`);
    console.log(`   URL    : http://localhost:${PORT}`);
    console.log(`   Health : http://localhost:${PORT}/health`);
    console.log(`   Base   : http://localhost:${PORT}/api/v1`);
    console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
    console.log(`   RATE_LIMIT_DISABLED: ${process.env.RATE_LIMIT_DISABLED || '0'}`);
    console.log(`   LOGIN_RATE_MAX: ${process.env.LOGIN_RATE_MAX || '30 (default)'}`);
    console.log('============================================================');
    console.log('');
  });

  server.ref();

  // ============================================
  // GRACEFUL SHUTDOWN (só faz sentido com servidor local)
  // ============================================
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${TAG} ${signal} recebido, encerrando...`);
    server.close(async () => {
      try {
        await prisma.$disconnect();
        console.log(`${TAG} ✔ Prisma desconectado`);
      } catch (err) {
        console.error(`${TAG} 💥 Erro ao desconectar Prisma: ${err.message}`);
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

// ============================================
// EXPORT PARA VERCEL (Serverless Function)
// ============================================
// Em ESM usamos `export default`, NÃO `module.exports`.
// A Vercel importa este app e o executa como handler HTTP.
export default app;