// ============================================
// src/integracao.js — Rotas que faltavam para o
// frontend React+Vite (TRIAD) funcionar 100%
// contra o backend v3.0.
//
// Montado em /api/v1 pelo api.js (2 linhas).
// NÃO altera routes.js, config.js, auth.js, prisma.js nem logs.js.
//
// Cobre:
//   - PAYMENTS   (pagamentos avulsos de mensalidade)
//   - PRODUCTS   (estoque do balcão)
//   - SALES      (vendas do balcão)
//   - SETTINGS   (configurações da academia)
//   - CHECKINS   (resumo do dia)
//
// Biometria (/futronic/*) e catraca (/acesso/testar-catraca)
// NÃO entram aqui — vivem no outro serviço. O front fala
// direto com ele via apiBiometria.js / apiCatraca.js.
// ============================================

import express from 'express';
import { z } from 'zod';
import { log as rootLog } from './logs.js';
import { safeQuery } from './prisma.js';
import {
  prisma, asyncHandler, validate, HttpError,
} from './config.js';
import { requireAuth, requireRole } from './auth.js';

const log = rootLog.child('[integracao.js] ');
log.info('carregando...');

const router = express.Router();

// ============================================
// HELPERS LOCAIS
// ============================================

// Formata número/Decimal para o padrão do front ("0,00")
// Aceita: number, string, Prisma.Decimal
function moneyToFront(value) {
  if (value == null) return '0,00';
  const n =
    typeof value === 'object' && typeof value.toNumber === 'function'
      ? value.toNumber()
      : Number(value);
  if (Number.isNaN(n)) return '0,00';
  return n.toFixed(2).replace('.', ',');
}

// Normaliza forma de pagamento para o front
function formaToFront(forma) {
  const f = String(forma || 'PIX').toUpperCase();
  if (['CREDITO', 'CRÉDITO', 'CARTAO', 'CARTÃO'].includes(f)) return 'CREDITO';
  if (['DEBITO', 'DÉBITO'].includes(f)) return 'DEBITO';
  if (f === 'DINHEIRO') return 'DINHEIRO';
  return 'PIX';
}

// Converte data ISO -> "YYYY-MM-DD"
function dateToFront(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('sv-SE');
}

// ============================================
// SCHEMAS ZOD (locais, não tocam em config.js)
// ============================================

const paymentCreateSchema = z.object({
  studentId: z.string().min(1),
  membershipId: z.string().min(1).optional().nullable(),
  valor: z.number().nonnegative(),
  valorRecebido: z.number().nonnegative().optional().nullable(),
  troco: z.number().nonnegative().optional().nullable(),
  forma: z.enum(['PIX', 'DINHEIRO', 'CREDITO', 'DEBITO']).default('PIX'),
  vencimentoAnterior: z.coerce.date().optional().nullable(),
  novoVencimento: z.coerce.date().optional().nullable(),
  origem: z.enum(['FINANCEIRO', 'BALCAO']).default('FINANCEIRO'),
  observacao: z.string().trim().max(500).optional().nullable(),
}).strict();

const productCreateSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  categoria: z.string().trim().max(60).optional().nullable(),
  quantidade: z.number().int().nonnegative().default(0),
  valorCompra: z.number().nonnegative().default(0),
  valorVenda: z.number().nonnegative().default(0),
  ativo: z.boolean().optional(),
}).strict();

const productUpdateSchema = productCreateSchema.partial();

const saleCreateSchema = z.object({
  produtoId: z.string().min(1),
  quantidade: z.number().int().positive(),
  valorUnitario: z.number().nonnegative(),
  valorRecebido: z.number().nonnegative().optional().nullable(),
  valorDevolvido: z.number().nonnegative().optional().nullable(),
  forma: z.enum(['PIX', 'DINHEIRO', 'CREDITO', 'DEBITO']).default('PIX'),
}).strict();

const settingsUpdateSchema = z.object({
  nomeAcademia: z.string().trim().max(120).optional(),
  subtituloSistema: z.string().trim().max(120).optional(),
  logoAcademia: z.string().trim().max(2000).optional().nullable(),
  corPrincipal: z.string().trim().max(20).optional(),
  valorMensalidadePadrao: z.union([z.string(), z.number()]).optional(),
  diasTolerancia: z.union([z.string(), z.number()]).optional(),
  bloquearVencidos: z.enum(['sim', 'nao']).optional(),
  mensagemBomTreino: z.string().trim().max(500).optional(),
  mensagemAcessoNegado: z.string().trim().max(500).optional(),
}).strict();

