"use client";

import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="w-full max-w-md">
        <SignIn
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "w-full",
            },
          }}
        />
      </div>
    </div>
  );
}
