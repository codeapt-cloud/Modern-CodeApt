/**
 * Compact brace-only mark `{ }` for favicons, collapsed nav, and tight spaces.
 * Cyan on transparent; scales to any square size via a height/width class.
 */
import { cn } from "../../lib/cn.js";

interface BrandmarkProps {
  className?: string;
  title?: string;
}

export function Brandmark({ className, title = "CodeApt" }: BrandmarkProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      role="img"
      aria-label={title}
      className={cn("h-8 w-8", className)}
    >
      <text
        x="50%"
        y="52%"
        dominantBaseline="middle"
        textAnchor="middle"
        fontSize="30"
        fontWeight="700"
        fill="rgb(var(--color-primary-500))"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {"{ }"}
      </text>
    </svg>
  );
}
