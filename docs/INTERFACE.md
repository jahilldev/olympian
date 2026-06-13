# Olympian — Monitoring Interface Specification

> Complete design and build reference for the `app/` web UI and the supporting API additions. An agent working from this document should be able to build the entire interface end-to-end without additional clarification.

---

## 1. Goals

- Provide a real-time web dashboard at `http://localhost:3030` that shows every Hermes job, its current state, and the full audit trail (plan revisions, review passes, PR feedback, agent runs).
- Allow a user to watch a running agent's activity in real time. Because hermes runs in headless (`-z`) mode, stdout is buffered and only flushed on exit — there are no real-time stdout chunks to pipe. Instead, the hermes `observability/langfuse` plugin fires Langfuse trace events (tool calls, LLM requests, completions) _during_ execution. Olympian acts as the Langfuse server: it receives these events and streams them to the UI via SSE.
- Keep operational overhead at zero: the Astro app is built to a static directory and served directly by the existing NestJS process — no second server process, no Docker compose change.

---

## 2. High-level architecture

```
browser
  │  GET /              → static HTML (SPA shell, served by NestJS ServeStaticModule)
  │  GET /ui/jobs       → JSON REST        (NestJS UiController)
  │  GET /stream/…           → SSE              (NestJS LangfuseController)
  │  POST /langfuse/api/public/otel/v1/traces → OTLP protobuf ingestion (NestJS LangfuseController)
  ▼
NestJS (port 3030)
  ├─ ServeStaticModule    → serves app/dist/** as SPA (index.html fallback)
  ├─ UiController         → GET /ui/jobs, GET /ui/jobs/:id
  ├─ LangfuseController   → POST /langfuse/api/public/otel/v1/traces  (OTLP protobuf; parsed by langfuse.utility.ts)
  │                          GET /stream/runs/:runId                   (SSE, fans out trace events)
  ├─ LangfuseService      → in-memory event store keyed by run ID; fan-out to SSE subscribers
  └─ HermesAgentService   → injects HERMES_LANGFUSE_* credentials + OTEL_RESOURCE_ATTRIBUTES=session.id=<run.id>
                             into every agent invocation; no changes to spawnProcess needed
hermes agent container
  └─ Langfuse SDK v3+ (uses OpenTelemetry natively)
       → POST /langfuse/api/public/otel/v1/traces on host.docker.internal:3030 (always-on)
         Body: binary protobuf (application/x-protobuf, ExportTraceServiceRequest)
         (SDK base URL is http://host.docker.internal:3030/langfuse; SDK appends /api/public/otel/v1/traces)
         Session ID flows in via OTEL_RESOURCE_ATTRIBUTES=session.id=<run.id> resource attribute
```

The Astro app is a **static-output SPA shell**. Astro generates one `index.html` and the asset bundle. NestJS's `ServeStaticModule` returns that `index.html` for every path that doesn't match a known API prefix. Preact handles client-side routing based on `window.location.pathname`.

---

## 3. Repository layout changes

```
olympian/
├── app/                        ← NEW: Astro + Preact app
│   ├── package.json
│   ├── astro.config.mjs
│   ├── tailwind.config.mjs
│   ├── tsconfig.json
│   └── src/
│       ├── layouts/
│       │   └── Base.astro
│       ├── pages/
│       │   └── index.astro     ← single SPA entry point
│       └── components/         ← Preact islands (all client:only)
│           ├── App.tsx
│           ├── JobList.tsx
│           ├── JobDetail.tsx
│           ├── RunOutput.tsx
│           ├── JobCard.tsx
│           ├── StateBadge.tsx
│           ├── Timeline.tsx
│           ├── ReviewPassCard.tsx
│           ├── PlanViewer.tsx
│           └── ConfidenceGauge.tsx
├── api/
│   └── src/
│       ├── ui/                 ← NEW NestJS module
│       │   ├── ui.module.ts
│       │   ├── ui.controller.ts
│       │   └── ui.model.ts
│       ├── langfuse/           ← NEW NestJS module (trace receiver + SSE emitter)
│       │   ├── langfuse.controller.ts
│       │   ├── langfuse.model.ts
│       │   ├── langfuse.module.ts
│       │   ├── langfuse.service.ts
│       │   └── langfuse.utility.ts
│       ├── agent/
│       │   ├── agent.service.ts   ← modified: injects session ID after run creation
│       │   └── agent.utility.ts   ← modified: hardcoded Langfuse credentials always forwarded
│       └── app.module.ts          ← modified: imports UiModule, LangfuseModule
└── docs/
    └── INTERFACE.md            ← this file
```

---

## 4. API extensions

### 4.1 New NestJS modules overview

