# NoMoreATS

A local React workspace that tailors Nicholas's resume to job descriptions using OpenRouter, while preserving the supplied LaTeX format.

## Run with Docker

```sh
docker compose up -d --build --wait
```

Open **http://127.0.0.1:3001**. Node, LaTeX, and PDF tools are included; workspace data persists in a Docker volume. See [Docker setup and backup guidance](docs/docker.md). This remains a local-only personal app, not a public hosted service.

For automatic code updates, use the [separate Docker hot-reload setup](docs/docker-development.md).

## Run

Requires Node.js 22.12 or later and npm. PDF generation needs `pdflatex` on PATH (MiKTeX or TeX Live); `pdftotext` is optional for a text-extraction check. The tools are already available on this computer.

```powershell
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs at http://127.0.0.1:3001. Both bind to this computer only.

For a production build on this computer:

```powershell
npm run build
npm start
```

Then open http://127.0.0.1:3001. `npm run typecheck` and `npm test` run the checks.

## Start tailoring

1. Review **My profile**, which opens on Experience. It starts with the facts from `NicholasResume/main.tex`. Your profile can be longer than one page: add all verified accomplishments and additional factual context to the relevant experience/project's notes so the AI can select the strongest evidence for each job. Edits autosave after a brief pause; the status shows failures and offers Retry.
2. Review **LaTeX template**. The imported original is copied into this project; the NicholasResume directory is never modified. You can reimport `C:\Users\nicho\codingRelated\NicholasResume\main.tex` or upload a supported `.tex` file.
3. In **Settings**, save your OpenRouter key and select a model from its live catalog, or enter an exact model ID. No model or key is supplied by the project. The catalog filters for structured-output support; routing enforces it again.
4. Choose **Tailor a resume** and paste the company, role, full description, and optional preferences. Generation sends career evidence and job text to OpenRouter and its selected provider; it does not send contact details. Each paid request is initiated by your action.
5. Review **Job match & gaps**, which opens for tailored resumes and pinpoints relevant facts, distinguishing full from partial matches. Then review the PDF and edits. A generated resume is saved only after its PDF is verified as exactly one page with no overfull boxes. An overflowing draft gets one additional AI request for a shorter revision; if that still fails, the app rejects it without saving a resume or application. Missing or failed PDF compilation also blocks saving. PDF and `.tex` downloads are available for saved resumes.
6. Review reuse suggestions, or select **Use for a job** on an existing resume. Multiple applications can share one immutable version. The library keeps each description and application status.

To refine a saved resume, select **Improve with AI questions** in its **Job match & gaps**. The AI asks focused questions tied to the posting and suggests where each answer belongs. You can change the experience/project attribution, leave questions blank, and answer honestly when you lack a qualification. **Save answers & generate** appends your exact answers to the selected profile notes, then makes a new model request using the job, current evidence, and conversation. General answers go to Additional evidence. Question wording is never saved as an accomplishment.

Repeat from the resulting resume to add further detail. Each successful revision keeps the same application and status, links its earlier resume versions, and passes the existing one-page check. Saved answers remain available if generation fails; **Retry resume generation** does not append them again. Pending questions and saved rounds persist locally. A question request and each generation are separate paid model calls; blank answers are skipped.

## Data and credentials

This version is a personal app on one computer. It does not implement cloud accounts or cross-device login. Reopening it restores your saved workspace automatically.

`data/workspace.json` contains the profile, template versions, resume snapshots, analyses, linked applications, and follow-up questions/answers. PDF/LaTeX artifacts live under `data/artifacts/`. Writes are serialized and use a temporary file plus rename. If the workspace is corrupt, startup preserves the file and reports an error.

An explicit **Save key** action stores the key as plain text in `data/secrets.json`, on the backend. It is never returned in app state or exports. These files, `.env`, and generated artifacts are ignored by Git. Prefer an environment key if desired: copy `.env.example` to `.env`, fill `OPENROUTER_API_KEY`, and restart. Environment keys take precedence over locally saved keys. Removing a local key cannot remove an environment key.

Use **Export local backup** to download the workspace without credentials. To restore, stop the app and place the backup at `data/workspace.json`. Restart; PDFs can be recompiled from the stored source. Back up this file before replacing it. The app never treats exported keys as credentials.

Privacy mode defaults to providers classified by OpenRouter as avoiding data collection and offering zero data retention. Some models will be unavailable under those constraints; the app reports the failure and never silently relaxes them.

## What “format locked” means

The renderer preserves every byte outside detected experience/project prose spans and the four Technologies values. It keeps all LaTeX commands, existing emphasis wrappers, headings, contact details, dates, links, section order, fonts, margins, and record structure. Model output is validated JSON containing plain text and evidence references; it never edits or executes LaTeX.

Updating fixed contact details, role titles/dates, education, project headings or certifications requires updating those facts in the local `.tex` source and reimporting it. Extra profile records can be saved as evidence; an existing template cannot create new entries for them. Supported imports use Nicholas's existing typography/preamble and single-column structure. Arbitrary LaTeX packages, macros, file reads and other layouts are rejected. Each saved resume retains the template and profile it used.

Text length can affect wrapping. The app compiles with no shell escape, enforces exactly one page and no overfull boxes before saving or linking a resume, and checks extractable PDF text when the tool is available. On overflow it tries one compact revision with shorter character budgets, without changing spacing or font sizes. Draft artifacts are removed if generation cannot produce a verified one-page result.

## Tailoring skill and ATS research

The backend loads [`skills/resume-tailor/SKILL.md`](skills/resume-tailor/SKILL.md) for every generation. It requires same-role/project/category evidence, truthful wording, explicit gaps, and grounded reuse. Numeric claims and requirement vocabulary are checked locally as an additional safeguard. Automated validation cannot prove every semantic claim; the evidence review is part of the workflow.

[`docs/ats-research.md`](docs/ats-research.md) cites ATS vendor documentation, employer guidance, career resources, and OpenRouter's official API/privacy documentation. Keywords come from each actual job description. The app does not claim a universal ATS score or hiring guarantee.

## Implementation

- `src/`: React workspace and API client.
- `shared/`: typed contracts and factual evidence IDs.
- `server/`: local storage, template validation/rendering, OpenRouter calls, PDF compilation, Express API.
- `templates/nicholas.tex`: exact original source copy.
- `tests/`: deterministic renderer, persistence, API, and provider-boundary checks. Provider tests use local responses and spend no API credits.

