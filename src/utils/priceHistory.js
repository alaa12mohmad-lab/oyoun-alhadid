export function getPriceForDate(priceHistory, dateStr, fallbackRate = 0) {
  if (!priceHistory || priceHistory.length === 0) return fallbackRate

  // Sort ascending by fromDate
  const sorted = [...priceHistory].sort((a, b) => a.fromDate.localeCompare(b.fromDate))

  // Find the applicable price entry
  let applicable = null
  for (const entry of sorted) {
    if (dateStr >= entry.fromDate) {
      applicable = entry
    }
  }

  if (applicable) return applicable.price

  // Date is before all entries — use the earliest price
  return sorted[0]?.price ?? fallbackRate
}

export function recalcLogsWithPriceHistory(logs, priceHistory, fallbackRate) {
  return logs.map(log => ({
    ...log,
    effectiveRate: getPriceForDate(priceHistory, log.date, fallbackRate),
    cost: (log.hours || 0) * getPriceForDate(priceHistory, log.date, fallbackRate),
  }))
}
