// Client-side port of lambda-layers/finance-common/python/finance_common/schedule.py's
// next_date_after - kept in sync with that file's logic intentionally.
// Uses plain y/m/d integers rather than the Date object throughout, since
// Date's local-timezone interpretation of "YYYY-MM-DD" strings is a classic
// source of off-by-one-day bugs that pure integer arithmetic avoids entirely.

function parseISO(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m, d };
}

function toISO({ y, m, d }) {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

function addDays(dateStr, days) {
  // Only used for weekly/biweekly (7/14 day jumps), where using Date's
  // UTC-anchored arithmetic is safe since there's no month-length
  // ambiguity to worry about.
  const { y, m, d } = parseISO(dateStr);
  const utcMs = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(utcMs);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function addMonths({ y, m, d }, months) {
  const monthIndex = m - 1 + months;
  const year = y + Math.floor(monthIndex / 12);
  const month = (((monthIndex % 12) + 12) % 12) + 1;
  const day = Math.min(d, 28); // templates are expected to use anchorDay <= 28, matching the backend
  return { y: year, m: month, d: day };
}

function nextSemimonthly({ y, m, d }, anchorDays) {
  for (const day of anchorDays) {
    if (d < day) return toISO({ y, m, d: day });
  }
  const firstOfNext = addMonths({ y, m, d: 1 }, 1);
  return toISO({ ...firstOfNext, d: anchorDays[0] });
}

export function nextDateAfter(item, fromDateStr) {
  const freq = item.frequency;
  if (freq === "weekly") return addDays(fromDateStr, 7);
  if (freq === "biweekly") return addDays(fromDateStr, 14);
  if (freq === "semimonthly") {
    const anchorDays = [...(item.anchorDays || [1, 15])].sort((a, b) => a - b);
    return nextSemimonthly(parseISO(fromDateStr), anchorDays);
  }
  if (freq === "monthly") return toISO(addMonths(parseISO(fromDateStr), 1));
  if (freq === "annual") return toISO(addMonths(parseISO(fromDateStr), 12));
  if (freq === "custom") {
    const count = Math.max(parseInt(item.intervalCount, 10) || 1, 1);
    const unit = item.intervalUnit || "days";
    if (unit === "days") return addDays(fromDateStr, count);
    if (unit === "weeks") return addDays(fromDateStr, count * 7);
    if (unit === "months") return toISO(addMonths(parseISO(fromDateStr), count));
    throw new Error(`Unknown intervalUnit: ${unit}`);
  }
  throw new Error(`Unknown frequency: ${freq}`);
}

/** Every occurrence of `item` from its current nextDueDate up to (and
 * including) endDateStr, bounded to avoid a runaway loop on malformed data. */
export function occurrencesUntil(item, endDateStr, maxCount = 60) {
  const results = [];
  let current = item.nextDueDate;
  for (let i = 0; i < maxCount && current <= endDateStr; i++) {
    results.push(current);
    current = nextDateAfter(item, current);
  }
  return results;
}
