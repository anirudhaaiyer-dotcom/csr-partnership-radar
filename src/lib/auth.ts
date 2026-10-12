import { timingSafeEqual } from 'node:crypto';

export function basicOk(header: string | null, password: string): boolean {
  if (!header || !header.startsWith('Basic ')) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const pw = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded;
  const a = Buffer.from(pw);
  const b = Buffer.from(password);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const challenge = () =>
  new Response('Sign in to CSR Partnership Radar', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="CSR Partnership Radar", charset="UTF-8"' } });

/** True when write actions are possible: a password protects the app, ALLOW_OPEN_WRITES=true is set (demo mode, no password), or we are in local development. */
export const openWrites = () => process.env.ALLOW_OPEN_WRITES === 'true';
export const writesEnabled = () => !!process.env.APP_PASSWORD || openWrites() || process.env.NODE_ENV !== 'production';

/** Returns an error Response when the caller may not write, or null when allowed. */
export function checkWrite(req: Request): Response | null {
  const pw = process.env.APP_PASSWORD;
  if (pw) return basicOk(req.headers.get('authorization'), pw) ? null : challenge();
  if (process.env.NODE_ENV === 'production' && !openWrites()) {
    return Response.json({ error: 'Changes are disabled until APP_PASSWORD is set on the server.' }, { status: 403 });
  }
  return null;
}

/** Cron routes: Vercel sends `Authorization: Bearer <CRON_SECRET>`. */
export function checkCron(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: 'CRON_SECRET is not set' }, { status: 500 });
  const h = req.headers.get('authorization') ?? '';
  const a = Buffer.from(h);
  const b = Buffer.from(`Bearer ${secret}`);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return null;
}
