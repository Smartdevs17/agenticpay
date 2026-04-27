'use client';

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CommandMenu() {
  const [open, setOpen] = useState(false);

  // 1. Listen for Cmd+K or Ctrl+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // 2. Listen for Escape to close 
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  return (
    <>
      {/* 3. The Visual Search Button with Shortcut Hint */}
      <Button 
        variant="outline" 
        className="hidden md:flex items-center gap-2 text-gray-500 bg-gray-50 w-64 justify-between" 
        onClick={() => setOpen(true)}
      >
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4" />
          <span className="font-normal">Search...</span>
        </div>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-gray-200 bg-white px-1.5 font-mono text-[10px] font-medium text-gray-500">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>

      {/* The Search Modal Overlay */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[20vh]" onClick={() => setOpen(false)}>
          <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl overflow-hidden border border-gray-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-center border-b border-gray-100 px-4">
              <Search className="h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search projects, invoices, or freelancers..."
                className="w-full bg-transparent border-0 py-4 px-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0 sm:text-sm"
                autoFocus
              />
              <button onClick={() => setOpen(false)} className="p-1 rounded-md hover:bg-gray-100">
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>
            <div className="p-6 text-sm text-gray-500 text-center flex flex-col items-center gap-2">
              <p>Start typing to search across your dashboard.</p>
              <div className="flex gap-2 text-xs mt-2">
                <span className="bg-gray-100 px-2 py-1 rounded">Navigate with ↑ ↓</span>
                <span className="bg-gray-100 px-2 py-1 rounded">Close with ESC</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}