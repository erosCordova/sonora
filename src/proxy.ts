import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/register", "/forgot", "/reset"];

// Protección de rutas: sin cookie de sesión no se accede a la app.
// La validez real de la sesión se comprueba en el servidor (layout y API).
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get("sid")?.value);
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
