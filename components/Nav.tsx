import Link from "next/link";
import { Logo } from "./Logo";

export function Nav({ minimal = false }: { minimal?: boolean }) {
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
          <Link href="/upload" className="btn btn-ghost">
            Sign in
          </Link>
          <Link href="/upload" className="btn btn-primary">
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
