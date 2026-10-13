import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const privateHost = env.TAILSCALE_ORIGIN ? new URL(env.TAILSCALE_ORIGIN).hostname : undefined;
  return {
    plugins: [react()],
    server: {
      host: env.VITE_HOST || '127.0.0.1',
      port: 5173,
      strictPort: true,
      allowedHosts: privateHost ? [privateHost] : [],
      fs: { deny: ['.env', '.env.*', '**/.git/**', '**/data/**', '**/workspace.json', '**/secrets.json', '**/*.{crt,pem}'] },
      proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } },
    },
  };
});
