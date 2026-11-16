// ============================================
// src/routes.js — Todas as rotas /api/v1
// Triad Academia · v3.2
//
// Mudanças v3.2 (sobre v3.1):
//   - POST /students aceita cpf (normalizado para só dígitos)
//   - evaluateCheckin normaliza CPF (com/sem pontuação) e busca em
//     id, cpf, legacyId — funciona com qualquer formato do gateway
//   - /invites/bulk sem skipDuplicates (createMany puro, mais rápido)
//   - POST /students/import aceita cpf
// ============================================

import express from 'express';
import { log as rootLog } from './logs.js';
import { safeQuery, safeTx } from './prisma.js';
import {
  prisma, asyncHandler, validate, HttpError,
  hashPassword, verifyPassword, signToken,
  generateDeviceKey, hashDeviceKey,
  userSelect,
  loginSchema, userCreateSchema, userUpdateSchema, userPasswordSchema,
  exerciseCreateSchema, exerciseUpdateSchema,
  studentCreateSchema, studentUpdateSchema,
  planCreateSchema, planUpdateSchema,
  membershipCreateSchema, membershipUpdateSchema,
  deviceCreateSchema, deviceUpdateSchema,
  checkinCreateSchema, checkinManualSchema, checkinQuerySchema,
  workoutCreateSchema, workoutUpdateSchema,
  workoutExerciseCreateSchema, workoutExerciseUpdateSchema,
  inviteCreateSchema, inviteBulkSchema, inviteAcceptSchema,
  inviteMarkSentSchema, studentImportSchema,
  generateInviteId, generateInviteNonce, signInvite, buildInviteUrl, verifyInviteHmac,
  APP_URL, INVITE_PATH, CRON_SECRET,
} from './config.js';

import {
  requireAuth, requireRole, requireAluno, requireDevice,
  loginLimiter, deviceLimiter,
} from './auth.js';

const log = rootLog.child('[routes.js] ');
log.info('carregando...');

const router = express.Router();
let routeCount = 0;
const countRoute = () => routeCount++;

// ============================================
// HELPER — normaliza CPF (remove pontuação)
// ============================================
// Retorna só dígitos se for 11 dígitos; senão retorna null.
// Usado pelo POST /students, import e evaluateCheckin.
function normalizeCpf(value) {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
}

// ============================================
// AUTH
// ============================================

router.post(
  '/auth/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.validated;

    const user = await safeQuery(
      () => prisma.user.findUnique({ where: { email } }),
      'auth.login.findUser'
    );
    if (!user || !user.active) throw new HttpError(401, 'Credenciais inválidas');

    const ok = await verifyPassword(user.password, password);
    if (!ok) throw new HttpError(401, 'Credenciais inválidas');

    const token = signToken(user);
    res.json({
      token,
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      user: { ...user, password: undefined },
    });
  })
);
countRoute();

router.get(
  '/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => res.json(req.user))
);
countRoute();

// ============================================
// USERS
// ============================================

router.get(
  '/users',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const users = await safeQuery(
      () => prisma.user.findMany({ select: userSelect, orderBy: { name: 'asc' } }),
      'users.list'
    );
    res.json(users);
  })
);
countRoute();

router.post(
  '/users',
  requireAuth, requireRole('ADMIN'),
  validate(userCreateSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password, role } = req.validated;
    const exists = await safeQuery(
      () => prisma.user.findUnique({ where: { email } }),
      'users.create.checkEmail'
    );
    if (exists) throw new HttpError(409, 'Email já cadastrado');
    const hash = await hashPassword(password);
    const user = await safeQuery(
      () => prisma.user.create({
        data: { name, email, password: hash, role: role ?? 'PROFESSOR' },
        select: userSelect,
      }),
      'users.create'
    );
    res.status(201).json(user);
  })
);
countRoute();

router.patch(
  '/users/:id',
  requireAuth, requireRole('ADMIN'),
  validate(userUpdateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await safeQuery(
      () => prisma.user.findUnique({ where: { id } }),
      'users.update.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Usuário não encontrado');
    const user = await safeQuery(
      () => prisma.user.update({
        where: { id }, data: req.validated, select: userSelect,
      }),
      'users.update'
    );
    res.json(user);
  })
);
countRoute();

router.patch(
  '/users/:id/password',
  requireAuth, requireRole('ADMIN'),
  validate(userPasswordSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await safeQuery(
      () => prisma.user.findUnique({ where: { id } }),
      'users.password.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Usuário não encontrado');
    const hash = await hashPassword(req.validated.password);
    await safeQuery(
      () => prisma.user.update({ where: { id }, data: { password: hash } }),
      'users.password'
    );
    res.status(204).send();
  })
);
countRoute();

router.delete(
  '/users/:id',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (id === req.user.id) throw new HttpError(400, 'Não pode desativar a si mesmo');
    const existing = await safeQuery(
      () => prisma.user.findUnique({ where: { id } }),
      'users.delete.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Usuário não encontrado');
    await safeQuery(
      () => prisma.user.update({ where: { id }, data: { active: false } }),
      'users.delete'
    );
    res.status(204).send();
  })
);
countRoute();

// ============================================
// EXERCISES
// ============================================