// ============================================
// MÓDULO 1 — PAGAMENTOS
// ============================================

router.post(
  '/payments',
  requireAuth, requireRole('ADMIN', 'RECEPCAO'),
  validate(paymentCreateSchema),
  asyncHandler(async (req, res) => {
    const {
      studentId, membershipId, valor, valorRecebido, troco,
      forma, vencimentoAnterior, novoVencimento, origem, observacao,
    } = req.validated;

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw new HttpError(404, 'Aluno não encontrado');

    const payment = await prisma.payment.create({
      data: {
        studentId,
        membershipId: membershipId ?? null,
        valor,
        valorRecebido: valorRecebido ?? valor,
        troco: troco ?? 0,
        forma,
        vencimentoAnterior: vencimentoAnterior ?? null,
        novoVencimento: novoVencimento ?? null,
        origem,
        observacao: observacao ?? null,
        registradoPor: req.user.id,
      },
    });

    if (novoVencimento && membershipId) {
      await prisma.membership.update({
        where: { id: membershipId },
        data: { endDate: novoVencimento, status: 'ATIVA' },
      }).catch((err) => log.warn('falha ao atualizar membership', {
        membershipId, msg: err.message,
      }));
    }

    res.status(201).json({
      ok: true,
      pagamento: {
        id: payment.id,
        data: dateToFront(payment.createdAt),
        horario: payment.createdAt.toLocaleTimeString('pt-BR', {
          hour: '2-digit', minute: '2-digit',
        }),
        valor: moneyToFront(payment.valor),
        valorRecebido: moneyToFront(payment.valorRecebido),
        troco: moneyToFront(payment.troco),
        forma: formaToFront(payment.forma),
        vencimentoAnterior: dateToFront(payment.vencimentoAnterior),
        novoVencimento: dateToFront(payment.novoVencimento),
        origem: payment.origem,
      },
    });
  })
);

router.get(
  '/payments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { studentId, from, to, limit } = req.query;
    const where = {};
    if (studentId) where.studentId = studentId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const payments = await safeQuery(
      () => prisma.payment.findMany({
        where,
        take: Math.min(Number(limit) || 100, 500),
        orderBy: { createdAt: 'desc' },
        include: {
          student: { select: { id: true, name: true } },
          registeredUser: { select: { id: true, name: true } },
        },
      }),
      'integracao.payments.list'
    );

    res.json(payments.map((p) => ({
      ...p,
      data: dateToFront(p.createdAt),
      horario: p.createdAt.toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit',
      }),
      valor: moneyToFront(p.valor),
      valorRecebido: moneyToFront(p.valorRecebido),
      troco: moneyToFront(p.troco),
      forma: formaToFront(p.forma),
      vencimentoAnterior: dateToFront(p.vencimentoAnterior),
      novoVencimento: dateToFront(p.novoVencimento),
    })));
  })
);

// ============================================
// MÓDULO 2 — PRODUTOS (BALCÃO)
// ============================================

router.get(
  '/products',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { ativo } = req.query;
    const where = {};
    if (ativo !== undefined) where.active = ativo === 'true';

    const products = await safeQuery(
      () => prisma.product.findMany({
        where,
        orderBy: { nome: 'asc' },
      }),
      'integracao.products.list'
    );

    res.json(products.map((p) => ({
      id: p.id,
      nome: p.nome,
      categoria: p.categoria || '',
      quantidade: p.quantidade,
      valorCompra: moneyToFront(p.valorCompra),
      valorVenda: moneyToFront(p.valorVenda),
      ativo: p.active ? 'sim' : 'nao',
      criadoEm: dateToFront(p.createdAt),
    })));
  })
);

router.post(
  '/products',
  requireAuth, requireRole('ADMIN', 'RECEPCAO'),
  validate(productCreateSchema),
  asyncHandler(async (req, res) => {
    const { nome, categoria, quantidade, valorCompra, valorVenda, ativo } = req.validated;
    const product = await prisma.product.create({
      data: {
        nome,
        categoria: categoria ?? null,
        quantidade,
        valorCompra,
        valorVenda,
        ...(ativo !== undefined && { active: ativo }),
      },
    });
    res.status(201).json(product);
  })
);

