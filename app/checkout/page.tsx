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
  Shield,
  Sparkles,
  Ticket,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CheckoutPage() {
  const { markPaid } = useFlow();
  const [processing, setProcessing] = useState(false);
  const [email, setEmail] = useState("");
  const [card, setCard] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");

  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const router = useRouter();

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
      setRedeeming(false);
    }
  };

  const valid =
    email.includes("@") && card.length >= 12 && exp.length >= 4 && cvc.length >= 3;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    setTimeout(() => {
      markPaid();
      router.push("/result");
    }, 1400);
  };

  return (
    <AppShell step="checkout">
      <div className="container-x py-10 grid lg:grid-cols-5 gap-8 max-w-5xl">
        <form onSubmit={submit} className="lg:col-span-3 space-y-5">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
              Unlock your optimized resume
            </h1>
            <p className="text-ink-500 mt-2">
              One payment. No subscription. 14-day money-back guarantee.
            </p>
          </div>

          {/* Promo code */}
          <div className="card p-4">
            {!codeOpen ? (
              <button
                type="button"
                onClick={() => setCodeOpen(true)}
                className="w-full flex items-center justify-between text-sm text-ink-700 hover:text-ink-900"
              >
                <span className="inline-flex items-center gap-2">
                  <Ticket size={14} className="text-accent-600" />
                  Have a code?
                </span>
                <span className="text-ink-400 text-xs">Redeem</span>
              </button>
            ) : (
              <form onSubmit={redeem} className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink-900 inline-flex items-center gap-2">
                    <Ticket size={14} className="text-accent-600" />
                    Redeem a code
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCodeOpen(false);
                      setCodeError(null);
                      setCode("");
                    }}
                    className="text-xs text-ink-400 hover:text-ink-700"
                  >
                    Cancel
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="e.g. BETA-LAUNCH"
                    className="flex-1 px-3 py-2.5 border border-ink-200 rounded-lg text-sm uppercase tracking-wider outline-none focus:border-ink-900 focus:ring-2 focus:ring-ink-900/10 placeholder:text-ink-300 placeholder:normal-case placeholder:tracking-normal"
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
                        Apply
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
            )}
          </div>

          <div className="card p-5 space-y-4">
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="you@work.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Hint>We'll send your receipt and download link here.</Hint>
            </div>
          </div>

          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-ink-900">
                Payment method
              </div>
              <div className="flex items-center gap-1 text-xs text-ink-400">
                <Lock size={11} /> Secure payment via Stripe
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                className="border border-ink-900 bg-white rounded-lg p-3 text-sm font-medium inline-flex items-center justify-center gap-2"
              >
                <CreditCard size={14} />
                Card
              </button>
              <button
                type="button"
                className="border border-ink-100 bg-ink-50/40 rounded-lg p-3 text-sm text-ink-500 inline-flex items-center justify-center gap-2 hover:border-ink-200"
              >
                Apple Pay
              </button>
              <button
                type="button"
                className="border border-ink-100 bg-ink-50/40 rounded-lg p-3 text-sm text-ink-500 inline-flex items-center justify-center gap-2 hover:border-ink-200"
              >
                Link
              </button>
            </div>

            <div>
              <Label>Card number</Label>
              <Input
                placeholder="1234 1234 1234 1234"
                value={card}
                onChange={(e) =>
                  setCard(e.target.value.replace(/[^\d ]/g, "").slice(0, 19))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Expiry</Label>
                <Input
                  placeholder="MM / YY"
                  value={exp}
                  onChange={(e) => setExp(e.target.value.slice(0, 5))}
                />
              </div>
              <div>
                <Label>CVC</Label>
                <Input
                  placeholder="123"
                  value={cvc}
                  onChange={(e) =>
                    setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Link href="/analysis" className="btn btn-ghost">
              <ArrowLeft size={14} /> Back
            </Link>
            <button
              type="submit"
              disabled={!valid || processing}
              className="btn btn-primary !px-5 !py-3"
            >
              {processing ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <Lock size={14} />
                  Pay $9.99
                </>
              )}
            </button>
          </div>
        </form>

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
                  Tailored to: Senior Product Engineer @ Vercel
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
                "PDF + DOCX export",
                "14-day money-back guarantee",
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
              <Shield size={11} /> 256-bit encryption · PCI-compliant
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-medium text-ink-700 mb-1.5 block">
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full px-3 py-2.5 border border-ink-200 rounded-lg text-sm outline-none focus:border-ink-900 focus:ring-2 focus:ring-ink-900/10 placeholder:text-ink-300"
    />
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-ink-400 mt-1.5">{children}</p>;
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
