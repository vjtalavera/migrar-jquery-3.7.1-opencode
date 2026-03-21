# AGENTS.md

## Purpose
This repository is a frontend tool for scanning legacy jQuery code and
suggesting migration steps toward jQuery 3.7.1 and jQuery 3.0.0.

Agents should optimize for safe migration guidance, strict TypeScript, and
readable code over clever abstractions.

## Current Stack
- Vite 5
- React 18
- TypeScript 5
- Acorn for parsing and syntax validation
- Plain CSS in `src/index.css` and `src/App.css`

## Repository Layout
- `src/main.tsx`: React bootstrap and root render.
- `src/App.tsx`: main UI, target-version selector, state, and event handlers.
- `src/analyzer.ts`: scan logic, summaries, file analysis, exported types, target-version filtering.
- `src/dependencyLayout.ts`: recursive include/script discovery and per-node analysis.
- `src/rules.ts`: migration rule catalog, regexes, suggestion builders, target-version rule selection.
- `src/index.css`: global resets and base layout.
- `src/App.css`: feature-specific styling.
- `dist/`: generated output; do not edit manually.

## Commands
```bash
npm install
npm run dev
npm run build
npm run preview
npx tsc --noEmit
```

## Build, Lint, And Test Status
- `npm run build` is the main existing verification command.
- `npx tsc --noEmit` is a lighter type-only check.
- `npm run lint` is not defined in `package.json`.
- `npm test` is not defined in `package.json`.
- There are no repository test files today.
- There is no current single-test command because no test runner is configured.

## Single Test Guidance
- Current state: not available.
- Do not claim a single test was run unless you first add a test runner.
- If the user asks to add tests, the least disruptive future setup is probably
  Vitest plus React Testing Library, but that would be a new repo decision.
- If test tooling is added later, document exact single-file and single-case
  commands here.

## Tooling Constraints From TypeScript Config
- `strict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noFallthroughCasesInSwitch: true`
- `jsx: react-jsx`
- `moduleResolution: bundler`
- `noEmit: true`

Practical consequence: avoid dead code, unused placeholders, implicit `any`,
and loose typing shortcuts that only work in less strict projects.

## Import Conventions
- Use ES module imports only.
- Put external imports first.
- Put local module imports next.
- Put CSS side-effect imports last.
- Prefer named imports for React hooks.
- Prefer named exports in utility modules.
- Keep default exports for top-level React components only when the file already
  follows that pattern, such as `src/App.tsx`.

## Formatting Conventions
- Use 2-space indentation.
- Use single quotes in TS and TSX.
- Use trailing commas in multiline objects and arrays.
- Source files mostly use semicolons; preserve the local style of a mixed file.
- Keep helpers and JSX blocks spaced for readability.
- Favor one logical concern per helper.

## Naming Conventions
- `PascalCase` for components, interfaces, and exported result types.
- `camelCase` for functions, variables, and local helpers.
- `UPPER_SNAKE_CASE` for module-level constants.
- Lowercase string unions for statuses and modes.
- Boolean names should usually start with `is`, `has`, or `should`.
- UI event handlers should usually start with `handle`.
- CSS classes should stay kebab-case.

## TypeScript Style
- Prefer `interface` for exported object shapes.
- Prefer `type` for unions and small aliases.
- Add explicit return types to exported functions.
- Add explicit return types to non-trivial helpers when it helps clarity.
- Avoid `any`; prefer `unknown` and narrow it.
- Model nullable state explicitly, for example `MigrationResult | null`.
- Non-null assertions are acceptable only when a DOM invariant is guaranteed,
  such as the root element lookup in `src/main.tsx`.

## Control Flow And Error Handling
- Prefer guard clauses and early returns.
- Use `switch` for finite statuses when it reads better than chained `if`s.
- Narrow caught errors with `instanceof Error` before reading `.message`.
- Use `try/finally` when setting and clearing loading state around async work.
- Avoid swallowing failures silently.
- If a migration fix is not safe in isolation, mark it contextual or manual.

## React And UI Patterns
- This codebase uses function components and hooks.
- Keep state local unless reuse clearly justifies extraction.
- Inline prop typing is acceptable for very small local components.
- Prefer straightforward conditional rendering with `&&` and ternaries.
- Keep user-facing copy in Spanish unless the task explicitly changes product
  copy or localization strategy.
