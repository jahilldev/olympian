# Olympian — Monitoring Interface Specification

> Complete design and build reference for the `app/` web UI and the supporting API additions. An agent working from this document should be able to build the entire interface end-to-end without additional clarification.

---

## 1. Goals

- Provide a real-time web dashboard at `http://localhost:3030` that shows every Hermes job, its current state, and the full audit trail (plan revisions, review passes, PR feedback, agent runs).
- Allow a user to watch a running agent's raw stdout stream as it happens, giving direct visibility into model reasoning and output.
- Keep operational overhead at zero: the Astro app is built to a static directory and served directly by the existing NestJS process — no second server process, no Docker compose change.

---

## 2. High-level architecture

```
browser
  │  GET /          → static HTML (SPA shell, served by NestJS ServeStaticModule)
  │  GET /ui/jobs   → JSON REST  (new NestJS UiController)
  │  GET /stream/…  → SSE        (new NestJS StreamController)
  ▼
NestJS (port 3030)
  ├─ ServeStaticModule  → serves app/dist/** as SPA (index.html fallback)
  ├─ UiController       → GET /ui/jobs, GET /ui/jobs/:id
  ├─ StreamController   → GET /stream/runs/:runId  (SSE)
  ├─ StreamService      → in-process pub/sub; agent service publishes chunks here
  └─ HermesAgentService → modified to pipe stdout through StreamService
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
│           ├── App.tsx          ← top-level router
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
│       ├── stream/             ← NEW NestJS module
│       │   ├── stream.module.ts
│       │   ├── stream.service.ts
│       │   └── stream.controller.ts
│       ├── agent/
│       │   ├── agent.service.ts   ← modified: injects StreamService
│       │   └── agent.utility.ts   ← modified: onChunk callback in spawnProcess
│       ├── app.module.ts          ← modified: imports UiModule, StreamModule
│       └── main.ts                ← modified: registers ServeStaticModule
└── docs/
    └── INTERFACE.md            ← this file
```

---

## 4. API extensions

### 4.1 New NestJS modules overview

| Module | File path | Responsibility |
|---|---|---|
| `UiModule` | `api/src/ui/` | REST endpoints the Preact app polls for data |
| `StreamModule` | `api/src/stream/` | SSE streaming of live agent stdout; in-process pub/sub |

Both modules follow the existing five-file module layout from `AGENTS.md`. Neither module has a `*.utility.ts` or `*.prompts.ts` file (no helpers or prompts needed).

### 4.2 `UiModule`

**`api/src/ui/ui.model.ts`** — response shape types

```typescript
import type { AgentPhase } from '../agent/agent.model.js';
import type { TaskKind, TaskStatus } from '../queue/queue.model.js';
import type { ReviewVerdict, IssueSeverity } from '../review/review.model.js';

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
  state: string;          // JobState union value
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
  status: string;         // AgentRunStatus
  exitCode: number | null;
  durationMs: number | null;
  hasOutput: boolean;     // true if stdout is non-empty in DB
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

| Method | Path | Response | Description |
|---|---|---|---|
| `GET` | `/ui/jobs` | `JobSummaryDto[]` | All jobs, sorted `updatedAt DESC`. Includes `activeRun` (any `AgentRun` with `status = 'RUNNING'`) and `activeTask` (any `QueueTask` with `status = 'RUNNING'`). |
| `GET` | `/ui/jobs/:id` | `JobDetailDto` | Full job record with all relations. Returns 404 if not found. |

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

### 4.3 `StreamModule`

#### `api/src/stream/stream.service.ts`

Singleton in-process pub/sub registry. The agent service publishes chunks; the SSE controller subscribes.

```typescript
import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

const BUFFER_LINES = 500; // circular buffer size per run

@Injectable()
export class StreamService {
  // Active run subjects — removed on complete()
  private readonly subjects = new Map<string, Subject<string>>();
  // Ring buffers — kept after completion so late SSE clients get history
  private readonly buffers = new Map<string, string[]>();

  /** Called by HermesAgentService before spawning the process. */
  register(runId: string): void {
    this.subjects.set(runId, new Subject<string>());
    this.buffers.set(runId, []);
  }

