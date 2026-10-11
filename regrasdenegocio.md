# Triad Academia — Regras de Negócio e Validações

> **Versão**: 1.0
> **Data**: 2026-10-11
> **Backend**: Node/Express + Prisma + Postgres (Vercel)
> **Base URL**: `https://triadacademiatreino.vercel.app/api/v1`
> **Formato**: JSON
> **Autenticação**: JWT Bearer (HS256) + X-Device-Key para devices

---

## 1. Visão Geral do Sistema

Sistema de gestão de academia com três camadas de acesso:

| Camada | Descrição | Autenticação |
|---|---|---|
| **Admin/Professor/Recepção** | Painel web (CRUD completo) | JWT Bearer |
| **Aluno** | Consulta de treinos, evolução, check-ins | JWT Bearer (role ALUNO, futuro) |
| **Device (catraca)** | Check-in via hardware físico | X-Device-Key header |

---

## 2. Roles e Permissões

### 2.1 Roles existentes

| Role | Pode |
|---|---|
| `ADMIN` | Tudo: usuários, planos, alunos, matrículas, exercícios, treinos, devices, check-ins |
| `PROFESSOR` | Exercícios, treinos, visualizar alunos/matrículas/planos/check-ins |
| `RECEPCAO` | Criar/editar alunos e matrículas, registrar check-in manual, visualizar tudo exceto usuários e devices |

### 2.2 Matriz de permissões (resumo)

| Recurso | ADMIN | PROFESSOR | RECEPCAO | ANON |
|---|---|---|---|---|
| **Usuários** (`/users`) | CRUD | ❌ | ❌ | ❌ |
| **Exercícios** (`/exercises`) | CRUD | CRUD | Leitura | Leitura |
| **Alunos** (`/students`) | CRUD | Leitura | Criar/Editar | ❌ |
| **Planos** (`/plans`) | CRUD | Leitura | Leitura | ❌ |
| **Matrículas** (`/memberships`) | CRUD | Leitura | Criar/Editar | ❌ |
| **Devices** (`/devices`) | CRUD | ❌ | ❌ | ❌ |
| **Check-ins** (`/checkins`) | CRUD | Leitura | Criar | ❌ |
| **Treinos** (`/workouts`) | CRUD | CRUD | Leitura | ❌ |
| **Evolução** (`/evolution`) | Leitura | Leitura | Leitura | ❌ |
| **`/auth/me`** | ✅ | ✅ | ✅ | ❌ |

### 2.3 Regras de autenticação

- **Token JWT** assinado com HS256, expira em **7 dias** (ou `JWT_EXPIRES_IN` do `.env`)
- **Header obrigatório**: `Authorization: Bearer <token>`
- **Token inválido/expirado** → `401 Unauthorized`
- **Role insuficiente** → `403 Forbidden`
- **Usuário inativo** (`active=false`) → tratado como não autenticado (`401`)

### 2.4 Regras de device (X-Device-Key)

- **Header obrigatório**: `X-Device-Key: <raw-key>`
- **Validação**: hash SHA-256 de `DEVICE_KEY_PEPPER + raw-key` deve bater com `Device.apiKeyHash`
- **Device inativo** → `401`
- **Device só pode fazer check-in** (`POST /checkins/device`)
- **A chave é exibida apenas na criação/rotação** — nunca mais

---

## 3. Entidades e Regras

### 3.1 User (Usuário do sistema)

| Campo | Tipo | Obrigatório | Regra |
|---|---|---|---|
| `id` | string (cuid) | ✅ | Gerado automaticamente |
| `name` | string | ✅ | 1–120 caracteres, trim |
| `email` | string | ✅ | Formato válido, único, lowercase, max 160 |
| `password` | string (hash) | ✅ | Argon2id, mínimo 8 chars no cadastro |
| `role` | enum | ✅ | `ADMIN` \| `PROFESSOR` \| `RECEPCAO` |
| `active` | boolean | ✅ | Default `true` |
| `createdAt` | datetime | ✅ | Auto |
| `updatedAt` | datetime | ✅ | Auto |

**Regras de negócio:**

- ❌ **Não é possível desativar a si mesmo** (`DELETE /users/:id` onde `id === req.user.id` → `400`)
- ✅ Email duplicado → `409 Conflict`
- ✅ Ao atualizar, apenas `name`, `role`, `active` são editáveis (não email/senha)
- ✅ Trocar senha é rota separada (`PATCH /users/:id/password`)
- ✅ Exclusão é **lógica** (`active=false`), nunca física

**Validações Zod (`userCreateSchema`):**
```json
{
  "name": "string (1-120, trim)",
  "email": "email válido",
  "password": "string (8-100)",
  "role": "ADMIN|PROFESSOR|RECEPCAO (opcional, default PROFESSOR)"
}

✅ FASE 0 — Backend saudável (Vercel + 99% no testerotas)
✅ FASE 1 — Gerador de convites standalone
✅ FASE 2 — Schema Prisma (Invite, Student.legacyId, ALUNO)
✅ FASE 3 — Backend de convites (config + auth + routers + api)
✅ FASE 4 — Testerotas validando tudo (100% PASS)

⏳ FASE 5 — Geradordeconvite.js v3.0 (cliente HTTP)
⏳ FASE 6 — Import de clientes legados
⏳ FASE 7 — Automação de envio (WhatsApp/SMS)
⏳ FASE 8 — Frontend (login.html, invite.html, app/)