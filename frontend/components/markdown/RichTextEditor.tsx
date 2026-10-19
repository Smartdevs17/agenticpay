'use client';

/**
 * RichTextEditor — Issue #795
 *
 * A dependency-free, markdown-backed rich text editor used for project
 * descriptions. It renders a formatting toolbar, a textarea, and an optional
 * live preview that reuses {@link MarkdownContent} for sanitized rendering.
 *
 * Markdown is stored as the source of truth so descriptions stay portable and
 * safe to persist/transport; the toolbar just inserts the corresponding syntax.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import {
  Bold,
  Code,
  Eye,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Pencil,
  Quote,
  Strikethrough,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownContent } from '@/components/markdown/MarkdownContent';
import { markdownToHtml } from '@/lib/markdown/to-html';
import { cn } from '@/lib/utils';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

type ToolbarAction =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'numberedList'
  | 'quote'
  | 'code'
  | 'link';

// Static toolbar definition lives at module scope so it never captures the
// editor's ref during render (see the `react-hooks/refs` rule).
const TOOLBAR_ITEMS: Array<{ action: ToolbarAction; label: string; icon: ReactNode }> = [
  { action: 'bold', label: 'Bold', icon: <Bold className="h-4 w-4" /> },
  { action: 'italic', label: 'Italic', icon: <Italic className="h-4 w-4" /> },
  { action: 'strikethrough', label: 'Strikethrough', icon: <Strikethrough className="h-4 w-4" /> },
  { action: 'heading2', label: 'Heading 2', icon: <Heading2 className="h-4 w-4" /> },
  { action: 'heading3', label: 'Heading 3', icon: <Heading3 className="h-4 w-4" /> },
  { action: 'bulletList', label: 'Bullet list', icon: <List className="h-4 w-4" /> },
  { action: 'numberedList', label: 'Numbered list', icon: <ListOrdered className="h-4 w-4" /> },
  { action: 'quote', label: 'Quote', icon: <Quote className="h-4 w-4" /> },
  { action: 'code', label: 'Code block', icon: <Code className="h-4 w-4" /> },
  { action: 'link', label: 'Link', icon: <LinkIcon className="h-4 w-4" /> },
];

export interface RichTextEditorProps {
  /** Current markdown source. */
  value: string;
  /** Called with the updated markdown source on every edit. */
  onChange: (value: string) => void;
  /** Field id, wired to the underlying textarea for <Label htmlFor>. */
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** When set, shows a character counter and enforces the limit. */
  maxLength?: number;
  /** Allow inserting images (URL or drag/drop). Defaults to true. */
  allowImages?: boolean;
  /** Also surface the description as HTML (see the HTML view toggle, issue #90). */
  showHtmlToggle?: boolean;
  onBlur?: () => void;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

interface SelectionState {
  start: number;
  end: number;
}

function applyWrap(
  text: string,
  { start, end }: SelectionState,
  prefix: string,
  suffix: string,
  placeholder: string,
) {
  const selected = text.slice(start, end) || placeholder;
  const next = text.slice(0, start) + prefix + selected + suffix + text.slice(end);
  return {
    next,
    cursorStart: start + prefix.length,
    cursorEnd: start + prefix.length + selected.length,
  };
}

function applyLinePrefix(text: string, { start, end }: SelectionState, prefix: string) {
  const lineStart = text.lastIndexOf('\n', Math.max(start - 1, 0)) + 1;
  let lineEnd = text.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = text.length;

  const block = text.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const allPrefixed = lines.every((line) => line.startsWith(prefix));
  const nextLines = lines.map((line) => (allPrefixed ? line.slice(prefix.length) : `${prefix}${line}`));
  const nextBlock = nextLines.join('\n');

  return {
    next: text.slice(0, lineStart) + nextBlock + text.slice(lineEnd),
    cursorStart: lineStart,
    cursorEnd: lineStart + nextBlock.length,
  };
}

function insertAtCursor(text: string, { start, end }: SelectionState, snippet: string) {
  const next = text.slice(0, start) + snippet + text.slice(end);
  const cursor = start + snippet.length;
  return { next, cursorStart: cursor, cursorEnd: cursor };
}

