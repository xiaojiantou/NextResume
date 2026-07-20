"use client";

import { AppShell } from "@/components/AppShell";
import { useFlow } from "@/lib/store";
import { AlertCircle, CheckCircle2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<Verifying />}>
      <CheckoutSuccess />
    </Suspense>
  );
}

function CheckoutSuccess() {
  const params = useSearchParams();
  const router = useRouter();
  const { markPaid } = useFlow();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const sessionId = params.get("session_id");
    if (!sessionId) {
      setError("Missing Stripe checkout session.");
      return;
    }

    (async () => {
      try {
        const res = await fetch(
          `/api/checkout/session?session_id=${encodeURIComponent(sessionId)}`,
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Payment check failed");
        if (!data.paid) {
          throw new Error("Stripe has not marked this checkout as paid yet.");
        }
        markPaid();
        router.replace("/result");
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not verify payment.",
        );
      }
    })();
  }, [markPaid, params, router]);

  if (error) {
    return (
      <AppShell step="checkout">
        <div className="container-x py-16 max-w-xl">
          <div className="card p-8 text-center">
            <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 mx-auto inline-flex items-center justify-center">
              <AlertCircle size={20} />
            </div>
            <h1 className="text-xl font-semibold text-ink-900 mt-4">
              Payment verification failed
            </h1>
            <p className="text-sm text-ink-500 mt-2">{error}</p>
            <div className="mt-5 flex justify-center gap-2">
              <Link href="/checkout" className="btn btn-outline">
                Back to checkout
              </Link>
              <button
                type="button"
                onClick={() => location.reload()}
                className="btn btn-primary"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return <Verifying />;
}

function Verifying() {
  return (
    <AppShell step="checkout">
      <div className="container-x py-16 max-w-xl">
        <div className="card p-10 text-center">
          <div className="w-12 h-12 rounded-xl bg-ink-900 text-white mx-auto inline-flex items-center justify-center">
            <Sparkles size={20} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mt-5 text-ink-900">
            Verifying payment…
          </h1>
          <p className="text-ink-500 mt-2">
            Checking your Stripe checkout before unlocking the rewrite.
          </p>
          <div className="mt-6 text-emerald-600 inline-flex items-center gap-2 text-sm">
            <CheckCircle2 size={16} />
            Secure return from Stripe
          </div>
        </div>
      </div>
    </AppShell>
  );
}