router.get(
  '/exercises',
  asyncHandler(async (req, res) => {
    const { search, muscleGroup, active } = req.query;
    const where = {};
    if (search) where.name = { contains: search, mode: 'insensitive' };
    if (muscleGroup) where.muscleGroup = muscleGroup;
    if (active !== undefined) where.active = active === 'true';

    const exercises = await safeQuery(
      () => prisma.exercise.findMany({ where, orderBy: { name: 'asc' } }),
      'exercises.list'
    );
    res.json(exercises);
  })
);
countRoute();

router.post(
  '/exercises',
  requireAuth, requireRole('ADMIN', 'PROFESSOR'),
  validate(exerciseCreateSchema),
  asyncHandler(async (req, res) => {
    const { name, description, muscleGroup, videoUrl, active } = req.validated;
    const exercise = await safeQuery(
      () => prisma.exercise.create({
        data: {
          name,
          description: description ?? null,
          muscleGroup: muscleGroup ?? null,
          videoUrl: videoUrl || null,
          ...(active !== undefined && { active }),
        },
      }),
      'exercises.create'
    );
    res.status(201).json(exercise);
  })
);
countRoute();

router.patch(
  '/exercises/:id',
  requireAuth, requireRole('ADMIN', 'PROFESSOR'),
  validate(exerciseUpdateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await safeQuery(
      () => prisma.exercise.findUnique({ where: { id } }),
      'exercises.update.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Exercício não encontrado');
    const data = { ...req.validated };
    if (data.videoUrl === '') data.videoUrl = null;
    const exercise = await safeQuery(
      () => prisma.exercise.update({ where: { id }, data }),
      'exercises.update'
    );
    res.json(exercise);
  })
);
countRoute();

router.delete(
  '/exercises/:id',
  requireAuth, requireRole('ADMIN', 'PROFESSOR'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await safeQuery(
      () => prisma.exercise.findUnique({ where: { id } }),
      'exercises.delete.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Exercício não encontrado');
    await safeQuery(
      () => prisma.exercise.update({ where: { id }, data: { active: false } }),
      'exercises.delete'
    );
    res.status(204).send();
  })
);
countRoute();

// ============================================
// STUDENTS
// ============================================

router.get(
  '/students',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { search, active } = req.query;
    const where = {};
    if (search) where.name = { contains: search, mode: 'insensitive' };
    if (active !== undefined) where.active = active === 'true';

    const students = await safeQuery(
      () => prisma.student.findMany({ where, orderBy: { name: 'asc' } }),
      'students.list'
    );
    res.json(students);
  })
);
countRoute();

router.get(
  '/students/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const student = await safeQuery(
      () => prisma.student.findUnique({
        where: { id: req.params.id },
        include: {
          memberships: { include: { plan: true }, orderBy: { startDate: 'desc' } },
        },
      }),
      'students.getById'
    );
    if (!student) throw new HttpError(404, 'Aluno não encontrado');
    res.json(student);
  })
);
countRoute();

router.post(
  '/students',
  requireAuth, requireRole('ADMIN', 'RECEPCAO'),
  validate(studentCreateSchema),
  asyncHandler(async (req, res) => {
    const { name, email, phone, cpf, birthDate, active } = req.validated;
    const cpfNorm = normalizeCpf(cpf);

    const student = await safeQuery(
      () => prisma.student.create({
        data: {
          name,
          email: email ?? null,
          phone: phone ?? null,
          cpf: cpfNorm,
          birthDate: birthDate ?? null,
          ...(active !== undefined && { active }),
        },
      }),
      'students.create'
    );
    res.status(201).json(student);
  })
);
countRoute();

router.patch(
  '/students/:id',
  requireAuth, requireRole('ADMIN', 'RECEPCAO'),
  validate(studentUpdateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await safeQuery(
      () => prisma.student.findUnique({ where: { id } }),
      'students.update.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Aluno não encontrado');
    const data = { ...req.validated };
    if ('cpf' in data) data.cpf = normalizeCpf(data.cpf);
    const student = await safeQuery(
      () => prisma.student.update({ where: { id }, data }),
      'students.update'
    );
    res.json(student);
  })
);
countRoute();

router.delete(
  '/students/:id',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await safeQuery(
      () => prisma.student.findUnique({ where: { id } }),
      'students.delete.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Aluno não encontrado');
    await safeQuery(
      () => prisma.student.update({ where: { id }, data: { active: false } }),
      'students.delete'
    );
    res.status(204).send();
  })
);
countRoute();

// ============================================
// PLANS
// ============================================

router.get(
  '/plans',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { active } = req.query;
    const where = {};
    if (active !== undefined) where.active = active === 'true';

    const plans = await safeQuery(
      () => prisma.plan.findMany({ where, orderBy: { name: 'asc' } }),
      'plans.list'
    );
    res.json(plans);
  })
);
countRoute();

router.get(
  '/plans/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const plan = await safeQuery(
      () => prisma.plan.findUnique({ where: { id: req.params.id } }),
      'plans.getById'
    );
    if (!plan) throw new HttpError(404, 'Plano não encontrado');
    res.json(plan);
  })
);
countRoute();

router.post(
  '/plans',
  requireAuth, requireRole('ADMIN'),
  validate(planCreateSchema),
  asyncHandler(async (req, res) => {
    const plan = await safeQuery(
      () => prisma.plan.create({ data: req.validated }),
      'plans.create'
    );
    res.status(201).json(plan);
  })
);
countRoute();

