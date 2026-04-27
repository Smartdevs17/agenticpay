import React, { useEffect, useState } from "react";

type Shortcut = {
  key: string;
  description: string;
  category: string;
};
const ShortcutsModal: React.FC = () => {
  const shortcuts: Shortcut[] = [
    { key: "?", description: "Open help modal", category: "General" },
    { key: "Ctrl + S", description: "Save changes", category: "Actions" },
    { key: "Ctrl + F", description: "Search", category: "Navigation" },
    { key: "Esc", description: "Close modal", category: "General" },
  ];

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName;
      const isTyping =
        activeTag === "INPUT" ||
        activeTag === "TEXTAREA" ||
        (document.activeElement as HTMLElement)?.isContentEditable;

      if (isTyping) return;

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        setOpen(prev => !prev);
      }

      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const filtered = shortcuts.filter(s =>
    `${s.key} ${s.description} ${s.category}`
      .toLowerCase()
      .includes(filter.toLowerCase())
  );

  const grouped = filtered.reduce((acc, shortcut) => {
    if (!acc[shortcut.category]) {
      acc[shortcut.category] = [];
    }
    acc[shortcut.category].push(shortcut);
    return acc;
  }, {} as Record<string, Shortcut[]>);

  if (!open) return null;

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>Keyboard Shortcuts</h2>

        <input
          type="text"
          placeholder="Search shortcuts..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        {Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <h3>{category}</h3>
            <ul>
              {items.map((s, i) => (
                <li key={i}>
                  <strong>{s.key}</strong> — {s.description}
                </li>
              ))}
            </ul>
          </div>
        ))}

        <button onClick={() => setOpen(false)}>Close</button>
      </div>
    </div>
  );
};

export default ShortcutsModal;