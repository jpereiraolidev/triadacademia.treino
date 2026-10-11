// ============================================
// routers.js — Todas as rotas /api/v1
// Triad Academia · v2.3
//
// Este arquivo:
//   1. Importa express, config.js e auth.js
//   2. Registra TODAS as rotas em /api/v1
//   3. Exporta o router
//
// Mudanças v2.3 (sobre 2.2):
//   - Importa safeQuery de ./prisma.js
//   - Rotas GET de leitura usam safeQuery (retry contra pooler zumbi)
//   - Rota POST /auth/login usa safeQuery na findUnique do user
//   - Transações e rotas de escrita NÃO usam safeQuery (por design)
//
// Se algo falhar aqui, procure por "[routers.js]" no log.
// ============================================

const TAG = '[routers.js]';
console.log(`${TAG} ▶ carregando...`);

// ============================================
// 1. IMPORTS
// ============================================
let express;
try {
  express = (await import('express')).default;
  console.log(`${TAG} ✔ express carregado`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar 'express'. Verifique: npm install express`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

let config;
try {
  config = await import('./config.js');
  const required = [
    'prisma', 'asyncHandler', 'validate', 'HttpError',
    'hashPassword', 'verifyPassword', 'signToken', 'generateDeviceKey', 'hashDeviceKey',
    'userSelect',
    'loginSchema', 'userCreateSchema', 'userUpdateSchema', 'userPasswordSchema',
    'exerciseCreateSchema', 'exerciseUpdateSchema',
    'studentCreateSchema', 'studentUpdateSchema',
    'planCreateSchema', 'planUpdateSchema',
    'membershipCreateSchema', 'membershipUpdateSchema',
    'deviceCreateSchema', 'deviceUpdateSchema',
    'checkinCreateSchema', 'checkinManualSchema', 'checkinQuerySchema',
    'workoutCreateSchema', 'workoutUpdateSchema',
    'workoutExerciseCreateSchema', 'workoutExerciseUpdateSchema',
    // novos (v2.2)
    'inviteCreateSchema', 'inviteBulkSchema', 'inviteAcceptSchema',
    'inviteMarkSentSchema', 'studentImportSchema',
    'generateInviteId', 'generateInviteNonce', 'signInvite', 'buildInviteUrl',
  ];
  const missing = required.filter((k) => config[k] === undefined);
  if (missing.length) {
    console.error(`${TAG} 💥 config.js não exportou: ${missing.join(', ')}`);
    console.error(`${TAG}    Verifique se config.js está completo e salvo.`);
    process.exit(1);
  }
  console.log(`${TAG} ✔ config.js carregado (todos os ${required.length} exports presentes)`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar './config.js'`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

// ← NOVO (v2.3): importa safeQuery direto de ./prisma.js
let safeQuery;
try {
  const prismaMod = await import('./prisma.js');
  safeQuery = prismaMod.safeQuery;
  if (typeof safeQuery !== 'function') {
    console.error(`${TAG} 💥 ./prisma.js não exportou 'safeQuery'.`);
    process.exit(1);
  }
  console.log(`${TAG} ✔ safeQuery importado de ./prisma.js`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar './prisma.js'`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

let auth;
try {
  auth = await import('./auth.js');
  const required = ['requireAuth', 'requireRole', 'requireAluno', 'requireDevice', 'loginLimiter', 'deviceLimiter'];
  const missing = required.filter((k) => auth[k] === undefined);
  if (missing.length) {
    console.error(`${TAG} 💥 auth.js não exportou: ${missing.join(', ')}`);
    console.error(`${TAG}    Verifique se auth.js está completo e salvo.`);
    process.exit(1);
  }
  console.log(`${TAG} ✔ auth.js carregado (requireAuth, requireRole, requireAluno, requireDevice, loginLimiter, deviceLimiter)`);
} catch (err) {
  console.error(`${TAG} 💥 Falha ao importar './auth.js'`);
  console.error(`${TAG}    Detalhe: ${err.message}`);
  process.exit(1);
}

const {
  prisma, asyncHandler, validate, HttpError,
  hashPassword, verifyPassword, signToken, generateDeviceKey, hashDeviceKey,
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
  // novos (v2.2)
  inviteCreateSchema, inviteBulkSchema, inviteAcceptSchema,
  inviteMarkSentSchema, studentImportSchema,
  generateInviteId, generateInviteNonce, signInvite, buildInviteUrl,
} = config;

const {
  requireAuth, requireRole, requireAluno, requireDevice,
  loginLimiter, deviceLimiter,
} = auth;

const router = express.Router();
let routeCount = 0;
function countRoute() { routeCount++; }

// ============================================
// 2. ROTAS — AUTH
// ============================================

router.post(
  '/auth/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.validated;

    // ← NOVO (v2.3): safeQuery na findUnique (primeira query da request)
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
  asyncHandler(async (req, res) => {
    res.json(req.user);
  })
);
countRoute();

// ============================================
// 3. ROTAS — USERS (ADMIN)
// ============================================

router.get(
  '/users',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    // ← NOVO (v2.3): safeQuery
    const users = await safeQuery(
      () => prisma.user.findMany({
        select: userSelect,
        orderBy: { name: 'asc' },
      }),
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
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw new HttpError(409, 'Email já cadastrado');
    const hash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { name, email, password: hash, role: role ?? 'PROFESSOR' },
      select: userSelect,
    });
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
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Usuário não encontrado');
    const user = await prisma.user.update({
      where: { id },
      data: req.validated,
      select: userSelect,
    });
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
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Usuário não encontrado');
    const hash = await hashPassword(req.validated.password);
    await prisma.user.update({ where: { id }, data: { password: hash } });
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
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Usuário não encontrado');
    await prisma.user.update({ where: { id }, data: { active: false } });
    res.status(204).send();
  })
);
countRoute();

// ============================================
// 4. ROTAS — EXERCISES
// ============================================

router.get(
  '/exercises',
  asyncHandler(async (req, res) => {
    const { search, muscleGroup, active } = req.query;
    const where = {};
    if (search) where.name = { contains: search, mode: 'insensitive' };
    if (muscleGroup) where.muscleGroup = muscleGroup;
    if (active !== undefined) where.active = active === 'true';
    // ← NOVO (v2.3): safeQuery
    const exercises = await safeQuery(
      () => prisma.exercise.findMany({
        where,
        orderBy: { name: 'asc' },
      }),
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
    const exercise = await prisma.exercise.create({
      data: {
        name,
        description: description ?? null,
        muscleGroup: muscleGroup ?? null,
        videoUrl: videoUrl || null,
        ...(active !== undefined && { active }),
      },
    });
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
    const existing = await prisma.exercise.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Exercício não encontrado');
    const data = { ...req.validated };
    if (data.videoUrl === '') data.videoUrl = null;
    const exercise = await prisma.exercise.update({ where: { id }, data });
    res.json(exercise);
  })
);
countRoute();

router.delete(
  '/exercises/:id',
  requireAuth, requireRole('ADMIN', 'PROFESSOR'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.exercise.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Exercício não encontrado');
    await prisma.exercise.update({ where: { id }, data: { active: false } });
    res.status(204).send();
  })
);
countRoute();

// ============================================
// 5. ROTAS — STUDENTS
// ============================================

router.get(
  '/students',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { search, active } = req.query;
    const where = {};
    if (search) where.name = { contains: search, mode: 'insensitive' };
    if (active !== undefined) where.active = active === 'true';
    // ← NOVO (v2.3): safeQuery
    const students = await safeQuery(
      () => prisma.student.findMany({
        where,
        orderBy: { name: 'asc' },
      }),
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
    // ← NOVO (v2.3): safeQuery
    const student = await safeQuery(
      () => prisma.student.findUnique({
        where: { id: req.params.id },
        include: {
          memberships: {
            include: { plan: true },
            orderBy: { startDate: 'desc' },
          },
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
    const { name, email, phone, birthDate, active } = req.validated;
    const student = await prisma.student.create({
      data: {
        name,
        email: email ?? null,
        phone: phone ?? null,
        birthDate: birthDate ?? null,
        ...(active !== undefined && { active }),
      },
    });
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
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Aluno não encontrado');
    const student = await prisma.student.update({
      where: { id },
      data: req.validated,
    });
    res.json(student);
  })
);
countRoute();

router.delete(
  '/students/:id',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Aluno não encontrado');
    await prisma.student.update({ where: { id }, data: { active: false } });
    res.status(204).send();
  })
);
countRoute();

// ============================================
// 6. ROTAS — PLANS
// ============================================

router.get(
  '/plans',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { active } = req.query;
    const where = {};
    if (active !== undefined) where.active = active === 'true';
    // ← NOVO (v2.3): safeQuery
    const plans = await safeQuery(
      () => prisma.plan.findMany({
        where,
        orderBy: { name: 'asc' },
      }),
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
    // ← NOVO (v2.3): safeQuery
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
    const plan = await prisma.plan.create({ data: req.validated });
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
    const existing = await prisma.plan.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Plano não encontrado');
    const plan = await prisma.plan.update({ where: { id }, data: req.validated });
    res.json(plan);
  })
);
countRoute();

router.delete(
  '/plans/:id',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.plan.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Plano não encontrado');
    await prisma.plan.update({ where: { id }, data: { active: false } });
    res.status(204).send();
  })
);
countRoute();

// ============================================
// 7. ROTAS — MEMBERSHIPS
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
    // ← NOVO (v2.3): safeQuery
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
    // ← NOVO (v2.3): safeQuery
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
      prisma.student.findUnique({ where: { id: studentId } }),
      prisma.plan.findUnique({ where: { id: planId } }),
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
    if (finalEnd <= startDate) {
      throw new HttpError(400, 'endDate deve ser depois de startDate');
    }

    const membership = await prisma.membership.create({
      data: {
        studentId,
        planId,
        startDate,
        endDate: finalEnd,
        priceAtPurchase: priceAtPurchase ?? plan.price,
        status: status ?? 'ATIVA',
      },
      include: { student: true, plan: true },
    });
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
    const existing = await prisma.membership.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Matrícula não encontrada');
    const membership = await prisma.membership.update({
      where: { id },
      data: req.validated,
      include: { student: true, plan: true },
    });
    res.json(membership);
  })
);
countRoute();

router.delete(
  '/memberships/:id',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.membership.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Matrícula não encontrada');
    await prisma.membership.update({ where: { id }, data: { status: 'CANCELADA' } });
    res.status(204).send();
  })
);
countRoute();

// ============================================
// 8. ROTAS — DEVICES
// ============================================

router.get(
  '/devices',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    // ← NOVO (v2.3): safeQuery
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
    const exists = await prisma.device.findUnique({ where: { identifier } });
    if (exists) throw new HttpError(409, 'Identificador já cadastrado');
    const rawKey = generateDeviceKey();
    const apiKeyHash = hashDeviceKey(rawKey);
    const device = await prisma.device.create({
      data: { name, identifier, apiKeyHash, ...(active !== undefined && { active }) },
      select: { id: true, name: true, identifier: true, active: true, createdAt: true },
    });
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
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Device não encontrado');
    const device = await prisma.device.update({
      where: { id },
      data: req.validated,
      select: {
        id: true, name: true, identifier: true, active: true,
        createdAt: true, updatedAt: true,
      },
    });
    res.json(device);
  })
);
countRoute();

router.post(
  '/devices/:id/rotate-key',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Device não encontrado');
    const rawKey = generateDeviceKey();
    const apiKeyHash = hashDeviceKey(rawKey);
    await prisma.device.update({ where: { id }, data: { apiKeyHash } });
    res.json({
      id,
      apiKey: rawKey,
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
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Device não encontrado');
    await prisma.device.update({ where: { id }, data: { active: false } });
    res.status(204).send();
  })
);
countRoute();

// ============================================
// 9. ROTAS — CHECKINS
// ============================================

async function evaluateCheckin(studentId) {
  try {
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw new HttpError(404, 'Aluno não encontrado');
    if (!student.active) return { authorized: false, reason: 'Aluno inativo', membership: null };

    const now = new Date();
    const membership = await prisma.membership.findFirst({
      where: {
        studentId,
        status: 'ATIVA',
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: { endDate: 'desc' },
    });
    if (!membership) return { authorized: false, reason: 'Sem matrícula ativa', membership: null };
    return { authorized: true, reason: null, membership };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error(`${TAG} 💥 evaluateCheckin falhou para studentId=${studentId}`);
    console.error(`${TAG}    ${err.message}`);
    throw new HttpError(500, 'Erro ao avaliar check-in');
  }
}

router.post(
  '/checkins/device',
  deviceLimiter,
  requireDevice,
  validate(checkinCreateSchema),
  asyncHandler(async (req, res) => {
    const { studentId, type, reason } = req.validated;
    const { authorized, reason: denyReason, membership } = await evaluateCheckin(studentId);
    const checkin = await prisma.checkin.create({
      data: {
        studentId,
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
    });
    res.status(authorized ? 201 : 403).json(checkin);
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
    const checkin = await prisma.checkin.create({
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
    });
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
    // ← NOVO (v2.3): safeQuery
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
    // ← NOVO (v2.3): safeQuery
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
// 10. ROTAS — WORKOUTS
// ============================================

router.get(
  '/students/:studentId/workouts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const { status } = req.query;
    // ← NOVO (v2.3): safeQuery
    const student = await safeQuery(
      () => prisma.student.findUnique({ where: { id: studentId } }),
      'workouts.findStudent'
    );
    if (!student) throw new HttpError(404, 'Aluno não encontrado');
    const where = { studentId };
    if (status) where.status = status;
    // ← NOVO (v2.3): safeQuery
    const workouts = await safeQuery(
      () => prisma.workoutPlan.findMany({
        where,
        include: {
          exercises: {
            include: { exercise: true },
            orderBy: { order: 'asc' },
          },
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

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw new HttpError(404, 'Aluno não encontrado');
    if (!student.active) throw new HttpError(400, 'Aluno inativo');

    if (exercises && exercises.length > 0) {
      const ids = [...new Set(exercises.map((e) => e.exerciseId))];
      const found = await prisma.exercise.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const foundSet = new Set(found.map((f) => f.id));
      const missing = ids.filter((id) => !foundSet.has(id));
      if (missing.length) throw new HttpError(400, `Exercícios inexistentes: ${missing.join(', ')}`);
    }

    const workout = await prisma.workoutPlan.create({
      data: {
        studentId,
        createdBy: req.user.id,
        name,
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
    });
    res.status(201).json(workout);
  })
);
countRoute();

router.get(
  '/workouts/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    // ← NOVO (v2.3): safeQuery
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
    const existing = await prisma.workoutPlan.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Treino não encontrado');
    const workout = await prisma.workoutPlan.update({
      where: { id },
      data: req.validated,
      include: {
        exercises: { include: { exercise: true }, orderBy: { order: 'asc' } },
      },
    });
    res.json(workout);
  })
);
countRoute();

router.delete(
  '/workouts/:id',
  requireAuth, requireRole('ADMIN', 'PROFESSOR'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.workoutPlan.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Treino não encontrado');
    await prisma.workoutPlan.update({ where: { id }, data: { status: 'ARQUIVADO' } });
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
      prisma.workoutPlan.findUnique({ where: { id: workoutId } }),
      prisma.exercise.findUnique({ where: { id: exerciseId } }),
    ]);
    if (!workout) throw new HttpError(404, 'Treino não encontrado');
    if (!exercise) throw new HttpError(404, 'Exercício não encontrado');

    let finalOrder = order;
    if (finalOrder === undefined || finalOrder === null) {
      const last = await prisma.workoutExercise.findFirst({
        where: { workoutId },
        orderBy: { order: 'desc' },
      });
      finalOrder = last ? last.order + 1 : 0;
    }

    const created = await prisma.workoutExercise.create({
      data: {
        workoutId, exerciseId, order: finalOrder,
        sets: sets ?? null,
        repetitions: repetitions ?? null,
        weight: weight ?? null,
        restSeconds: restSeconds ?? null,
        notes: notes ?? null,
      },
      include: { exercise: true },
    });
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
    const existing = await prisma.workoutExercise.findFirst({
      where: { id: exerciseId, workoutId },
    });
    if (!existing) throw new HttpError(404, 'Exercício do treino não encontrado');
    const updated = await prisma.workoutExercise.update({
      where: { id: exerciseId },
      data: req.validated,
      include: { exercise: true },
    });
    res.json(updated);
  })
);
countRoute();

router.delete(
  '/workouts/:id/exercises/:exerciseId',
  requireAuth, requireRole('ADMIN', 'PROFESSOR'),
  asyncHandler(async (req, res) => {
    const { id: workoutId, exerciseId } = req.params;
    const existing = await prisma.workoutExercise.findFirst({
      where: { id: exerciseId, workoutId },
    });
    if (!existing) throw new HttpError(404, 'Exercício do treino não encontrado');
    await prisma.workoutExercise.delete({ where: { id: exerciseId } });
    res.status(204).send();
  })
);
countRoute();

// ============================================
// 11. ROTAS — EVOLUÇÃO
// ============================================

router.get(
  '/students/:studentId/evolution',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const { exerciseId } = req.query;

    // ← NOVO (v2.3): safeQuery
    const student = await safeQuery(
      () => prisma.student.findUnique({ where: { id: studentId } }),
      'evolution.findStudent'
    );
    if (!student) throw new HttpError(404, 'Aluno não encontrado');

    const where = { workout: { studentId } };
    if (exerciseId) where.exerciseId = exerciseId;

    // ← NOVO (v2.3): safeQuery
    const records = await safeQuery(
      () => prisma.workoutExercise.findMany({
        where,
        include: {
          exercise: true,
          workout: {
            select: { id: true, name: true, startDate: true, status: true },
          },
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
// 12. ROTAS — INVITES (v2.2)
// ============================================

/**
 * Helper interno: cria 1 Invite no banco.
 * Não faz validação de role — quem chama deve garantir.
 */
async function createInvite({ studentId, email, phone, name, type, role, expiresInDays, createdById }) {
  const id = generateInviteId();
  const nonce = generateInviteNonce();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  const exp = Math.floor(expiresAt.getTime() / 1000);

  const hmac = signInvite({ id, exp, nonce });
  const token = `${id}.${hmac}`;

  const invite = await prisma.invite.create({
    data: {
      id,
      token,
      hmac,
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
  });

  return { invite, token, url: buildInviteUrl(token), expiresAt };
}

router.post(
  '/invites',
  requireAuth, requireRole('ADMIN'),
  validate(inviteCreateSchema),
  asyncHandler(async (req, res) => {
    const { studentId, email, phone, name, type, role, expiresInDays } = req.validated;

    if (studentId) {
      const student = await prisma.student.findUnique({ where: { id: studentId } });
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

    const results = [];
    for (const item of invites) {
      if (item.type === 'STAFF' && !item.role) {
        throw new HttpError(400, 'role é obrigatório para convites de STAFF');
      }
      const r = await createInvite({
        studentId: item.studentId,
        email: item.email,
        phone: item.phone,
        name: item.name,
        type: item.type,
        role: item.role,
        expiresInDays,
        createdById: req.user.id,
      });
      results.push({ invite: r.invite, token: r.token, url: r.url });
    }

    res.status(201).json({ created: results.length, invites: results });
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
    // ← NOVO (v2.3): safeQuery
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

    // ← NOVO (v2.3): safeQuery
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
    if (invite.status === 'REVOKED') throw new HttpError(400, 'Convite cancelado');
    if (invite.status === 'ACCEPTED') throw new HttpError(409, 'Convite já utilizado');
    if (invite.expiresAt < new Date()) {
      await prisma.invite.update({
        where: { id: invite.id },
        data: { status: 'EXPIRED' },
      }).catch(() => {});
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

    const invite = await prisma.invite.findUnique({
      where: { token },
      include: { student: true },
    });

    if (!invite) throw new HttpError(404, 'Convite inválido');
    if (invite.status === 'REVOKED') throw new HttpError(400, 'Convite cancelado');
    if (invite.status === 'ACCEPTED') throw new HttpError(409, 'Convite já utilizado');
    if (invite.expiresAt < new Date()) throw new HttpError(400, 'Convite expirado');

    const email = invite.student?.email || invite.email || emailInput;
    if (!email) throw new HttpError(400, 'Email é obrigatório para criar a conta');

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw new HttpError(409, 'Email já cadastrado');

    const hash = await hashPassword(password);

    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          name: invite.student?.name || invite.name || 'Aluno',
          email,
          password: hash,
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
    });

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

    const invite = await prisma.invite.findUnique({ where: { id } });
    if (!invite) throw new HttpError(404, 'Convite não encontrado');
    if (invite.status === 'ACCEPTED') throw new HttpError(409, 'Convite já aceito');

    const updated = await prisma.invite.update({
      where: { id },
      data: {
        status: invite.status === 'PENDING' ? 'SENT' : invite.status,
        sentAt: invite.sentAt ?? new Date(),
        sentVia: via,
      },
    });
    res.json(updated);
  })
);
countRoute();

router.post(
  '/invites/:id/revoke',
  requireAuth, requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const invite = await prisma.invite.findUnique({ where: { id } });
    if (!invite) throw new HttpError(404, 'Convite não encontrado');
    if (invite.status === 'ACCEPTED') throw new HttpError(409, 'Convite já aceito');

    const updated = await prisma.invite.update({
      where: { id },
      data: { status: 'REVOKED' },
    });
    res.json(updated);
  })
);
countRoute();

// ============================================
// 13. ROTAS — STUDENT IMPORT (v2.2)
// ============================================

router.post(
  '/students/import',
  requireAuth, requireRole('ADMIN'),
  validate(studentImportSchema),
  asyncHandler(async (req, res) => {
    const { students } = req.validated;

    const out = { created: 0, skipped: 0, errors: [] };

    await prisma.$transaction(async (tx) => {
      for (const s of students) {
        try {
          const exists = await tx.student.findUnique({ where: { legacyId: s.legacyId } });
          if (exists) {
            out.skipped++;
            continue;
          }
          await tx.student.create({
            data: {
              legacyId: s.legacyId,
              name: s.name,
              email: s.email ?? null,
              phone: s.phone ?? null,
              birthDate: s.birthDate ?? null,
            },
          });
          out.created++;
        } catch (err) {
          out.errors.push({ legacyId: s.legacyId, error: err.message });
        }
      }
    }, { timeout: 30000 });

    res.status(201).json(out);
  })
);
countRoute();

// ============================================
// 14. EXPORT
// ============================================
console.log(`${TAG} ✔ ${routeCount} rotas registradas`);
console.log(`${TAG} ✅ carregado com sucesso`);

export default router;