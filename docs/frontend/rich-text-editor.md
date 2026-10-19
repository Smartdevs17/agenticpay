# Rich Text Editor (#795)

`frontend/components/markdown/RichTextEditor.tsx` replaces the plain `Input`
previously used for project descriptions. It gives contributors a formatting
toolbar, image support, and a live preview while keeping **markdown** as the
stored format.

## Why markdown

- Descriptions are persisted on-chain as part of `workDescription`, so a portable,
  plain-text format avoids HTML escaping problems and payload bloat.
- Rendering reuses `MarkdownContent`, which already sanitizes output with
  `rehype-sanitize` and `remark-gfm` — no new dependencies were added.

## Usage

```tsx
import { Controller } from 'react-hook-form';
import { RichTextEditor } from '@/components/markdown/RichTextEditor';

<Controller
  name="description"
  control={control}
  render={({ field }) => (
    <RichTextEditor
      id="description"
      value={field.value ?? ''}
      onChange={field.onChange}
      onBlur={field.onBlur}
      maxLength={5000}
      placeholder="Describe the work"
    />
  )}
/>;
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `value` | `string` | Markdown source (required) |
| `onChange` | `(value: string) => void` | Called on every edit (required) |
| `id` / `name` | `string` | Wired to the textarea for labels and forms |
| `placeholder` | `string` | Placeholder text |
| `disabled` | `boolean` | Disables the toolbar and textarea |
| `className` | `string` | Extra container classes |
| `maxLength` | `number` | Shows a counter and truncates input |
| `allowImages` | `boolean` | Toggle image insertion (default `true`) |
| `showHtmlToggle` | `boolean` | Show the *HTML* view toggle (default `true`, issue #90) |
| `onBlur` | `() => void` | Forwarded to the textarea (react-hook-form support) |
| `aria-invalid` / `aria-describedby` | — | Forwarded for validation messaging |

## supported formatting

Bold, italic, strikethrough, `##`/`###` headings, bullet and numbered lists,
block quotes, fenced code blocks, and links. Keyboard shortcuts match common
editors: `Cmd/Ctrl+B`, `Cmd/Ctrl+I`, `Cmd/Ctrl+K`.

## Images

Images can be inserted three ways:

1. **Toolbar** — choose *Insert image* and provide a URL plus alt text.
2. **Paste** — paste an image from the clipboard (≤ 5MB).
3. **Drag & drop** — drop an image file onto the textarea (≤ 5MB).

Pasted/dropped files are inlined as data URLs. For production uploads, prefer
the server-side `POST /api/v1/uploads` endpoint and reference the returned URL.

## Preview

The *Preview* toggle renders the markdown through `MarkdownContent` with
sanitization enabled, so raw HTML and unsafe links are stripped before display.

## HTML view and "save as HTML" (issue #90)

The *HTML* toggle shows the sanitized HTML rendition of the current description
with a **Copy HTML** button. The conversion lives in
`frontend/lib/markdown/to-html.ts` (`markdownToHtml`), and the persisted payload
is built by `frontend/lib/projects/work-description.ts` — both
`/dashboard/projects/new` and its localized variant call
`serializeWorkDescription`, so the on-chain shape stays consistent:

```ts
serializeWorkDescription({ title, description, repo });
// => {
//   title,
//   description,       // markdown source of truth (issue #795)
//   descriptionHtml,   // sanitized HTML rendition (issue #90)
//   repo,
// }
```

### Why a local serializer

The preview renders with `react-markdown`, but the project does not depend on a
markdown *stringifier* (`rehype-stringify`), and adding one purely for this would
be a heavier change than the feature warrants. `to-html.ts` therefore covers the
subset the editor can produce — headings, emphasis, strikethrough, inline and
fenced code, links, images, lists, quotes and rules — and is dependency-free.

Both paths share the same security posture:

- raw HTML is never passed through — every text run is escaped, so `<script>`
  becomes `&lt;script&gt;`;
- only `http:`, `https:` and `mailto:` URLs are emitted (plus anything passed via
  `allowedProtocols`); `javascript:`, `data:`, `vbscript:` and protocol-relative
  URLs are dropped, and external links get `rel="noopener noreferrer"`;
- images additionally use `loading="lazy"`.

## Tests

`frontend/components/markdown/__tests__/RichTextEditor.test.tsx` covers
formatting, list prefixes, image insertion/validation, preview rendering, the
character limit, and the disabled state.

`frontend/lib/markdown/__tests__/to-html.test.ts` and
`frontend/lib/projects/__tests__/work-description.test.ts` cover the HTML
rendition, including injection attempts and URL-scheme filtering, plus the
"save as HTML" payload.
