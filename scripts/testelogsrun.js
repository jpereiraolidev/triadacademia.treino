import 'dotenv/config';
import { log, flush } from '../src/logs.js';

console.log('--- disparando alertas de teste ---');

log.error('TESTE de alerta — ignore', {
  op: 'test-alert',
  password: 'deve-sair-REDACTED',
  cpf: '123.456.789-00',
  foo: 'bar',
});

log.fatal('TESTE fatal — ignore');

console.log('--- aguardando email + DB (até 15s) ---');
await flush(15000);
console.log('✅ email e DB concluídos. Confira Resend + SystemLog.');
process.exit(0);