import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = req.cookies.get("zp_session");
  const isLoginPage = pathname === "/login";
  const isApi = pathname.startsWith("/api/");
  const isMiniapp = pathname === "/m" || pathname.startsWith("/m/");

  if (isApi || isMiniapp) return NextResponse.next();

  if (!session && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (session && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
