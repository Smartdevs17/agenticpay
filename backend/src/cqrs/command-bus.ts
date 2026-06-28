/**
 * Command bus — dispatches write operations to the primary DB.
 * Commands are fire-and-execute; they mutate state and return a result.
 */

export interface Command<TResult = void> {
  readonly _type: string;
}

export type CommandHandler<TCommand extends Command<TResult>, TResult = void> = (
  command: TCommand
) => Promise<TResult>;

const registry = new Map<string, CommandHandler<Command<unknown>, unknown>>();

export function registerCommandHandler<TCommand extends Command<TResult>, TResult>(
  type: string,
  handler: CommandHandler<TCommand, TResult>
): void {
  registry.set(type, handler as CommandHandler<Command<unknown>, unknown>);
}

export async function executeCommand<TResult>(command: Command<TResult>): Promise<TResult> {
  const handler = registry.get(command._type);
  if (!handler) throw new Error(`No handler registered for command: ${command._type}`);
  return handler(command) as Promise<TResult>;
}