| Module           | File path           | Responsibility                                                      |
| ---------------- | ------------------- | ------------------------------------------------------------------- |
| `UiModule`       | `api/src/ui/`       | REST endpoints the Preact app polls for data                        |
| `LangfuseModule` | `api/src/langfuse/` | Langfuse-compatible ingestion endpoint; SSE fan-out of trace events |

Both modules follow the existing five-file module layout from `AGENTS.md`. `LangfuseModule` has a `langfuse.model.ts` (shared types and constants) and a `langfuse.utility.ts` (OTLP protobuf parser); `UiModule` has neither.

### 4.2 `UiModule`

**`api/src/ui/ui.model.ts`** — response shape types

```typescript
import type { AgentPhase } from "../agent/agent.model.js";
import type { TaskKind, TaskStatus } from "../queue/queue.model.js";
import type { ReviewVerdict, IssueSeverity } from "../review/review.model.js";

export interface ActiveRunDto {
  id: string;
  phase: AgentPhase;
  model: string | null;
  createdAt: string; // ISO-8601
}

export interface ActiveTaskDto {
  kind: TaskKind;
  status: TaskStatus;
  attempts: number;
}

export interface JobSummaryDto {
  id: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  state: string; // JobState union value
  confidence: number | null;
  reviewCycle: number;
  prNumber: number | null;
  prUrl: string | null;
  prIsDraft: boolean;
  createdAt: string;
  updatedAt: string;
  activeRun: ActiveRunDto | null;
  activeTask: ActiveTaskDto | null;
}

export interface TransitionDto {
  id: string;
  fromState: string | null;
  toState: string;
  reason: string | null;
  actor: string;
  createdAt: string;
}

export interface PlanRevisionDto {
  id: string;
  revision: number;
  content: string;
  status: string;
  createdAt: string;
}

export interface FeedbackDto {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface ReviewIssueDto {
  severity: IssueSeverity;
  title: string;
  detail: string;
  file?: string;
}

export interface ReviewPassDto {
  id: string;
  cycle: number;
  passNumber: number;
  confidence: number;
  verdict: ReviewVerdict;
  issues: ReviewIssueDto[];
  createdAt: string;
}

export interface AgentRunDto {
  id: string;
  phase: AgentPhase;
  model: string | null;
  status: string; // AgentRunStatus
  exitCode: number | null;
  durationMs: number | null;
  hasOutput: boolean; // true if stdout is non-empty in DB
  createdAt: string;
}

export interface JobDetailDto extends JobSummaryDto {
  issueBody: string;
  branchName: string | null;
  headSha: string | null;
  error: string | null;
  transitions: TransitionDto[];
  plans: PlanRevisionDto[];
  planFeedback: FeedbackDto[];
  prFeedback: FeedbackDto[];
  reviewPasses: ReviewPassDto[];
  runs: AgentRunDto[];
}
```

**`api/src/ui/ui.controller.ts`** — REST routes

| Method | Path           | Response          | Description                                                                                                                                                      |
| ------ | -------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/ui/jobs`     | `JobSummaryDto[]` | All jobs, sorted `updatedAt DESC`. Includes `activeRun` (any `AgentRun` with `status = 'RUNNING'`) and `activeTask` (any `QueueTask` with `status = 'RUNNING'`). |
| `GET`  | `/ui/jobs/:id` | `JobDetailDto`    | Full job record with all relations. Returns 404 if not found.                                                                                                    |

Implementation notes:

- Use a single Prisma query with `include` for each endpoint to avoid N+1 queries.
- `activeRun`: from `runs` include, filter to first where `status = 'RUNNING'`.
- `activeTask`: from `tasks` include, filter to first where `status = 'RUNNING'`.
- `ReviewPass.issues` is stored as serialised JSON — parse it before returning.
- Strip `stdout` and `stderr` from `AgentRun` records in `/ui/jobs` (summary only). Include only `hasOutput: run.stdout != null && run.stdout.length > 0`.
- The job detail endpoint also does **not** return full stdout/stderr — those are served exclusively through the stream endpoint to keep the REST response lean.
- Apply `@Header('Cache-Control', 'no-store')` to both routes.
- No auth is needed; the UI is localhost-only by design.

**`api/src/ui/ui.module.ts`**

```typescript
@Module({
  imports: [PrismaModule],
  controllers: [UiController],
})
export class UiModule {}
```

### 4.3 `LangfuseModule`

Olympian acts as an OTLP-compatible trace receiver. The Langfuse SDK v3+ uses OpenTelemetry
natively and POSTs binary protobuf payloads (`application/x-protobuf`,
`ExportTraceServiceRequest`) to `/langfuse/api/public/otel/v1/traces` using Basic Auth.
Credentials are fixed: public key `pk-lf-olympian`, secret key `sk-lf-olympian` — always
injected by the agent service, never read from `.env`.

The Langfuse SDK constructs the full URL as `{HERMES_LANGFUSE_BASE_URL}/api/public/otel/v1/traces`.
The base URL is `http://host.docker.internal:3030/langfuse` (docker) / `http://localhost:3030/langfuse`
(system mode). The NestJS controller is decorated `@Controller()` (no prefix) with route
`@Post('langfuse/api/public/otel/v1/traces')`.

