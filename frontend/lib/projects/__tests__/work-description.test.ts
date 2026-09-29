/**
 * buildWorkDescription / serializeWorkDescription tests — Issue #90
 */
import { describe, expect, it } from 'vitest';

import {
  buildWorkDescription,
  serializeWorkDescription,
} from '@/lib/projects/work-description';

describe('buildWorkDescription', () => {
  it('keeps the markdown description as the source of truth', () => {
    const result = buildWorkDescription({ title: 'Redesign', description: '**bold**' });

    expect(result.description).toBe('**bold**');
  });

  it('also stores the HTML rendition of the description', () => {
    const result = buildWorkDescription({ title: 'Redesign', description: '## Scope\n\n**bold**' });

    expect(result.descriptionHtml).toBe('<h2>Scope</h2>\n<p><strong>bold</strong></p>');
  });

  it('renders images in the HTML rendition', () => {
    const result = buildWorkDescription({
      title: 'Redesign',
      description: '![shot](/img/a.png)',
    });

    expect(result.descriptionHtml).toContain('<img src="/img/a.png" alt="shot" loading="lazy" />');
  });

  it('omits images when the editor disables them', () => {
    const result = buildWorkDescription({
      title: 'Redesign',
      description: '![shot](/img/a.png)',
      allowImages: false,
    });

    expect(result.descriptionHtml).toBe('<p>![shot](/img/a.png)</p>');
  });

  it('escapes hostile markup in the HTML rendition', () => {
    const result = buildWorkDescription({ title: 'Redesign', description: '<script>alert(1)</script>' });

    expect(result.descriptionHtml).not.toContain('<script>');
    expect(result.descriptionHtml).toContain('&lt;script&gt;');
  });

  it('defaults missing description and repo to empty strings', () => {
    const result = buildWorkDescription({ title: 'Redesign' });

    expect(result).toEqual({
      title: 'Redesign',
      description: '',
      descriptionHtml: '',
      repo: '',
    });
  });

  it('treats null description and repo as empty', () => {
    const result = buildWorkDescription({ title: 'Redesign', description: null, repo: null });

    expect(result.description).toBe('');
    expect(result.repo).toBe('');
  });

  it('carries the repository URL through', () => {
    const result = buildWorkDescription({ title: 'Redesign', repo: 'https://github.com/a/b' });

    expect(result.repo).toBe('https://github.com/a/b');
  });
});

describe('serializeWorkDescription', () => {
  it('produces the JSON payload passed to the contract', () => {
    const payload = serializeWorkDescription({
      title: 'Redesign',
      description: '**bold**',
      repo: 'https://github.com/a/b',
    });

    expect(JSON.parse(payload)).toEqual({
      title: 'Redesign',
      description: '**bold**',
      descriptionHtml: '<p><strong>bold</strong></p>',
      repo: 'https://github.com/a/b',
    });
  });

  it('round-trips a description containing quotes and newlines', () => {
    const description = 'He said "hi"\n\n- one\n- two';
    const payload = JSON.parse(serializeWorkDescription({ title: 't', description }));

    expect(payload.description).toBe(description);
    expect(payload.descriptionHtml).toBe('<p>He said &quot;hi&quot;</p>\n<ul><li>one</li><li>two</li></ul>');
  });
});
