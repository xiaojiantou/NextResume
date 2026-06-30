import { Logo } from "./Logo";
import Link from "next/link";
import { Stepper } from "./Stepper";

export function AppShell({
  step,
  children,
}: {
  step: "upload" | "job" | "analysis" | "checkout" | "result";
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-ink-100 bg-white">
        <div className="container-x flex items-center justify-between h-14">
          <Logo />
          <div className="flex items-center gap-3 text-sm text-ink-500">
            <span className="hidden sm:inline">Need help?</span>
            <Link
              href="/"
              className="btn btn-ghost !py-1.5 !px-2 text-ink-500"
            >
              Exit
            </Link>
          </div>
        </div>
      </header>
      <div className="border-b border-ink-100 bg-ink-50/40">
        <div className="container-x">
          <Stepper current={step} />
        </div>
      </div>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-ink-100 mt-12">
        <div className="container-x py-6 flex items-center justify-between text-xs text-ink-400">
          <span>© NextResume · Built with privacy in mind</span>
          <span className="flex items-center gap-4">
            <a href="#" className="hover:text-ink-700">
              Privacy
            </a>
            <a href="#" className="hover:text-ink-700">
              Terms
            </a>
            <a href="#" className="hover:text-ink-700">
              Status
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
