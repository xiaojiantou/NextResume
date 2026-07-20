"use client";

import { useEffect } from "react";
import { useClerk } from "@clerk/nextjs";

export default function SignUpPage() {
  const { openSignUp } = useClerk();

  useEffect(() => {
    openSignUp();
  }, [openSignUp]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="text-center">
        <p className="text-gray-600">Redirecting to sign up...</p>
      </div>
    </div>
  );
}