router.patch(
  '/products/:id',
  requireAuth, requireRole('ADMIN', 'RECEPCAO'),
  validate(productUpdateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Produto não encontrado');

    const data = { ...req.validated };
    if ('ativo' in data) {
      data.active = data.ativo;
      delete data.ativo;
    }

    const product = await prisma.product.update({
      where: { id }, data,
    });
    res.json(product);
  })
);

router.delete(
  '/products/:id',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Produto não encontrado');
    await prisma.product.update({ where: { id }, data: { active: false } });
    res.status(204).send();
  })
);

// ============================================
// MÓDULO 3 — VENDAS (BALCÃO)
// ============================================

router.post(
  '/sales',
  requireAuth, requireRole('ADMIN', 'RECEPCAO'),
  validate(saleCreateSchema),
  asyncHandler(async (req, res) => {
    const {
      produtoId, quantidade, valorUnitario,
      valorRecebido, valorDevolvido, forma,
    } = req.validated;

    const product = await prisma.product.findUnique({ where: { id: produtoId } });
    if (!product) throw new HttpError(404, 'Produto não encontrado');
    if (!product.active) throw new HttpError(400, 'Produto inativo');
    if (product.quantidade < quantidade) {
      throw new HttpError(400, `Estoque insuficiente (disponível: ${product.quantidade})`);
    }

    const total = valorUnitario * quantidade;

    const result = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          produtoId,
          produtoNome: product.nome,
          categoria: product.categoria,
          quantidade,
          valorUnitario,
          total,
          valorRecebido: valorRecebido ?? total,
          valorDevolvido: valorDevolvido ?? 0,
          forma,
          registeredBy: req.user.id,
        },
      });

      const updated = await tx.product.update({
        where: { id: produtoId },
        data: { quantidade: { decrement: quantidade } },
      });

      return { sale, updated };
    });

    res.status(201).json({
      venda: {
        id: result.sale.id,
        produtoId,
        produtoNome: result.sale.produtoNome,
        categoria: result.sale.categoria || '',
        quantidade: result.sale.quantidade,
        valorUnitario: moneyToFront(result.sale.valorUnitario),
        total: moneyToFront(result.sale.total),
        valorRecebido: moneyToFront(result.sale.valorRecebido),
        valorDevolvido: moneyToFront(result.sale.valorDevolvido),
        forma: formaToFront(result.sale.forma),
        data: dateToFront(result.sale.createdAt),
        horario: result.sale.createdAt.toLocaleTimeString('pt-BR', {
          hour: '2-digit', minute: '2-digit',
        }),
      },
      produto: {
        id: result.updated.id,
        nome: result.updated.nome,
        quantidade: result.updated.quantidade,
      },
    });
  })
);

router.get(
  '/sales',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { from, to, limit } = req.query;
    const where = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const sales = await safeQuery(
      () => prisma.sale.findMany({
        where,
        take: Math.min(Number(limit) || 200, 500),
        orderBy: { createdAt: 'desc' },
        include: { product: { select: { id: true, nome: true } } },
      }),
      'integracao.sales.list'
    );

    res.json(sales.map((s) => ({
      id: s.id,
      produtoId: s.produtoId,
      produtoNome: s.produtoNome,
      categoria: s.categoria || '',
      quantidade: s.quantidade,
      valorUnitario: moneyToFront(s.valorUnitario),
      total: moneyToFront(s.total),
      valorRecebido: moneyToFront(s.valorRecebido),
      valorDevolvido: moneyToFront(s.valorDevolvido),
      forma: formaToFront(s.forma),
      data: dateToFront(s.createdAt),
      horario: s.createdAt.toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit',
      }),
    })));
  })
);

// ============================================
// MÓDULO 4 — SETTINGS (CONFIGURAÇÕES)
// ============================================