router.patch(
  '/plans/:id',
  requireAuth, requireRole('ADMIN'),
  validate(planUpdateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await safeQuery(
      () => prisma.plan.findUnique({ where: { id } }),
      'plans.update.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Plano não encontrado');
    const plan = await safeQuery(
      () => prisma.plan.update({ where: { id }, data: req.validated }),
      'plans.update'
    );
    res.json(plan);
  })
);
countRoute();

router.delete(
  '/plans/:id',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await safeQuery(
      () => prisma.plan.findUnique({ where: { id } }),
      'plans.delete.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Plano não encontrado');
    await safeQuery(
      () => prisma.plan.update({ where: { id }, data: { active: false } }),
      'plans.delete'
    );
    res.status(204).send();
  })
);
countRoute();

// ============================================
// MEMBERSHIPS
// ============================================

router.get(
  '/memberships',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { studentId, status, active } = req.query;
    const where = {};
    if (studentId) where.studentId = studentId;
    if (status) where.status = status;
    if (active === 'true') where.endDate = { gte: new Date() };

    const memberships = await safeQuery(
      () => prisma.membership.findMany({
        where,
        include: {
          student: { select: { id: true, name: true, email: true } },
          plan: { select: { id: true, name: true, price: true, durationDays: true } },
        },
        orderBy: { startDate: 'desc' },
      }),
      'memberships.list'
    );
    res.json(memberships);
  })
);
countRoute();

router.get(
  '/memberships/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const m = await safeQuery(
      () => prisma.membership.findUnique({
        where: { id: req.params.id },
        include: { student: true, plan: true },
      }),
      'memberships.getById'
    );
    if (!m) throw new HttpError(404, 'Matrícula não encontrada');
    res.json(m);
  })
);
countRoute();

router.post(
  '/memberships',
  requireAuth, requireRole('ADMIN', 'RECEPCAO'),
  validate(membershipCreateSchema),
  asyncHandler(async (req, res) => {
    const { studentId, planId, startDate, endDate, priceAtPurchase, status } = req.validated;

    const [student, plan] = await Promise.all([
      safeQuery(
        () => prisma.student.findUnique({ where: { id: studentId } }),
        'memberships.create.findStudent'
      ),
      safeQuery(
        () => prisma.plan.findUnique({ where: { id: planId } }),
        'memberships.create.findPlan'
      ),
    ]);
    if (!student) throw new HttpError(404, 'Aluno não encontrado');
    if (!student.active) throw new HttpError(400, 'Aluno inativo');
    if (!plan) throw new HttpError(404, 'Plano não encontrado');
    if (!plan.active) throw new HttpError(400, 'Plano inativo');

    let finalEnd = endDate;
    if (!finalEnd) {
      finalEnd = new Date(startDate);
      finalEnd.setDate(finalEnd.getDate() + plan.durationDays);
    }
    if (finalEnd <= startDate) throw new HttpError(400, 'endDate deve ser depois de startDate');

    const membership = await safeQuery(
      () => prisma.membership.create({
        data: {
          studentId, planId, startDate,
          endDate: finalEnd,
          priceAtPurchase: priceAtPurchase ?? plan.price,
          status: status ?? 'ATIVA',
        },
        include: { student: true, plan: true },
      }),
      'memberships.create'
    );
    res.status(201).json(membership);
  })
);
countRoute();

router.patch(
  '/memberships/:id',
  requireAuth, requireRole('ADMIN', 'RECEPCAO'),
  validate(membershipUpdateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await safeQuery(
      () => prisma.membership.findUnique({ where: { id } }),
      'memberships.update.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Matrícula não encontrada');
    const membership = await safeQuery(
      () => prisma.membership.update({
        where: { id }, data: req.validated,
        include: { student: true, plan: true },
      }),
      'memberships.update'
    );
    res.json(membership);
  })
);
countRoute();

router.delete(
  '/memberships/:id',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await safeQuery(
      () => prisma.membership.findUnique({ where: { id } }),
      'memberships.delete.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Matrícula não encontrada');
    await safeQuery(
      () => prisma.membership.update({ where: { id }, data: { status: 'CANCELADA' } }),
      'memberships.delete'
    );
    res.status(204).send();
  })
);
countRoute();

// ============================================
// DEVICES
// ============================================

router.get(
  '/devices',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const devices = await safeQuery(
      () => prisma.device.findMany({
        select: {
          id: true, name: true, identifier: true, active: true,
          createdAt: true, updatedAt: true,
        },
        orderBy: { name: 'asc' },
      }),
      'devices.list'
    );
    res.json(devices);
  })
);
countRoute();

router.post(
  '/devices',
  requireAuth, requireRole('ADMIN'),
  validate(deviceCreateSchema),
  asyncHandler(async (req, res) => {
    const { name, identifier, active } = req.validated;
    const exists = await safeQuery(
      () => prisma.device.findUnique({ where: { identifier } }),
      'devices.create.checkIdentifier'
    );
    if (exists) throw new HttpError(409, 'Identificador já cadastrado');

    const rawKey = generateDeviceKey();
    const apiKeyHash = hashDeviceKey(rawKey);
    const device = await safeQuery(
      () => prisma.device.create({
        data: { name, identifier, apiKeyHash, ...(active !== undefined && { active }) },
        select: { id: true, name: true, identifier: true, active: true, createdAt: true },
      }),
      'devices.create'
    );
    res.status(201).json({
      ...device,
      apiKey: rawKey,
      warning: 'Guarde esta API key. Ela não será exibida novamente.',
    });
  })
);
countRoute();