- Preserve the current analyzer-first flow: input, analyze action, then results.
- In folder mode, keep on-demand analysis per selected file (no forced full scan).
- Preserve the two-column recursive panel behavior:
  - left column: base-file issues,
  - right column: recursive include/script tree with expandable node issues.
- Keep the target-version selector visible and explicit in analysis results.

## Analyzer And Rule Authoring
- Keep analyzer helpers pure when possible.
- Centralize migration rule metadata in `src/rules.ts`.
- New rules should include id, severity, source info, version, fix type,
  regex pattern, and suggestion builder.
- Link new rules to official jQuery API docs, upgrade guides, or release notes.
- Prefer reusable rule factories when many rules share structure.
- When scanning with global regexes, guard against zero-length matches.
- Use `requiresContext: true` when a transform is unsafe as a standalone edit.
- Reuse the Acorn-based validation flow instead of inventing a second parser.
- The analyzer scans only jQuery instructions that start with `$jq`, `$`,
  `JQuery`, or `jQuery`.
- The analyzer must support more than one jQuery instruction in the same line.
- Keep alias-agnostic detection in `src/analyzer.ts` (normalize alias to a
  canonical form for matching, then restore original alias for reported matches
  and suggested output).
- Avoid rule-by-rule alias duplication in `src/rules.ts`; prefer analyzer-level
  normalization when adding support for new jQuery aliases.
- For deprecated selector pseudos (`:first`, `:last`, `:eq`, `:gt`, `:lt`,
  `:even`, `:odd`), prefer deterministic chain rewrites over dropping tokens.
- Only expose `suggestedLine` when the rewritten line is actually different from
  the original detected segment.
- Keep version-aware filtering centralized in analyzer/rules integration.
- Supported target versions today are `3.0.0` and `3.7.1`.
- The default target version is `3.7.1` for backward compatibility.
- Rules whose `sinceVersion` is above the selected target version must not run.

## Recursive Include Layout
- Keep recursive dependency extraction in `src/dependencyLayout.ts`.
- Supported recursive sources:
  - JSP includes: `<jsp:include ... file|page=...>`.
  - JSP directives: `<%@ include ... file|page=...>` and `<%@:include ...>`.
  - Script sources: `<script ... src=...>`.
  - Inline scripts: `<script>...</script>` without `src`.
- Preserve `referenceLine` for include/script origin in parent files.
- Preserve inline-script line offsets so issue line numbers match the original file.
- In the recursive tree UI, keep nodes sorted by `referenceLine` ascending.

## CSS And Styling
- Keep the current visual language unless the task is explicitly a redesign.
- The existing UI uses a dark blue palette, rounded cards, pill metadata, and
  high-contrast code panels.
- Put global resets and app-wide layout in `src/index.css`.
- Put feature-specific styles in `src/App.css` unless a new component justifies
  its own stylesheet.
- Preserve mobile behavior with media queries when changing layout.
- Do not add a heavy design-system dependency for small UI tweaks.

## Files To Avoid Editing Without Need
- `dist/**` because it is generated.
- `node_modules/**` because it is dependency code.
- `package-lock.json` unless dependency changes are intentional.

## Cursor And Copilot Rule Audit
No repo-specific instruction files were present when this file was written:
- `.cursorrules`
- `.cursor/rules/`
- `.github/copilot-instructions.md`

If any of those files are added later, fold their repository-specific guidance
into this document and follow the more specific rule when conflicts arise.

## Working Norms For Agents
- Edit source under `src/` unless the task requires config changes.
- Do not edit generated `dist/` output unless the user explicitly asks.
- Run `npm run build` after meaningful code changes.
- Mention that lint and automated tests are not configured when relevant.
- Do not invent unsupported commands in status reports.
- If you introduce new tooling, document the new commands in this file.

## Skills disponibles
- `SKILL-jquery-migration-maintainer.md`: usar para cambios generales del proyecto.
- Si en el futuro hay mas de un skill aplicable, usar todos los necesarios; en
  conflicto, prevalece `AGENTS.md`.
