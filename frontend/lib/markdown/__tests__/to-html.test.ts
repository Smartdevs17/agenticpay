/**
 * markdownToHtml tests — Issue #90 ("Save as HTML")
 */
import { describe, expect, it } from 'vitest';

import { escapeHtml, markdownToHtml } from '@/lib/markdown/to-html';

describe('markdownToHtml — block structure', () => {
  it('returns an empty string for empty input', () => {
    expect(markdownToHtml('')).toBe('');
    expect(markdownToHtml('   \n\n  ')).toBe('');
  });

  it('wraps plain text in a paragraph', () => {
    expect(markdownToHtml('Hello world')).toBe('<p>Hello world</p>');
  });

  it('joins consecutive lines into one paragraph', () => {
    expect(markdownToHtml('line one\nline two')).toBe('<p>line one\nline two</p>');
  });

  it('separates paragraphs on blank lines', () => {
    expect(markdownToHtml('first\n\nsecond')).toBe('<p>first</p>\n<p>second</p>');
  });

  it('renders headings h1–h6', () => {
    expect(markdownToHtml('# One')).toBe('<h1>One</h1>');
    expect(markdownToHtml('## Two')).toBe('<h2>Two</h2>');
    expect(markdownToHtml('### Three')).toBe('<h3>Three</h3>');
    expect(markdownToHtml('###### Six')).toBe('<h6>Six</h6>');
  });

  it('renders bullet lists', () => {
    expect(markdownToHtml('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
  });

  it('renders ordered lists', () => {
    expect(markdownToHtml('1. first\n2. second')).toBe('<ol><li>first</li><li>second</li></ol>');
  });

  it('renders blockquotes', () => {
    expect(markdownToHtml('> quoted')).toBe('<blockquote>quoted</blockquote>');
  });

  it('renders horizontal rules', () => {
    expect(markdownToHtml('---')).toBe('<hr />');
  });

  it('renders fenced code with a language class and escapes the body', () => {
    const html = markdownToHtml('```ts\nconst a = "<b>";\n```');
    expect(html).toBe('<pre><code class="language-ts">const a = &quot;&lt;b&gt;&quot;;</code></pre>');
  });

  it('treats a fenced block as code rather than markdown', () => {
    expect(markdownToHtml('```\n**not bold**\n```')).toContain('**not bold**');
  });
});

describe('markdownToHtml — inline formatting', () => {
  it('renders bold with ** and __', () => {
    expect(markdownToHtml('**bold**')).toBe('<p><strong>bold</strong></p>');
    expect(markdownToHtml('__bold__')).toBe('<p><strong>bold</strong></p>');
  });

  it('renders italic with * and _', () => {
    expect(markdownToHtml('*italic*')).toBe('<p><em>italic</em></p>');
    expect(markdownToHtml('some _italic_ text')).toBe('<p>some <em>italic</em> text</p>');
  });

  it('renders strikethrough', () => {
    expect(markdownToHtml('~~gone~~')).toBe('<p><del>gone</del></p>');
  });

  it('renders inline code without applying formatting inside it', () => {
    expect(markdownToHtml('use `**not bold**` here')).toBe(
      '<p>use <code>**not bold**</code> here</p>'
    );
  });

  it('escapes code span contents', () => {
    expect(markdownToHtml('`<script>`')).toBe('<p><code>&lt;script&gt;</code></p>');
  });

  it('combines formatting with surrounding text', () => {
    expect(markdownToHtml('a **b** and *c*')).toBe('<p>a <strong>b</strong> and <em>c</em></p>');
  });
});

describe('markdownToHtml — links and images', () => {
  it('renders links', () => {
    expect(markdownToHtml('[docs](https://example.com/docs)')).toBe(
      '<p><a href="https://example.com/docs" rel="noopener noreferrer">docs</a></p>'
    );
  });

  it('renders relative links without a rel attribute', () => {
    expect(markdownToHtml('[home](/dashboard)')).toBe('<p><a href="/dashboard">home</a></p>');
  });

  it('allows mailto links', () => {
    expect(markdownToHtml('[mail](mailto:hi@example.com)')).toContain('href="mailto:hi@example.com"');
  });

  it('renders images with alt text and lazy loading', () => {
    expect(markdownToHtml('![shot](/img/a.png)')).toBe(
      '<p><img src="/img/a.png" alt="shot" loading="lazy" /></p>'
    );
  });

  it('omits images when they are disabled', () => {
    const html = markdownToHtml('![shot](/img/a.png)', { allowImages: false });
    expect(html).toBe('<p>![shot](/img/a.png)</p>');
  });

  it('leaves a rejected-protocol link as inert literal text', () => {
    const html = markdownToHtml('[click](javascript:alert(1))');
    // No anchor is emitted; the syntax survives only as escaped text.
    expect(html).not.toContain('<a ');
    expect(html).toBe('<p>[click](javascript:alert(1))</p>');
  });
});

describe('markdownToHtml — injection defence', () => {
  it('escapes raw HTML instead of passing it through', () => {
    const html = markdownToHtml('<script>alert(1)</script>');
    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(html).not.toContain('<script>');
  });

  it('escapes HTML inside emphasis', () => {
    expect(markdownToHtml('**<img src=x onerror=alert(1)>**')).toContain(
      '&lt;img src=x onerror=alert(1)&gt;'
    );
  });

  it('drops event-handler style attributes smuggled through a link', () => {
    const html = markdownToHtml('[x](https://example.com" onmouseover="alert(1))');
    // The payload may survive as escaped text, but never as a real attribute.
    expect(html).not.toContain('<a ');
    expect(html).not.toMatch(/<[a-z]+[^>]*onmouseover=/i);
  });

  it('rejects data: and vbscript: URLs', () => {
    const dataUrl = markdownToHtml('[x](data:text/html;base64,PHNjcmlwdD4=)');
    expect(dataUrl).not.toContain('<a ');

    const vbscript = markdownToHtml('![x](vbscript:msgbox)');
    expect(vbscript).not.toContain('<img ');
  });

  it('rejects protocol-relative URLs', () => {
    expect(markdownToHtml('[x](//evil.example.com)')).not.toContain('href="//');
  });

  it('honours extra allowlisted protocols', () => {
    expect(markdownToHtml('[call](tel:+15551234)', { allowedProtocols: ['tel:'] })).toContain(
      'href="tel:+15551234"'
    );
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
});