router.patch(
  '/devices/:id',
  requireAuth, requireRole('ADMIN'),
  validate(deviceUpdateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await safeQuery(
      () => prisma.device.findUnique({ where: { id } }),
      'devices.update.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Device não encontrado');
    const device = await safeQuery(
      () => prisma.device.update({
        where: { id }, data: req.validated,
        select: {
          id: true, name: true, identifier: true, active: true,
          createdAt: true, updatedAt: true,
        },
      }),
      'devices.update'
    );
    res.json(device);
  })
);
countRoute();

router.post(
  '/devices/:id/rotate-key',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await safeQuery(
      () => prisma.device.findUnique({ where: { id } }),
      'devices.rotateKey.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Device não encontrado');
    const rawKey = generateDeviceKey();
    const apiKeyHash = hashDeviceKey(rawKey);
    await safeQuery(
      () => prisma.device.update({ where: { id }, data: { apiKeyHash } }),
      'devices.rotateKey'
    );
    res.json({
      id, apiKey: rawKey,
      warning: 'Guarde esta API key. Ela não será exibida novamente.',
    });
  })
);
countRoute();

router.delete(
  '/devices/:id',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await safeQuery(
      () => prisma.device.findUnique({ where: { id } }),
      'devices.delete.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Device não encontrado');
    await safeQuery(
      () => prisma.device.update({ where: { id }, data: { active: false } }),
      'devices.delete'
    );
    res.status(204).send();
  })
);
countRoute();

// ============================================
// CHECKINS
// ============================================
// v3.2: normaliza CPF (com/sem pontuação) e busca em id, cpf, legacyId.
// Usa 1 query (findFirst com OR + include memberships).
// ============================================
async function evaluateCheckin(studentId) {
  const now = new Date();
  const digits = normalizeCpf(studentId); // só dígitos ou null

  // Monta o OR dinamicamente:
  //   - id: studentId (como veio)
  //   - cpf: studentId (se já for 11 dígitos) + digits (se for CPF pontuado)
  //   - legacyId: studentId + digits (gateway pode mandar com/sem pontuação)
  const or = [{ id: studentId }];
  if (typeof studentId === 'string') {
    or.push({ cpf: studentId });
    if (digits && digits !== studentId) or.push({ cpf: digits });
    or.push({ legacyId: studentId });
    if (digits && digits !== studentId) or.push({ legacyId: digits });
  }

  const student = await safeQuery(
    () => prisma.student.findFirst({
      where: { OR: or },
      include: {
        memberships: {
          where: {
            status: 'ATIVA',
            startDate: { lte: now },
            endDate: { gte: now },
          },
          orderBy: { endDate: 'desc' },
          take: 1,
        },
      },
    }),
    'checkins.evaluateCheckin'
  );

  if (!student) {
    return {
      authorized: false,
      reason: 'Aluno não encontrado no banco da Nuvem.',
      membership: null,
      student: null,
    };
  }
  if (!student.active) {
    return { authorized: false, reason: 'Aluno inativo', membership: null, student };
  }

  const membership = student.memberships[0] ?? null;
  if (!membership) {
    return { authorized: false, reason: 'Sem matrícula ativa', membership: null, student };
  }

  return { authorized: true, reason: null, membership, student };
}

router.post(
  '/checkins/device',
  deviceLimiter,
  requireDevice,
  validate(checkinCreateSchema),
  asyncHandler(async (req, res) => {
    const { studentId, type, reason } = req.validated;
    const { authorized, reason: denyReason, membership, student } = await evaluateCheckin(studentId);

    if (!student) {
      return res.status(404).json({ error: denyReason || 'Aluno não encontrado na nuvem.' });
    }

    const checkin = await safeQuery(
      () => prisma.checkin.create({
        data: {
          studentId: student.id,
          type,
          status: authorized ? 'AUTORIZADO' : 'NEGADO',
          reason: reason ?? denyReason ?? null,
          deviceId: req.device.id,
          membershipId: membership?.id ?? null,
        },
        include: {
          student: { select: { id: true, name: true } },
          device: { select: { id: true, name: true } },
        },
      }),
      'checkins.device.create'
    );

    res.status(200).json({
      authorized,
      reason: denyReason ?? null,
      checkin,
    });
  })
);
countRoute();

router.post(
  '/checkins',
  requireAuth, requireRole('ADMIN', 'RECEPCAO'),
  validate(checkinManualSchema),
  asyncHandler(async (req, res) => {
    const { studentId, type, status, reason } = req.validated;
    const { membership } = await evaluateCheckin(studentId).catch(() => ({ membership: null }));

    const checkin = await safeQuery(
      () => prisma.checkin.create({
        data: {
          studentId, type, status,
          reason: reason ?? null,
          membershipId: membership?.id ?? null,
          registeredBy: req.user.id,
        },
        include: {
          student: { select: { id: true, name: true } },
          registeredUser: { select: { id: true, name: true } },
        },
      }),
      'checkins.manual.create'
    );
    res.status(201).json(checkin);
  })
);
countRoute();

