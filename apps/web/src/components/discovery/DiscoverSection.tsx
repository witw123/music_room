import React from "react";

export function DiscoverSection({
  title,
  subtitle,
  icon,
  children
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 sm:mt-12">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">{title}</h2>
        </div>
        {subtitle ? <p className="mt-1 text-xs text-foreground-muted">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
