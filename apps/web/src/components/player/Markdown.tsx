/**
 * Markdown renderer for `text` topics. Uses react-markdown (which does NOT
 * render raw HTML — safe by default; we deliberately omit rehype-raw) plus
 * remark-gfm for tables/strikethrough/task-lists. Styled with design tokens
 * for a clean prose look in both themes.
 */
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "../../lib/cn.js";

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight text-ink">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-8 text-xl font-semibold tracking-tight text-ink">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-6 text-lg font-semibold text-ink">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="my-4 leading-7 text-ink-secondary">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-4 list-disc space-y-2 pl-6 text-ink-secondary">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-4 list-decimal space-y-2 pl-6 text-ink-secondary">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-7">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-primary underline underline-offset-2 hover:text-primary-400"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-ink">{children}</strong>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-primary/60 pl-4 italic text-ink-muted">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-8 border-subtle" />,
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-xl border border-subtle bg-surface-sunken p-4 font-mono text-sm text-ink">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) {
      return <code className="bg-transparent p-0 font-mono">{children}</code>;
    }
    return (
      <code className="rounded bg-surface-overlay px-1.5 py-0.5 font-mono text-[0.85em] text-primary">
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-subtle bg-surface-overlay px-3 py-2 text-left font-semibold text-ink">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-subtle px-3 py-2 text-ink-secondary">
      {children}
    </td>
  ),
};

export function Markdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={cn("max-w-none", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
