// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { LogIn } from "lucide-react";
import Link from "next/link";

const CHECKOUT = "/checkout";

// /checkout is behind auth.protect() in middleware.ts. Sending a signed-out
// user there as a plain link means they only learn they need an account after
// a redirect bounce, so this opens Clerk's sign-in modal right here instead
// and continues to checkout once they're in. Signed-in users get the link.
export function UnlockLink({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { isLoaded, isSignedIn } = useUser();
  const { openSignIn } = useClerk();

  if (isLoaded && !isSignedIn) {
    return (
      <button
        type="button"
        className={className}
        onClick={() =>
          openSignIn({
            forceRedirectUrl: CHECKOUT,
            signUpForceRedirectUrl: CHECKOUT,
          })
        }
      >
        {children}
      </button>
    );
  }

  return (
    <Link href={CHECKOUT} className={className}>
      {children}
    </Link>
  );
}

// A one-line heads-up shown next to the unlock offer while signed out, so the
// account requirement is visible before anyone clicks.
export function SignInToUnlockNote() {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded || isSignedIn) return null;
  return (
    <p className="mt-2 text-xs text-ink-500 inline-flex items-center gap-1.5">
      <LogIn size={12} />
      You&apos;ll sign in (or create a free account) before checkout, so your
      purchase stays with you.
    </p>
  );
}