The `express.raw({ type: 'application/x-protobuf', limit: '50mb' })` middleware (registered in
`main.ts` before the app starts) delivers the raw binary body as a `Buffer` to the controller
via `@Body()`.

The module has two responsibilities:

1. **Receive** OTLP spans, parse them with `deserializeOtlpTraces` from `langfuse.utility.ts`, and index events by session ID (= `AgentRun.id`).
2. **Emit** those events to SSE subscribers watching `/stream/runs/:runId`.

#### `api/src/langfuse/langfuse.model.ts`

Defines all shared types and constants for the module:

```typescript
export interface LangfuseEvent {
  type: string; // e.g. 'span-internal', 'generation-create'
  timestamp: string;
  body: Record<string, unknown>;
}

export type StreamPayload =
  | { type: "history"; events: LangfuseEvent[] }
  | { type: "event"; event: LangfuseEvent }
  | {
      type: "done";
      status: string;
      exitCode: number | null;
      durationMs: number | null;
    }
  | { type: "error"; message: string };

export const LANGFUSE_PUBLIC_KEY = "pk-lf-olympian";
export const LANGFUSE_SECRET_KEY = "sk-lf-olympian";
export const BUFFER_EVENTS = 1_000;
```

#### `api/src/langfuse/langfuse.utility.ts`

Exports `deserializeOtlpTraces(raw: Buffer): { sessionId: string; event: LangfuseEvent }[]`.

Parses an OTLP `ExportTraceServiceRequest` protobuf payload using a minimal hand-rolled
`ProtoReader` (wire types 0/1/2/5). Walks ResourceSpans → Resource.attributes to find
`session.id` (or `langfuse.session.id` / `langfuse.sessionId` for compatibility), then
ScopeSpans → Spans to build one `LangfuseEvent` per span. Span attributes prefixed
`langfuse.*` are preserved verbatim; `startTimeUnixNano` is converted to an ISO-8601
timestamp. Returns only spans for which a session ID could be resolved.

#### `api/src/langfuse/langfuse.service.ts`

```typescript
import { Injectable } from "@nestjs/common";
import { Subject, Observable } from "rxjs";
import {
  type LangfuseEvent,
  LANGFUSE_PUBLIC_KEY,
  LANGFUSE_SECRET_KEY,
  BUFFER_EVENTS,
} from "./langfuse.model.js";

@Injectable()
export class LangfuseService {
  private readonly subjects = new Map<string, Subject<LangfuseEvent>>();
  private readonly buffers = new Map<string, LangfuseEvent[]>();

  verifyCredentials(authHeader: string | undefined): boolean {
    if (!authHeader?.startsWith("Basic ")) return false;
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
    const [pub, sec] = decoded.split(":");
    return pub === LANGFUSE_PUBLIC_KEY && sec === LANGFUSE_SECRET_KEY;
  }

  /** Called for each item in the batch POSTed to /langfuse/api/public/ingestion. */
  ingest(sessionId: string, events: LangfuseEvent[]): void {
    if (!this.subjects.has(sessionId)) {
      this.subjects.set(sessionId, new Subject());
      this.buffers.set(sessionId, []);
    }
    const subject = this.subjects.get(sessionId)!;
    const buffer = this.buffers.get(sessionId)!;
    for (const ev of events) {
      if (buffer.length >= BUFFER_EVENTS) buffer.shift();
      buffer.push(ev);
      subject.next(ev);
    }
  }

  /** Mark the session complete (agent run finished). */
  complete(sessionId: string): void {
    this.subjects.get(sessionId)?.complete();
    this.subjects.delete(sessionId);
  }

  observe(sessionId: string): Observable<LangfuseEvent> | null {
    return this.subjects.get(sessionId)?.asObservable() ?? null;
  }

  getBuffer(sessionId: string): LangfuseEvent[] {
    return this.buffers.get(sessionId) ?? [];
  }

  isActive(sessionId: string): boolean {
    return this.subjects.has(sessionId);
  }
}
```

#### `api/src/langfuse/langfuse.controller.ts`

**`POST /langfuse/api/public/otel/v1/traces`** — OTLP protobuf trace ingestion