  /** Called for each stdout chunk received from the subprocess. */
  publish(runId: string, chunk: string): void {
    const subject = this.subjects.get(runId);
    const buffer = this.buffers.get(runId);
    if (!subject || !buffer) return;

    // Split on newlines to keep buffer lines readable; trailing partial line is fine.
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (buffer.length >= BUFFER_LINES) buffer.shift();
      buffer.push(line);
    }
    subject.next(chunk);
  }

  /** Called by HermesAgentService after the process exits. */
  complete(runId: string): void {
    const subject = this.subjects.get(runId);
    subject?.complete();
    this.subjects.delete(runId);
    // Buffer is intentionally kept so late SSE subscribers can replay it.
  }

  /** Returns an Observable that emits future chunks. Returns null if run is unknown. */
  observe(runId: string): Observable<string> | null {
    const subject = this.subjects.get(runId);
    return subject ? subject.asObservable() : null;
  }

  /** Returns buffered lines collected so far (or since completion). */
  getBuffer(runId: string): string[] {
    return this.buffers.get(runId) ?? [];
  }

  /** Returns true if the run is currently active (subject still open). */
  isActive(runId: string): boolean {
    return this.subjects.has(runId);
  }
}
```

#### `api/src/stream/stream.controller.ts`

```typescript
@Controller('stream')
export class StreamController {
  constructor(
    private readonly stream: StreamService,
    private readonly prisma: PrismaService,
  ) {}

  @Sse('runs/:runId')
  async streamRun(
    @Param('runId') runId: string,
    @Res() res: Response,
  ): Promise<Observable<MessageEvent>> { ... }
}
```

SSE event protocol (each `data` field is a JSON string):

```typescript
type StreamEvent =
  | { type: 'history'; lines: string[] }   // buffered lines to date
  | { type: 'chunk'; content: string }     // new live chunk
  | { type: 'done'; status: string; exitCode: number | null; durationMs: number | null }
  | { type: 'error'; message: string }     // run not found
```

**Behaviour:**
1. Look up the `AgentRun` row from Prisma.
2. If not found → emit `{ type: 'error', message: 'Run not found' }` and complete.
3. If run `status` is **not** `RUNNING` → emit `{ type: 'history', lines: (run.stdout ?? '').split('\n') }`, then `{ type: 'done', status, exitCode, durationMs }`, then complete.
4. If run is `RUNNING`:
   a. Emit `{ type: 'history', lines: streamService.getBuffer(runId) }`.
   b. Merge with `streamService.observe(runId)` — emit each chunk as `{ type: 'chunk', content }`.
   c. When the observable completes, re-fetch the `AgentRun` row and emit `{ type: 'done', ... }`.

**`api/src/stream/stream.module.ts`**

```typescript
@Module({
  imports: [PrismaModule],
  controllers: [StreamController],
  providers: [StreamService],
  exports: [StreamService],
})
export class StreamModule {}
```

### 4.4 Agent service modifications

**`api/src/agent/agent.utility.ts`** — add `onChunk` to spawn options

```typescript
export function spawnProcess(
  spec: SpawnSpec,
  opts: { cwd: string; timeoutMs: number; onChunk?: (chunk: string) => void },
): Promise<RawSpawnResult>
```

In the `child.stdout.on('data', ...)` handler, after appending to the `stdout` accumulator, call `opts.onChunk?.(d.toString())`.

**`api/src/agent/agent.service.ts`** — inject `StreamService`

1. Add `StreamService` to the constructor.
2. Before calling `spawnProcess`, call `this.stream.register(run.id)`.
3. Pass `onChunk: (chunk) => this.stream.publish(run.id, chunk)` in the spawn options.
4. After `spawnProcess` resolves (in the same `try/finally` if one exists, or immediately after), call `this.stream.complete(run.id)`.

`StreamModule` must be in `AgentModule`'s imports so `StreamService` can be injected.

### 4.5 `AppModule` changes

Add `UiModule` and `StreamModule` (via `StreamModule`'s export of `StreamService`) to the `imports` array in `app.module.ts`. `AgentModule` must also import `StreamModule`.

### 4.6 `main.ts` changes — static serving

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
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as express from 'express';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const distPath = join(__dirname, '..', '..', '..', 'app', 'dist');

// Serve built Astro assets; fall back to index.html for SPA routes.
app.use(express.static(distPath));
app.use((req, res, next) => {
  if (!req.path.startsWith('/ui') && !req.path.startsWith('/stream')
      && !req.path.startsWith('/webhooks') && !req.path.startsWith('/health')
      && !req.path.startsWith('/metrics')) {
    res.sendFile(join(distPath, 'index.html'));
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
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  output: 'static',
  integrations: [preact({ compat: false }), tailwind()],
  vite: {
    server: {
      proxy: {
        '/ui': 'http://localhost:3030',
        '/stream': 'http://localhost:3030',
      },
    },
  },
});
```

