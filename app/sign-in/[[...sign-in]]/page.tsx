// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { LanguageSwitch } from "@/components/LanguageProvider";
import { SignIn } from "@clerk/nextjs";

// Hosted in-app rather than redirected to Clerk's Account Portal. The old
// redirect pointed at clerk.howbetech.com, which is the Frontend API host and
// answers every page path with a bare "404 page not found" — so every
// protected route (auth.protect() in middleware.ts) dead-ended there. Rendering
// <SignIn /> here also keeps the ?redirect_url the middleware attaches, so a
// signed-out buyer lands back on /checkout after signing in.
export default function SignInPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-ink-50/40 p-6">
      <div className="absolute right-4 top-4"><LanguageSwitch /></div>
      <SignIn />
    </main>
  );
}
