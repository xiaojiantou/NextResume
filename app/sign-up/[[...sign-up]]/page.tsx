// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { SignUp } from "@clerk/nextjs";

// See app/sign-in/[[...sign-in]]/page.tsx for why this is rendered in-app.
export default function SignUpPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-ink-50/40 p-6">
      <SignUp />
    </main>
  );
}
