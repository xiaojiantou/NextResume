// Copyright (c) 2026 HowBe LLC. All rights reserved.

import Link from "next/link";

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <Link href="/" className="flex items-center gap-2 group">
      <img
        src="/assets/img/nextresume-icon.svg"
        alt=""
        width={size}
        height={size}
        aria-hidden="true"
        className="shrink-0 rounded-[21%]"
      />
      <span className="font-semibold tracking-tight text-ink-900">
        NextResume
      </span>
    </Link>
  );
}