router.get(
  '/checkins',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = checkinQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Parâmetros inválidos',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const { studentId, deviceId, status, type, from, to, limit } = parsed.data;
    const where = {};
    if (studentId) where.studentId = studentId;
    if (deviceId) where.deviceId = deviceId;
    if (status) where.status = status;
    if (type) where.type = type;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }
    const take = Math.min(limit ?? 100, 500);

    const checkins = await safeQuery(
      () => prisma.checkin.findMany({
        where,
        include: {
          student: { select: { id: true, name: true } },
          device: { select: { id: true, name: true } },
          registeredUser: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      'checkins.list'
    );
    res.json(checkins);
  })
);
countRoute();

router.get(
  '/checkins/:studentId/last',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const last = await safeQuery(
      () => prisma.checkin.findFirst({
        where: { studentId },
        orderBy: { createdAt: 'desc' },
      }),
      'checkins.lastByStudent'
    );
    res.json(last || null);
  })
);
countRoute();

// ============================================
// WORKOUTS
// ============================================

router.get(
  '/students/:studentId/workouts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const { status } = req.query;

    const student = await safeQuery(
      () => prisma.student.findUnique({ where: { id: studentId } }),
      'workouts.findStudent'
    );
    if (!student) throw new HttpError(404, 'Aluno não encontrado');

    const where = { studentId };
    if (status) where.status = status;

    const workouts = await safeQuery(
      () => prisma.workoutPlan.findMany({
        where,
        include: {
          exercises: { include: { exercise: true }, orderBy: { order: 'asc' } },
          creator: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      'workouts.listByStudent'
    );
    res.json(workouts);
  })
);
countRoute();

router.post(
  '/students/:studentId/workouts',
  requireAuth, requireRole('ADMIN', 'PROFESSOR'),
  validate(workoutCreateSchema),
  asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const { name, description, startDate, endDate, exercises } = req.validated;

    const student = await safeQuery(
      () => prisma.student.findUnique({ where: { id: studentId } }),
      'workouts.create.findStudent'
    );
    if (!student) throw new HttpError(404, 'Aluno não encontrado');
    if (!student.active) throw new HttpError(400, 'Aluno inativo');

    if (exercises && exercises.length > 0) {
      const ids = [...new Set(exercises.map((e) => e.exerciseId))];
      const found = await safeQuery(
        () => prisma.exercise.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        }),
        'workouts.create.findExercises'
      );
      const foundSet = new Set(found.map((f) => f.id));
      const missing = ids.filter((id) => !foundSet.has(id));
      if (missing.length) throw new HttpError(400, `Exercícios inexistentes: ${missing.join(', ')}`);
    }

    const workout = await safeQuery(
      () => prisma.workoutPlan.create({
        data: {
          studentId, createdBy: req.user.id, name,
          description: description ?? null,
          startDate,
          endDate: endDate ?? null,
          exercises:
            exercises && exercises.length > 0
              ? {
                  create: exercises.map((ex, index) => ({
                    exerciseId: ex.exerciseId,
                    order: ex.order ?? index,
                    sets: ex.sets ?? null,
                    repetitions: ex.repetitions ?? null,
                    weight: ex.weight ?? null,
                    restSeconds: ex.restSeconds ?? null,
                    notes: ex.notes ?? null,
                  })),
                }
              : undefined,
        },
        include: {
          exercises: { include: { exercise: true }, orderBy: { order: 'asc' } },
          creator: { select: { id: true, name: true } },
        },
      }),
      'workouts.create'
    );
    res.status(201).json(workout);
  })
);
countRoute();

router.get(
  '/workouts/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const workout = await safeQuery(
      () => prisma.workoutPlan.findUnique({
        where: { id: req.params.id },
        include: {
          exercises: { include: { exercise: true }, orderBy: { order: 'asc' } },
          student: { select: { id: true, name: true, email: true } },
          creator: { select: { id: true, name: true, email: true } },
        },
      }),
      'workouts.getById'
    );
    if (!workout) throw new HttpError(404, 'Treino não encontrado');
    res.json(workout);
  })
);
countRoute();

router.patch(
  '/workouts/:id',
  requireAuth, requireRole('ADMIN', 'PROFESSOR'),
  validate(workoutUpdateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await safeQuery(
      () => prisma.workoutPlan.findUnique({ where: { id } }),
      'workouts.update.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Treino não encontrado');
    const workout = await safeQuery(
      () => prisma.workoutPlan.update({
        where: { id }, data: req.validated,
        include: { exercises: { include: { exercise: true }, orderBy: { order: 'asc' } } },
      }),
      'workouts.update'
    );
    res.json(workout);
  })
);
countRoute();

router.delete(
  '/workouts/:id',
  requireAuth, requireRole('ADMIN', 'PROFESSOR'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await safeQuery(
      () => prisma.workoutPlan.findUnique({ where: { id } }),
      'workouts.delete.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Treino não encontrado');
    await safeQuery(
      () => prisma.workoutPlan.update({ where: { id }, data: { status: 'ARQUIVADO' } }),
      'workouts.delete'
    );
    res.status(204).send();
  })
);
countRoute();

