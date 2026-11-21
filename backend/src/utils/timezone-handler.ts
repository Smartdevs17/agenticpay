/**
 * Issue #1022: Fix timezone handling in scheduled payouts
 * 
 * Utility for normalizing all scheduled payout times to UTC
 * Handles DST boundaries and provides local time conversion for UI display
 */

/**
 * Normalize any date/time to UTC
 * All schedules are stored in UTC internally
 */
export function normalizeToUTC(date: Date): Date {
  return new Date(date.toISOString());
}

/**
 * Convert UTC timestamp to local time for display
 * @param utcDate - Date in UTC
 * @param timezone - IANA timezone identifier (e.g., 'America/New_York', 'Asia/Dubai')
 */
export function convertUTCToLocal(utcDate: Date, timezone: string): Date {
  const utcTime = utcDate.getTime();
  const localString = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(utcTime);

  return new Date(localString);
}

/**
 * Convert local time to UTC for storage
 * @param localDate - Date in local timezone
 * @param timezone - IANA timezone identifier
 */
export function convertLocalToUTC(localDate: Date, timezone: string): Date {
  // Create date string in the specified timezone
  const localString = localDate.toLocaleString('en-US', { timeZone: timezone });
  const localTime = new Date(localString);
  
  // Calculate offset and adjust to UTC
  const offset = localTime.getTime() - localDate.getTime();
  return new Date(localDate.getTime() - offset);
}

/**
 * Calculate next execution time in UTC for a scheduled payout
 * @param scheduleType - daily, weekly, or monthly
 * @param lastExecutionUTC - Last execution time in UTC (or now if first run)
 * @param preferredHourUTC - Preferred hour of day in UTC (0-23)
 */
export function calculateNextExecutionUTC(
  scheduleType: 'daily' | 'weekly' | 'monthly',
  lastExecutionUTC: Date = new Date(),
  preferredHourUTC: number = 0
): Date {
  const next = new Date(lastExecutionUTC);
  next.setUTCHours(preferredHourUTC, 0, 0, 0);

  switch (scheduleType) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
  }

  return next;
}

/**
 * Check if a date is during a DST transition
 * @param date - Date to check
 * @param timezone - IANA timezone identifier
 */
export function isDSTTransition(date: Date, timezone: string): boolean {
  const before = new Date(date.getTime() - 24 * 60 * 60 * 1000);
  const after = new Date(date.getTime() + 24 * 60 * 60 * 1000);

  const formatOptions: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    timeZoneName: 'short',
  };

  const beforeTZ = new Intl.DateTimeFormat('en-US', formatOptions).format(before);
  const dateTZ = new Intl.DateTimeFormat('en-US', formatOptions).format(date);
  const afterTZ = new Intl.DateTimeFormat('en-US', formatOptions).format(after);

  // Extract timezone abbreviations
  const extractTZ = (str: string) => str.split(' ').pop() || '';
  
  return extractTZ(beforeTZ) !== extractTZ(dateTZ) || extractTZ(dateTZ) !== extractTZ(afterTZ);
}

/**
 * Get timezone offset in minutes for a specific date
 * Accounts for DST
 */
export function getTimezoneOffset(date: Date, timezone: string): number {
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  
  return (tzDate.getTime() - utcDate.getTime()) / (1000 * 60);
}

/**
 * Format UTC date for display in a specific timezone
 * @param utcDate - Date in UTC
 * @param timezone - IANA timezone identifier
 * @param includeTimezone - Whether to include timezone abbreviation
 */
export function formatForDisplay(
  utcDate: Date,
  timezone: string,
  includeTimezone: boolean = true
): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  };

  if (includeTimezone) {
    options.timeZoneName = 'short';
  }

  return new Intl.DateTimeFormat('en-US', options).format(utcDate);
}

/**
 * Validate IANA timezone identifier
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get common timezones for dropdown/selection
 */
export const COMMON_TIMEZONES = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'Eastern Time (US)' },
  { value: 'America/Chicago', label: 'Central Time (US)' },
  { value: 'America/Denver', label: 'Mountain Time (US)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US)' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Paris', label: 'Paris' },
  { value: 'Europe/Berlin', label: 'Berlin' },
  { value: 'Asia/Dubai', label: 'Dubai' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Asia/Shanghai', label: 'Shanghai' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Australia/Sydney', label: 'Sydney' },
] as const;

/**
 * Schedule configuration with timezone support
 */
export interface ScheduleConfig {
  scheduleType: 'daily' | 'weekly' | 'monthly';
  /** Preferred execution hour in merchant's local timezone (0-23) */
  preferredHourLocal: number;
  /** Merchant's timezone (IANA identifier) */
  timezone: string;
}

/**
 * Convert schedule config to UTC-based next execution time
 */
export function scheduleToNextExecutionUTC(config: ScheduleConfig, lastExecution?: Date): Date {
  // Convert preferred hour from local to UTC
  const now = lastExecution || new Date();
  const localDate = new Date(now);
  localDate.setHours(config.preferredHourLocal, 0, 0, 0);
  
  const utcDate = convertLocalToUTC(localDate, config.timezone);
  const preferredHourUTC = utcDate.getUTCHours();
  
  return calculateNextExecutionUTC(config.scheduleType, now, preferredHourUTC);
}
