import React from "react";
import { cn } from "../lib/cn";

type LobbyHeroProps = {
  title: string;
  subtitle?: string;
  rightText?: string;
  imageSrc?: string;
  tone?: "dark" | "light";
  statusLabel?: string;        // "Online", "Sin nuevas entradas", "3 esperando"
  lastActivityLabel?: string;  // "Última actividad: 2m"
  children?: React.ReactNode;  // KPI cards
};

export function LobbyHero({
  title,
  subtitle,
  rightText,
  imageSrc,
  tone = "dark",
  statusLabel = "Online",
  lastActivityLabel = "Sincronizado recién",
  children,
}: LobbyHeroProps) {
  return (
    <section
      className={cn(
        // ✅ wrapper premium (tu snippet, completo)
        "relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/40 backdrop-blur"
      )}
    >
      {/* Ambient gradients */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          "bg-[radial-gradient(1000px_circle_at_20%_0%,rgba(16,185,129,0.12),transparent_55%),radial-gradient(900px_circle_at_80%_20%,rgba(59,130,246,0.10),transparent_55%)]"
        )}
      />

      {/* Optional background image */}
      {imageSrc ? (
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage: `url(${imageSrc})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      ) : null}

      {/* Noise overlay */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 opacity-[0.08] mix-blend-overlay",
          "[background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.8%22 numOctaves=%223%22 stitchTiles=%22stitch%22/></filter><rect width=%22120%22 height=%22120%22 filter=%22url(%23n)%22 opacity=%220.45%22/></svg>')]"
        )}
      />

      {/* Vignette */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-black/20 to-black/45" />

      {/* Content */}
      <div className="relative px-6 py-6 md:px-8 md:py-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100 md:text-3xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-2 max-w-2xl text-sm text-slate-300/90 md:text-base">
                {subtitle}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {/* Status badge */}
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                {statusLabel}
              </span>

              {/* Last activity */}
              <span className="inline-flex items-center rounded-full border border-slate-700/70 bg-slate-950/30 px-3 py-1 text-xs text-slate-300">
                {lastActivityLabel}
              </span>
            </div>
          </div>

          {/* Right chip */}
          <div className="flex items-center justify-start md:justify-end">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/40 px-3 py-1.5 text-xs text-slate-200">
              <span className="h-2 w-2 rounded-full bg-teal-300/80" />
              {rightText ?? (tone === "dark" ? "—" : "")}
            </span>
          </div>
        </div>

        {/* KPI grid */}
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {children}
        </div>
      </div>
    </section>
  );
}