router.post(
  '/workouts/:id/exercises',
  requireAuth, requireRole('ADMIN', 'PROFESSOR'),
  validate(workoutExerciseCreateSchema),
  asyncHandler(async (req, res) => {
    const { id: workoutId } = req.params;
    const { exerciseId, order, sets, repetitions, weight, restSeconds, notes } = req.validated;

    const [workout, exercise] = await Promise.all([
      safeQuery(
        () => prisma.workoutPlan.findUnique({ where: { id: workoutId } }),
        'workouts.exercise.create.findWorkout'
      ),
      safeQuery(
        () => prisma.exercise.findUnique({ where: { id: exerciseId } }),
        'workouts.exercise.create.findExercise'
      ),
    ]);
    if (!workout) throw new HttpError(404, 'Treino não encontrado');
    if (!exercise) throw new HttpError(404, 'Exercício não encontrado');

    let finalOrder = order;
    if (finalOrder === undefined || finalOrder === null) {
      const last = await safeQuery(
        () => prisma.workoutExercise.findFirst({
          where: { workoutId },
          orderBy: { order: 'desc' },
        }),
        'workouts.exercise.create.findLastOrder'
      );
      finalOrder = last ? last.order + 1 : 0;
    }

    const created = await safeQuery(
      () => prisma.workoutExercise.create({
        data: {
          workoutId, exerciseId, order: finalOrder,
          sets: sets ?? null, repetitions: repetitions ?? null,
          weight: weight ?? null, restSeconds: restSeconds ?? null,
          notes: notes ?? null,
        },
        include: { exercise: true },
      }),
      'workouts.exercise.create'
    );
    res.status(201).json(created);
  })
);
countRoute();

router.patch(
  '/workouts/:id/exercises/:exerciseId',
  requireAuth, requireRole('ADMIN', 'PROFESSOR'),
  validate(workoutExerciseUpdateSchema),
  asyncHandler(async (req, res) => {
    const { id: workoutId, exerciseId } = req.params;
    const existing = await safeQuery(
      () => prisma.workoutExercise.findFirst({
        where: { id: exerciseId, workoutId },
      }),
      'workouts.exercise.update.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Exercício do treino não encontrado');
    const updated = await safeQuery(
      () => prisma.workoutExercise.update({
        where: { id: exerciseId }, data: req.validated,
        include: { exercise: true },
      }),
      'workouts.exercise.update'
    );
    res.json(updated);
  })
);
countRoute();

router.delete(
  '/workouts/:id/exercises/:exerciseId',
  requireAuth, requireRole('ADMIN', 'PROFESSOR'),
  asyncHandler(async (req, res) => {
    const { id: workoutId, exerciseId } = req.params;
    const existing = await safeQuery(
      () => prisma.workoutExercise.findFirst({
        where: { id: exerciseId, workoutId },
      }),
      'workouts.exercise.delete.checkExists'
    );
    if (!existing) throw new HttpError(404, 'Exercício do treino não encontrado');
    await safeQuery(
      () => prisma.workoutExercise.delete({ where: { id: exerciseId } }),
      'workouts.exercise.delete'
    );
    res.status(204).send();
  })
);
countRoute();

// ============================================
// EVOLUTION
// ============================================

router.get(
  '/students/:studentId/evolution',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const { exerciseId } = req.query;

    const student = await safeQuery(
      () => prisma.student.findUnique({ where: { id: studentId } }),
      'evolution.findStudent'
    );
    if (!student) throw new HttpError(404, 'Aluno não encontrado');

    const where = { workout: { studentId } };
    if (exerciseId) where.exerciseId = exerciseId;

    const records = await safeQuery(
      () => prisma.workoutExercise.findMany({
        where,
        include: {
          exercise: true,
          workout: { select: { id: true, name: true, startDate: true, status: true } },
        },
        orderBy: { workout: { startDate: 'asc' } },
      }),
      'evolution.listRecords'
    );

    const evolution = records.reduce((acc, record) => {
      const key = record.exerciseId;
      if (!acc[key]) {
        acc[key] = {
          exerciseId: record.exerciseId,
          exerciseName: record.exercise.name,
          muscleGroup: record.exercise.muscleGroup,
          history: [],
        };
      }
      acc[key].history.push({
        workoutId: record.workout.id,
        workoutName: record.workout.name,
        date: record.workout.startDate,
        status: record.workout.status,
        sets: record.sets,
        repetitions: record.repetitions,
        weight: record.weight,
        restSeconds: record.restSeconds,
        notes: record.notes,
      });
      return acc;
    }, {});

    res.json(Object.values(evolution));
  })
);
countRoute();

// ============================================
// INVITES
// ============================================

async function createInvite({ studentId, email, phone, name, type, role, expiresInDays, createdById }) {
  const id = generateInviteId();
  const nonce = generateInviteNonce();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  const exp = Math.floor(expiresAt.getTime() / 1000);

  const hmac = signInvite({ id, exp, nonce });
  const token = `${id}.${hmac}`;

  const invite = await safeQuery(
    () => prisma.invite.create({
      data: {
        id, token, hmac, nonce,
        createdById,
        studentId: studentId ?? null,
        email: email ?? null,
        phone: phone ?? null,
        name: name ?? null,
        type,
        role: role ?? null,
        expiresAt,
      },
      include: {
        student: { select: { id: true, name: true, email: true, phone: true, legacyId: true } },
      },
    }),
    'invites.create'
  );

  return { invite, token, url: buildInviteUrl(token), expiresAt };
}

