# Docker development with hot reload

The development stack uses the same host loopback port as production, so the existing Tailscale Serve URL continues to work. Run only one stack at a time.

## Switch to development

```sh
docker compose stop
docker compose -f compose.dev.yaml up -d --build --wait
```

Open http://127.0.0.1:3001 or your configured Tailscale HTTPS URL. React/Vite is served through host port 3001; it proxies `/api` to the backend inside the same container. Vite's hot-reload WebSocket uses the browser's origin, including HTTPS through Serve.

Edit files in this local checkout:
- `src/`: React and CSS refresh automatically; React state is preserved where Fast Refresh permits it.
- `server/` and imported `shared/` files: tsx restarts the API automatically. Requests during a restart may briefly fail; retry them.
- `vite.config.ts`: Vite restarts its configuration automatically.
- Templates and tailoring skill files are mounted too; runtime readers see the new contents. Cached imports may require an API/container restart.

Source mounts are read-only from the container. Container-managed `node_modules` is not overlaid by host dependencies. Rebuild after changing package.json/package-lock.json or Dockerfile.dev. Changes to environment variables or the Compose file require container recreation; changes to the dev launcher require a restart.

Development uses a **separate named volume**, `nomoreats-dev_dev-workspace`, mounted at `/data` outside Vite's source root. Vite denies workspace and secret file paths, and its API proxy preserves the original Host so missing Serve identity fails closed. Your production volume is not copied or altered. A fresh profile/workspace and unconfigured OpenRouter key in development is expected. Never use paid generation without deliberately configuring and initiating it.

The development server exposes source code to its allowed visitors. Keep the published port loopback-only and use private Tailscale Serve, never public Funnel. Vite accepts only the configured Tailscale hostname; the API also requires the configured Serve user. Any tailnet member permitted to reach Serve may be able to read frontend source; API career data and credentials remain guarded. Use tailnet access rules for stricter source visibility.

## Switch back to production

```sh
docker compose -f compose.dev.yaml stop
docker compose up -d --build --wait
```

Your production workspace is restored from its existing volume. Do not add `-v` to a `down` command unless you intend to delete that stack's workspace.

## Troubleshooting

```sh
docker compose -f compose.dev.yaml ps
docker compose -f compose.dev.yaml logs --tail 50 app
docker compose -f compose.dev.yaml restart app
```

Linux bind-mount hot reload was verified through Tailscale HTTPS, including CSS updates without browser navigation and API restart on source edits. Docker Desktop file-event forwarding may differ; inspect Vite/tsx logs if changes are not detected.
