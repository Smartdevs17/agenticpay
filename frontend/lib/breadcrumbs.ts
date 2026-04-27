/**
 * Utility functions for breadcrumb generation and path management
 */

export interface BreadcrumbItem {
  label: string;
  href: string;
}

/**
 * Maps path segments to human-readable labels
 */
const pathLabelMap: Record<string, string> = {
  dashboard: 'Dashboard',
  projects: 'Projects',
  invoices: 'Invoices',
  payments: 'Payments',
  new: 'New Project',
};

/**
 * Humanize a path segment into readable label
 * Example: "projects" -> "Projects", "my-project" -> "My Project"
 */
export function humanizePathSegment(segment: string): string {
  // Check if it's in our predefined map
  if (pathLabelMap[segment]) {
    return pathLabelMap[segment];
  }

  // Remove ID brackets and hyphens, capitalize words
  if (segment.startsWith('[') && segment.endsWith(']')) {
    return segment.slice(1, -1); // Return placeholder name without brackets
  }

  return segment
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Generate breadcrumb items from pathname
 * Example: "/dashboard/projects/123" -> [
 *   { label: "Dashboard", href: "/dashboard" },
 *   { label: "Projects", href: "/dashboard/projects" }
 * ]
 */
export function generateBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split('/').filter(Boolean);
  const breadcrumbs: BreadcrumbItem[] = [];
  let path = '';

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    path += `/${segment}`;

    // Skip ID segments (like [id])
    if (segment.startsWith('[') && segment.endsWith(']')) {
      continue;
    }

    const label = humanizePathSegment(segment);
    breadcrumbs.push({
      label,
      href: path,
    });
  }

  return breadcrumbs;
}

/**
 * Get breadcrumb items for dashboard routes with custom labels
 * Allows overriding default labels for dynamic content like project names or invoice IDs
 */
export function getDashboardBreadcrumbs(
  pathname: string,
  overrides?: Record<string, string>
): BreadcrumbItem[] {
  const breadcrumbs = generateBreadcrumbs(pathname);

  // Apply any label overrides
  if (overrides) {
    return breadcrumbs.map(item => ({
      ...item,
      label: overrides[item.href] || item.label,
    }));
  }

  return breadcrumbs;
}
