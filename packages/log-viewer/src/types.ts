export interface LogEntry {
  level: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  timestamp: string;
  msg: string;
  module?: string;
  service?: string;
  traceId?: string;
  requestId?: string;
  correlationId?: string;
  stack?: string;
  [key: string]: unknown;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface LogFilter {
  levels: LogLevel[];
  search: string;
  service?: string;
  module?: string;
  timeRange?: { start: string; end: string };
}

export interface LogViewerState {
  entries: LogEntry[];
  filter: LogFilter;
  paused: boolean;
  expandedEntry: number | null;
}
