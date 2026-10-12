import { NextResponse, type NextRequest } from 'next/server';
import { basicOk, challenge } from '@/lib/auth';

/** When APP_PASSWORD is set the whole app sits behind it, except the cron route, which uses CRON_SECRET. */
export function proxy(req: NextRequest) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith('/api/cron/')) return NextResponse.next();
  return basicOk(req.headers.get('authorization'), pw) ? NextResponse.next() : challenge();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
