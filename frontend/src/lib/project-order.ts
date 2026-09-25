/**
 * Manual ordering for the project list.
 *
 * Projects arrive from the chain in an order the user cannot influence, so the
 * list keeps a user-defined ordering in local storage and applies it on top of
 * whatever the query returns. New projects that have never been placed are
 * appended in their incoming order, so a newly created project is never hidden.
 */

/** localStorage key holding the ordered project ids. */
export const PROJECT_ORDER_STORAGE_KEY = 'agenticpay-project-order';

export function parseProjectOrder(raw: string | null): string[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of parsed) {
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  return order;
}

export function serializeProjectOrder(order: readonly string[]): string {
  return JSON.stringify([...order]);
}

/**
 * Applies a saved ordering to `projects`.
 *
 * Ids that are known but missing from the collection are dropped, so deleting a
 * project eventually shrinks the stored order instead of growing forever.
 * Returns the ordered ids as well, which is what the caller persists back.
 */
export function applyProjectOrder<T>(
  projects: readonly T[],
  order: readonly string[],
  getId: (project: T) => string
): { ordered: T[]; nextOrder: string[] } {
  const byId = new Map<string, T>();
  for (const project of projects) byId.set(getId(project), project);

  const ordered: T[] = [];
  const nextOrder: string[] = [];

  for (const id of order) {
    const project = byId.get(id);
    if (!project) continue;
    ordered.push(project);
    nextOrder.push(id);
  }

  // Anything the user has not positioned yet keeps its incoming order at the end.
  const positioned = new Set(nextOrder);
  for (const project of projects) {
    const id = getId(project);
    if (positioned.has(id)) continue;
    ordered.push(project);
    nextOrder.push(id);
  }

  return { ordered, nextOrder };
}

/** Moves the item at `from` to `to`, returning a new array. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to) return [...items];
  if (from < 0 || from >= items.length) return [...items];

  const next = [...items];
  const [moved] = next.splice(from, 1);
  const target = Math.max(0, Math.min(to, next.length));
  next.splice(target, 0, moved);
  return next;
}

/** Moves the item with `id` to index `to`, returning a new array. */
export function moveItemToIndex<T>(
  items: readonly T[],
  id: string,
  to: number,
  getId: (item: T) => string
): T[] {
  const from = items.findIndex((item) => getId(item) === id);
  if (from === -1) return [...items];
  return moveItem(items, from, to);
}

/**
 * Resolves the drop target index from a pointer position.
 *
 * Given the midpoints of every card, returns the index the dragged card should
 * occupy. `position` and `rects` share a coordinate space (viewport Y works,
 * because the caller measures with `getBoundingClientRect`).
 */
export function resolveDropIndex(
  position: number,
  rects: readonly { top: number; height: number }[]
): number {
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    if (position < rect.top + rect.height / 2) return index;
  }
  return rects.length;
}
