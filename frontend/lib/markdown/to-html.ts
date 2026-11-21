/**
 * Markdown → HTML serialisation — Issue #90
 *
 * The rich text editor (issue #795) stores markdown as its source of truth, but
 * issue #90 additionally requires descriptions to be **saved as HTML** for
 * consumers that cannot render markdown (API payloads, emails, exports).
 *
 * This module converts the subset of markdown the editor can produce —
 * headings, bold/italic/strikethrough, inline code, fenced code, links, images,
 * lists, blockquotes and rules — into HTML.
 *
 * Security model: raw HTML is **never** passed through. Every plain text run is
 * escaped, and `javascript:`/`data:`/`vbscript:` URLs are dropped, so hostile
 * input cannot introduce script or event-handler attributes. The output is
 * therefore safe to persist and render directly, mirroring the allowlist the
 * preview applies via `rehype-sanitize` in `MarkdownContent`.
 *
 * Implemented without extra dependencies: the stringifier (`rehype-stringify`)
 * is not a dependency of this project, and adding one solely for this would be
 * a heavier change than the feature warrants.
 */

export interface MarkdownToHtmlOptions {
  /** Render `![alt](url)` images. Defaults to `true`. */
  allowImages?: boolean;
  /** Additional URL schemes to allow for links, e.g. `['tel:']`. */
  allowedProtocols?: string[];
}

/** Schemes that are safe to place in an `href`/`src`. */
const DEFAULT_PROTOCOLS = ['http:', 'https:', 'mailto:'];

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape text for use in HTML content and attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPE_MAP[character] as string);
}

/**
 * Resolve a URL from markdown, returning `undefined` when the scheme is not
 * allowlisted. Relative URLs and fragments are permitted.
 */
function safeUrl(url: string, allowedProtocols: string[]): string | undefined {
  const trimmed = url.trim();
  if (!trimmed) return undefined;

  // A scheme is only present before the first `/`, `?` or `#`. Anything without
  // a scheme is relative and safe (e.g. `/docs`, `#section`, `images/x.png`).
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (!schemeMatch) {
    // Protocol-relative URLs (`//evil.com`) inherit the page scheme; reject them.
    return trimmed.startsWith('//') ? undefined : trimmed;
  }

  const scheme = `${schemeMatch[1]!.toLowerCase()}:`;
  if (!allowedProtocols.includes(scheme)) return undefined;

  // Block header/script smuggling inside the value.
  if (/[\s\u0000-\u001F]/.test(trimmed)) return undefined;

  return trimmed;
}

interface InlineContext {
  allowedProtocols: string[];
  allowImages: boolean;
}

/**
 * Render a run of inline markdown. Code spans are extracted first so their
 * contents are rendered verbatim, then the remaining text is escaped before
 * formatting markers are turned into tags.
 */
function renderInline(source: string, context: InlineContext): string {
  const codeSpans: string[] = [];
  const stashedCode = source.replace(/(`+)([\s\S]*?)\1/g, (_match, _ticks: string, code: string) => {
    codeSpans.push(`<code>${escapeHtml(code.trim())}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  // When images are disabled the syntax must be preserved verbatim — otherwise
  // the `![alt](url)` half would still be rewritten into a link.
  const imageLiterals: string[] = [];
  const stashed = context.allowImages
    ? stashedCode
    : stashedCode.replace(/!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)/g, (match) => {
        imageLiterals.push(match);
        return `\u0001${imageLiterals.length - 1}\u0001`;
      });

  let html = escapeHtml(stashed);

  // Images before links: `![alt](url)` also contains a `[alt](url)` shape.
  if (context.allowImages) {
    html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (match, alt: string, url: string, title?: string) => {
      const safe = safeUrl(url, context.allowedProtocols);
      if (!safe) return escapeHtml(match);
      const titleAttribute = title ? ` title="${title}"` : '';
      return `<img src="${escapeHtml(safe)}" alt="${alt}"${titleAttribute} loading="lazy" />`;
    });
  }

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (match, text: string, url: string, title?: string) => {
    const safe = safeUrl(url, context.allowedProtocols);
    if (!safe) return escapeHtml(match);
    const titleAttribute = title ? ` title="${title}"` : '';
    // External links are marked so the UI can add rel="noopener".
    const isExternal = /^https?:/i.test(safe);
    const rel = isExternal ? ' rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(safe)}"${titleAttribute}${rel}>${text}</a>`;
  });

  html = html
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');

  // Restore stashed spans. Code spans already hold HTML; disabled image syntax
  // is restored as escaped literal text.
  return html
    .replace(/\u0000(\d+)\u0000/g, (_match, index: string) => codeSpans[Number(index)] ?? '')
    .replace(/\u0001(\d+)\u0001/g, (_match, index: string) => escapeHtml(imageLiterals[Number(index)] ?? ''));
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^```(\w*)\s*$/;
const BULLET_ITEM = /^\s*[-*+]\s+(.*)$/;
const ORDERED_ITEM = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^\s*(?:---+|\*\*\*+|___+)\s*$/;

/**
 * Convert markdown into sanitized HTML.
 *
 * @example
 * markdownToHtml('**bold** and ![shot](/a.png)')
 * // => '<p><strong>bold</strong> and <img src="/a.png" alt="shot" loading="lazy" /></p>'
 */
export function markdownToHtml(markdown: string, options: MarkdownToHtmlOptions = {}): string {
  const context: InlineContext = {
    allowImages: options.allowImages ?? true,
    allowedProtocols: [...DEFAULT_PROTOCOLS, ...(options.allowedProtocols ?? [])],
  };

  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] as string;

    if (!line.trim()) {
      index += 1;
      continue;
    }

    // Fenced code block.
    const fence = FENCE.exec(line);
    if (fence) {
      const language = fence[1] ?? '';
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index] as string)) {
        code.push(lines[index] as string);
        index += 1;
      }
      index += 1; // consume the closing fence
      const languageAttribute = language ? ` class="language-${escapeHtml(language)}"` : '';
      blocks.push(`<pre><code${languageAttribute}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (RULE.test(line)) {
      blocks.push('<hr />');
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      blocks.push(`<h${level}>${renderInline(heading[2]!.trim(), context)}</h${level}>`);
      index += 1;
      continue;
    }

    // Blockquote: consecutive `>` lines become one block.
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index] as string)) {
        quoted.push(QUOTE.exec(lines[index] as string)![1] as string);
        index += 1;
      }
      blocks.push(`<blockquote>${renderInline(quoted.join('\n').trim(), context)}</blockquote>`);
      continue;
    }

    if (BULLET_ITEM.test(line) || ORDERED_ITEM.test(line)) {
      const ordered = ORDERED_ITEM.test(line) && !BULLET_ITEM.test(line);
      const pattern = ordered ? ORDERED_ITEM : BULLET_ITEM;
      const items: string[] = [];
      while (index < lines.length && pattern.test(lines[index] as string)) {
        items.push(renderInline(pattern.exec(lines[index] as string)![1] as string, context));
        index += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      blocks.push(`<${tag}>${items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`);
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index] as string;
      if (
        !candidate.trim() ||
        FENCE.test(candidate) ||
        HEADING.test(candidate) ||
        QUOTE.test(candidate) ||
        RULE.test(candidate) ||
        BULLET_ITEM.test(candidate) ||
        ORDERED_ITEM.test(candidate)
      ) {
        break;
      }
      paragraph.push(candidate.trim());
      index += 1;
    }
    blocks.push(`<p>${renderInline(paragraph.join('\n'), context)}</p>`);
  }

  return blocks.join('\n');
}

export default markdownToHtml;
