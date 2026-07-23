import { NextResponse } from 'next/server';

export async function GET() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  return NextResponse.redirect(`${apiUrl}/oauth/callback`);
}
