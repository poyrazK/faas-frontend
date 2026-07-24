import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const backendUrl = process.env.APID_BACKEND_URL || 'http://146.190.210.124:8080';
  
  try {
    const contentType = request.headers.get('content-type') || 'application/x-www-form-urlencoded';
    const body = await request.text();

    const backendRes = await fetch(`${backendUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
      },
      body,
    });

    const responseText = await backendRes.text();
    const headers = new Headers();
    headers.set('Content-Type', backendRes.headers.get('content-type') || 'text/html; charset=utf-8');

    // Forward session cookie set by apid backend
    const setCookie = backendRes.headers.get('set-cookie');
    if (setCookie) {
      headers.set('Set-Cookie', setCookie);
    }

    return new NextResponse(responseText, {
      status: backendRes.status,
      headers,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to reach DigitalOcean backend', detail: err.message },
      { status: 502 }
    );
  }
}