- Validates Basic Auth credentials against `langfuseService.verifyCredentials()`; returns `401` on failure.
- Receives the raw binary body as a `Buffer` via `@Body()` (the `express.raw()` middleware in `main.ts` handles content-type `application/x-protobuf`).
- Calls `deserializeOtlpTraces(raw)` from `langfuse.utility.ts` to parse the `ExportTraceServiceRequest` and return `{ sessionId, event }[]`. Session ID is read from the OTLP resource attribute `session.id` (set by `OTEL_RESOURCE_ATTRIBUTES` in the agent container).
- Calls `langfuseService.ingest(sessionId, [event])` for each resolved span.
- Returns `{ partialSuccess: {} }` (OTLP SDK expects `ExportTraceServiceResponse` shape).

**`GET /stream/runs/:runId`** — SSE stream of trace events for a run

SSE event protocol (each `data` field is a JSON string):

```typescript
type StreamEvent =
  | { type: "history"; events: LangfuseEvent[] } // buffered events to date
  | { type: "event"; event: LangfuseEvent } // new live event
  | {
      type: "done";
      status: string;
      exitCode: number | null;
      durationMs: number | null;
    }
  | { type: "error"; message: string }; // run not found
```

**Behaviour:**

1. Look up the `AgentRun` in Prisma by `runId`.
2. Not found → emit `error` and complete.
3. Run `status` is **not** `RUNNING` → emit `{ type: 'history', events: [] }` (no events stored for completed runs in current iteration; stdout is available via DB), then `done`.
4. Run is `RUNNING`:
   a. Emit `{ type: 'history', events: langfuseService.getBuffer(runId) }`.
   b. Subscribe to `langfuseService.observe(runId)` — emit each event as `{ type: 'event', event }`.
   c. When observable completes, re-fetch `AgentRun` and emit `done`.

#### `api/src/langfuse/langfuse.module.ts`

```typescript
@Module({
  imports: [PrismaModule],
  controllers: [LangfuseController],
  providers: [LangfuseService],
  exports: [LangfuseService],
})
export class LangfuseModule {}
```

### 4.4 Agent service modifications

No changes to `spawnProcess` or `agent.utility.ts`'s function signature are required.

**`api/src/agent/agent.utility.ts`** — hardcoded credentials, always forwarded

In `buildSpawnSpec`, both modes (docker and none) unconditionally inject:

- `HERMES_LANGFUSE_PUBLIC_KEY=pk-lf-olympian`
- `HERMES_LANGFUSE_SECRET_KEY=sk-lf-olympian`
- `HERMES_LANGFUSE_BASE_URL=http://host.docker.internal:<PORT>` (docker) / `http://localhost:<PORT>` (none)

No `.env` variables are read for observability; it is always-on.

**`api/src/agent/agent.service.ts`** — inject session ID after run creation

After `this.prisma.agentRun.create(...)` returns `run`, and before calling `spawnProcess`:

```typescript
// Inject the run ID as an OTLP resource attribute so the trace receiver can
// correlate incoming spans to this specific AgentRun record.
const sessionAttr = `session.id=${run.id}`;
const imageArg = this.config.get("DOCKER_AGENT_IMAGE");
const imageIdx = spec.args.indexOf(imageArg);

if (imageIdx > -1) {
  // docker mode: splice --env OTEL_RESOURCE_ATTRIBUTES before the image name
  spec.args.splice(
    imageIdx,
    0,
    "--env",
    `OTEL_RESOURCE_ATTRIBUTES=${sessionAttr}`,
  );
} else if (spec.env) {
  // system mode: merge into existing env object
  const env = spec.env as Record<string, string>;
  const existing = env.OTEL_RESOURCE_ATTRIBUTES;
  env.OTEL_RESOURCE_ATTRIBUTES = existing
    ? `${existing},${sessionAttr}`
    : sessionAttr;
}
```

The OpenTelemetry SDK reads `OTEL_RESOURCE_ATTRIBUTES` at startup and merges the key-value
pairs into every span's resource. `langfuse.utility.ts` reads `session.id` from the resource
attributes to correlate spans with the `AgentRun` record.

### 4.5 `AppModule` changes

Add `UiModule` and `LangfuseModule` to the `imports` array in `app.module.ts`.

### 4.6 `main.ts` changes — middleware and static serving

**OTLP body parser (required before `app.listen`):**

```typescript
import { raw } from "express";

// OTLP/HTTP protobuf — must be registered before NestJS's JSON body parser
// so the binary payload is preserved as a Buffer for the OTLP handler.
app.use(
  "/langfuse/api/public/otel/v1/traces",
  raw({ type: "application/x-protobuf", limit: "50mb" }),
);
```

**SPA static serving:**

Install `@nestjs/serve-static`:

```
npm install @nestjs/serve-static
```

In `app.module.ts`, add `ServeStaticModule` to imports:

