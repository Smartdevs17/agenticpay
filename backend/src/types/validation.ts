import { z } from 'zod';

export type ValidatedBody<T extends z.ZodTypeAny> = z.infer<T>;
export type ValidatedQuery<T extends z.ZodTypeAny> = z.infer<T>;
export type ValidatedParams<T extends z.ZodTypeAny> = z.infer<T>;

export interface ValidationErrorDetail {
  path: string;
  message: string;
  code: string;
}
