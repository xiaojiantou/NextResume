import Link from "next/link";
import { SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { Logo } from "./Logo";

export async function Nav({ minimal = false }: { minimal?: boolean }) {
  const { userId } = await auth();

  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-white/70 border-b border-ink-100">
      <div className="container-x flex items-center justify-between h-14">
        <Logo />
        {!minimal && (
          <nav className="hidden md:flex items-center gap-7 text-sm text-ink-600">
            <a href="#how" className="hover:text-ink-900 transition">
              How it works
            </a>
            <a href="#evidence" className="hover:text-ink-900 transition">
              Evidence Mode
            </a>
            <a href="#pricing" className="hover:text-ink-900 transition">
              Pricing
            </a>
            <a href="#faq" className="hover:text-ink-900 transition">
              FAQ
            </a>
          </nav>
        )}
        <div className="flex items-center gap-2">
          {userId ? (
            <>
              <Link href="/upload" className="btn btn-ghost text-sm">
                Go to app
              </Link>
              <UserButton />
            </>
          ) : (
            <>
              <SignInButton mode="modal">
                <button className="btn btn-ghost">Sign in</button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="btn btn-primary">Get started</button>
              </SignUpButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
