import Link from "next/link";

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <Link href="/" className="flex items-center gap-2 group">
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect
          x="2"
          y="2"
          width="28"
          height="28"
          rx="8"
          fill="url(#g)"
        />
        <path
          d="M10 22V10h2.4l7.2 8.4V10H22v12h-2.4l-7.2-8.4V22H10Z"
          fill="white"
        />
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="32" y2="32">
            <stop offset="0" stopColor="#18181b" />
            <stop offset="1" stopColor="#3f3f46" />
          </linearGradient>
        </defs>
      </svg>
      <span className="font-semibold tracking-tight text-ink-900">
        NextResume
      </span>
    </Link>
  );
}
