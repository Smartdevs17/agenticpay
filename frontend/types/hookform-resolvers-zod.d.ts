declare module '@hookform/resolvers/zod' {
  import type { FieldValues, Resolver } from 'react-hook-form';

  export function zodResolver<TFieldValues extends FieldValues = FieldValues>(
    schema: unknown,
    schemaOptions?: unknown,
    resolverOptions?: {
      mode?: 'async' | 'sync';
      raw?: boolean;
    }
  ): Resolver<TFieldValues>;
}
