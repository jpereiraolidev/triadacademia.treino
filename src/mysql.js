// src/database/mysql.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function adaptarSqlParaPostgres(sql) {
  let s = sql;

  // 1. Trocar nomes de tabelas antigas para os models do Prisma
  s = s.replace(/\balunos\b/gi, '"Student"');
  s = s.replace(/\bfuncionarios\b/gi, '"funcionarios"');
  s = s.replace(/\bpagamentos\b/gi, '"pagamentos"');
  s = s.replace(/\bacessos\b/gi, '"acessos"');
  s = s.replace(/\bdigitais\b/gi, '"digitais"');
  s = s.replace(/\bprodutos_balcao\b/gi, '"produtos_balcao"');
  s = s.replace(/\bvendas_balcao\b/gi, '"vendas_balcao"');
  
  // 2. Trocar nomes de colunas (se o seu SQL antigo usar)
  s = s.replace(/\bnome\b/gi, 'name'); // Aluno local usava "nome", Prisma usa "name"
  // (Se precisar, adicione mais replaces aqui para colunas que mudaram de nome)

  // 3. Ajustes do Postgres
  s = s.replace(/`/g, '"');
  s = s.replace(/NOW\(\)/gi, 'CURRENT_TIMESTAMP');
  
  if (s.toUpperCase().includes("INSERT IGNORE")) {
    s = s.replace(/INSERT IGNORE/gi, "INSERT");
    s += " ON CONFLICT DO NOTHING";
  }

  return s;
}

const db = {
  query: async (sql, params = []) => {
    const sqlUpper = sql.trim().toUpperCase();
    const sqlAdaptado = adaptarSqlParaPostgres(sql);

    try {
      // SELECT
      if (sqlUpper.startsWith("SELECT") || sqlUpper.startsWith("SHOW")) {
        const linhas = await prisma.$queryRawUnsafe(sqlAdaptado, ...params);
        
        // Tratamento de datas e decimais para o frontend antigo não quebrar
        const linhasNormalizadas = linhas.map(linha => {
          const nova = { ...linha };
          for (const key in nova) {
            if (nova[key] !== null && typeof nova[key] === 'object' && nova[key].constructor.name === 'Decimal') {
              nova[key] = parseFloat(nova[key].toString());
            }
            if (nova[key] instanceof Date) {
              nova[key] = nova[key].toISOString().split('T')[0]; // YYYY-MM-DD
            }
          }
          return nova;
        });
        return [linhasNormalizadas, null];
      }

      // INSERT, UPDATE, DELETE
      const resultado = await prisma.$executeRawUnsafe(sqlAdaptado, ...params);
      return [{ affectedRows: resultado, insertId: null }, null];
      
    } catch (e) {
      console.error("❌ Erro na query:", sqlAdaptado);
      console.error("Detalhes:", e.message);
      throw e;
    }
  },

  execute: async (sql, params = []) => db.query(sql, params),

  getConnection: async () => ({
    query: db.query,
    execute: db.execute,
    release: () => {},
    ping: async () => true,
  }),

  testarConexao: async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { conectado: true, mensagem: "Prisma Cloud (Postgres) conectado." };
    } catch (e) {
      return { conectado: false, mensagem: e.message };
    }
  },
  
  obterEstadoConexao: () => ({ conectado: true, mensagem: "Conectado ao Prisma Postgres" })
};

module.exports = db;