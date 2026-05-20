# Tasks REST API

A Node.js + Express REST API with PostgreSQL for managing tasks — full CRUD with filtering, pagination, Zod validation, JWT authentication, and role-based access control.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (runtime-managed)
- Required env: `SESSION_SECRET` — used as the JWT signing secret

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Auth: JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`)
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Logging: pino + pino-http

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for all contracts)
- `lib/db/src/schema/tasks.ts` — Tasks Drizzle table + insert schema
- `lib/db/src/schema/users.ts` — Users Drizzle table + insert schema
- `artifacts/api-server/src/routes/auth.ts` — Register/login handlers
- `artifacts/api-server/src/routes/tasks.ts` — Task route handlers (JWT-protected)
- `artifacts/api-server/src/middleware/auth.ts` — JWT verify middleware + `signToken`
- `artifacts/api-server/src/middleware/rbac.ts` — `requireAdmin` middleware
- `artifacts/api-server/src/types/auth.d.ts` — Express `Request` type augmentation
- `lib/api-zod/src/generated/api.ts` — Generated Zod validation schemas (server-side)
- `lib/api-client-react/src/generated/api.ts` — Generated React Query hooks (frontend use)

## API Endpoints

Base path: `/api`

### Auth (public)

| Method | Path               | Description                          |
|--------|--------------------|--------------------------------------|
| POST   | /auth/register     | Register — returns `{ token, user }` |
| POST   | /auth/login        | Login — returns `{ token, user }`    |

### Tasks (JWT required — `Authorization: Bearer <token>`)

| Method | Path         | Description                                       | Role    |
|--------|--------------|---------------------------------------------------|---------|
| GET    | /healthz     | Health check                                      | public  |
| GET    | /tasks       | List tasks (filter: status, priority; paginate)   | any     |
| POST   | /tasks       | Create a task                                     | any     |
| GET    | /tasks/:id   | Get a single task                                 | any     |
| PATCH  | /tasks/:id   | Update a task (partial)                           | any     |
| DELETE | /tasks/:id   | Delete a task                                     | admin   |

### Query parameters for GET /tasks

- `status` — `todo` | `in_progress` | `done`
- `priority` — `low` | `medium` | `high`
- `page` — page number (default: 1)
- `limit` — items per page (default: 20, max: 100)

### Task schema

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

### Auth response schema

```json
{
  "token": "<JWT>",
  "user": { "id": 1, "email": "user@example.com", "role": "user | admin" }
}
```

## Architecture decisions

- Contract-first: OpenAPI spec is written first; Zod schemas and React Query hooks are generated from it via Orval — never hand-written.
- All request/response validation uses generated Zod schemas from `@workspace/api-zod`.
- JWT is signed with `SESSION_SECRET`; tokens expire after 7 days.
- Passwords are hashed with bcrypt (cost factor 12).
- `requireAuth` is applied at the router level in `tasks.ts` — all task routes require a valid JWT.
- `requireAdmin` is applied only to `DELETE /tasks/:id` — all other task operations accept any authenticated user.
- The `role` field is accepted during registration to allow seeding admin accounts.
- Pagination uses `OFFSET/LIMIT` with a parallel `COUNT(*)` query for accurate totals.

## Product

A task management API supporting create, read, update, delete, filter by status/priority, and paginated list queries. Users must authenticate via JWT. Only admins can delete tasks. Ready to be consumed by any frontend or mobile client.

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `openapi.yaml`, and then `pnpm run typecheck:libs` to rebuild composite libs before running the server typecheck.
- Body schema names in the OpenAPI spec must be entity-shaped (`TaskInput`, `RegisterInput`) — never operation-shaped (`CreateTaskBody`) to avoid TS2308 collisions.
- Wildcard routes in Express 5 require `/{*splat}` syntax, not bare `*`.
- `DATABASE_URL` is runtime-managed — do not set it manually.
- `SESSION_SECRET` must be set as a Replit secret — the server throws on startup if it is missing.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
