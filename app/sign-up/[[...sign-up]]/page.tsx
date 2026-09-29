// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { LanguageSwitch } from "@/components/LanguageProvider";
import { SignUp } from "@clerk/nextjs";

// See app/sign-in/[[...sign-in]]/page.tsx for why this is rendered in-app.
export default function SignUpPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-ink-50/40 p-6">
      <div className="absolute right-4 top-4"><LanguageSwitch /></div>
      <SignUp />
    </main>
  );
}
