'use client';

import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading2,
  Quote,
  Undo2,
  Redo2,
  ImagePlus,
  Link2,
  Unlink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

type RichTextEditorProps = {
  value?: string;
  onChange: (html: string) => void;
};

function normalizeHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return '';

  if (typeof window === 'undefined') return trimmed;

  const doc = new DOMParser().parseFromString(trimmed, 'text/html');
  const hasImage = !!doc.body.querySelector('img');
  const text = doc.body.textContent?.replace(/\u00a0/g, ' ').trim() ?? '';

  if (!hasImage && text === '') return '';

  return trimmed;
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!editor) return null;

  const insertImageByUrl = () => {
    const url = window.prompt('Enter image URL');
    if (!url) return;

    editor.chain().focus().setImage({ src: url }).run();
  };

  const insertLink = () => {
    const url = window.prompt('Enter link URL');
    if (!url) return;

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const removeLink = () => {
    editor.chain().focus().unsetLink().run();
  };

  const pickLocalImage = () => {
    fileInputRef.current?.click();
  };

  const onLocalImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        editor.chain().focus().setImage({ src: result }).run();
      }
    };
    reader.readAsDataURL(file);

    e.target.value = '';
  };

  return (
    <div className="mb-3 flex flex-wrap gap-2 rounded-md border p-2">
      <Button type="button" variant="outline" size="sm" onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </Button>

      <Button type="button" variant="outline" size="sm" onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </Button>

      <Button type="button" variant="outline" size="sm" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="h-4 w-4" />
      </Button>

      <Button type="button" variant="outline" size="sm" onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="h-4 w-4" />
      </Button>

      <Button type="button" variant="outline" size="sm" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="h-4 w-4" />
      </Button>

      <Button type="button" variant="outline" size="sm" onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="h-4 w-4" />
      </Button>

      <Button type="button" variant="outline" size="sm" onClick={insertLink}>
        <Link2 className="h-4 w-4" />
      </Button>

      <Button type="button" variant="outline" size="sm" onClick={removeLink}>
        <Unlink className="h-4 w-4" />
      </Button>

      <Button type="button" variant="outline" size="sm" onClick={insertImageByUrl}>
        <ImagePlus className="h-4 w-4" />
      </Button>

      <Button type="button" variant="outline" size="sm" onClick={pickLocalImage}>
        Upload Image
      </Button>

      <Button type="button" variant="outline" size="sm" onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 className="h-4 w-4" />
      </Button>

      <Button type="button" variant="outline" size="sm" onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 className="h-4 w-4" />
      </Button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onLocalImageChange}
      />
    </div>
  );
}

export function RichTextEditor({ value = '', onChange }: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Image,
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class:
          'min-h-[200px] rounded-md border px-3 py-2 text-sm outline-none prose prose-sm max-w-none',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(normalizeHtml(editor.getHTML()));
    },
  });

  useEffect(() => {
    if (!editor) return;

    const current = normalizeHtml(editor.getHTML());
    const incoming = normalizeHtml(value);

    if (current !== incoming) {
      editor.commands.setContent(incoming || '', { emitUpdate: false });
    }
  }, [editor, value]);

  return (
    <div className="space-y-2">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}