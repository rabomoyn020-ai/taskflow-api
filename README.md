# TaskFlow API

A production-ready REST API for task management built with **Node.js**, **Express 5**, and **PostgreSQL**. Includes JWT authentication, role-based access control, full CRUD, filtering, pagination, and a single-page HTML frontend.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24 |
| Language | TypeScript 5.9 (strict) |
| Framework | Express 5 |
| Database | PostgreSQL + Drizzle ORM |
| Validation | Zod v4 (generated from OpenAPI spec) |
| Authentication | JWT (`jsonwebtoken`) |
| Password hashing | bcrypt (`bcryptjs`, cost factor 12) |
| Logging | pino + pino-http (structured JSON) |
| Build | esbuild (ESM bundle) |
| Package manager | pnpm workspaces |
| API contract | OpenAPI 3.1 (contract-first, Orval codegen) |

---

## Project Setup

### Prerequisites

- Node.js 24+
- pnpm 10+
- PostgreSQL database (automatically provisioned by Replit)

### Install dependencies

```bash
pnpm install
```

### Environment variables

| Variable | Description | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Yes (runtime-managed on Replit) |
| `SESSION_SECRET` | JWT signing secret (min 32 chars) | Yes |
| `PORT` | Server port | Yes (injected by workflow) |

### Run locally

```bash
# Start the API server in development mode (builds then runs)
pnpm --filter @workspace/api-server run dev
```

The server starts on `PORT` (default `8080` in production, set by the workflow config).

Open `http://localhost:8080` to view the frontend dashboard.

### Push database schema

```bash
# Apply schema changes to the database
pnpm --filter @workspace/db run push
```

### Regenerate API types (after changing openapi.yaml)

```bash
pnpm --filter @workspace/api-spec run codegen
```

This regenerates:
- `lib/api-zod/src/generated/api.ts` — Zod validation schemas (server)
- `lib/api-client-react/src/generated/api.ts` — React Query hooks (frontend)

### Typecheck everything

```bash
pnpm run typecheck
```

---

## API Endpoints

**Base URL:** `/api`

All task endpoints require `Authorization: Bearer <token>` (obtain a token from `/api/auth/login` or `/api/auth/register`).

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/healthz` | None | Returns `{ status: "ok" }` |

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/register` | None | Register a new user |
| `POST` | `/api/auth/login` | None | Login and get a JWT |

**Register / Login request body:**

```json
{ "email": "user@example.com", "password": "password123" }
```

Pass `"role": "admin"` during registration to create an admin account.

**Response (both endpoints):**

```json
{
  "token": "<JWT — valid 7 days>",
  "user": { "id": 1, "email": "user@example.com", "role": "user" }
}
```

