export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="11" fill="var(--primary)" />
      <path
        d="M12 20.5L17.2 26L28.5 13"
        stroke="var(--primary-foreground)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <LogoMark className="size-8 shrink-0" />
      <span className="font-heading text-lg font-semibold tracking-tight">Gabarita</span>
    </div>
  );
}
