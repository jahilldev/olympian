# Project conventions

Guidance for any agent (human or AI) contributing to this repository. Keep changes aligned with the rules below — drift here causes the codebase to lose its predictability faster than any other category of issue.

## Module file layout

Every NestJS module under `api/src/<module>/` uses a fixed five-file shape. A module may have a subset of these files (only what it needs), but it must NEVER have more than ONE file of each type:

| File | Contains |
| --- | --- |
| `<module>.module.ts` | NestJS root module definition (imports, providers, controllers). |
| `<module>.service.ts` | The module's service class. ONE service per module. |
| `<module>.utility.ts` | Pure utility functions used by the service or its callers. |
| `<module>.prompts.ts` | LLM prompt strings and prompt builders. |
| `<module>.model.ts` | Types, interfaces, enums, and constants. |
| `<module>.controller.ts` | (When the module exposes HTTP routes.) |

Each file must contain ONLY code that fits its slot:

- **`*.service.ts`** — only the `@Injectable()` service class. No module-internal helpers, no top-level constants other than what's strictly needed inside the class. If a helper grew at the bottom of a service file, move it to `<module>.utility.ts`.
- **`*.utility.ts`** — only `function` declarations (exported or internal). No types, no constants. Constants used by the utilities live in `<module>.model.ts`.
- **`*.prompts.ts`** — only prompt strings and prompt-builder functions. No business logic, no parsing.
- **`*.model.ts`** — only `type`, `interface`, `enum`, and `const` declarations. No functions, no logic.
- **`*.module.ts`** — only `@Module({...})` registration. Wiring only.
- **`*.controller.ts`** — only `@Controller()` route handlers. Constants used by the controller live in `<module>.model.ts`.

When a service grows past ~600 lines, prefer extracting helpers to `<module>.utility.ts` over splitting the service. There is exactly one service class per module.

## Other conventions

- **Function parameters: max 3.** A function with 4+ parameters must collapse them into an `{ ... }` options object. Enforced by ESLint (`no-restricted-syntax`).
- **Comments are for the WHY, not the WHAT.** Default to writing no comments. Add one only when removing it would confuse a future reader (a hidden constraint, a subtle invariant, a workaround for a specific bug). Don't reference the current task, fix, or callers — those rot fast.
- **Tests live alongside the code.** `<module>.service.ts` → `<module>.service.spec.ts` in the same directory. Vitest is the runner.
- **Never skip git hooks** (`--no-verify`, `--no-gpg-sign`, etc.) unless the user explicitly asks. If a hook fails, fix the underlying issue.
