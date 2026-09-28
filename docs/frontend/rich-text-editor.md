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

## Tests

`frontend/components/markdown/__tests__/RichTextEditor.test.tsx` covers
formatting, list prefixes, image insertion/validation, preview rendering, the
character limit, and the disabled state.
