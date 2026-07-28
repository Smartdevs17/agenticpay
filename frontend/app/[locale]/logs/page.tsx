'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

interface LogEntry {
  level: LogLevel;
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

const LEVEL_COLORS: Record<LogLevel, string> = {
  error: 'text-red-500 bg-red-950/20 border-red-500/30',
  warn: 'text-yellow-500 bg-yellow-950/20 border-yellow-500/30',
  info: 'text-blue-400 bg-blue-950/20 border-blue-400/30',
  debug: 'text-gray-500 bg-gray-950/20 border-gray-500/30',
  trace: 'text-gray-600 bg-gray-950/10 border-gray-600/20',
};

const LEVEL_BADGES: Record<LogLevel, string> = {
  error: 'bg-red-500',
  warn: 'bg-yellow-500',
  info: 'bg-blue-400',
  debug: 'bg-gray-500',
  trace: 'bg-gray-600',
};

const ALL_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];

export default function LogViewerPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filteredEntries, setFilteredEntries] = useState<LogEntry[]>([]);
  const [search, setSearch] = useState('');
  const [selectedLevels, setSelectedLevels] = useState<LogLevel[]>(ALL_LEVELS);
  const [paused, setPaused] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [serviceFilter, setServiceFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let reconnectAttempts = 0;
    const maxReconnect = 10;

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = process.env.NEXT_PUBLIC_API_URL
        ? process.env.NEXT_PUBLIC_API_URL.replace(/^https?:\/\//, '')
        : 'localhost:3001';
      const ws = new WebSocket(`${protocol}//${host}/ws/logs`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectAttempts = 0;
      };

      ws.onclose = () => {
        setConnected(false);
        if (reconnectAttempts < maxReconnect) {
          reconnectAttempts++;
          setTimeout(connect, Math.min(1000 * Math.pow(2, reconnectAttempts), 30000));
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'log:entry' && !paused) {
            setEntries((prev) => [...prev.slice(-4999), msg.payload]);
          } else if (msg.type === 'log:buffer') {
            setEntries(msg.payload);
          } else if (msg.type === 'log:cleared') {
            setEntries([]);
          }
        } catch { /* ignore */ }
      };
    }

    connect();
    return () => { wsRef.current?.close(); };
  }, [paused]);

  useEffect(() => {
    let result = entries;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.msg?.toLowerCase().includes(q) ||
          e.module?.toLowerCase().includes(q) ||
          e.service?.toLowerCase().includes(q) ||
          e.traceId?.toLowerCase().includes(q) ||
          e.requestId?.toLowerCase().includes(q),
      );
    }
    if (selectedLevels.length < 5) {
      result = result.filter((e) => selectedLevels.includes(e.level));
    }
    if (serviceFilter) {
      result = result.filter((e) => e.service === serviceFilter);
    }
    setFilteredEntries(result);
  }, [entries, search, selectedLevels, serviceFilter]);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filteredEntries.length, autoScroll]);

  const toggleLevel = useCallback((level: LogLevel) => {
    setSelectedLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level],
    );
  }, []);

  const clearLogs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'log:clear' }));
    }
    setEntries([]);
  }, []);

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString();
    } catch {
      return ts;
    }
  };

  const uniqueServices = [...new Set(entries.map((e) => e.service).filter(Boolean))];

  return (
    <div className="min-h-screen bg-black text-gray-100 font-mono text-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-gray-300">Log Viewer</h1>
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-500">{connected ? 'connected' : 'disconnected'}</span>
          <span className="text-xs text-gray-600">
            {filteredEntries.length}/{entries.length} entries
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPaused(!paused)}
            className={`px-2 py-1 text-xs rounded ${paused ? 'bg-yellow-600 text-yellow-100' : 'bg-gray-800 text-gray-300'} hover:bg-gray-700`}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={clearLogs}
            className="px-2 py-1 text-xs rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
          >
            Clear
          </button>
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-1 text-xs rounded ${autoScroll ? 'bg-gray-700' : 'bg-gray-800'} text-gray-300 hover:bg-gray-700`}
          >
            {autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-950">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search logs..."
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
        />
        {ALL_LEVELS.map((level) => (
          <button
            key={level}
            onClick={() => toggleLevel(level)}
            className={`px-2 py-1 text-xs rounded border ${
              selectedLevels.includes(level)
                ? `${LEVEL_COLORS[level]} border`
                : 'bg-gray-900 border-gray-700 text-gray-600'
            }`}
          >
            {level}
          </button>
        ))}
        {uniqueServices.length > 0 && (
          <select
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
          >
            <option value="">All services</option>
            {uniqueServices.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
      </div>

      <div ref={containerRef} className="h-[calc(100vh-110px)] overflow-y-auto">
        {filteredEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600">
            {entries.length === 0 ? 'Waiting for logs...' : 'No matching logs'}
          </div>
        ) : (
          filteredEntries.map((entry, idx) => (
            <div
              key={`${entry.timestamp}-${idx}`}
              className={`border-b border-gray-900 cursor-pointer hover:bg-gray-900/50 ${
                LEVEL_COLORS[entry.level].split(' ')[1]
              }`}
              onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
            >
              <div className="flex items-start gap-3 px-4 py-1.5">
                <span className={`shrink-0 w-12 text-right text-xs ${LEVEL_COLORS[entry.level].split(' ')[0]}`}>
                  {formatTime(entry.timestamp)}
                </span>
                <span className={`shrink-0 w-10 text-center text-[10px] uppercase font-bold rounded ${LEVEL_BADGES[entry.level]} text-white`}>
                  {entry.level}
                </span>
                {entry.service && (
                  <span className="shrink-0 text-xs text-gray-500">{entry.service}</span>
                )}
                {entry.module && (
                  <span className="shrink-0 text-xs text-gray-600">{entry.module}</span>
                )}
                <span className="flex-1 text-xs text-gray-200 truncate">{entry.msg}</span>
                {(entry.traceId || entry.requestId) && (
                  <span className="shrink-0 text-[10px] text-gray-700 font-mono">
                    {entry.traceId?.slice(0, 8) || entry.requestId?.slice(0, 8)}
                  </span>
                )}
              </div>
              {expandedIdx === idx && (
                <div className="px-4 pb-2 pt-1 bg-gray-950 border-t border-gray-800">
                  <pre className="text-xs text-gray-400 whitespace-pre-wrap overflow-x-auto max-h-64">
                    {JSON.stringify(
                      (({ level, timestamp, msg, ...rest }) => rest)(entry),
                      null,
                      2,
                    )}
                  </pre>
                  {entry.stack && (
                    <pre className="mt-1 text-xs text-red-400 whitespace-pre-wrap">{entry.stack}</pre>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
