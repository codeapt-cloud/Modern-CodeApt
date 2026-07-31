/**
 * CodeApt wordmark as a crisp, theme-adaptive inline SVG.
 *
 * Motif `{Code}Apt`: the cyan curly braces and "Apt" use the primary token;
 * "Code" uses `currentColor` so it flips ink↔white with the theme. Size it by
 * setting a height class (e.g. `h-7`); width scales automatically.
 */
import { cn } from "../../lib/cn.js";

interface LogoProps {
  className?: string;
  title?: string;
}

export function Logo({ className, title = "CodeApt" }: LogoProps) {
  return (
    <svg
      viewBox="0 0 158 34"
      role="img"
      aria-label={title}
      className={cn("h-7 w-auto overflow-visible", className)}
      preserveAspectRatio="xMinYMid meet"
    >
      <text
        x="0"
        y="26"
        fontSize="28"
        fontWeight="700"
        letterSpacing="-0.5"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <tspan
          fill="rgb(var(--color-primary-500))"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {"{"}
        </tspan>
        <tspan fill="currentColor">Code</tspan>
        <tspan
          fill="rgb(var(--color-primary-500))"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {"}"}
        </tspan>
        <tspan fill="rgb(var(--color-primary-500))">Apt</tspan>
      </text>
    </svg>
  );
}
