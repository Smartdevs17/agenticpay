/**
 * Project work-description payload — Issue #90
 *
 * The create-project form stores the description inside the on-chain
 * `workDescription` argument as JSON. Issue #795 made the description markdown
 * (authored through the rich text editor); issue #90 requires it to also be
 * **saved as HTML** so consumers that cannot render markdown can display it.
 *
 * `description` stays the markdown source of truth, and `descriptionHtml` is the
 * sanitized rendition produced by {@link markdownToHtml}. Keeping the shape in
 * one tested helper means both `/dashboard/projects/new` and its localized
 * variant stay in sync with the on-chain contract.
 */

import { markdownToHtml } from '@/lib/markdown/to-html';

export interface WorkDescriptionInput {
  title: string;
  /** Markdown authored in the rich text editor. */
  description?: string | null;
  /** Optional GitHub repository URL. */
  repo?: string | null;
  /** Forwarded to the HTML serializer; disable for editors without images. */
  allowImages?: boolean;
}

export interface WorkDescription {
  title: string;
  description: string;
  descriptionHtml: string;
  repo: string;
}

/** Build the structured description stored on-chain. */
export function buildWorkDescription(input: WorkDescriptionInput): WorkDescription {
  const description = input.description ?? '';

  return {
    title: input.title,
    description,
    descriptionHtml: markdownToHtml(description, { allowImages: input.allowImages ?? true }),
    repo: input.repo ?? '',
  };
}

/** Serialize the description for the `workDescription` contract argument. */
export function serializeWorkDescription(input: WorkDescriptionInput): string {
  return JSON.stringify(buildWorkDescription(input));
}

export default buildWorkDescription;