router.get(
  '/settings',
  requireAuth,
  asyncHandler(async (req, res) => {
    let settings = await safeQuery(
      () => prisma.settings.findUnique({ where: { id: 1 } }),
      'integracao.settings.get'
    );

    if (!settings) {
      settings = await prisma.settings.create({ data: { id: 1 } }).catch(() => null);
    }
    if (!settings) throw new HttpError(500, 'Não foi possível carregar as configurações');

    res.json({
      nomeAcademia: settings.nomeAcademia,
      subtituloSistema: settings.subtituloSistema || 'Academia',
      logoAcademia: settings.logoAcademia || '',
      corPrincipal: settings.corPrincipal || '#2563eb',
      valorMensalidadePadrao: moneyToFront(settings.valorMensalidadePadrao),
      diasTolerancia: String(settings.diasTolerancia || 0),
      bloquearVencidos: settings.bloquearVencidos || 'sim',
      mensagemBomTreino: settings.mensagemBomTreino || '',
      mensagemAcessoNegado: settings.mensagemAcessoNegado || '',
    });
  })
);

router.put(
  '/settings',
  requireAuth, requireRole('ADMIN'),
  validate(settingsUpdateSchema),
  asyncHandler(async (req, res) => {
    const v = req.validated;

    const data = {
      ...(v.nomeAcademia !== undefined && { nomeAcademia: v.nomeAcademia }),
      ...(v.subtituloSistema !== undefined && { subtituloSistema: v.subtituloSistema }),
      ...(v.logoAcademia !== undefined && { logoAcademia: v.logoAcademia || null }),
      ...(v.corPrincipal !== undefined && { corPrincipal: v.corPrincipal }),
      ...(v.valorMensalidadePadrao !== undefined && {
        valorMensalidadePadrao: Number(
          String(v.valorMensalidadePadrao).replace(',', '.')
        ) || 0,
      }),
      ...(v.diasTolerancia !== undefined && {
        diasTolerancia: Number(v.diasTolerancia) || 0,
      }),
      ...(v.bloquearVencidos !== undefined && { bloquearVencidos: v.bloquearVencidos }),
      ...(v.mensagemBomTreino !== undefined && { mensagemBomTreino: v.mensagemBomTreino }),
      ...(v.mensagemAcessoNegado !== undefined && {
        mensagemAcessoNegado: v.mensagemAcessoNegado,
      }),
    };

    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });

    res.json({
      nomeAcademia: settings.nomeAcademia,
      subtituloSistema: settings.subtituloSistema || 'Academia',
      logoAcademia: settings.logoAcademia || '',
      corPrincipal: settings.corPrincipal || '#2563eb',
      valorMensalidadePadrao: moneyToFront(settings.valorMensalidadePadrao),
      diasTolerancia: String(settings.diasTolerancia || 0),
      bloquearVencidos: settings.bloquearVencidos || 'sim',
      mensagemBomTreino: settings.mensagemBomTreino || '',
      mensagemAcessoNegado: settings.mensagemAcessoNegado || '',
    });
  })
);

// ============================================
// MÓDULO 5 — RESUMO DE CHECK-INS DO DIA
// ============================================

router.get(
  '/checkins/summary/today',
  requireAuth,
  asyncHandler(async (req, res) => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const [total, autorizados, negados, ultimos] = await Promise.all([
      prisma.checkin.count({
        where: { createdAt: { gte: startOfDay, lt: endOfDay } },
      }),
      prisma.checkin.count({
        where: {
          createdAt: { gte: startOfDay, lt: endOfDay },
          status: 'AUTORIZADO',
        },
      }),
      prisma.checkin.count({
        where: {
          createdAt: { gte: startOfDay, lt: endOfDay },
          status: 'NEGADO',
        },
      }),
      prisma.checkin.findMany({
        where: { createdAt: { gte: startOfDay, lt: endOfDay } },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { student: { select: { id: true, name: true } } },
      }),
    ]);

    res.json({
      data: dateToFront(startOfDay),
      total,
      autorizados,
      negados,
      ultimos: ultimos.map((c) => ({
        id: c.id,
        alunoNome: c.student?.name || '',
        status: c.status,
        horario: c.createdAt.toLocaleTimeString('pt-BR', {
          hour: '2-digit', minute: '2-digit',
        }),
      })),
    });
  })
);

// ============================================
// EXPORT
// ============================================
log.info('integracao.js carregado (payments, products, sales, settings, checkins/summary)');
export default router;