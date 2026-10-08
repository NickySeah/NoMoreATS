import 'dotenv/config';
import { resolve } from 'node:path';
import { Store } from './store';
import { createApp } from './app';
const port = Number(process.env.PORT || 3001);
const dataDir = resolve(process.env.DATA_DIR || 'data');
const store = await Store.open(dataDir);
const server = createApp(store).listen(port, '127.0.0.1', () => console.log(`NoMoreATS API: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));
