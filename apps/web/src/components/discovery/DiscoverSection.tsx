import React from "react";

export function DiscoverSection({
  title,
  subtitle,
  icon,
  eyebrow,
  children
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 sm:mt-7">
      <div className="mb-2 sm:mb-2.5">
        {eyebrow ? (
          <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-muted/65 mb-0.5">
            {eyebrow}
          </span>
        ) : null}
        <div className="flex items-center gap-1.5">
          {icon}
          <h2 className="text-sm sm:text-base font-semibold tracking-tight text-foreground">{title}</h2>
        </div>
        {subtitle ? <p className="mt-0.5 text-[11px] sm:text-xs text-foreground-muted">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