```typescript
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

ServeStaticModule.forRoot({
  rootPath: join(__dirname, '..', '..', '..', 'app', 'dist'),
  // All API routes are excluded so they reach NestJS controllers normally.
  exclude: ['/ui*', '/stream*', '/webhooks*', '/health*', '/metrics*'],
  serveStaticOptions: {
    index: false,   // Don't auto-serve index.html for API paths
    fallback: undefined,
  },
}),
```

Additionally, in `main.ts`, after creating the app, add an Express static fallback so any unmatched path returns `index.html` (SPA routing):

```typescript
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as express from "express";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const distPath = join(__dirname, "..", "..", "..", "app", "dist");

// Serve built Astro assets; fall back to index.html for SPA routes.
app.use(express.static(distPath));
app.use((req, res, next) => {
  if (
    !req.path.startsWith("/ui") &&
    !req.path.startsWith("/stream") &&
    !req.path.startsWith("/webhooks") &&
    !req.path.startsWith("/health") &&
    !req.path.startsWith("/metrics")
  ) {
    res.sendFile(join(distPath, "index.html"));
  } else {
    next();
  }
});
```

> **Note:** In development, the Astro dev server handles the frontend independently (see section 10). The static serving path in NestJS is only exercised in production after `npm run build` has been run in `app/`.

---

## 5. Astro app specification

### 5.1 Package setup (`app/package.json`)

```json
{
  "name": "olympian-ui",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "astro dev --port 4321",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "@astrojs/preact": "^4.0.0",
    "@astrojs/tailwind": "^5.0.0",
    "astro": "^5.0.0",
    "preact": "^10.0.0",
    "tailwindcss": "^3.4.0"
  }
}
```

### 5.2 `astro.config.mjs`

```javascript
import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
  output: "static",
  integrations: [preact({ compat: false }), tailwind()],
  vite: {
    server: {
      proxy: {
        "/ui": "http://localhost:3030",
        "/stream": "http://localhost:3030",
      },
    },
  },
});
```

The Vite proxy forwards API and SSE requests to the NestJS server during `astro dev`. In production both are same-origin.

### 5.3 `tailwind.config.mjs`

```javascript
export default {
  content: ["./src/**/*.{astro,tsx,ts}"],
  theme: {
    extend: {
      fontFamily: { mono: ["JetBrains Mono", "ui-monospace", "monospace"] },
    },
  },
  plugins: [],
};
```

### 5.4 `tsconfig.json`

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

### 5.5 `src/layouts/Base.astro`

The HTML shell. Imports global CSS and renders `<slot />`.

```astro
---
export interface Props { title?: string }
const { title = 'Olympian' } = Astro.props;
---
<!doctype html>
<html lang="en" class="bg-zinc-950 text-zinc-100 h-full">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body class="h-full">
    <slot />
  </body>
</html>
```

### 5.6 `src/pages/index.astro`

The single page entry point. Renders the Preact `App` component with `client:only="preact"` so all interactivity runs purely in the browser. Astro generates a static `index.html` with no server-side data baked in.

```astro
---
import Base from '../layouts/Base.astro';
import App from '../components/App.tsx';
---
<Base>
  <App client:only="preact" />
</Base>
```

---

## 6. Preact component specification

All components live in `app/src/components/`. They use only Preact hooks (`useState`, `useEffect`, `useRef`, `useCallback`) and the browser's native `fetch` and `EventSource` APIs. No third-party state library or router library is used.

### 6.1 Routing (`App.tsx`)

Simple path-based router using `window.location.pathname` and the `popstate` event.

**Routes:**

| Path pattern            | Rendered component                       |
| ----------------------- | ---------------------------------------- |
| `/`                     | `<JobList />`                            |
| `/jobs/:id`             | `<JobDetail id={id} />`                  |
| `/jobs/:id/runs/:runId` | `<RunOutput jobId={id} runId={runId} />` |

```typescript
function useRoute(): { path: string } {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const handler = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);
  return { path };
}

export function navigate(to: string): void {
  window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
```

`App.tsx` parses the path with a small regex-based match function and renders the appropriate component. Export `navigate` from this file; other components import it for link navigation.

### 6.2 `StateBadge.tsx`

Renders a coloured pill for a `JobState` string.

| State                    | Tailwind classes                |
| ------------------------ | ------------------------------- |
| `TRIAGED`                | `bg-zinc-700 text-zinc-200`     |
| `PLANNING`               | `bg-blue-900 text-blue-200`     |
| `AWAITING_PLAN_APPROVAL` | `bg-amber-900 text-amber-200`   |
| `IMPLEMENTING`           | `bg-indigo-900 text-indigo-200` |
| `SELF_REVIEWING`         | `bg-violet-900 text-violet-200` |
| `REVISING`               | `bg-orange-900 text-orange-200` |
| `OPENING_PR`             | `bg-sky-900 text-sky-200`       |
| `AWAITING_PR_APPROVAL`   | `bg-amber-900 text-amber-200`   |
| `DONE`                   | `bg-green-900 text-green-200`   |
| `FAILED`                 | `bg-red-900 text-red-200`       |
| `CANCELLED`              | `bg-zinc-700 text-zinc-400`     |

