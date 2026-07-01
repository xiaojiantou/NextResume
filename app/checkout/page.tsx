"use client";

import { AppShell } from "@/components/AppShell";
import { useFlow } from "@/lib/store";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  CreditCard,
  Lock,
  Sparkles,
  Ticket,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CheckoutPage() {
  const { markPaid } = useFlow();
  const [processing, setProcessing] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const router = useRouter();

  const startCheckout = async () => {
    setProcessing(true);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      if (!data.url) throw new Error("Checkout URL was missing.");
      window.location.href = data.url;
    } catch (err) {
      setCheckoutError(
        err instanceof Error ? err.message : "Could not start checkout.",
      );
      setProcessing(false);
    }
  };

  const redeem = async (e: React.FormEvent) => {
    e.preventDefault();
    setRedeeming(true);
    setCodeError(null);
    try {
      const res = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");
      markPaid();
      router.push("/result");
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <AppShell step="checkout">
      <div className="container-x py-10 grid lg:grid-cols-5 gap-8 max-w-5xl">
        <div className="lg:col-span-3 space-y-5">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
              Unlock your optimized resume
            </h1>
            <p className="text-ink-500 mt-2">
              Secure Stripe checkout. One payment, no subscription.
            </p>
          </div>

          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-ink-900">
                  Pay with Stripe
                </div>
                <p className="text-xs text-ink-400 mt-1">
                  You'll return here automatically after payment.
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-ink-400">
                <Lock size={11} /> Test mode ready
              </div>
            </div>
            <button
              type="button"
              onClick={startCheckout}
              disabled={processing}
              className="btn btn-primary w-full !py-3"
            >
              {processing ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Opening Stripe…
                </>
              ) : (
                <>
                  <CreditCard size={14} />
                  Pay $9.99 with Stripe
                </>
              )}
            </button>
            {checkoutError && (
              <div className="text-xs text-rose-700 inline-flex items-center gap-1.5">
                <AlertCircle size={11} />
                {checkoutError}
              </div>
            )}
          </div>

          <div className="card p-4">
            <form onSubmit={redeem} className="space-y-3">
              <div>
                <span className="text-sm font-medium text-ink-900 inline-flex items-center gap-2">
                  <Ticket size={14} className="text-accent-600" />
                  Access code
                </span>
                <p className="text-xs text-ink-400 mt-1">
                  Set PROMO_CODES in .env.local, or use DEV-UNLOCK while
                  running locally.
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="DEV-UNLOCK"
                  className="flex-1 px-3 py-2.5 border border-ink-200 rounded-lg text-sm uppercase tracking-wider outline-none focus:border-ink-900 focus:ring-2 focus:ring-ink-900/10 placeholder:text-ink-300"
                />
                <button
                  type="submit"
                  disabled={!code.trim() || redeeming}
                  className="btn btn-primary"
                >
                  {redeeming ? (
                    <>
                      <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Checking…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} />
                      Unlock
                    </>
                  )}
                </button>
              </div>
              {codeError && (
                <div className="text-xs text-rose-700 inline-flex items-center gap-1.5">
                  <AlertCircle size={11} />
                  {codeError}
                </div>
              )}
            </form>
          </div>

          <div className="flex items-center justify-between">
            <Link href="/analysis" className="btn btn-ghost">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
        </div>

        {/* Order summary */}
        <aside className="lg:col-span-2">
          <div className="card p-5 sticky top-20">
            <div className="text-xs text-ink-500">Order summary</div>
            <div className="mt-3 flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-ink-900 text-white inline-flex items-center justify-center">
                <Sparkles size={16} />
              </div>
              <div className="flex-1">
                <div className="font-medium text-ink-900">
                  Optimized Resume
                </div>
                <div className="text-xs text-ink-500 mt-0.5">
                  Full rewrite unlock
                </div>
              </div>
              <div className="text-sm font-medium tabular-nums">$9.99</div>
            </div>

            <div className="hairline my-5" />

            <div className="space-y-2 text-sm">
              <Row label="Subtotal" value="$9.99" />
              <Row label="Tax" value="$0.00" muted />
              <div className="hairline" />
              <Row label="Total" value="$9.99" bold />
            </div>

            <div className="mt-5 rounded-lg bg-ink-50/60 p-3.5 text-xs text-ink-600 space-y-2">
              {[
                "Full AI rewrite tailored to the JD",
                "Evidence Mode — bullet-level traceability",
                "Side-by-side comparison",
                "Browser PDF export",
              ].map((t) => (
                <div key={t} className="flex items-start gap-2">
                  <Check
                    size={12}
                    className="mt-0.5 text-emerald-600 shrink-0"
                    strokeWidth={3}
                  />
                  {t}
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-1.5 text-[11px] text-ink-400">
              <Lock size={11} /> Stripe-hosted checkout
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? "text-ink-400" : "text-ink-600"}>{label}</span>
      <span
        className={`tabular-nums ${
          bold ? "font-semibold text-ink-900" : "text-ink-700"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
