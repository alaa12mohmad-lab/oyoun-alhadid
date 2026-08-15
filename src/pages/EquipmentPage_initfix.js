// PATCH: Replace initAllPrices function in EquipmentPage.jsx
// Find: async function initAllPrices() {
// Replace entire function with this:

  async function initAllPrices() {
    if (!confirm('سيتم إنشاء سجل أسعار لكل المعدات بأقدم تاريخ لها في السجلات. هل تريد المتابعة؟')) return
    setInitLoading(true)
    setInitMsg('')
    let count = 0
    try {
      // Get all logs to find earliest date per equipment
      const allLogsSnap = await getDocs(
        query(collection(db, 'logs'), orderBy('date', 'asc'))
      )
      const earliestDate = {}
      allLogsSnap.docs.forEach(d => {
        const log = d.data()
        if (!earliestDate[log.equipmentId] || log.date < earliestDate[log.equipmentId]) {
          earliestDate[log.equipmentId] = log.date
        }
      })

      for (const eq of items) {
        if (eq.status === 'retired') continue
        // Check if already has priceHistory
        const snap = await getDocs(collection(db, 'equipment', eq.id, 'priceHistory'))
        if (snap.empty && eq.hourlyRate) {
          // Use earliest log date, or startDate, or today
          const fromDate = earliestDate[eq.id] || eq.startDate || today
          await addDoc(collection(db, 'equipment', eq.id, 'priceHistory'), {
            price: parseFloat(eq.hourlyRate),
            fromDate,
            toDate: null,
            createdAt: serverTimestamp(),
          })
          count++
        }
      }
      setInitMsg(`✅ تم تهيئة ${count} معدة — الأسعار ستُحسب من أقدم سجل لكل معدة`)
    } catch (e) {
      setInitMsg('❌ خطأ: ' + e.message)
    } finally {
      setInitLoading(false)
    }
  }
