const rfc3339Instant = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;

function leapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  if (month === 2) return leapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isCanonicalInstant(value) {
  if (typeof value !== 'string') return false;
  const match = rfc3339Instant.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute]
    = match.slice(1).map(part => part === undefined ? undefined : Number(part));
  if (year < 1
      || month < 1 || month > 12
      || day < 1 || day > daysInMonth(year, month)
      || hour < 0 || hour > 23
      || minute < 0 || minute > 59
      || second < 0 || second > 59
      || (offsetHour !== undefined && (offsetHour > 23 || offsetMinute > 59))) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}