The Vite proxy forwards API and SSE requests to the NestJS server during `astro dev`. In production both are same-origin.

### 5.3 `tailwind.config.mjs`

```javascript
export default {
  content: ['./src/**/*.{astro,tsx,ts}'],
  theme: {
    extend: {
      fontFamily: { mono: ['JetBrains Mono', 'ui-monospace', 'monospace'] },
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

| Path pattern | Rendered component |
|---|---|
| `/` | `<JobList />` |
| `/jobs/:id` | `<JobDetail id={id} />` |
| `/jobs/:id/runs/:runId` | `<RunOutput jobId={id} runId={runId} />` |

```typescript
function useRoute(): { path: string } {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const handler = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);
  return { path };
}

export function navigate(to: string): void {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
```

`App.tsx` parses the path with a small regex-based match function and renders the appropriate component. Export `navigate` from this file; other components import it for link navigation.

### 6.2 `StateBadge.tsx`

Renders a coloured pill for a `JobState` string.

| State | Tailwind classes |
|---|---|
| `TRIAGED` | `bg-zinc-700 text-zinc-200` |
| `PLANNING` | `bg-blue-900 text-blue-200` |
| `AWAITING_PLAN_APPROVAL` | `bg-amber-900 text-amber-200` |
| `IMPLEMENTING` | `bg-indigo-900 text-indigo-200` |
| `SELF_REVIEWING` | `bg-violet-900 text-violet-200` |
| `REVISING` | `bg-orange-900 text-orange-200` |
| `OPENING_PR` | `bg-sky-900 text-sky-200` |
| `AWAITING_PR_APPROVAL` | `bg-amber-900 text-amber-200` |
| `DONE` | `bg-green-900 text-green-200` |
| `FAILED` | `bg-red-900 text-red-200` |
| `CANCELLED` | `bg-zinc-700 text-zinc-400` |

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

This is the most complex component. It streams agent stdout in real time.

**On mount:**
1. Fetch `GET /ui/jobs/:jobId` to get the run metadata (phase, model, status) — or alternatively make a dedicated run summary endpoint if preferred (see note below).
2. Open `new EventSource('/stream/runs/' + runId)`.
3. On `message` event: parse the JSON payload and handle:
   - `{ type: 'history', lines }` → set `lines` state to the array
   - `{ type: 'chunk', content }` → append `content` to the raw output string
   - `{ type: 'done', status, exitCode, durationMs }` → update header, close `EventSource`
   - `{ type: 'error', message }` → show error, close `EventSource`
4. On SSE `error` event: if `eventSource.readyState === EventSource.CLOSED`, show "Stream ended" message.
5. Close `EventSource` on component unmount.

> **Note:** Rather than a full job fetch for run metadata, it is acceptable to include `GET /ui/runs/:runId` as an additional endpoint in `UiController` that returns `{ id, phase, model, status, exitCode, durationMs, jobId, createdAt }`. This keeps the RunOutput component self-contained. The implementing agent should add this endpoint if it makes the component cleaner.

**Layout:**
- Back link: `← Job detail` → `navigate('/jobs/' + jobId)`
- Header bar: phase badge, model name, status indicator, duration (updates live on `done` event)
- **Terminal pane**: dark background (`bg-black`), `font-mono text-sm text-green-400`, `overflow-y-auto`, full remaining viewport height.
  - Content is the accumulated raw output string rendered inside a `<pre>`.
  - Auto-scrolls to the bottom when new chunks arrive (only if the user hasn't manually scrolled up — use a "pinned to bottom" flag: if `scrollTop + clientHeight >= scrollHeight - 50`, keep scrolling).
- Copy button in the top-right corner of the terminal pane: copies full output to clipboard using `navigator.clipboard.writeText`.
- "Scroll to bottom" floating button appears when the user has scrolled up; clicking re-pins the scroll.

---

## 7. Data flow summary

```
GitHub review submitted
  → NestJS: pull_request_review webhook
  → OrchestratorService.onPullRequestReview()
  → jobs.transition(IMPLEMENTING)
  → queue.enqueue(IMPLEMENT)

WorkerService.tick()
  → queue.claimBatch()
  → orchestrator.processTask(IMPLEMENT)
  → HermesAgentService.run(...)
      │
      ├─ streamService.register(runId)
      ├─ spawnProcess(spec, { onChunk: chunk => streamService.publish(runId, chunk) })
      │     └─ child.stdout.on('data') → calls onChunk → streamService.publish()
      │         └─ StreamService.publish() → updates ring buffer, next() on Subject
      │                                       ↑
      │             StreamController.streamRun() ──── subscribed via EventSource ─── browser
      │
      └─ streamService.complete(runId)

browser (RunOutput.tsx)
  EventSource('/stream/runs/:runId')
  ← { type: 'history', lines: [...] }   (buffered lines so far)
  ← { type: 'chunk', content: '...' }   (live as agent writes)
  ← { type: 'done', status: 'SUCCEEDED', exitCode: 0, durationMs: 87432 }
```

---

## 8. State polling strategy

| View | Endpoint | Interval | Notes |
|---|---|---|---|
| Job list | `GET /ui/jobs` | 3 000 ms | Entire list replaced each poll |
| Job detail | `GET /ui/jobs/:id` | 2 000 ms | Stopped if `state` is terminal (`DONE`, `FAILED`, `CANCELLED`) |
| Run output | SSE | — | No polling; driven by SSE events |

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

No new environment variables are required. The UI reads data from the same NestJS process using relative paths. The `PORT` variable (default `3030`) already controls the listening port.

The Astro app has no environment variables of its own in production — all API calls are relative paths (same origin).

---

## 11. Security considerations

- All `/ui/*` and `/stream/*` endpoints are **unauthenticated** by design. The UI is intended for local/trusted-network use only. If the NestJS server is exposed publicly (e.g. via Tailscale Funnel), consider adding a middleware guard to these routes that checks `req.ip` or a bearer token.
- SSE connections are long-lived. The `StreamController` must handle client disconnects cleanly: subscribe to `req.on('close', ...)` or use NestJS's `@Res()` lifecycle to call `streamService.unsubscribe` (if implemented) and avoid memory leaks from orphaned Subject subscriptions.
- The `AgentRun.stdout` column is already capped at `STDOUT_CAP = 200_000` bytes in the existing agent service. The SSE buffer (`BUFFER_LINES = 500`) is a separate in-memory cap for the live stream — it doesn't bypass the DB cap.

---

## 12. Implementation checklist

For an agent building from this document, the recommended order of implementation is:

1. **`api/src/stream/`** — `StreamService` (no dependencies), `StreamModule`, `StreamController`.
2. **`api/src/agent/agent.utility.ts`** — add `onChunk` to `spawnProcess` options.
3. **`api/src/agent/agent.service.ts`** — inject `StreamService`, wire `register`/`publish`/`complete`.
4. **`api/src/ui/`** — `UiModule`, `UiController`, `UiModel`.
5. **`api/src/app.module.ts`** — import `UiModule`, `StreamModule`.
6. **`api/main.ts`** (or `app.module.ts`) — add `ServeStaticModule` + SPA fallback middleware.
7. **`app/`** — scaffold Astro project (`npm create astro@latest`), install integrations.
8. **`app/src/components/StateBadge.tsx`** — simplest component, no data dependency.
9. **`app/src/components/App.tsx`** — router shell.
10. **`app/src/components/JobList.tsx`** + **`JobCard.tsx`** — main dashboard.
11. **`app/src/components/JobDetail.tsx`** + sub-components (`Timeline`, `ReviewPassCard`, `PlanViewer`, `AgentRunRow`, `ConfidenceGauge`).
12. **`app/src/components/RunOutput.tsx`** — SSE consumer, last because it depends on `StreamController` being ready.
13. **End-to-end test**: label a GitHub issue, watch the job appear on the dashboard, click through to a run, observe live stdout.
