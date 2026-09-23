// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import { UserButton, useClerk, useUser } from "@clerk/nextjs";

// Shows on every app step (upload → result) whether there's a signed-in
// account, so nobody discovers they're signed out only when checkout bounces
// them. Renders nothing until Clerk has loaded, to avoid a sign-in/avatar flash.
export function AuthStatus() {
  const { isLoaded, isSignedIn } = useUser();
  const { openSignIn } = useClerk();

  if (!isLoaded) return null;
  if (isSignedIn) return <UserButton />;
  return (
    <button
      type="button"
      onClick={() => openSignIn()}
      className="btn btn-ghost !py-1.5 !px-2 text-ink-700"
    >
      Sign in
    </button>
  );
}
