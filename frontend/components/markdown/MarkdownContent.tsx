'use client';

import { useMemo, useState } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), 'className'],
    span: [...(defaultSchema.attributes?.span ?? []), 'className'],
  },
};

export interface MarkdownContentProps {
  content: string;
  className?: string;
  previewMode?: boolean;
}

export function MarkdownContent({
  content,
  className,
  previewMode = true,
}: MarkdownContentProps) {
  const [showPreview, setShowPreview] = useState(true);

  const components = useMemo<Components>(
    () => ({
      code(props) {
        const { className: codeClassName, children } = props;
        const match = /language-(\w+)/.exec(codeClassName ?? '');
        const code = String(children).replace(/\n$/, '');
        if (match) {
          return (
            <SyntaxHighlighter
              style={oneDark}
              language={match[1]}
              PreTag="div"
              customStyle={{ margin: 0, borderRadius: '0.375rem', fontSize: '0.8125rem' }}
            >
              {code}
            </SyntaxHighlighter>
          );
        }
        return (
          <code className={cn('rounded bg-muted px-1 py-0.5 text-sm', codeClassName)}>
            {children}
          </code>
        );
      },
      a(props) {
        const { href, children } = props;
        const safe =
          href?.startsWith('http://') ||
          href?.startsWith('https://') ||
          href?.startsWith('/');
        if (!safe) return <span>{children}</span>;
        return (
          <a
            href={href}
            rel="noopener noreferrer"
            target="_blank"
            className="text-blue-600 hover:underline"
          >
            {children}
          </a>
        );
      },
    }),
    [],
  );

  return (
    <div className={cn('space-y-2', className)}>
      {previewMode && (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={showPreview ? 'default' : 'outline'}
            onClick={() => setShowPreview(true)}
          >
            Preview
          </Button>
          <Button
            type="button"
            size="sm"
            variant={!showPreview ? 'default' : 'outline'}
            onClick={() => setShowPreview(false)}
          >
            Source
          </Button>
        </div>
      )}

      {showPreview || !previewMode ? (
        <div className="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-300">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
            components={components}
          >
            {content}
          </ReactMarkdown>
        </div>
      ) : (
        <pre className="rounded-md border bg-muted/50 p-3 text-xs font-mono whitespace-pre-wrap break-words">
          {content}
        </pre>
      )}
    </div>
  );
}
