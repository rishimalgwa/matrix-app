import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { toCss, fromHex } from "@/core/color";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "default" | "primary" | "ghost" | "danger" | "live" | "spotify";

const VARIANTS: Record<Variant, string> = {
  default: "bg-panel-3 hover:bg-line-strong text-fg border border-line",
  primary: "bg-accent hover:brightness-110 text-white border border-transparent shadow-[0_0_18px_-6px_var(--color-accent)]",
  ghost: "bg-transparent hover:bg-panel-3 text-muted hover:text-fg border border-transparent",
  danger: "bg-transparent hover:bg-err/15 text-err border border-err/30",
  live: "bg-err/15 text-err border border-err/40 hover:bg-err/25",
  spotify: "bg-spotify hover:brightness-110 text-black border border-transparent",
};

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  icon?: ReactNode;
  active?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "default", size = "md", icon, active, className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition select-none whitespace-nowrap",
        "disabled:opacity-40 disabled:pointer-events-none",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
        VARIANTS[variant],
        active && "!bg-accent-2/15 !text-accent-2 !border-accent-2/50",
        className
      )}
    >
      {icon}
      {children}
    </button>
  );
});

export function IconButton({ label, active, className, children, ...rest }: BtnProps & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active}
      {...rest}
      className={cx(
        "grid size-9 place-items-center rounded-[10px] border transition disabled:opacity-40",
        active
          ? "border-accent-2/60 bg-accent-2/15 text-accent-2"
          : "border-transparent text-muted hover:bg-panel-3 hover:text-fg",
        className
      )}
    >
      {children}
    </button>
  );
}

export function Panel({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("panel p-4", className)}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="label">{title}</h2>}
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Slider({
  label, value, min, max, step = 1, onChange, format, disabled,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; format?: (v: number) => string; disabled?: boolean;
}) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <label className={cx("block", disabled && "opacity-40")}>
      <div className="mb-0.5 flex items-center justify-between text-[13px]">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-xs text-fg tabular-nums">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ ["--p" as string]: `${p}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative h-6 w-10 shrink-0 rounded-full border transition",
          checked ? "border-accent-2/60 bg-accent-2/30" : "border-line bg-panel-3"
        )}
      >
        <span className={cx("absolute top-0.5 size-4 rounded-full transition-all", checked ? "left-[18px] bg-accent-2" : "left-0.5 bg-muted")} />
      </button>
    </label>
  );
}

export function Segmented<T extends string | number>({
  value, options, onChange, className, size = "md",
}: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; className?: string; size?: "sm" | "md";
}) {
  return (
    <div className={cx("inline-flex flex-wrap rounded-[10px] border border-line bg-bg p-0.5", className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            "flex-1 rounded-lg font-medium transition whitespace-nowrap",
            size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-[13px]",
            o.value === value ? "bg-panel-3 text-fg shadow-sm" : "text-muted hover:text-fg"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: number; onChange: (c: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-xs text-faint uppercase">{toCss(value)}</span>
        <input type="color" className="swatch-input size-8" value={toCss(value)} onChange={(e) => onChange(fromHex(e.target.value))} />
      </span>
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "ok" | "warn" | "err" | "live" }) {
  const tones = {
    default: "bg-panel-3 text-muted",
    ok: "bg-ok/15 text-ok",
    warn: "bg-warn/15 text-warn",
    err: "bg-err/15 text-err",
    live: "bg-err/15 text-err",
  };
  return <span className={cx("inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", tones[tone])}>{children}</span>;
}