router.post(
  '/invites',
  requireAuth, requireRole('ADMIN'),
  validate(inviteCreateSchema),
  asyncHandler(async (req, res) => {
    const { studentId, email, phone, name, type, role, expiresInDays } = req.validated;

    if (studentId) {
      const student = await safeQuery(
        () => prisma.student.findUnique({ where: { id: studentId } }),
        'invites.create.findStudent'
      );
      if (!student) throw new HttpError(404, 'Aluno não encontrado');
      if (student.userId) throw new HttpError(409, 'Aluno já possui conta ativa');
    }
    if (type === 'STAFF' && !role) {
      throw new HttpError(400, 'role é obrigatório para convites de STAFF');
    }

    const { invite, token, url } = await createInvite({
      studentId, email, phone, name, type, role, expiresInDays,
      createdById: req.user.id,
    });

    res.status(201).json({ invite, token, url });
  })
);
countRoute();

router.post(
  '/invites/bulk',
  requireAuth, requireRole('ADMIN'),
  validate(inviteBulkSchema),
  asyncHandler(async (req, res) => {
    const { invites, expiresInDays } = req.validated;

    const drafts = invites.map((item) => {
      if (item.type === 'STAFF' && !item.role) {
        throw new HttpError(400, 'role é obrigatório para convites de STAFF');
      }
      const id = generateInviteId();
      const nonce = generateInviteNonce();
      const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
      const exp = Math.floor(expiresAt.getTime() / 1000);
      const hmac = signInvite({ id, exp, nonce });
      return {
        id,
        token: `${id}.${hmac}`,
        hmac,
        nonce,
        createdById: req.user.id,
        studentId: item.studentId ?? null,
        email: item.email ?? null,
        phone: item.phone ?? null,
        name: item.name ?? null,
        type: item.type,
        role: item.role ?? null,
        expiresAt,
      };
    });

    // v3.2: sem skipDuplicates (tokens são gerados com crypto — colisão ~0)
    await safeQuery(
      () => prisma.invite.createMany({ data: drafts }),
      'invites.bulk.createMany'
    );

    res.status(201).json({
      created: drafts.length,
      invites: drafts.map((d) => ({
        token: d.token,
        url: buildInviteUrl(d.token),
      })),
    });
  })
);
countRoute();

router.get(
  '/invites/pending',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { status, limit } = req.query;
    const where = {
      status: status || 'PENDING',
      expiresAt: { gt: new Date() },
    };

    const invites = await safeQuery(
      () => prisma.invite.findMany({
        where,
        take: Math.min(Number(limit) || 100, 500),
        orderBy: { createdAt: 'asc' },
        include: {
          student: { select: { id: true, name: true, email: true, phone: true, legacyId: true } },
        },
      }),
      'invites.listPending'
    );
    res.json({
      total: invites.length,
      invites: invites.map((i) => ({
        id: i.id,
        token: i.token,
        url: buildInviteUrl(i.token),
        name: i.name || i.student?.name || null,
        email: i.email || i.student?.email || null,
        phone: i.phone || i.student?.phone || null,
        expiresAt: i.expiresAt,
        status: i.status,
      })),
    });
  })
);
countRoute();

router.get(
  '/invites/:token',
  asyncHandler(async (req, res) => {
    const { token } = req.params;
    if (!token || typeof token !== 'string') throw new HttpError(400, 'Token inválido');

    const invite = await safeQuery(
      () => prisma.invite.findUnique({
        where: { token },
        include: {
          student: { select: { id: true, name: true, email: true, phone: true, legacyId: true } },
        },
      }),
      'invites.getByToken'
    );

    if (!invite) throw new HttpError(404, 'Convite inválido');

    const exp = Math.floor(invite.expiresAt.getTime() / 1000);
    const hmacOk = verifyInviteHmac({
      id: invite.id,
      exp,
      nonce: invite.nonce,
      hmac: invite.hmac,
    });
    if (!hmacOk) {
      log.warn('invite HMAC inválido', { reqId: req.id, inviteId: invite.id });
      throw new HttpError(401, 'Convite inválido');
    }

    if (invite.status === 'REVOKED') throw new HttpError(400, 'Convite cancelado');
    if (invite.status === 'ACCEPTED') throw new HttpError(409, 'Convite já utilizado');
    if (invite.expiresAt < new Date()) {
      await safeQuery(
        () => prisma.invite.update({
          where: { id: invite.id },
          data: { status: 'EXPIRED' },
        }),
        'invites.markExpired'
      ).catch(() => {});
      throw new HttpError(400, 'Convite expirado');
    }

    res.json({
      valid: true,
      invite: {
        id: invite.id,
        type: invite.type,
        expiresAt: invite.expiresAt,
        name: invite.student?.name || invite.name || null,
        email: invite.student?.email || invite.email || null,
        phone: invite.student?.phone || invite.phone || null,
        legacyId: invite.student?.legacyId || null,
        needsEmail: !(invite.student?.email || invite.email),
      },
    });
  })
);
countRoute();

