import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Stripe calls this server-to-server with no Clerk session; it verifies
  // itself via the webhook signature instead.
  "/api/stripe/webhook(.*)",
]);

const isApiRoute = createRouteMatcher(["/api(.*)", "/trpc(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return;

  // auth.protect() answers unauthenticated fetch() calls with an HTML 404,
  // which crashes clients doing res.json(). Give API callers JSON instead.
  if (isApiRoute(request)) {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Your session expired. Refresh the page and sign in again." },
        { status: 401 },
      );
    }
    return;
  }

  await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk(.*)",
  ],
};