export function RichTextEditor({
  value,
  onChange,
  id,
  name,
  placeholder = 'Write a description…',
  disabled = false,
  className,
  maxLength,
  allowImages = true,
  showHtmlToggle = true,
  onBlur,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: RichTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showHtml, setShowHtml] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);
  const [showImageForm, setShowImageForm] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [imageAlt, setImageAlt] = useState('');
  const [imageError, setImageError] = useState<string | null>(null);

  const getSelection = useCallback((): SelectionState => {
    const el = textareaRef.current;
    if (!el) return { start: value.length, end: value.length };
    return { start: el.selectionStart, end: el.selectionEnd };
  }, [value.length]);

  const focusSelection = useCallback((start: number, end: number) => {
    // Wait for React to flush the controlled value before restoring selection.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
    });
  }, []);

  const commit = useCallback(
    (next: string, start: number, end: number) => {
      onChange(next);
      focusSelection(start, end);
    },
    [onChange, focusSelection],
  );

  const handleWrap = useCallback(
    (prefix: string, suffix: string, placeholderText: string) => {
      if (disabled) return;
      const result = applyWrap(value, getSelection(), prefix, suffix, placeholderText);
      commit(result.next, result.cursorStart, result.cursorEnd);
    },
    [commit, disabled, getSelection, value],
  );

  const handleLinePrefix = useCallback(
    (prefix: string) => {
      if (disabled) return;
      const result = applyLinePrefix(value, getSelection(), prefix);
      commit(result.next, result.cursorStart, result.cursorEnd);
    },
    [commit, disabled, getSelection, value],
  );

  const handleInsert = useCallback(
    (snippet: string) => {
      if (disabled) return;
      const result = insertAtCursor(value, getSelection(), snippet);
      commit(result.next, result.cursorStart, result.cursorEnd);
    },
    [commit, disabled, getSelection, value],
  );

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = maxLength ? event.target.value.slice(0, maxLength) : event.target.value;
    onChange(next);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'b') {
      event.preventDefault();
      handleWrap('**', '**', 'bold text');
    } else if (key === 'i') {
      event.preventDefault();
      handleWrap('*', '*', 'italic text');
    } else if (key === 'k') {
      event.preventDefault();
      handleWrap('[', '](https://)', 'link text');
    }
  };

  const insertImage = (url: string, alt: string) => {
    const trimmed = url.trim();
    if (!trimmed) {
      setImageError('Image URL is required');
      return;
    }
    setImageError(null);
    handleInsert(`![${alt.trim() || 'image'}](${trimmed})`);
    setImageUrl('');
    setImageAlt('');
    setShowImageForm(false);
  };

  const handleImageFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        setImageError('Only image files are supported');
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setImageError('Image must be smaller than 5MB');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setImageError(null);
        handleInsert(`![${file.name}](${String(reader.result)})`);
      };
      reader.onerror = () => setImageError('Failed to read image file');
      reader.readAsDataURL(file);
    },
    [handleInsert],
  );

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!allowImages || disabled) return;
    const file = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
    if (file) {
      event.preventDefault();
      handleImageFile(file);
    }
  };

  const handleDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    if (!allowImages || disabled) return;
    const file = Array.from(event.dataTransfer?.files ?? []).find((f) => f.type.startsWith('image/'));
    if (file) {
      event.preventDefault();
      handleImageFile(file);
    }
  };

  const runToolbarAction = (action: ToolbarAction) => {
    switch (action) {
      case 'bold':
        return handleWrap('**', '**', 'bold text');
      case 'italic':
        return handleWrap('*', '*', 'italic text');
      case 'strikethrough':
        return handleWrap('~~', '~~', 'strikethrough');
      case 'heading2':
        return handleLinePrefix('## ');
      case 'heading3':
        return handleLinePrefix('### ');
      case 'bulletList':
        return handleLinePrefix('- ');
      case 'numberedList':
        return handleLinePrefix('1. ');
      case 'quote':
        return handleLinePrefix('> ');
      case 'code':
        return handleWrap('```\n', '\n```', 'code');
      case 'link':
        return handleWrap('[', '](https://)', 'link text');
    }
  };

  // The HTML rendition of the description, i.e. what "save as HTML" persists.
  const html = useMemo(() => markdownToHtml(value, { allowImages }), [value, allowImages]);

  const handleCopyHtml = () => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard) return;
    void clipboard.writeText(html).then(
      () => setCopiedHtml(true),
      () => setCopiedHtml(false),
    );
  };

  const sourceLength = value.length;

  return (
    <div className={cn('rounded-md border border-input bg-background', className)} data-testid="rich-text-editor">
      <div className="flex flex-wrap items-center gap-1 border-b p-1.5" role="toolbar" aria-label="Formatting">
        {TOOLBAR_ITEMS.map((item) => (
          <Button
            key={item.label}
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            aria-label={item.label}
            title={item.label}
            disabled={disabled}
            onClick={() => runToolbarAction(item.action)}
          >
            {item.icon}
          </Button>
        ))}

        {allowImages && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            aria-label="Insert image"
            title="Insert image"
            disabled={disabled}
            onClick={() => setShowImageForm((open) => !open)}
          >
            <ImageIcon className="h-4 w-4" />
          </Button>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant={showPreview ? 'default' : 'ghost'}
            className="h-8 gap-1 px-2 text-xs"
            aria-pressed={showPreview}
            disabled={disabled}
            onClick={() => setShowPreview((preview) => !preview)}
          >
            {showPreview ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showPreview ? 'Edit' : 'Preview'}
          </Button>

          {showHtmlToggle && (
            <Button
              type="button"
              size="sm"
              variant={showHtml ? 'default' : 'ghost'}
              className="h-8 gap-1 px-2 text-xs"
              aria-pressed={showHtml}
              aria-label="View HTML"
              title="View the generated HTML"
              disabled={disabled}
              onClick={() => {
                setShowHtml((open) => !open);
                setShowPreview(false);
                setCopiedHtml(false);
              }}
            >
              <Code className="h-3.5 w-3.5" />
              HTML
            </Button>
          )}
        </div>
      </div>

      {showImageForm && allowImages && (
        <div className="space-y-2 border-b bg-muted/30 p-3" data-testid="image-form">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={id ? `${id}-image-url` : undefined} className="text-xs">
                Image URL
              </Label>
              <Input
                id={id ? `${id}-image-url` : undefined}
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="https://example.com/screenshot.png"
                aria-label="Image URL"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={id ? `${id}-image-alt` : undefined} className="text-xs">
                Alt text
              </Label>
              <Input
                id={id ? `${id}-image-alt` : undefined}
                value={imageAlt}
                onChange={(event) => setImageAlt(event.target.value)}
                placeholder="Screenshot of the design"
                aria-label="Image alt text"
              />
            </div>
          </div>
          {imageError && <p className="text-xs text-red-600">{imageError}</p>}
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => insertImage(imageUrl, imageAlt)}>
              Insert
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setShowImageForm(false);
                setImageError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {showHtml ? (
        <div className="space-y-2 p-3" data-testid="rich-text-html">
          {value.trim() ? (
            <>
              <textarea
                readOnly
                rows={8}
                aria-label="HTML output"
                className="w-full resize-y rounded-md border bg-muted/40 p-2 font-mono text-xs"
                value={html}
              />
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={handleCopyHtml}>
                  Copy HTML
                </Button>
                {copiedHtml && <span className="text-xs text-muted-foreground">Copied</span>}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to convert yet.</p>
          )}
        </div>
      ) : showPreview ? (
        <div className="min-h-[120px] p-3" data-testid="rich-text-preview">
          {value.trim() ? (
            <MarkdownContent content={value} previewMode={false} />
          ) : (
            <p className="text-sm text-muted-foreground">{placeholder}</p>
          )}
        </div>
      ) : (
        <Textarea
          id={id}
          name={name}
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onBlur={onBlur}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onDrop={handleDrop}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          className="min-h-[120px] resize-y rounded-none border-0 focus-visible:ring-0"
        />
      )}

      {typeof maxLength === 'number' && (
        <div className="border-t px-3 py-1 text-right text-xs text-muted-foreground">
          {sourceLength}/{maxLength}
        </div>
      )}
    </div>
  );
}

export default RichTextEditor;
