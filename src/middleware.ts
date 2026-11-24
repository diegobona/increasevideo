import { NextResponse, type NextRequest } from "next/server";
import { getVisitor, withVisitorCookie } from "@/libs/visitor";

function identifyVisitor(request: NextRequest) {
  const visitor = getVisitor(request);
  if (!visitor.isNew) return NextResponse.next();

  // Forward the same identity immediately, including on a first direct API call.
  const headers = new Headers(request.headers);
  const otherCookies = (headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("visitorId="));
  headers.set("cookie", [...otherCookies, `visitorId=${visitor.id}`].join("; "));
  const response = NextResponse.next({ request: { headers } });
  return withVisitorCookie(response, request, visitor);
}

export function middleware(request: NextRequest) {
  const response = identifyVisitor(request);
  // Keep public previews crawlable so search engines can read the noindex rule.
  // Use the actual URL, never an untrusted forwarded host header.
  if (request.nextUrl.hostname.endsWith(".workers.dev")) {
    response.headers.set("X-Robots-Tag", "noindex, follow");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/|demos/|favicon.ico|robots.txt|.*\\.[\\w]+$).*)", "/sitemap.xml"],
};
