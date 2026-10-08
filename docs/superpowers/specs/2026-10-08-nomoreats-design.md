# NoMoreATS design

Build a personal React workspace for Nicholas to save career evidence, paste job descriptions, tailor resume text with OpenRouter, and keep an application-linked resume library. This implements the user's supplied brief. Default to a local single-user app while the optional cross-device account clarification is pending.

## Architecture and storage

React + Vite + TypeScript client, Express TypeScript backend bound to 127.0.0.1. JSON data is versioned and saved atomically under ignored `data/`; persistence survives browser and server restarts. API keys stay on the backend, saved only when the user supplies one in Settings, and are never returned in API state. OpenRouter model IDs are configurable and can be selected from its live model catalog. No paid API call occurs without a key and a user generation action.

## User surfaces

Overview and resume library show the imported original and generated versions, their linked roles/companies, timestamps, and PDF/LaTeX downloads. My profile edits contact details, work, projects, education, skills, certifications, and extra career evidence. Changes autosave with explicit saving/error states. A tailoring dialog takes company, role, job URL, description, and optional instructions. Resume detail shows the generated PDF, requirement coverage, gaps, evidence behind edits, and linked jobs. Template screen imports a local `.tex` path or uploaded source and explains exactly which text slots may change. Settings manages the OpenRouter model/key. Application status is editable.

## Format invariant

Copy NicholasResume/main.tex, without changing NicholasResume. Extract only approved prose spans inside resumeitemize bullets and Technologies values. Keep all bytes outside approved spans unchanged, including LaTeX commands, emphasis wrappers, structure, fonts, margins, headings, dates, employers and URLs. Profile facts must remain consistent with frozen identity fields; expose a clear warning and require reimporting an updated template when those fixed facts change. A template version and source snapshot travel with every resume. Unsupported/unsafe template syntax is rejected before compilation. Escape plain text deterministically. Never execute model-generated LaTeX.

## AI and ATS

Load repository `skills/resume-tailor/SKILL.md` as the runtime instruction. Send selected profile evidence, editable slot specifications, pasted job description, and compatible prior resumes to OpenRouter. Require validated JSON containing edits with evidence references, requirements with source quotes, gaps, explanation, and an optional reuse suggestion. Reject invalid IDs, malformed or excessive content and unknown evidence. Treat job descriptions and profile notes as untrusted data. Match supported terms naturally; never fabricate experience, keywords, metrics or ATS ranking guarantees. Show coverage as an application analysis, never a universal ATS score.

Reuse suggestions are advisory. An existing resume must have the same template version; selecting reuse links a new saved job to the original immutable artifact. Generating a new version creates a separate immutable resume with the profile and job snapshots. Missing keys and provider/validation errors are visible and never create fake successful resumes.

## PDF and validation

Compile with local pdflatex, no shell escape, timeout, and a dedicated generated directory. Download `.tex` even if PDF compilation is unavailable; surface the exact PDF limitation. Inspect page count and overfull boxes, flag or reject overflow without adjusting format. Test format preservation, escaping, model response validation, persistence, jobs/reuse, secret handling, and provider failure branches. Run build/typecheck and desktop/mobile browser interaction checks. Live OpenRouter generation remains dependent on the user's API key.
