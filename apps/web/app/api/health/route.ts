import { NextResponse } from 'next/server';

// Healthcheck do container web (deploy/openrate.yaml bate em /api/health).
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok' });
}
