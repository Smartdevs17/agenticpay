import { create } from 'zustand';

interface ShortcutsStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/** Visibility of the keyboard shortcut reference dialog. */
export const useShortcutsStore = create<ShortcutsStore>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
}));
