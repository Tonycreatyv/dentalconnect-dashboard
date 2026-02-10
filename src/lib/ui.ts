// src/lib/ui.ts
export const glowHover =
  "transition-[box-shadow,transform] hover:shadow-[0_0_0_1px_rgba(16,185,129,0.12),0_0_30px_rgba(16,185,129,0.06)] active:scale-[0.99]";

export const panelHover =
  "rounded-2xl border border-slate-800 bg-slate-950/35 hover:bg-slate-950/45 transition-colors";

export const panelHeader =
  "px-4 py-3 text-xs font-semibold tracking-widest text-slate-400 border-b border-slate-800";

export const kpiCard =
  "rounded-2xl border border-slate-800 bg-slate-950/35 px-4 py-4";

export const cardInteractive =
  "rounded-2xl border border-slate-800 bg-slate-950/35 hover:bg-slate-950/45 transition-colors " + glowHover;

export const btnGhost =
  "inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-950/70 disabled:opacity-50 disabled:cursor-not-allowed";

export const btnPrimary =
  "inline-flex items-center gap-2 rounded-xl border border-emerald-700/40 bg-emerald-600/15 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed";

export const inputBase =
  "w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-600/40 focus:ring-2 focus:ring-emerald-700/20";

export const selectBase =
  "w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-600/40 focus:ring-2 focus:ring-emerald-700/20";
