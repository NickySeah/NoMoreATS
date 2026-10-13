export function listenHost(env: { HOST?: string } = process.env): string {
  return env.HOST || '127.0.0.1';
}
