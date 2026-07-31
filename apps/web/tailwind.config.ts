import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Tailwind is wired to the CSS-variable design tokens in src/styles/tokens.css.
 * Tokens are RGB channel triplets; `channel()` wraps them so opacity modifiers
 * (bg-primary/15, bg-surface-raised/80, border-info/30) work. Utilities flip
 * with the theme automatically: bg-surface, text-ink, border-subtle,
 * ring-primary, shadow-glow, etc.
 */
const channel = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const primaryScale = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((s) => [
    String(s),
    channel(`--color-primary-${s}`),
  ]),
);
const neutralScale = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((s) => [
    String(s),
    channel(`--color-neutral-${s}`),
  ]),
);

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { ...primaryScale, DEFAULT: channel("--color-primary-500") },
        neutral: neutralScale,
        surface: {
          DEFAULT: channel("--surface-base"),
          base: channel("--surface-base"),
          raised: channel("--surface-raised"),
          overlay: channel("--surface-overlay"),
          sunken: channel("--surface-sunken"),
        },
        ink: {
          DEFAULT: channel("--text-primary"),
          secondary: channel("--text-secondary"),
          muted: channel("--text-muted"),
          inverse: channel("--text-inverse"),
        },
        success: {
          DEFAULT: channel("--color-success"),
          fg: channel("--color-success-fg"),
          subtle: channel("--color-success-subtle"),
        },
        warning: {
          DEFAULT: channel("--color-warning"),
          fg: channel("--color-warning-fg"),
          subtle: channel("--color-warning-subtle"),
        },
        error: {
          DEFAULT: channel("--color-error"),
          fg: channel("--color-error-fg"),
          subtle: channel("--color-error-subtle"),
        },
        info: {
          DEFAULT: channel("--color-info"),
          fg: channel("--color-info-fg"),
          subtle: channel("--color-info-subtle"),
        },
      },
      borderColor: {
        DEFAULT: channel("--border-subtle"),
        subtle: channel("--border-subtle"),
        strong: channel("--border-strong"),
        primary: channel("--color-primary-500"),
      },
      ringColor: {
        DEFAULT: channel("--ring"),
        primary: channel("--ring"),
      },
      ringOffsetColor: {
        DEFAULT: "var(--ring-offset)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        glow: "var(--shadow-glow)",
        focus: "var(--glow-primary)",
      },
      borderRadius: {
        lg: "0.75rem",
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.75rem",
      },
      zIndex: {
        dropdown: "1000",
        sticky: "1100",
        overlay: "1200",
        modal: "1300",
        popover: "1400",
        toast: "1500",
        tooltip: "1600",
      },
      transitionDuration: {
        fast: "120ms",
        base: "200ms",
        slow: "320ms",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        emphasized: "var(--ease-emphasized)",
        out: "var(--ease-out)",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "glow-pulse": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
        "fade-in-up": "fade-in-up var(--duration-base) var(--ease-out)",
        "glow-pulse": "glow-pulse 2.4s var(--ease-standard) infinite",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