router.post(
  '/invites/:token/accept',
  loginLimiter,
  validate(inviteAcceptSchema),
  asyncHandler(async (req, res) => {
    const { token } = req.params;
    const { password, email: emailInput } = req.validated;

    const invite = await safeQuery(
      () => prisma.invite.findUnique({
        where: { token },
        include: { student: true },
      }),
      'invites.accept.findInvite'
    );

    if (!invite) throw new HttpError(404, 'Convite inválido');

    const exp = Math.floor(invite.expiresAt.getTime() / 1000);
    const hmacOk = verifyInviteHmac({
      id: invite.id,
      exp,
      nonce: invite.nonce,
      hmac: invite.hmac,
    });
    if (!hmacOk) throw new HttpError(401, 'Convite inválido');

    if (invite.status === 'REVOKED') throw new HttpError(400, 'Convite cancelado');
    if (invite.status === 'ACCEPTED') throw new HttpError(409, 'Convite já utilizado');
    if (invite.expiresAt < new Date()) throw new HttpError(400, 'Convite expirado');

    const email = invite.student?.email || invite.email || emailInput;
    if (!email) throw new HttpError(400, 'Email é obrigatório para criar a conta');

    const exists = await safeQuery(
      () => prisma.user.findUnique({ where: { email } }),
      'invites.accept.checkEmail'
    );
    if (exists) throw new HttpError(409, 'Email já cadastrado');

    const hash = await hashPassword(password);

    const user = await safeTx(async (tx) => {
      const u = await tx.user.create({
        data: {
          name: invite.student?.name || invite.name || 'Aluno',
          email, password: hash,
          role: invite.type === 'STAFF' && invite.role ? invite.role : 'ALUNO',
          student: invite.studentId ? { connect: { id: invite.studentId } } : undefined,
        },
        select: userSelect,
      });

      await tx.invite.update({
        where: { id: invite.id },
        data: {
          status: 'ACCEPTED',
          acceptedAt: new Date(),
          acceptedById: u.id,
        },
      });

      return u;
    }, 'invites.accept.tx', { timeout: 10000 });

    const jwt = signToken(user);
    res.status(201).json({ token: jwt, user });
  })
);
countRoute();

router.post(
  '/invites/:id/mark-sent',
  requireAuth, requireRole('ADMIN'),
  validate(inviteMarkSentSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { via } = req.validated;

    const invite = await safeQuery(
      () => prisma.invite.findUnique({ where: { id } }),
      'invites.markSent.findInvite'
    );
    if (!invite) throw new HttpError(404, 'Convite não encontrado');
    if (invite.status === 'ACCEPTED') throw new HttpError(409, 'Convite já aceito');

    const updated = await safeQuery(
      () => prisma.invite.update({
        where: { id },
        data: {
          status: invite.status === 'PENDING' ? 'SENT' : invite.status,
          sentAt: invite.sentAt ?? new Date(),
          sentVia: via,
        },
      }),
      'invites.markSent'
    );
    res.json(updated);
  })
);
countRoute();

router.post(
  '/invites/:id/revoke',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const invite = await safeQuery(
      () => prisma.invite.findUnique({ where: { id } }),
      'invites.revoke.findInvite'
    );
    if (!invite) throw new HttpError(404, 'Convite não encontrado');
    if (invite.status === 'ACCEPTED') throw new HttpError(409, 'Convite já aceito');

    const updated = await safeQuery(
      () => prisma.invite.update({
        where: { id }, data: { status: 'REVOKED' },
      }),
      'invites.revoke'
    );
    res.json(updated);
  })
);
countRoute();

// ============================================
// STUDENT IMPORT
// ============================================
// v3.2: aceita cpf (normalizado) no import
// ============================================

router.post(
  '/students/import',
  requireAuth, requireRole('ADMIN'),
  validate(studentImportSchema),
  asyncHandler(async (req, res) => {
    const { students } = req.validated;
    const out = { created: 0, skipped: 0, errors: [] };

    await safeTx(async (tx) => {
      const legacyIds = students.map((s) => s.legacyId);
      const existing = await tx.student.findMany({
        where: { legacyId: { in: legacyIds } },
        select: { legacyId: true },
      });
      const skipSet = new Set(existing.map((e) => e.legacyId));

      const toCreate = students.filter((s) => !skipSet.has(s.legacyId));
      out.skipped = students.length - toCreate.length;

      if (toCreate.length > 0) {
        await tx.student.createMany({
          data: toCreate.map((s) => ({
            legacyId: s.legacyId,
            name: s.name,
            email: s.email ?? null,
            phone: s.phone ?? null,
            cpf: normalizeCpf(s.cpf),
            birthDate: s.birthDate ?? null,
          })),
          skipDuplicates: true,
        });
        out.created = toCreate.length;
      }
    }, 'students.import.tx', { timeout: 10000 });

    res.status(201).json(out);
  })
);
countRoute();

// ============================================
// CRON / PING
// ============================================
router.get('/_ping', asyncHandler(async (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
}));
countRoute();

router.post('/cron/ping', asyncHandler(async (req, res) => {
  if (!CRON_SECRET) {
    return res.status(503).json({ error: 'Cron desabilitado (CRON_SECRET ausente)' });
  }
  const secret = req.headers['x-cron-secret'];
  if (secret !== CRON_SECRET) {
    log.warn('cron: secret inválido', { reqId: req.id, ip: req.ip });
    return res.status(401).json({ error: 'Não autorizado' });
  }

  log.info('cron: ping recebido', { reqId: req.id });

  setImmediate(() => {
    import('./prisma.js').then(({ warmupDb }) => {
      warmupDb(3000).catch(() => {});
    }).catch(() => {});
  });

  res.status(202).json({
    accepted: true,
    ts: new Date().toISOString(),
  });
}));
countRoute();

// ============================================
// EXPORT
// ============================================
log.info(`${routeCount} rotas registradas`);
log.info('carregado com sucesso');

export default router;