Props: `{ state: string }`. Renders `<span class="px-2 py-0.5 rounded text-xs font-medium …">{state}</span>`.

### 6.3 `JobCard.tsx`

Renders a single row in the job list table.

**Displayed fields:**

- State badge (`StateBadge`)
- Repo + issue number — `owner/repo #N` as a GitHub link (`https://github.com/{repoFullName}/issues/{issueNumber}`)
- Issue title (truncated to 80 chars with ellipsis)
- PR link if `prNumber` is set — shows `#N` with a draft indicator if `prIsDraft`
- Active agent phase badge if `activeRun` is not null — shows `● IMPLEMENT` (green pulsing dot + phase name)
- Review cycle count if `reviewCycle > 0` — `cycle N`
- Confidence percentage if `confidence` is not null — shown as `N%` with colour: `< 70` → red, `70–84` → amber, `≥ 85` → green
- `updatedAt` as a relative time string (e.g. "3 min ago", "2 h ago")

Clicking anywhere on the row calls `navigate('/jobs/' + id)`.

### 6.4 `JobList.tsx`

Dashboard view. Polls `GET /ui/jobs` every **3 seconds** using `setInterval` inside `useEffect`.

**Layout:**

- Full-page container with a fixed header bar: "Olympian" wordmark on the left, a coloured dot and count of active jobs on the right (e.g. `● 2 active`).
- Below: a scrollable table with columns: **State | Job | PR | Active | Confidence | Cycle | Updated**.
- Each row is a `<JobCard />`.
- If the array is empty, show a centred message: "No jobs yet. Add the `hermes` label to a GitHub issue to get started."
- Loading state: skeleton rows (3 rows of grey rounded-rect placeholders) while the first fetch is in flight.
- Error state: red banner "Failed to fetch jobs — retrying…" if the last fetch threw.

### 6.5 `JobDetail.tsx`

Props: `{ id: string }`. Polls `GET /ui/jobs/:id` every **2 seconds**.

**Layout — two-column, 60/40 split on desktop, stacked on mobile:**

**Left column — timeline and plan:**

- Back link: `← All jobs` calls `navigate('/')`.
- Page header: issue title (h1), repo + issue number as link, `StateBadge`.
- If `error` is set: red error box showing the error string.
- PR info bar (if `prNumber`): PR number + link, draft/open indicator, head SHA (first 7 chars).
- **Plan section**: if `plans` array is non-empty, shows a collapsible `<PlanViewer />` with the latest `APPROVED` plan (or most recent if none approved).
- **Plan feedback** (if non-empty): list of feedback items with author, body, and relative timestamp.
- **Timeline**: `<Timeline transitions={transitions} />` — chronological list of all state transitions.

**Right column — review cycles and runs:**

- **Review passes**: if `reviewPasses` is non-empty, grouped by `cycle`. Show a tab strip with `Cycle 1`, `Cycle 2`, … tabs. Within each tab, show each `<ReviewPassCard pass={pass} />` in pass number order.
- **PR feedback** (if non-empty): list of `PrRevisionFeedback` items with author, body, timestamp.
- **Agent runs**: list of `<AgentRunRow run={run} jobId={id} />` sorted by `createdAt` descending. Clicking a row calls `navigate('/jobs/' + id + '/runs/' + run.id)`.

### 6.6 `AgentRunRow.tsx`

Single row in the runs list. Shows:

- Phase tag (`PLAN`, `IMPLEMENT`, etc.) with a fixed-width monospace badge
- Status indicator: `RUNNING` → pulsing green dot; `SUCCEEDED` → green check; `FAILED` → red ✗; `TIMED_OUT` → amber clock
- Model name (if set) in muted text
- Duration: formatted as `Nm Ns` if `durationMs` is set, else `—`
- "View output" link if `hasOutput` or `status === 'RUNNING'` — calls `navigate(…/runs/${run.id})`

### 6.7 `ReviewPassCard.tsx`

Props: `{ pass: ReviewPassDto }`.

Displays:

- Pass number heading: `Pass N`
- Verdict badge: `PASS` → green, `FAIL` → red
- **Confidence gauge**: horizontal bar, 0–100 range. Colour:
  - `< 70` → red (`bg-red-500`)
  - `70–84` → amber (`bg-amber-500`)
  - `≥ 85` → green (`bg-green-500`)
  - Numeric label: `N%`
