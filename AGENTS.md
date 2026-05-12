<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.

<!--VITE PLUS END-->

# Project Notes

## Maintaining This File

- Keep this file updated when making important project-wide decisions about structure, naming, styling, state, data access, validation, deployment, or tooling.
- Do not document one-off implementation details here; only record conventions that future work should follow.

## Product Direction

Build a mobile-first PWA for tracking gym exercises, workout templates, active workout sessions, set history, and rest timers.

The product should feel fast, practical, and reliable during a workout. The preferred UX direction is a local-first training log that works well on a phone in a gym, including when the connection is weak or unavailable.

MVP scope:

- Let users create, edit, and delete exercises.
- Let users organize exercises by muscle group, equipment, and optional notes.
- Let users create workout templates such as Push, Pull, Legs, Upper, Lower, or Full Body.
- Let users start an active workout from a template or from an empty session.
- Let users log sets with reps, weight, completion state, and optional notes.
- Let users start a rest timer after completing a set.
- Let users adjust rest duration quickly during a workout.
- Let users finish a workout and save it to local history.
- Show recent performance for an exercise during logging where useful.
- Support offline-first usage through browser storage.
- Keep the first version account-free unless sync becomes a product requirement.

Technical direction:

- Planned stack is Vite+ + React + TypeScript, PandaCSS, Radix UI, Lucide React, `clsx`, Dexie.js, and `vite-plugin-pwa`.
- Use IndexedDB through Dexie.js as the local source of truth for exercises, workout templates, workout sessions, settings, and active workout persistence.
- Use React state and custom hooks for local UI state.
- Use Radix UI primitives for behavior-heavy accessible components such as dialogs, alert dialogs, popovers, menus, tabs, selects, and tooltips; keep simple controls as native HTML when Radix does not add meaningful behavior.
- Do not introduce a backend for the MVP unless multi-device sync, accounts, or remote backups become explicit requirements.
- Deploy the static PWA with Docker on a VPS using Dokploy.
- Keep the Dockerfile runtime stage named `production` so Dokploy can target that build stage.
- The domain is managed through Cloudflare.

## UX Principles

- Design mobile-first. Assume the primary and possibly only device is a phone.
- Prioritise speed during workouts over decorative UI.
- Make common workout actions reachable with one thumb.
- Minimise typing during active workouts.
- Use clear large touch targets for set completion, timer controls, and navigation.
- Avoid visual clutter around primary actions.
- Keep active workout screens glanceable: exercise name, current set, previous set data, weight, reps, and timer should be easy to read quickly.
- Make destructive actions reversible or confirmed, especially deleting sessions, templates, or exercises.
- Respect reduced-motion preferences. Animation should clarify state changes, not delay logging.
- The app should remain usable offline after installation or after the first successful load.
- Timer completion should use vibration and/or notifications only where supported and only after appropriate user permission or user gesture.

## Naming

- Use lowercase kebab-case for source file and folder names under `src`.
- Keep React component exports in PascalCase so JSX can render them normally.
- Prefer arrow functions assigned to `const` wherever the framework does not require a function declaration.
- Prefer named exports over default exports wherever the framework does not require a default export.
- Use required framework/tooling filenames as-is when a tool expects them, such as `AGENTS.md`, `README.md`, `Dockerfile`, or config files.

## Documentation

- Add TSDoc comments to utility functions, including utility functions defined inside components.
- Add a one-line TSDoc summary to each type and interface.
- Add a one-line TSDoc comment to each property in each type or interface.
- Add inline comments for complex logic or major function sections only when they improve readability.

## Structure

- Use a feature-first structure around gym tracking workflows.
- Keep app-level wiring under `src/app/`.
- Keep `src/main.tsx` as the React entry point.
- Add routing only when the app has multiple persistent screens. If routing is added, keep route definitions under `src/app/`.
- Put exercise-specific UI, state, helpers, and tests under `src/features/exercises/`.
- Put workout template UI, state, helpers, and tests under `src/features/workouts/`.
- Put active session UI, state, helpers, and tests under `src/features/sessions/`.
- Put rest timer UI, state, helpers, and tests under `src/features/timer/`.
- Put app settings, preferences, and local data management UI under `src/features/settings/`.
- Put database schema, Dexie setup, repositories, and migrations under `src/db/`.
- Use Dexie with typed string IDs and ISO timestamp strings for local-first persisted records.
- Keep IndexedDB schema changes versioned in `src/db/database.ts`; add migrations instead of mutating existing schema versions once data may exist.
- Access persisted data through typed repositories instead of using Dexie tables directly from UI components.
- Put locale configuration, message dictionaries, and lightweight i18n helpers under `src/i18n/`.
- Put shared reusable UI under `src/components/` only when it is genuinely useful across multiple features.
- Put shared types under the relevant feature first; promote to `src/types/` only when used across unrelated features.
- Put static icons, illustrations, and PWA assets under `src/assets/`.
- Use the `@/` import alias for shared or cross-feature imports from `src`.
- Add entry points with `index.ts` when they make imports cleaner, such as `@/app`, `@/db`, or `@/features/sessions`.

## Styling

- Use PandaCSS for app and component styling.
- Use the app color identity of charcoal black backgrounds, elevated graphite surfaces, and electric lime accents.
- Prefer semantic color tokens such as `bg`, `card`, `fg`, `fgMuted`, `accent`, and `line` in component styles instead of raw hex values.
- Use logical CSS properties for layout, spacing, sizing, borders, radii, scrolling, and positioning. Prefer `inlineSize`, `blockSize`, `minBlockSize`, `paddingInline`, `paddingBlock`, `marginInline`, `marginBlock`, `insetInlineStart`, `borderInline`, and `borderStartStartRadius` over physical properties or shorthand aliases such as `width`, `height`, `minH`, `m`, `mx`, `px`, `pl`, `left`, and `right`.
- Put component styles in a `{component-file-name}.styles.ts` file next to the component when the styles are component-specific, such as `app.styles.ts` for `app.tsx`.
- Import `css` and `cva` from `styled-system/css`.
- Export a named `styles` constant; use `css({})` directly for single-class components or a `styles` object of `css({})` classes for multi-part components.
- Use `cva({})` for components with variants, sizes, or visual states that should be selected from props.
- Keep global CSS limited to the Panda layer entry and true app-wide base styles.

## Internationalisation

- Keep user-visible copy in locale message files under `src/i18n/messages/`, not inline in components or feature logic.
- Use stable nested message keys grouped by app area or feature, such as `app.title` or `sessions.finishWorkout`.
- Keep the default locale and supported locale metadata in `src/i18n/locales.ts`.
- Set document `lang` and `dir` from locale metadata when wiring the app.
- Avoid splitting translated sentences across components or concatenating copy from multiple message keys.
