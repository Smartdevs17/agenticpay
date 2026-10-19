/**
 * RichTextEditor tests — Issue #795
 * Covers formatting, markdown insertion, images, preview, and limits.
 */
import { useState } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RichTextEditor, type RichTextEditorProps } from '@/components/markdown/RichTextEditor';

// `globals` is disabled in vitest.config.ts, so React Testing Library cannot
// register its automatic cleanup — do it explicitly to keep tests isolated.
afterEach(cleanup);

function Harness(props: Partial<RichTextEditorProps> & { initial?: string }) {
  const { initial = '', ...rest } = props;
  const [value, setValue] = useState(initial);
  return <RichTextEditor value={value} onChange={setValue} {...rest} />;
}

function getTextarea() {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

describe('RichTextEditor', () => {
  it('renders the toolbar and an editable textarea', () => {
    render(<Harness initial="Hello" />);
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeTruthy();
    expect(screen.getByLabelText('Bold')).toBeTruthy();
    expect(screen.getByLabelText('Insert image')).toBeTruthy();
    expect(getTextarea().value).toBe('Hello');
  });

  it('reports edits through onChange', () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="" onChange={onChange} />);
    fireEvent.change(getTextarea(), { target: { value: 'New description' } });
    expect(onChange).toHaveBeenCalledWith('New description');
  });

  it('wraps the current selection in bold syntax', async () => {
    const user = userEvent.setup();
    render(<Harness initial="hello world" />);
    const textarea = getTextarea();
    textarea.setSelectionRange(0, 5);

    await user.click(screen.getByLabelText('Bold'));

    expect(textarea.value).toBe('**hello** world');
  });

  it('applies a bullet-list prefix to the selected lines', async () => {
    const user = userEvent.setup();
    render(<Harness initial={'one\ntwo'} />);
    const textarea = getTextarea();
    textarea.setSelectionRange(0, 3);

    await user.click(screen.getByLabelText('Bullet list'));

    expect(textarea.value).toBe('- one\ntwo');
  });

  it('inserts a markdown image from the image form', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByLabelText('Insert image'));
    await user.type(screen.getByLabelText('Image URL'), 'https://example.com/pic.png');
    await user.type(screen.getByLabelText('Image alt text'), 'Design mockup');
    await user.click(screen.getByRole('button', { name: 'Insert' }));

    expect(getTextarea().value).toBe('![Design mockup](https://example.com/pic.png)');
  });

  it('shows an error when inserting an image without a URL', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByLabelText('Insert image'));
    await user.click(screen.getByRole('button', { name: 'Insert' }));

    expect(screen.getByText('Image URL is required')).toBeTruthy();
  });

  it('toggles between edit and sanitized preview', async () => {
    const user = userEvent.setup();
    render(<Harness initial="**bold** description" />);

    await user.click(screen.getByRole('button', { name: 'Preview' }));

    const preview = screen.getByTestId('rich-text-preview');
    expect(preview.querySelector('strong')?.textContent).toBe('bold');
    expect(screen.queryByRole('textbox')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Edit/ }));
    expect(getTextarea()).toBeTruthy();
  });

  it('enforces the maxLength limit and renders a counter', () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="abc" onChange={onChange} maxLength={3} />);

    fireEvent.change(getTextarea(), { target: { value: 'abcd' } });

    expect(onChange).toHaveBeenCalledWith('abc');
    expect(screen.getByText('3/3')).toBeTruthy();
  });

  it('disables formatting controls when disabled', () => {
    render(<RichTextEditor value="" onChange={vi.fn()} disabled />);
    expect((screen.getByLabelText('Bold') as HTMLButtonElement).disabled).toBe(true);
    expect((getTextarea() as HTMLTextAreaElement).disabled).toBe(true);
  });
});