- **Issues list** (if `issues.length > 0`): each issue as a card with:
  - Severity badge (colour mapping: `low` → zinc, `medium` → amber, `high` → orange, `critical` → red)
  - Title in bold
  - Detail text
  - File path in monospace (if `file` is set)

### 6.8 `ConfidenceGauge.tsx`

Props: `{ value: number }`. Standalone reusable bar component used by `ReviewPassCard`. Renders a full-width `<div>` background track with a coloured fill div at width `${value}%`.

### 6.9 `PlanViewer.tsx`

Props: `{ content: string; revision: number; status: string }`.

Renders the plan content inside a `<pre>` block with `font-mono text-sm text-zinc-300 whitespace-pre-wrap`. Shows the revision number and status in a small header above.

### 6.10 `Timeline.tsx`

Props: `{ transitions: TransitionDto[] }`.

Renders a vertical timeline list. Each entry:

- A small coloured circle (colour matches the `toState` badge colour)
- `toState` badge
- Reason text (if set) in muted style
- Actor tag: `HUMAN` → blue, `AGENT` → violet, `SYSTEM` → zinc
- Relative timestamp

### 6.11 `RunOutput.tsx`

Props: `{ jobId: string; runId: string }`.

This is the most complex component. It streams Langfuse trace events (LLM turns, tool calls) in real time via SSE, providing a live view of the agent's work during a run.

**On mount:**

1. Fetch `GET /ui/jobs/:jobId` to get the run metadata (phase, model, status).
2. Open `new EventSource('/stream/runs/' + runId)`.
3. On `message` event: parse the JSON payload (`StreamPayload`) and handle:
   - `{ type: 'history', events: LangfuseEvent[] }` → populate the event list with buffered events from before this connection opened
   - `{ type: 'event', event: LangfuseEvent }` → append the live event to the list
   - `{ type: 'done', status, exitCode, durationMs }` → update header, close `EventSource`
   - `{ type: 'error', message }` → show error, close `EventSource`
4. On SSE `error` event: if `eventSource.readyState === EventSource.CLOSED`, show "Stream ended" message.
5. Close `EventSource` on component unmount.

> **Note:** Rather than a full job fetch for run metadata, it is acceptable to include `GET /ui/runs/:runId` as an additional endpoint in `UiController` that returns `{ id, phase, model, status, exitCode, durationMs, jobId, createdAt }`. This keeps the RunOutput component self-contained. The implementing agent should add this endpoint if it makes the component cleaner.

**Layout:**

