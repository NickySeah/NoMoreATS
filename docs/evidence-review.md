# Pre-generation evidence review

New tailoring starts with **Analyze job requirements**, a separate user-initiated paid OpenRouter request. It compares the job against all saved factual evidence, including accumulated notes, and asks up to eight focused questions about missing or unclear qualifications. It does not generate resume text or save model-written claims.

For each question, choose relevant experience, no experience, or skip. Positive answers must describe your personal contribution and tools and must be explicitly assigned to an existing experience, project, or skill category. **Save confirmed answers** appends your factual plain-text answer to that entry's notes; previous notes and accomplishments remain intact. The app does not independently verify the truth of user answers. Do not attach achievements to an entry where they did not happen. Create missing entries in My profile first; new roles/projects still require an updated LaTeX template if they need new layout slots.

No-experience and skipped responses save no positive evidence. They are not permanent global denials: a later job may ask about a requirement again. Positive notes persist in the workspace and are included in subsequent analyses, with the model instructed not to repeat already answered questions. Generating is a separate action after review/save, including when no questions are returned. Existing-resume linking remains available without a paid analysis.

## Contracts and safeguards

- `POST /api/evidence/analyze` accepts `{ job }`; returns a validated summary, quoted questions, existing groups, and an opaque `reviewId`.
- `POST /api/evidence/save` accepts `{ reviewId, job, answers }`; returns the persisted profile and positive-answer count. Every question is resolved exactly once. Unknown groups/questions, raw LaTeX, model edits, extra payload fields and malformed answers are rejected atomically.
- Analysis uses the same privacy provider flags as generation: structured parameters required; privacy mode adds `data_collection: deny` and `zdr: true`. Contact details and API credentials are not included in the analysis data payload.
- Confirmed notes keep existing role/project evidence IDs and groups. Skill notes use `skills.<id>.notes` with group `skills.<id>`. Existing same-group tailoring restrictions continue to apply.
- Reviews are bound to the exact normalized job, current profile content, and template identity/hash. They expire after 30 minutes, are bounded in memory, and are lost on backend restart. Saved positive facts are durable. Changed input requires another explicit analysis; retrying the identical save does not append duplicate notes.
- The UI supplies `reviewId` to generation, which rejects stale or unreviewed sessions before a paid generation call. The legacy direct tailoring API remains compatible without a review ID.

## Verification (no paid model calls)

```sh
npm test
npm run build
node scripts/evidence-ui-smoke.mjs
UI_BASE_URL=https://nickyserver.tailb84a0e.ts.net node scripts/evidence-ui-smoke.mjs
```

Vitest uses isolated stores, mock provider responses and a fixture compiler. The Playwright smoke test uses the running application but intercepts analysis, saving and generation; it never writes fixture evidence to the live backend or makes paid OpenRouter calls. It covers desktop/mobile review, retry, positive/no/skip responses, explicit save, profile synchronization, generation gating/error, navigation, no questions and missing-key setup. Screenshots are saved under the configured scratch directory via `TMPDIR`.
