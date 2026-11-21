import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import { cn } from '@ds/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn('markdown-chat', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
        p: ({ children }) => (
          <p className="text-[13px] leading-relaxed mb-2 last:mb-0" style={{ color: 'var(--theme-text)' }}>
            {children}
          </p>
        ),
        // Heading size/weight come from the .markdown-chat override in
        // index.css — Tailwind text-* utilities lose against the un-layered
        // global typography.css and must not be used here.
        h1: ({ children }) => (
          <h1 className="mb-2 mt-3 first:mt-0" style={{ color: 'var(--theme-text)' }}>
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-1.5 mt-3 first:mt-0" style={{ color: 'var(--theme-text)' }}>
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-1 mt-2 first:mt-0" style={{ color: 'var(--theme-text)' }}>
            {children}
          </h3>
        ),
        ul: ({ children }) => (
          <ul className="list-disc pl-4 mb-2 space-y-0.5" style={{ color: 'var(--theme-text)' }}>
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-4 mb-2 space-y-0.5" style={{ color: 'var(--theme-text)' }}>
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="text-[13px] leading-relaxed">{children}</li>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold" style={{ color: 'var(--theme-text)' }}>
            {children}
          </strong>
        ),
        em: ({ children }) => (
          <em className="italic">{children}</em>
        ),
        code: ({ className: codeClassName, children }) => {
          const isBlock = codeClassName?.startsWith('language-');
          if (isBlock) {
            return (
              <code
                className={cn(
                  'block rounded-md p-2.5 text-[12px] leading-relaxed overflow-x-auto mb-2',
                  codeClassName,
                )}
                style={{
                  background: 'var(--theme-bg)',
                  color: 'var(--theme-text)',
                  border: '1px solid var(--theme-border)',
                }}
              >
                {children}
              </code>
            );
          }
          return (
            <code
              className="rounded px-1 py-0.5 text-[12px]"
              style={{
                background: 'var(--theme-bg)',
                color: 'var(--theme-text)',
                border: '1px solid var(--theme-border)',
              }}
            >
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="mb-2 last:mb-0 overflow-x-auto">{children}</pre>
        ),
        blockquote: ({ children }) => (
          <blockquote
            className="border-l-2 pl-3 my-2 italic"
            style={{ borderColor: 'var(--color-primary-30)', color: 'var(--theme-text-muted)' }}
          >
            {children}
          </blockquote>
        ),
        a: ({ href, children }) => {
          // F18: internal app paths navigate in the same tab via the router;
          // only external links open a new tab.
          const isInternal = typeof href === 'string' && href.startsWith('/') && !href.startsWith('//');
          if (isInternal) {
            return (
              <Link to={href} className="underline" style={{ color: 'var(--color-primary-50)' }}>
                {children}
              </Link>
            );
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: 'var(--color-primary-50)' }}
            >
              {children}
            </a>
          );
        },
        table: ({ children }) => (
          <div className="overflow-x-auto mb-2">
            <table
              className="w-full text-[12px] border-collapse"
              style={{ borderColor: 'var(--theme-border)' }}
            >
              {children}
            </table>
          </div>
        ),
        th: ({ children }) => (
          <th
            className="text-left px-2 py-1 font-semibold border-b"
            style={{
              background: 'var(--theme-bg)',
              color: 'var(--theme-text)',
              borderColor: 'var(--theme-border)',
            }}
          >
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td
            className="px-2 py-1 border-b"
            style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
          >
            {children}
          </td>
        ),
        hr: () => (
          <hr className="my-2" style={{ borderColor: 'var(--theme-border)' }} />
        ),
      }}
    >
      {content}
      </ReactMarkdown>
    </div>
  );
}
