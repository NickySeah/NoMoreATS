# NoMoreATS Implementation Plan

> For agentic workers: implement independent boundaries in parallel, with meaningful test-first checks and a final independent review.

**Goal:** A working local React resume tailoring app preserving Nicholas's existing LaTeX format.

**Architecture:** Typed client/server contract. Deterministic text-slot renderer. Persistent local backend coordinating OpenRouter, PDF compilation, and application history.

**Tech stack:** React, Vite, TypeScript, Express, Zod, Vitest, local pdflatex.

**Spec:** ../specs/2026-10-08-nomoreats-design.md

## Global constraints

- Preserve all LaTeX outside approved text slots byte-for-byte.
- Keep keys and runtime personal data out of Git and API responses.
- Bind to loopback; reject nonlocal requests and cross-origin writes.
- Every generated artifact retains its own template and profile snapshot.

## Review focus

- A malformed or instruction-bearing job description cannot alter trusted template commands.
- Invalid model IDs/evidence references produce actionable errors without persisted fake success.
- Browser refresh or restart preserves edited profile and linked applications.
- Unicode, `%`, `&`, and backslashes render safely with unchanged formatting commands.
- A reused resume retains the original file and links multiple job descriptions.

## Task 1: Template and evidence foundation

Files: shared/types.ts; server/template.ts; server/seed.ts; templates/nicholas.tex; tests/template.test.ts.
Produces: `extractTemplate(source,name): ResumeTemplate`, `renderTemplate(template,edits): string`, `seedProfile`, `getEvidence(profile): Evidence[]`.

- [x] Pin public types and copy original source.
- [x] Write and run failing tests for text-only edits, literal escaping, invalid slots, unsafe templates and evidence extraction.
- [x] Implement extractor, immutable renderer and seed.
- [x] Verify source matches original and all foundation tests pass.

## Task 2: Persistent orchestration backend

Files: server/store.ts, server/ai.ts, server/pdf.ts, server/app.ts, server/index.ts; tests/backend.test.ts and tests/ai.test.ts.
Consumes shared types and foundation. Produces documented `/api` endpoints consumed by client.

- [x] Write failing behavior tests for restart persistence, credential redaction, invalid AI edits and reuse associations.
- [x] Implement atomic store and API validation.
- [x] Implement OpenRouter structured output and candidate validation, trusted rendering and bounded PDF compilation.
- [x] Verify provider requests using a local fake provider, without spending API credits.

## Task 3: React workspace

Files: src/App.tsx, src/api.ts, src/components/*, src/styles.css.
Consumes `/api/state`, profile/settings/template/tailor/jobs/resumes endpoints.

- [x] Implement concept tokens, sidebar, library and overview.
- [x] Implement autosaved structured profile, template import and provider settings.
- [x] Implement tailoring, saved details, downloads, reuse and application status.
- [x] Check loading/error/empty states, keyboard use, mobile layout and refresh persistence in browser.

## Task 4: Research skill and handoff

Files: skills/resume-tailor/SKILL.md, docs/ats-research.md, README.md.

- [x] Cite ATS vendor and OpenRouter primary sources and incorporate truthful contextual wording in skill.
- [x] Validate skill and run an independent behavior fixture.
- [x] Run typecheck, full tests, production build and real PDF compilation.
- [x] Independent code review; fix material findings and rerun affected checks.
- [x] Open running local app and report setup, validation and live-key limitation.

