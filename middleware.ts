import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  // Landing page + the free flow (upload, paste JD, ATS analysis) — no
  // account needed, per the site's own "no account required" copy.
  "/",
  "/upload",
  "/job",
  "/analysis",
  // The result page gates itself: it already redirects to /checkout unless
  // `paid` is set, or a valid order/token pair was supplied (email-link
  // access from any device — that flow has no Clerk session by design).
  "/result",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/parse-resume(.*)",
  "/api/parse-job(.*)",
  "/api/import-job-url(.*)",
  "/api/analyze(.*)",
  "/api/optimize(.*)",
  "/api/export(.*)",
  "/api/voice-rewrite(.*)",
  // Its own token check (verifyOrderToken) is the real gate here, so buyers
  // can open their order from any device via the emailed link.
  "/api/order(.*)",
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
