import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB

export function middleware(request: NextRequest) {
  // POST /api/meetings 에 대해서만 Content-Length 선제 검사
  if (request.method === "POST" && request.nextUrl.pathname === "/api/meetings") {
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "파일 크기가 너무 큽니다. 최대 100MB까지 업로드할 수 있습니다." },
        { status: 413 },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
