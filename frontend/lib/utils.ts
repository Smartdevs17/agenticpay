import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

const DEFAULT_TIME_ZONE = 'UTC';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getBrowserTimeZone() {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function isValidTimeZone(timeZone?: string | null) {
  if (!timeZone) {
    return false;
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(timeZone?: string | null): string {
  if (isValidTimeZone(timeZone)) {
    return timeZone as string;
  }

  const browserTimeZone = getBrowserTimeZone();
  if (isValidTimeZone(browserTimeZone)) {
    return browserTimeZone as string;
  }

  return DEFAULT_TIME_ZONE;
}

function formatInTimeZone(
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions,
  timeZone?: string | null
) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Invalid date';
  }

  return new Intl.DateTimeFormat(undefined, {
    timeZone: resolveTimeZone(timeZone),
    ...options,
  }).format(date);
}

export function formatDateInTimeZone(value: string | number | Date, timeZone?: string | null) {
  return formatInTimeZone(
    value,
    {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    },
    timeZone
  );
}

export function formatTimeInTimeZone(value: string | number | Date, timeZone?: string | null) {
  return formatInTimeZone(
    value,
    {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    },
    timeZone
  );
}

export function formatDateTimeInTimeZone(
  value: string | number | Date,
  timeZone?: string | null
) {
  return formatInTimeZone(
    value,
    {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    },
    timeZone
  );
}
