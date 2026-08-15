/**
 * getPriceForDate
 * Returns the correct hourly rate for a given equipment on a given date.
 * Falls back to eq.hourlyRate if no price history exists.
 *
 * @param {Array}  priceHistory  - array of { price, fromDate, toDate|null }
 * @param {string} dateStr       - 'yyyy-MM-dd'
 * @param {number} fallbackRate  - eq.hourlyRate
 */
export function getPriceForDate(priceHistory, dateStr, fallbackRate = 0) {
  if (!priceHistory || priceHistory.length === 0) return fallbackRate

  // Sort descending by fromDate
  const sorted = [...priceHistory].sort((a, b) => b.fromDate.localeCompare(a.fromDate))

  for (const entry of sorted) {
    if (dateStr >= entry.fromDate) {
      // Check toDate if exists
      if (!entry.toDate || dateStr <= entry.toDate) {
        return entry.price
      }
    }
  }

  // Before all price entries — use earliest price
  const earliest = [...priceHistory].sort((a, b) => a.fromDate.localeCompare(b.fromDate))[0]
  return earliest?.price ?? fallbackRate
}

/**
 * recalcLogsWithPriceHistory
 * Recalculates cost for an array of logs using price history.
 */
export function recalcLogsWithPriceHistory(logs, priceHistory, fallbackRate) {
  return logs.map(log => ({
    ...log,
    effectiveRate: getPriceForDate(priceHistory, log.date, fallbackRate),
    cost: (log.hours || 0) * getPriceForDate(priceHistory, log.date, fallbackRate),
  }))
}
