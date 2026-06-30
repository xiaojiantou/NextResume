import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

const STEPS = [
  { id: "upload", label: "Upload" },
  { id: "job", label: "Job" },
  { id: "analysis", label: "Analysis" },
  { id: "checkout", label: "Unlock" },
  { id: "result", label: "Optimize" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

export function Stepper({ current }: { current: StepId }) {
  const currentIdx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center justify-center gap-2 py-6">
      {STEPS.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition",
                done && "bg-ink-900 text-white border-ink-900",
                active &&
                  "bg-white text-ink-900 border-ink-900 shadow-soft",
                !done && !active && "bg-white text-ink-400 border-ink-100",
              )}
            >
              <span
                className={cn(
                  "w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px]",
                  done && "bg-white text-ink-900",
                  active && "bg-ink-900 text-white",
                  !done && !active && "bg-ink-100 text-ink-400",
                )}
              >
                {done ? <Check size={12} strokeWidth={3} /> : i + 1}
              </span>
              {s.label}
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "w-6 h-px",
                  i < currentIdx ? "bg-ink-900" : "bg-ink-200",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