- Back link: `← Job detail` → `navigate('/jobs/' + jobId)`
- Header bar: phase badge, model name, status indicator, duration (updates live on `done` event)
- **Agent activity pane**: dark background (`bg-black`), `font-mono text-sm`, `overflow-y-auto`, full remaining viewport height.
  - Renders the event list as a feed of cards/rows, newest at the bottom.
  - Each `span-internal` event with `langfuse.observation.type = 'generation'` is rendered as an LLM turn card: model name, truncated text content, tool names dispatched, token counts.
  - Each `span-internal` event with `langfuse.observation.type = 'tool'` is rendered as a tool call row: tool name and input summary.
  - Auto-scrolls to the bottom when new events arrive (only if the user hasn't manually scrolled up — use a "pinned to bottom" flag: if `scrollTop + clientHeight >= scrollHeight - 50`, keep scrolling).
- Copy button in the top-right corner of the terminal pane: copies full output to clipboard using `navigator.clipboard.writeText`.
- "Scroll to bottom" floating button appears when the user has scrolled up; clicking re-pins the scroll.

---

## 7. Data flow summary

```
WorkerService.tick()
  → queue.claimBatch()
  → orchestrator.processTask(IMPLEMENT / TEST / REVISE / …)
  → HermesAgentService.run(...)
      │
      ├─ buildSpawnSpec — injects HERMES_LANGFUSE_{KEY,SECRET,BASE_URL} (hardcoded)
      ├─ prisma.agentRun.create() → run.id
      ├─ injects OTEL_RESOURCE_ATTRIBUTES=session.id=<run.id> into docker --env or spec.env
      └─ spawnProcess(spec, { timeoutMs })
              └─ docker run hermes-agent …
                    └─ hermes -z …
                          └─ Langfuse SDK (OpenTelemetry native)
                                └─ POST /langfuse/api/public/otel/v1/traces
                                     binary protobuf ExportTraceServiceRequest
                                     resource.attributes: { session.id: run.id, … }
                                          ▼
                                   LangfuseController → deserializeOtlpTraces(raw)
                                                       → langfuseService.ingest(run.id, [event])
                                                                ▼
                                                      Subject.next(event)
                                                           ▼
                                        browser (RunOutput.tsx EventSource)
                                        ← { type: 'event', event: { type: 'span-internal', … } }

When agent exits:
  spawnProcess resolves → HermesAgentService updates AgentRun status
  → (LangfuseService.complete() — called implicitly when the run transitions out of RUNNING)
  → LangfuseController emits { type: 'done', status, exitCode, durationMs }
  → EventSource closes
```

---

## 8. State polling strategy

| View       | Endpoint           | Interval | Notes                                                          |
| ---------- | ------------------ | -------- | -------------------------------------------------------------- |
| Job list   | `GET /ui/jobs`     | 3 000 ms | Entire list replaced each poll                                 |
| Job detail | `GET /ui/jobs/:id` | 2 000 ms | Stopped if `state` is terminal (`DONE`, `FAILED`, `CANCELLED`) |
| Run output | SSE                | —        | No polling; driven by SSE events                               |

All polling uses `setInterval` inside `useEffect` with proper cleanup (`clearInterval` on unmount). The first fetch fires immediately on mount (don't wait for the first interval tick).

---

## 9. Build and development workflow

### 9.1 Development

Two processes run concurrently:

```bash
# Terminal 1 — API
cd api && npm run start:dev

# Terminal 2 — Astro dev server
cd app && npm run dev
```

Browse to `http://localhost:4321`. The Vite proxy (configured in `astro.config.mjs`) forwards `/ui/*` and `/stream/*` to `http://localhost:3030`.

### 9.2 Production build

```bash
cd app && npm run build
# Outputs to app/dist/

# Then (re)start the NestJS service — it serves app/dist/ automatically.
cd api && npm run build && node dist/main.js
```

The NestJS production build is at `api/dist/`. The relative path from `api/dist/main.js` to `app/dist/` is `../../../app/dist` (repo root layout). The `__dirname` equivalent in the NestJS ESM build must use `fileURLToPath(new URL('.', import.meta.url))`.

### 9.3 Root workspace `package.json` additions

Add convenience scripts to the root `package.json`:

```json
{
  "scripts": {
    "ui:dev": "cd app && npm run dev",
    "ui:build": "cd app && npm run build",
    "ui:install": "cd app && npm install"
  }
}
```

---

## 10. Configuration

No new environment variables are required for the UI or observability. Langfuse credentials
(`pk-lf-olympian` / `sk-lf-olympian`) are hardcoded constants — both in the service
(which injects them into every agent container) and in `LangfuseService` (which validates
them on ingestion). The UI reads data from the same NestJS process using relative paths.
The `PORT` variable (default `3030`) already controls the listening port.

---

## 11. Security considerations

- All `/ui/*` and `/stream/*` endpoints are **unauthenticated** by design. The UI is intended for local/trusted-network use only. If the NestJS server is exposed publicly (e.g. via Tailscale Funnel), consider adding a middleware guard to these routes that checks `req.ip` or a bearer token.
- SSE connections are long-lived. `LangfuseController` must handle client disconnects cleanly: subscribe to `req.on('close', ...)` to call `Subject.unsubscribe()` and avoid memory leaks from orphaned subscriptions.
- The `AgentRun.stdout` column is already capped at `STDOUT_CAP = 200_000` bytes in the existing agent service. The SSE event buffer (`BUFFER_EVENTS = 1000`) is a separate in-memory cap for the live stream — it doesn't bypass the DB cap.

---

## 12. Implementation checklist

For an agent building from this document, the recommended order of implementation is:

1. **`api/src/langfuse/`** — `LangfuseService` (no external dependencies), `LangfuseModule`, `LangfuseController`.
2. **`api/src/agent/agent.utility.ts`** — hardcoded Langfuse credentials injected into every spawn spec (already done).
3. **`api/src/agent/agent.service.ts`** — inject `HERMES_LANGFUSE_SESSION_ID` after `agentRun.create()` (already done).
4. **`api/src/ui/`** — `UiModule`, `UiController`, `UiModel`.
5. **`api/src/app.module.ts`** — import `UiModule`, `LangfuseModule`.
6. **`api/main.ts`** (or `app.module.ts`) — add `ServeStaticModule` + SPA fallback middleware.
7. **`app/`** — scaffold Astro project (`npm create astro@latest`), install integrations.
8. **`app/src/components/StateBadge.tsx`** — simplest component, no data dependency.
9. **`app/src/components/App.tsx`** — router shell.
10. **`app/src/components/JobList.tsx`** + **`JobCard.tsx`** — main dashboard.
11. **`app/src/components/JobDetail.tsx`** + sub-components (`Timeline`, `ReviewPassCard`, `PlanViewer`, `AgentRunRow`, `ConfidenceGauge`).
12. **`app/src/components/RunOutput.tsx`** — SSE consumer, last because it depends on `LangfuseController` being ready.
13. **End-to-end test**: label a GitHub issue, watch the job appear on the dashboard, click through to a run, observe live Langfuse trace events.
