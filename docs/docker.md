# Docker

Requires Docker Engine/Desktop with Docker Compose. From the repository root:

```sh
docker compose up -d --build --wait
```

Open **http://127.0.0.1:3001**. The image includes the built React frontend, Express backend, TeX Live packages/font dependencies, and Poppler PDF tools; host Node/LaTeX installations are not required. The build runs the automated tests and TypeScript/frontend build. The runtime uses plain compiled JavaScript and production dependencies, running as the non-root `node` user.

## Local-only access

The server listens on `0.0.0.0` **inside the container**, while Compose publishes port 3001 on **host loopback only**. The existing localhost Host and cross-origin write checks remain enabled. Native `npm start` remains bound to `127.0.0.1` unless `HOST` is explicitly set.

This is still a single-user app with no login. Do not publish it to the internet or change the host mapping to all interfaces without designing authentication and origin restrictions first. Browser access should use exactly `http://127.0.0.1:3001` or `http://localhost:3001`; alternate ports require corresponding origin configuration.

## Persistence and credentials

The `workspace` named volume stores `/app/data`: profile, templates, applications, generated PDFs and locally saved keys. Container recreation and ordinary `docker compose down` preserve it.

Configure OpenRouter through the app's Settings, or optionally set `OPENROUTER_API_KEY` in an ignored `.env` file before starting. Compose injects it at runtime; no keys, host `.env`, or local data are copied into the image. Runtime environment credentials are visible to users with Docker administrator access; locally saved keys are plaintext in the data volume, as in native mode.

The initial container workspace is separate from your native `data/` folder. Export a backup before migrating. To import an existing workspace, stop the container and copy the backed-up `workspace.json` into its volume with ownership UID/GID 1000; restart and missing PDFs will be recompiled. Never overwrite an existing workspace without a backup. Upload `.tex` files through the app: Windows/host filesystem paths are not available inside the container.

## Operations

```sh
docker compose ps
docker compose logs --tail 50 app
docker compose stop
docker compose start --wait
docker compose down
```

**Do not use `docker compose down -v` unless you intend to delete the saved workspace and credentials.**

Back up the workspace using **Export local backup** in the app. Keep that file private; it contains personal career/contact information. It excludes API credentials and PDF binaries; PDFs can be rebuilt from stored LaTeX.

The first build downloads LaTeX packages and is larger than a typical Node image. Subsequent builds reuse the PDF-tool layer. For repeatable supply-chain builds, pin the base-image digest and use a controlled package mirror; the current major-version base tag intentionally receives maintenance updates on rebuild.

## Checks

```sh
docker compose config --quiet
docker compose exec app id
docker compose exec app pdflatex --version
docker compose exec app pdftotext -v
```

For browser smoke checks against the container, install project development dependencies and Chromium, then run `node scripts/ui-smoke.mjs`. No paid AI generation is required for these checks.