### Tasks

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/api/tasks` | any | List tasks (paginated, filterable) |
| `POST` | `/api/tasks` | any | Create a task |
| `GET` | `/api/tasks/:id` | any | Get a single task |
| `PATCH` | `/api/tasks/:id` | any | Partially update a task |
| `DELETE` | `/api/tasks/:id` | **admin** | Delete a task |

#### Query parameters for `GET /api/tasks`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | `todo \| in_progress \| done` | — | Filter by status |
| `priority` | `low \| medium \| high` | — | Filter by priority |
| `page` | integer ≥ 1 | `1` | Page number |
| `limit` | integer 1–100 | `20` | Items per page |

#### Task schema

```json
{
  "id": 1,
  "title": "Design the homepage",
  "description": "optional text or null",
  "status": "todo | in_progress | done",
  "priority": "low | medium | high",
  "dueDate": "2026-06-01T00:00:00Z (nullable)",
  "createdAt": "2026-05-20T10:00:00Z",
  "updatedAt": "2026-05-20T10:00:00Z"
}
```

#### Task list response

```json
{
  "data": [ ...tasks ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

---

## Error Responses

All errors return `{ "error": "<message>" }` with an appropriate HTTP status:

| Status | Meaning |
|--------|---------|
| `400` | Validation error (invalid body / params) |
| `401` | Missing, expired, or invalid JWT |
| `403` | Insufficient role (admin required) |
| `404` | Resource not found |
| `409` | Conflict (e.g. email already in use) |

---

## Architecture

- **Contract-first:** `lib/api-spec/openapi.yaml` is the single source of truth. Zod schemas and React Query hooks are generated from it — never hand-written.
- **DB schema:** Drizzle ORM with `pgTable`. Each model in its own file under `lib/db/src/schema/`.
- **Validation:** All request bodies, path params, and query params are validated with generated Zod schemas from `@workspace/api-zod`.
- **Auth flow:** Register/login → bcrypt verify → sign JWT → client sends `Authorization: Bearer <token>` → `requireAuth` middleware verifies and attaches `req.user`.
- **RBAC:** `requireAdmin` middleware checks `req.user.role === "admin"` and returns `403` otherwise.
- **Logging:** pino with `pino-http` for structured JSON logging in production; `pino-pretty` in development.

---

## Scalability Notes

### Microservices

The monorepo structure is already decomposed by domain — `lib/db`, `lib/api-zod`, `lib/api-client-react`, and `artifacts/api-server`. Splitting into microservices is incremental:

1. **Extract by domain** — break `artifacts/api-server` into separate services (e.g. `auth-service`, `tasks-service`) each with their own Drizzle schema and Express app. Keep shared DB libs in `lib/`.
2. **Shared contracts** — the OpenAPI spec in `lib/api-spec` becomes a versioned artifact. Each service publishes its own spec; an API gateway (e.g. Kong, nginx, AWS API Gateway) aggregates them.
3. **Service communication** — use HTTP (REST/gRPC) for synchronous calls. For async workflows (e.g. task notifications), introduce a message broker like **RabbitMQ** or **Kafka** between services.
4. **Auth at the gateway** — move JWT verification to the API gateway (or a dedicated auth sidecar) so individual services don't need to carry `jsonwebtoken`. Internal service calls use mTLS or internal JWTs with short TTLs.

### Caching with Redis

Redis adds two critical layers:

| Layer | What to cache | TTL strategy |
|---|---|---|
| **Query cache** | `GET /tasks` paginated results per user/filter combo | Short TTL (30–60 s); invalidate on `POST/PATCH/DELETE` |
| **Session / token blocklist** | Revoked JWT IDs (for logout/rotation) | TTL = remaining token lifetime |

Implementation sketch:

```typescript
import { createClient } from "redis";
const redis = createClient({ url: process.env.REDIS_URL });

// In GET /tasks handler
const cacheKey = `tasks:${JSON.stringify(req.query)}:user:${req.user.id}`;
const cached = await redis.get(cacheKey);
if (cached) { res.json(JSON.parse(cached)); return; }

const result = await db.select()...
await redis.setEx(cacheKey, 30, JSON.stringify(result));
res.json(result);
```

For a write-through pattern on mutations, call `redis.del` (or use key pattern deletion) after any `POST/PATCH/DELETE` on tasks.

### Load Balancing

**Horizontal scaling** is straightforward because this API is stateless — JWTs carry all session state, and the database is external:

1. **Multiple instances** — run N replicas of `api-server` behind a load balancer (nginx, HAProxy, or a cloud LB like AWS ALB / GCP Cloud Load Balancing).
2. **Sticky sessions are not needed** — JWTs are verified with a shared `SESSION_SECRET`; any replica can serve any request.
3. **Connection pooling** — use `pg.Pool` (already in place via Drizzle) with a pool size tuned per replica (e.g. `max: 10`). For many replicas, put **PgBouncer** in front of Postgres to avoid connection exhaustion.
4. **Health checks** — the `/api/healthz` endpoint is already defined. Wire it into your load balancer's health probe so unhealthy instances are drained automatically.
5. **Zero-downtime deploys** — use rolling deployments (Kubernetes rolling update or ECS task replacement). The stateless design means new and old replicas can serve traffic simultaneously during the rollout.
6. **Rate limiting** — add per-IP and per-user rate limiting at the load balancer or API gateway level (e.g. nginx `limit_req_zone`, Kong rate-limit plugin) before requests reach your Node.js processes.

---

## Directory Structure

```
├── artifacts/
│   └── api-server/         # Express API + static frontend
│       ├── public/
│       │   └── index.html  # Single-page frontend (no build step)
│       └── src/
│           ├── app.ts
│           ├── index.ts
│           ├── middleware/
│           │   ├── auth.ts  # JWT verify + signToken
│           │   └── rbac.ts  # requireAdmin
│           ├── routes/
│           │   ├── auth.ts  # POST /auth/register, /auth/login
│           │   ├── tasks.ts # CRUD /tasks
│           │   └── health.ts
│           └── lib/
│               └── logger.ts
├── lib/
│   ├── api-spec/
│   │   └── openapi.yaml    # OpenAPI 3.1 spec (source of truth)
│   ├── api-zod/            # Generated Zod schemas (server)
│   ├── api-client-react/   # Generated React Query hooks (frontend)
│   └── db/
│       └── src/schema/
│           ├── tasks.ts
│           └── users.ts
└── README.md
```
