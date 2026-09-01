import { useEffect, useState } from 'react'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek } from 'date-fns'
import { getPriceForDate } from '../utils/priceHistory'

function generateInvoiceNumber() {
  const d = new Date()
  return `INV-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`
}

export default function SupplierReportPage() {
  const [suppliers, setSuppliers]     = useState([])
  const [allEquipment, setAllEquipment] = useState([])
  const [supplierEquipment, setSupplierEquipment] = useState([]) // filtered by supplier
  const [filters, setFilters] = useState({
    supplierId:  '',
    equipmentId: '', // '' = all
    dateFrom:    format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    dateTo:      format(endOfMonth(new Date()),   'yyyy-MM-dd'),
    preset:      'month',
    reportType:  'both',    // 'timesheet' | 'summary' | 'both'
    version:     'supplier', // 'supplier' | 'accounting'
  })
  const [reportData, setReportData] = useState(null)
  const [loading, setLoading]       = useState(false)
  const [generated, setGenerated]   = useState(false)
  const [invoiceNo]                 = useState(generateInvoiceNumber())

  useEffect(() => { loadMeta() }, [])

  // Update supplier equipment list when supplierId changes
  useEffect(() => {
    if (filters.supplierId) {
      setSupplierEquipment(allEquipment.filter(e => e.supplierId === filters.supplierId))
    } else {
      setSupplierEquipment([])
    }
    setFilters(f => ({ ...f, equipmentId: '' }))
  }, [filters.supplierId, allEquipment])

  async function loadMeta() {
    const [supSnap, eqSnap] = await Promise.all([
      getDocs(collection(db, 'suppliers')),
      getDocs(collection(db, 'equipment')),
    ])
    setSuppliers(supSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setAllEquipment(eqSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  function applyPreset(preset) {
    const now = new Date()
    let from, to
    if (preset === 'week')      { from = startOfWeek(now, { weekStartsOn: 6 }); to = endOfWeek(now, { weekStartsOn: 6 }) }
    else if (preset === 'month')     { from = startOfMonth(now); to = endOfMonth(now) }
    else if (preset === 'lastmonth') { from = startOfMonth(subMonths(now,1)); to = endOfMonth(subMonths(now,1)) }
    setFilters(f => ({ ...f, preset, dateFrom: format(from,'yyyy-MM-dd'), dateTo: format(to,'yyyy-MM-dd') }))
  }

  async function generate() {
    if (!filters.supplierId) return alert('يرجى اختيار المورد')
    setLoading(true); setGenerated(false)
    try {
      const eqMap = {}; allEquipment.forEach(e => eqMap[e.id] = e)
      const supplier = suppliers.find(s => s.id === filters.supplierId)

      // Query logs
      let logsSnap = await getDocs(query(
        collection(db, 'logs'),
        where('supplierId', '==', filters.supplierId),
        where('date', '>=', filters.dateFrom),
        where('date', '<=', filters.dateTo),
        orderBy('date', 'asc')
      ))
      let logs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }))

      // Filter by equipment if selected
      if (filters.equipmentId) {
        logs = logs.filter(l => l.equipmentId === filters.equipmentId)
      }

      // Load priceHistory
      const usedEqIds = [...new Set(logs.map(l => l.equipmentId))]
      const histories = {}
      await Promise.all(usedEqIds.map(async eqId => {
        const s = await getDocs(query(collection(db, 'equipment', eqId, 'priceHistory'), orderBy('fromDate', 'asc')))
        histories[eqId] = s.docs.map(d => ({ id: d.id, ...d.data() }))
      }))

      function getRate(log) {
        const history  = histories[log.equipmentId] || []
        const fallback = eqMap[log.equipmentId]?.hourlyRate || log.hourlyRate || 0
        return getPriceForDate(history, log.date, fallback)
      }

      // Filter retired
      const filteredLogs = logs.filter(log => {
        const eq = eqMap[log.equipmentId]
        if (eq?.status === 'retired' && eq?.retiredDate) return log.date <= eq.retiredDate
        return true
      }).map(log => ({
        ...log,
        effectiveRate: getRate(log),
        cost: (log.hours || 0) * getRate(log),
      }))

      // Group by equipment
      const byEquipment = {}
      filteredLogs.forEach(log => {
        if (!byEquipment[log.equipmentId]) {
          const eq = eqMap[log.equipmentId]
          byEquipment[log.equipmentId] = {
            id: log.equipmentId,
            name: log.equipmentName || eq?.name || '—',
            type: eq?.type || '—',
            siteName: log.siteName || eq?.siteName || '—',
            hourlyRate: getRate(log),
            logs: [], totalHours: 0, totalCost: 0,
          }
        }
        const eq = byEquipment[log.equipmentId]
        eq.logs.push(log)
        if (log.status === 'working') {
          eq.totalHours += log.hours || 0
          eq.totalCost  += log.cost
        }
      })

      const eqList      = Object.values(byEquipment).sort((a,b) => a.name.localeCompare(b.name))
      const grandHours  = eqList.reduce((s,e) => s + e.totalHours, 0)
      const grandCost   = eqList.reduce((s,e) => s + e.totalCost,  0)

      setReportData({ supplier, eqList, grandHours, grandCost, logs: filteredLogs })
      setGenerated(true)
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  function exportExcel() {
    if (!reportData) return
    import('xlsx').then(XLSX => {
      const wb         = XLSX.utils.book_new()
      const showPrice  = filters.version === 'accounting'
      const supplier   = reportData.supplier

      const summaryRows = [
        [`تقرير المورد — ${supplier?.name || '—'}`],
        [`رقم المرجع: ${invoiceNo}`],
        [`الفترة: ${filters.dateFrom} — ${filters.dateTo}`],
        [showPrice ? 'نسخة المحاسبة' : 'نسخة المورد'],
        [],
        showPrice
          ? ['#', 'المعدة', 'النوع', 'الموقع', 'ساعات العمل', 'سعر/ساعة', 'الإجمالي (ريال)']
          : ['#', 'المعدة', 'النوع', 'الموقع', 'ساعات العمل'],
        ...reportData.eqList.map((e,i) => showPrice
          ? [i+1, e.name, e.type, e.siteName, e.totalHours, e.hourlyRate, e.totalCost.toFixed(2)]
          : [i+1, e.name, e.type, e.siteName, e.totalHours]
        ),
        [],
        showPrice
          ? ['', 'الإجمالي', '', '', reportData.grandHours, '', reportData.grandCost.toFixed(2)]
          : ['', 'الإجمالي', '', '', reportData.grandHours],
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'الملخص')

      reportData.eqList.forEach(eq => {
        const rows = [
          [`تايم شيت — ${eq.name}`],
          [`الموقع: ${eq.siteName} | المرجع: ${invoiceNo}`],
          [],
          showPrice
            ? ['#', 'التاريخ', 'الحالة', 'الساعات', 'سعر/ساعة', 'التكلفة', 'ملاحظات']
            : ['#', 'التاريخ', 'الحالة', 'الساعات', 'ملاحظات'],
          ...eq.logs.map((l,i) => showPrice
            ? [i+1, l.date, l.status==='working'?'شغالة':l.status==='breakdown'?'عطل':'صيانة', l.hours||'—', l.effectiveRate, l.cost>0?l.cost.toFixed(2):'—', l.notes||'']
            : [i+1, l.date, l.status==='working'?'شغالة':l.status==='breakdown'?'عطل':'صيانة', l.hours||'—', l.notes||'']
          ),
          [],
          showPrice ? ['','الإجمالي','',eq.totalHours,'',eq.totalCost.toFixed(2),''] : ['','الإجمالي','',eq.totalHours,''],
        ]
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), eq.name.substring(0,28))
      })

      XLSX.writeFile(wb, `تقرير-${reportData.supplier?.name}-${filters.dateFrom}.xlsx`)
    })
  }

  const showPrice   = filters.version === 'accounting'
  const supplier    = reportData?.supplier

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body { background: white !important; color: #1a1f2e !important; direction: rtl; font-family: 'IBM Plex Sans Arabic', sans-serif; margin: 0; }
          .print-page { padding: 24px 32px; }

          /* Invoice header */
          .inv-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0; }
          .inv-company { }
          .inv-company-name { font-size: 22px; font-weight: 800; color: #1a1f2e; }
          .inv-company-sub { font-size: 11px; color: #888; margin-top: 2px; }
          .inv-badge { display: inline-block; margin-top: 6px; padding: 3px 12px; border-radius: 20px; font-size: 10px; font-weight: 700; }
          .inv-badge-supplier { background: #e8f4fd; color: #1a6fa0; }
          .inv-badge-accounting { background: #fef3cd; color: #856404; }
          .inv-title-block { text-align: left; }
          .inv-title { font-size: 28px; font-weight: 900; color: #e8a020; letter-spacing: 1px; }
          .inv-no { font-size: 12px; color: #888; margin-top: 2px; }
          .inv-date { font-size: 11px; color: #555; }

          /* Divider */
          .inv-divider { border: none; border-top: 3px solid #1a1f2e; margin: 14px 0; }
          .inv-divider-gold { border: none; border-top: 2px solid #e8a020; margin: 10px 0; }

          /* Parties */
          .inv-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 16px; }
          .inv-party-label { font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
          .inv-party-name { font-size: 15px; font-weight: 700; color: #1a1f2e; }
          .inv-party-sub { font-size: 11px; color: #555; }
          .inv-period-box { background: #f8f8f8; border: 1px solid #ddd; border-radius: 6px; padding: 8px 14px; display: inline-block; font-size: 12px; font-weight: 600; color: #333; }

          /* Summary table */
          .inv-section-title { font-size: 12px; font-weight: 700; color: #1a1f2e; border-right: 3px solid #e8a020; padding-right: 8px; margin: 16px 0 8px; }
          .inv-table { width: 100%; border-collapse: collapse; font-size: 11px; }
          .inv-table th { background: #1a1f2e; color: white; padding: 7px 10px; text-align: right; }
          .inv-table td { padding: 6px 10px; border-bottom: 1px solid #eee; }
          .inv-table tr:nth-child(even) td { background: #fafafa; }
          .inv-table .total-row td { font-weight: 700; background: #f0f0f0; border-top: 2px solid #1a1f2e; }

          /* Timesheet */
          .ts-header { display: flex; justify-content: space-between; align-items: center; background: #f8f8f8; padding: 8px 12px; border-radius: 6px 6px 0 0; border: 1px solid #ddd; }
          .ts-eq-name { font-size: 13px; font-weight: 700; color: #1a1f2e; }
          .ts-eq-sub { font-size: 10px; color: #777; }
          .ts-total { font-size: 12px; font-weight: 700; color: #e8a020; }
          .ts-table { width: 100%; border-collapse: collapse; font-size: 10px; border: 1px solid #ddd; border-top: none; margin-bottom: 14px; }
          .ts-table th { background: #eee; color: #333; padding: 5px 8px; text-align: right; border-bottom: 1px solid #ddd; }
          .ts-table td { padding: 4px 8px; border-bottom: 1px solid #f0f0f0; }
          .ts-table .ts-total-row td { font-weight: 700; background: #f5f5f5; border-top: 1px solid #ddd; }

          /* Grand total box */
          .grand-total-box { margin-top: 20px; border: 2px solid #1a1f2e; border-radius: 8px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; }
          .grand-label { font-size: 14px; font-weight: 700; }
          .grand-amount { font-size: 22px; font-weight: 900; color: #e8a020; }
          .grand-hours { font-size: 11px; color: #888; }

          /* Signature */
          .inv-signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 30px; }
          .sig-box { border-top: 1px solid #333; padding-top: 8px; text-align: center; font-size: 11px; color: #555; }

          /* Footer */
          .inv-footer { margin-top: 20px; border-top: 1px solid #eee; padding-top: 10px; font-size: 9px; color: #aaa; display: flex; justify-content: space-between; }

          .page-break { page-break-before: always; }
        }
        @media screen { .print-only { display: none; } }
      `}</style>

      {/* ── Screen UI ── */}
      <div className="page no-print">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="page-title">🏢 تقرير المورد</div>
            <div className="page-sub">تايم شيت وفاتورة احترافية</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {generated && <button className="btn btn-secondary" onClick={exportExcel}>📥 Excel</button>}
            {generated && <button className="btn btn-primary" onClick={() => window.print()}>🖨️ طباعة / PDF</button>}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><span className="card-title">🔍 إعدادات التقرير</span></div>
          <div className="card-body">

            {/* Supplier + Equipment */}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">المورد *</label>
                <select className="form-control" value={filters.supplierId}
                  onChange={e => setFilters(f => ({ ...f, supplierId: e.target.value }))}>
                  <option value="">اختر المورد</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">المعدة</label>
                <select className="form-control" value={filters.equipmentId}
                  onChange={e => setFilters(f => ({ ...f, equipmentId: e.target.value }))}
                  disabled={!filters.supplierId}>
                  <option value="">كل المعدات</option>
                  {supplierEquipment.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                {filters.supplierId && supplierEquipment.length === 0 && (
                  <div className="info-text">لا توجد معدات مسجلة لهذا المورد</div>
                )}
              </div>
            </div>

            {/* Date preset */}
            <div style={{ marginBottom: 14 }}>
              <label className="form-label">الفترة الزمنية</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[{ key: 'week', label: 'هذا الأسبوع' }, { key: 'month', label: 'هذا الشهر' }, { key: 'lastmonth', label: 'الشهر الماضي' }, { key: 'custom', label: 'مخصص' }].map(p => (
                  <button key={p.key} type="button" onClick={() => p.key !== 'custom' && applyPreset(p.key)}
                    style={{ padding: '6px 14px', borderRadius: 20, cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '0.82rem', border: '1px solid', background: filters.preset === p.key ? 'var(--accent)' : 'var(--steel-3)', color: filters.preset === p.key ? '#1a1200' : 'var(--text-2)', borderColor: filters.preset === p.key ? 'var(--accent)' : 'var(--border)' }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-row" style={{ marginBottom: 16 }}>
              <div className="form-group">
                <label className="form-label">من تاريخ</label>
                <input type="date" className="form-control" value={filters.dateFrom}
                  onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value, preset: 'custom' }))} />
              </div>
              <div className="form-group">
                <label className="form-label">إلى تاريخ</label>
                <input type="date" className="form-control" value={filters.dateTo}
                  onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value, preset: 'custom' }))} />
              </div>
            </div>

            {/* Report type */}
            <div style={{ marginBottom: 16 }}>
              <label className="form-label">نوع التقرير</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[{ key: 'both', label: '📋 ملخص + تايم شيت' }, { key: 'summary', label: '📊 ملخص فقط' }, { key: 'timesheet', label: '📅 تايم شيت فقط' }].map(t => (
                  <button key={t.key} type="button" onClick={() => setFilters(f => ({ ...f, reportType: t.key }))}
                    style={{ padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '0.85rem', border: '1px solid', background: filters.reportType === t.key ? 'var(--accent)' : 'var(--steel-3)', color: filters.reportType === t.key ? '#1a1200' : 'var(--text-2)', borderColor: filters.reportType === t.key ? 'var(--accent)' : 'var(--border)' }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Version */}
            <div style={{ marginBottom: 20 }}>
              <label className="form-label">نسخة التقرير</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setFilters(f => ({ ...f, version: 'supplier' }))}
                  style={{ padding: '7px 20px', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '0.85rem', border: '1px solid', background: filters.version === 'supplier' ? '#e8f4fd' : 'var(--steel-3)', color: filters.version === 'supplier' ? '#1a6fa0' : 'var(--text-2)', borderColor: filters.version === 'supplier' ? '#1a6fa0' : 'var(--border)', fontWeight: filters.version === 'supplier' ? 700 : 400 }}>
                  📋 للمورد (بدون سعر)
                </button>
                <button type="button" onClick={() => setFilters(f => ({ ...f, version: 'accounting' }))}
                  style={{ padding: '7px 20px', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '0.85rem', border: '1px solid', background: filters.version === 'accounting' ? '#fef3cd' : 'var(--steel-3)', color: filters.version === 'accounting' ? '#856404' : 'var(--text-2)', borderColor: filters.version === 'accounting' ? '#e8a020' : 'var(--border)', fontWeight: filters.version === 'accounting' ? 700 : 400 }}>
                  💰 للمحاسبة (بالسعر)
                </button>
              </div>
            </div>

            <button className="btn btn-primary" onClick={generate} disabled={loading || !filters.supplierId}>
              {loading ? 'جاري الإنشاء...' : '📊 إنشاء التقرير'}
            </button>
          </div>
        </div>

        {/* Screen preview */}
        {generated && reportData && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">
                معاينة — {supplier?.name}
                {filters.equipmentId && <span style={{ color: 'var(--accent)', marginRight: 8, fontSize: '0.82rem' }}>({reportData.eqList[0]?.name})</span>}
                <span style={{ fontSize: '0.75rem', marginRight: 8, color: showPrice ? '#e8a020' : 'var(--info)' }}>
                  {showPrice ? '💰 نسخة المحاسبة' : '📋 نسخة المورد'}
                </span>
              </span>
              <span className="badge badge-gray">{invoiceNo}</span>
            </div>
            <div className="card-body">
              {/* Summary */}
              {(filters.reportType === 'summary' || filters.reportType === 'both') && (
                <>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 10, color: 'var(--text-2)' }}>📊 ملخص المعدات</div>
                  <div className="table-wrap" style={{ marginBottom: 20 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>#</th><th>المعدة</th><th>النوع</th><th>الموقع</th><th>ساعات العمل</th>
                          {showPrice && <><th>سعر/ساعة</th><th>الإجمالي (ريال)</th></>}
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.eqList.map((eq, i) => (
                          <tr key={eq.id}>
                            <td style={{ color: 'var(--text-3)' }}>{i+1}</td>
                            <td style={{ fontWeight: 600 }}>{eq.name}</td>
                            <td><span className="badge badge-gray">{eq.type}</span></td>
                            <td><span className="badge badge-blue">{eq.siteName}</span></td>
                            <td style={{ fontWeight: 600 }}>{eq.totalHours} س</td>
                            {showPrice && (
                              <><td style={{ color: 'var(--text-2)' }}>{eq.hourlyRate} ر/س</td>
                              <td style={{ color: 'var(--accent)', fontWeight: 700 }}>{eq.totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td></>
                            )}
                          </tr>
                        ))}
                        <tr style={{ background: 'var(--accent-dim2)', fontWeight: 700 }}>
                          <td colSpan={4}>الإجمالي</td>
                          <td>{reportData.grandHours} س</td>
                          {showPrice && <><td></td><td style={{ color: 'var(--accent)' }}>{reportData.grandCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td></>}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Timesheet */}
              {(filters.reportType === 'timesheet' || filters.reportType === 'both') && reportData.eqList.map(eq => (
                <div key={eq.id} style={{ marginBottom: 20, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ background: 'var(--steel-3)', padding: '10px 16px', display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <span style={{ fontWeight: 700 }}>{eq.name}</span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginRight: 12 }}>{eq.type} · {eq.siteName}</span>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{eq.totalHours} س</span>
                      {showPrice && <span style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginRight: 8 }}>{eq.totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</span>}
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th><th>التاريخ</th><th>الحالة</th><th>الساعات</th>
                          {showPrice && <><th>سعر/ساعة</th><th>التكلفة</th></>}
                          <th>ملاحظات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {eq.logs.map((log, i) => (
                          <tr key={log.id}>
                            <td style={{ color: 'var(--text-3)' }}>{i+1}</td>
                            <td>{log.date}</td>
                            <td><span className={`badge ${log.status==='working'?'badge-green':log.status==='breakdown'?'badge-red':'badge-gold'}`} style={{ fontSize: '0.72rem' }}>
                              {log.status==='working'?'شغالة':log.status==='breakdown'?'عطل':log.status==='maintenance'?'صيانة':'راحة'}
                            </span></td>
                            <td>{log.hours > 0 ? `${log.hours} س` : '—'}</td>
                            {showPrice && (
                              <><td style={{ color: 'var(--text-2)', fontSize: '0.82rem' }}>{log.effectiveRate > 0 ? `${log.effectiveRate} ر` : '—'}</td>
                              <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{log.cost > 0 ? `${log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر` : '—'}</td></>
                            )}
                            <td style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{log.notes || '—'}</td>
                          </tr>
                        ))}
                        <tr style={{ background: 'var(--steel-3)', fontWeight: 700 }}>
                          <td colSpan={3}>الإجمالي</td>
                          <td>{eq.totalHours} س</td>
                          {showPrice && <><td></td><td style={{ color: 'var(--accent)' }}>{eq.totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td></>}
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {showPrice && (
                <div style={{ background: 'var(--accent-dim2)', border: '2px solid var(--accent)', borderRadius: 10, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '1rem' }}>إجمالي الفاتورة</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent)' }}>
                      {reportData.grandCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ريال
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{reportData.grandHours} ساعة عمل</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Print / Invoice ── */}
      {generated && reportData && (
        <div className="print-page print-only">

          {/* Invoice header */}
          <div className="inv-header">
            <div className="inv-company">
              <div className="inv-company-name">⚙️ عيون الحديد</div>
              <div className="inv-company-sub">نظام متابعة المعدات</div>
              <span className={`inv-badge ${showPrice ? 'inv-badge-accounting' : 'inv-badge-supplier'}`}>
                {showPrice ? '💰 نسخة المحاسبة' : '📋 نسخة المورد'}
              </span>
            </div>
            <div className="inv-title-block">
              <div className="inv-title">فاتورة</div>
              <div className="inv-no">رقم المرجع: {invoiceNo}</div>
              <div className="inv-date">تاريخ الإصدار: {format(new Date(), 'dd/MM/yyyy')}</div>
            </div>
          </div>

          <hr className="inv-divider" />

          {/* Parties */}
          <div className="inv-parties">
            <div>
              <div className="inv-party-label">مقدم من</div>
              <div className="inv-party-name">شركة عيون الحديد</div>
              <div className="inv-party-sub">نظام متابعة المعدات</div>
            </div>
            <div>
              <div className="inv-party-label">مقدم إلى</div>
              <div className="inv-party-name">{supplier?.name}</div>
              {supplier?.contactPerson && <div className="inv-party-sub">{supplier.contactPerson}</div>}
              {supplier?.phone && <div className="inv-party-sub">{supplier.phone}</div>}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <span className="inv-period-box">📅 الفترة: {filters.dateFrom} — {filters.dateTo}</span>
            {filters.equipmentId && reportData.eqList[0] && (
              <span className="inv-period-box" style={{ marginRight: 10 }}>🏗️ المعدة: {reportData.eqList[0].name}</span>
            )}
          </div>

          <hr className="inv-divider-gold" />

          {/* Summary */}
          {(filters.reportType === 'summary' || filters.reportType === 'both') && (
            <>
              <div className="inv-section-title">ملخص المعدات</div>
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>#</th><th>المعدة</th><th>النوع</th><th>الموقع</th><th>ساعات العمل</th>
                    {showPrice && <><th>سعر/ساعة (ريال)</th><th>الإجمالي (ريال)</th></>}
                  </tr>
                </thead>
                <tbody>
                  {reportData.eqList.map((eq, i) => (
                    <tr key={eq.id}>
                      <td>{i+1}</td>
                      <td style={{ fontWeight: 700 }}>{eq.name}</td>
                      <td>{eq.type}</td>
                      <td>{eq.siteName}</td>
                      <td style={{ fontWeight: 700 }}>{eq.totalHours}</td>
                      {showPrice && (
                        <><td>{eq.hourlyRate}</td>
                        <td style={{ fontWeight: 700, color: '#e8a020' }}>{eq.totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td></>
                      )}
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan={4}>الإجمالي</td>
                    <td>{reportData.grandHours}</td>
                    {showPrice && <><td></td><td style={{ color: '#e8a020' }}>{reportData.grandCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td></>}
                  </tr>
                </tbody>
              </table>
            </>
          )}

          {/* Timesheets */}
          {(filters.reportType === 'timesheet' || filters.reportType === 'both') && reportData.eqList.map((eq, idx) => (
            <div key={eq.id}>
              <div className="inv-section-title">تايم شيت — {eq.name}</div>
              <div className="ts-header">
                <div>
                  <div className="ts-eq-name">{eq.name}</div>
                  <div className="ts-eq-sub">{eq.type} · {eq.siteName}</div>
                </div>
                <div className="ts-total">
                  {eq.totalHours} ساعة
                  {showPrice && ` · ${eq.totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ريال`}
                </div>
              </div>
              <table className="ts-table">
                <thead>
                  <tr>
                    <th>#</th><th>التاريخ</th><th>الحالة</th><th>ساعات العمل</th>
                    {showPrice && <><th>سعر/ساعة</th><th>التكلفة (ريال)</th></>}
                    <th>ملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {eq.logs.map((log, i) => (
                    <tr key={log.id}>
                      <td>{i+1}</td>
                      <td>{log.date}</td>
                      <td>{log.status==='working'?'شغالة':log.status==='breakdown'?'عطل':log.status==='maintenance'?'صيانة':'راحة'}</td>
                      <td>{log.hours > 0 ? log.hours : '—'}</td>
                      {showPrice && (
                        <><td>{log.effectiveRate > 0 ? log.effectiveRate : '—'}</td>
                        <td style={{ fontWeight: 600 }}>{log.cost > 0 ? log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 }) : '—'}</td></>
                      )}
                      <td>{log.notes || '—'}</td>
                    </tr>
                  ))}
                  <tr className="ts-total-row">
                    <td colSpan={3}>إجمالي {eq.name}</td>
                    <td>{eq.totalHours} ساعة</td>
                    {showPrice && <><td></td><td style={{ color: '#e8a020' }}>{eq.totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td></>}
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}

          {/* Grand total */}
          {showPrice && (
            <div className="grand-total-box">
              <div>
                <div className="grand-label">إجمالي المستحقات</div>
                <div className="grand-hours">{reportData.grandHours} ساعة عمل إجمالية</div>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div className="grand-amount">{reportData.grandCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ريال</div>
              </div>
            </div>
          )}

          {/* Signatures */}
          <div className="inv-signatures">
            <div className="sig-box">
              <div style={{ height: 40 }}></div>
              توقيع المورد / {supplier?.name}
            </div>
            <div className="sig-box">
              <div style={{ height: 40 }}></div>
              توقيع المستلم / عيون الحديد
            </div>
          </div>

          <div className="inv-footer">
            <span>⚙️ عيون الحديد — نظام متابعة المعدات | {invoiceNo}</span>
            <span>تم إصداره بتاريخ {format(new Date(), 'dd/MM/yyyy HH:mm')}</span>
          </div>
        </div>
      )}
    </>
  )
}
