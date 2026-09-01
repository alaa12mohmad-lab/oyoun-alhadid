import { useEffect, useState } from 'react'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek } from 'date-fns'
import { getPriceForDate } from '../utils/priceHistory'

export default function SupplierReportPage() {
  const [suppliers, setSuppliers] = useState([])
  const [equipment, setEquipment] = useState([])
  const [filters, setFilters] = useState({
    supplierId: '',
    dateFrom: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    dateTo:   format(endOfMonth(new Date()),   'yyyy-MM-dd'),
    preset: 'month',
    reportType: 'both',   // 'timesheet' | 'summary' | 'both'
    version: 'supplier',  // 'supplier' | 'accounting'
  })
  const [reportData, setReportData] = useState(null)
  const [loading, setLoading]       = useState(false)
  const [generated, setGenerated]   = useState(false)

  useEffect(() => { loadMeta() }, [])

  async function loadMeta() {
    const [supSnap, eqSnap] = await Promise.all([
      getDocs(collection(db, 'suppliers')),
      getDocs(collection(db, 'equipment')),
    ])
    setSuppliers(supSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setEquipment(eqSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  function applyPreset(preset) {
    const now = new Date()
    let from, to
    if (preset === 'week') { from = startOfWeek(now, { weekStartsOn: 6 }); to = endOfWeek(now, { weekStartsOn: 6 }) }
    else if (preset === 'month') { from = startOfMonth(now); to = endOfMonth(now) }
    else if (preset === 'lastmonth') { from = startOfMonth(subMonths(now, 1)); to = endOfMonth(subMonths(now, 1)) }
    setFilters(f => ({ ...f, preset, dateFrom: format(from, 'yyyy-MM-dd'), dateTo: format(to, 'yyyy-MM-dd') }))
  }

  async function generate() {
    if (!filters.supplierId) return alert('يرجى اختيار المورد')
    setLoading(true); setGenerated(false)
    try {
      const eqMap = {}; equipment.forEach(e => eqMap[e.id] = e)
      const supplier = suppliers.find(s => s.id === filters.supplierId)

      // Get logs for this supplier in date range
      const logsSnap = await getDocs(query(
        collection(db, 'logs'),
        where('supplierId', '==', filters.supplierId),
        where('date', '>=', filters.dateFrom),
        where('date', '<=', filters.dateTo),
        orderBy('date', 'asc')
      ))
      const logs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }))

      // Load priceHistory for equipment
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

      // Filter out logs after retiredDate
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
            hourlyRate: log.effectiveRate,
            logs: [],
            totalHours: 0,
            totalCost: 0,
            workDays: 0,
          }
        }
        const eq = byEquipment[log.equipmentId]
        eq.logs.push(log)
        if (log.status === 'working') {
          eq.totalHours += log.hours || 0
          eq.totalCost  += log.cost
          eq.workDays++
        }
      })

      const eqList = Object.values(byEquipment).sort((a, b) => a.name.localeCompare(b.name))
      const grandHours = eqList.reduce((s, e) => s + e.totalHours, 0)
      const grandCost  = eqList.reduce((s, e) => s + e.totalCost,  0)

      setReportData({ supplier, eqList, grandHours, grandCost, logs: filteredLogs })
      setGenerated(true)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  function exportExcel() {
    if (!reportData) return
    import('xlsx').then(XLSX => {
      const wb = XLSX.utils.book_new()
      const showPrice = filters.version === 'accounting'
      const supplier  = reportData.supplier

      // Sheet 1: Summary
      const summaryRows = [
        [`تقرير المورد — ${supplier?.name || '—'}`],
        [`الفترة: ${filters.dateFrom} — ${filters.dateTo}`],
        [filters.version === 'accounting' ? 'نسخة المحاسبة (بالأسعار)' : 'نسخة المورد (بدون أسعار)'],
        [],
        showPrice
          ? ['المعدة', 'النوع', 'الموقع', 'ساعات العمل', 'سعر/ساعة', 'الإجمالي (ريال)']
          : ['المعدة', 'النوع', 'الموقع', 'ساعات العمل'],
        ...reportData.eqList.map(e => showPrice
          ? [e.name, e.type, e.siteName, e.totalHours, e.hourlyRate, e.totalCost.toFixed(2)]
          : [e.name, e.type, e.siteName, e.totalHours]
        ),
        [],
        showPrice
          ? ['الإجمالي', '', '', reportData.grandHours, '', reportData.grandCost.toFixed(2)]
          : ['الإجمالي', '', '', reportData.grandHours],
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'الملخص')

      // Sheet 2: Timesheet per equipment
      reportData.eqList.forEach(eq => {
        const rows = [
          [`تايم شيت — ${eq.name}`],
          [`الموقع: ${eq.siteName}`],
          [],
          showPrice
            ? ['التاريخ', 'الحالة', 'الساعات', 'سعر/ساعة', 'التكلفة', 'ملاحظات']
            : ['التاريخ', 'الحالة', 'الساعات', 'ملاحظات'],
          ...eq.logs.map(l => showPrice
            ? [l.date, l.status === 'working' ? 'شغالة' : l.status === 'breakdown' ? 'عطل' : 'صيانة', l.hours || '—', l.effectiveRate, l.cost > 0 ? l.cost.toFixed(2) : '—', l.notes || '']
            : [l.date, l.status === 'working' ? 'شغالة' : l.status === 'breakdown' ? 'عطل' : 'صيانة', l.hours || '—', l.notes || '']
          ),
          [],
          showPrice
            ? ['الإجمالي', '', eq.totalHours, '', eq.totalCost.toFixed(2), '']
            : ['الإجمالي', '', eq.totalHours, ''],
        ]
        const name = eq.name.substring(0, 28)
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
      })

      XLSX.writeFile(wb, `تقرير-مورد-${reportData.supplier?.name}-${filters.dateFrom}.xlsx`)
    })
  }

  const showPrice    = filters.version === 'accounting'
  const supplier     = reportData?.supplier
  const selectedSup  = suppliers.find(s => s.id === filters.supplierId)

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body { background: white !important; color: #1a1f2e !important; direction: rtl; font-family: 'IBM Plex Sans Arabic', sans-serif; }
          .print-page { padding: 20px 28px; }
          .inv-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1a1f2e; padding-bottom: 14px; margin-bottom: 20px; }
          .inv-logo { font-size: 20px; font-weight: 800; color: #1a1f2e; }
          .inv-sub { font-size: 11px; color: #666; margin-top: 3px; }
          .inv-to { text-align: left; }
          .inv-to-label { font-size: 10px; color: #999; }
          .inv-to-name { font-size: 16px; font-weight: 700; color: #1a1f2e; }
          .inv-period { font-size: 11px; color: #555; background: #f5f5f5; padding: 4px 12px; border-radius: 20px; display: inline-block; margin-top: 8px; }
          .inv-type-badge { font-size: 10px; font-weight: 700; padding: 3px 10px; border-radius: 12px; display: inline-block; margin-top: 4px; }
          .badge-supplier { background: #e8f4fd; color: #1a6fa0; }
          .badge-accounting { background: #fef3cd; color: #856404; }
          .summary-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
          .summary-table th { background: #1a1f2e; color: white; padding: 8px 12px; text-align: right; }
          .summary-table td { padding: 7px 12px; border-bottom: 1px solid #eee; }
          .summary-table tr:last-child td { font-weight: 700; background: #f8f8f8; border-top: 2px solid #1a1f2e; }
          .timesheet-title { font-size: 13px; font-weight: 700; margin: 18px 0 6px; color: #1a1f2e; border-right: 3px solid #e8a020; padding-right: 8px; }
          .ts-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 14px; }
          .ts-table th { background: #f0f0f0; color: #333; padding: 6px 10px; text-align: right; border-bottom: 1px solid #ddd; }
          .ts-table td { padding: 5px 10px; border-bottom: 1px solid #eee; }
          .ts-table .last-day { background: #fff0f0; }
          .total-row td { font-weight: 700; background: #f8f8f8; border-top: 1px solid #ccc; }
          .grand-total { margin-top: 20px; border-top: 3px double #1a1f2e; padding-top: 12px; display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; }
          .inv-footer { margin-top: 30px; border-top: 1px solid #ddd; padding-top: 10px; font-size: 10px; color: #999; display: flex; justify-content: space-between; }
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
            {generated && <button className="btn btn-primary" onClick={() => window.print()}>🖨️ طباعة PDF</button>}
          </div>
        </div>

        {/* Filters */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><span className="card-title">🔍 إعدادات التقرير</span></div>
          <div className="card-body">

            {/* Supplier */}
            <div className="form-group">
              <label className="form-label">المورد *</label>
              <select className="form-control" style={{ maxWidth: 300 }} value={filters.supplierId}
                onChange={e => setFilters(f => ({ ...f, supplierId: e.target.value }))}>
                <option value="">اختر المورد</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
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
              <div style={{ display: 'flex', gap: 8 }}>
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

        {/* Preview */}
        {generated && reportData && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">
                معاينة — {supplier?.name}
                <span style={{ fontSize: '0.75rem', marginRight: 8, color: showPrice ? 'var(--accent)' : 'var(--info)' }}>
                  {showPrice ? '💰 نسخة المحاسبة' : '📋 نسخة المورد'}
                </span>
              </span>
              <span className="badge badge-gray">{reportData.eqList.length} معدة</span>
            </div>
            <div className="card-body">

              {/* Summary */}
              {(filters.reportType === 'summary' || filters.reportType === 'both') && (
                <>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 10, color: 'var(--text-2)' }}>📊 ملخص المعدات</div>
                  <div className="table-wrap" style={{ marginBottom: 24 }}>
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
                            <td style={{ color: 'var(--text-3)' }}>{i + 1}</td>
                            <td style={{ fontWeight: 600 }}>{eq.name}</td>
                            <td><span className="badge badge-gray">{eq.type}</span></td>
                            <td><span className="badge badge-blue">{eq.siteName}</span></td>
                            <td style={{ fontWeight: 600 }}>{eq.totalHours.toFixed(0)} س</td>
                            {showPrice && (
                              <>
                                <td style={{ color: 'var(--text-2)' }}>{eq.hourlyRate} ر</td>
                                <td style={{ color: 'var(--accent)', fontWeight: 700 }}>{eq.totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                              </>
                            )}
                          </tr>
                        ))}
                        <tr style={{ background: 'var(--accent-dim2)', fontWeight: 700 }}>
                          <td colSpan={4} style={{ color: 'var(--text-2)' }}>الإجمالي</td>
                          <td>{reportData.grandHours.toFixed(0)} س</td>
                          {showPrice && (
                            <><td></td><td style={{ color: 'var(--accent)', fontSize: '1.05rem' }}>{reportData.grandCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td></>
                          )}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Timesheet per equipment */}
              {(filters.reportType === 'timesheet' || filters.reportType === 'both') && (
                <>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 10, color: 'var(--text-2)' }}>📅 التايم شيت التفصيلي</div>
                  {reportData.eqList.map((eq, idx) => (
                    <div key={eq.id} style={{ marginBottom: 24, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ background: 'var(--steel-3)', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                              <th>التاريخ</th><th>الحالة</th><th>الساعات</th>
                              {showPrice && <><th>سعر/ساعة</th><th>التكلفة</th></>}
                              <th>ملاحظات</th>
                            </tr>
                          </thead>
                          <tbody>
                            {eq.logs.map((log, i) => (
                              <tr key={log.id}>
                                <td style={{ fontSize: '0.85rem' }}>{log.date}</td>
                                <td>
                                  <span className={`badge ${log.status === 'working' ? 'badge-green' : log.status === 'breakdown' ? 'badge-red' : 'badge-gold'}`} style={{ fontSize: '0.72rem' }}>
                                    {log.status === 'working' ? 'شغالة' : log.status === 'breakdown' ? 'عطل' : log.status === 'maintenance' ? 'صيانة' : 'راحة'}
                                  </span>
                                </td>
                                <td>{log.hours > 0 ? `${log.hours} س` : '—'}</td>
                                {showPrice && (
                                  <>
                                    <td style={{ color: 'var(--text-2)', fontSize: '0.82rem' }}>{log.effectiveRate > 0 ? `${log.effectiveRate} ر` : '—'}</td>
                                    <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{log.cost > 0 ? `${log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر` : '—'}</td>
                                  </>
                                )}
                                <td style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{log.notes || '—'}</td>
                              </tr>
                            ))}
                            <tr style={{ background: 'var(--steel-3)', fontWeight: 700, fontSize: '0.85rem' }}>
                              <td colSpan={2}>الإجمالي</td>
                              <td>{eq.totalHours} س</td>
                              {showPrice && <><td></td><td style={{ color: 'var(--accent)' }}>{eq.totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td></>}
                              <td></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Grand total */}
              {showPrice && (
                <div style={{ background: 'var(--accent-dim2)', border: '2px solid var(--accent)', borderRadius: 10, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '1rem' }}>إجمالي الفاتورة</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--accent)' }}>
                      {reportData.grandCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ريال
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{reportData.grandHours.toFixed(0)} ساعة عمل</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Print area ── */}
      {generated && reportData && (
        <div className="print-page print-only">
          {/* Invoice header */}
          <div className="inv-header">
            <div>
              <div className="inv-logo">⚙️ عيون الحديد</div>
              <div className="inv-sub">نظام متابعة المعدات</div>
              <div className="inv-sub">تاريخ الإصدار: {format(new Date(), 'dd/MM/yyyy')}</div>
            </div>
            <div className="inv-to">
              <div className="inv-to-label">مقدم إلى:</div>
              <div className="inv-to-name">{supplier?.name}</div>
              {supplier?.contactPerson && <div style={{ fontSize: 11, color: '#666' }}>{supplier.contactPerson}</div>}
              <div className="inv-period">📅 {filters.dateFrom} — {filters.dateTo}</div>
              <br />
              <span className={`inv-type-badge ${showPrice ? 'badge-accounting' : 'badge-supplier'}`}>
                {showPrice ? '💰 نسخة المحاسبة' : '📋 نسخة المورد'}
              </span>
            </div>
          </div>

          {/* Summary table */}
          {(filters.reportType === 'summary' || filters.reportType === 'both') && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, borderRight: '3px solid #e8a020', paddingRight: 8 }}>ملخص المعدات</div>
              <table className="summary-table">
                <thead>
                  <tr>
                    <th>#</th><th>المعدة</th><th>النوع</th><th>الموقع</th><th>ساعات العمل</th>
                    {showPrice && <><th>سعر/ساعة</th><th>الإجمالي (ريال)</th></>}
                  </tr>
                </thead>
                <tbody>
                  {reportData.eqList.map((eq, i) => (
                    <tr key={eq.id}>
                      <td>{i + 1}</td>
                      <td style={{ fontWeight: 700 }}>{eq.name}</td>
                      <td>{eq.type}</td>
                      <td>{eq.siteName}</td>
                      <td style={{ fontWeight: 700 }}>{eq.totalHours}</td>
                      {showPrice && (
                        <>
                          <td>{eq.hourlyRate}</td>
                          <td style={{ fontWeight: 700, color: '#e8a020' }}>{eq.totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td>
                        </>
                      )}
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={4}>الإجمالي</td>
                    <td>{reportData.grandHours.toFixed(0)}</td>
                    {showPrice && <><td></td><td style={{ color: '#e8a020' }}>{reportData.grandCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td></>}
                  </tr>
                </tbody>
              </table>
            </>
          )}

          {/* Timesheet per equipment */}
          {(filters.reportType === 'timesheet' || filters.reportType === 'both') && reportData.eqList.map((eq, idx) => (
            <div key={eq.id} className={idx > 0 && filters.reportType === 'timesheet' ? 'page-break' : ''}>
              <div className="timesheet-title">
                📅 تايم شيت — {eq.name}
                <span style={{ fontSize: 11, fontWeight: 400, color: '#666', marginRight: 8 }}>{eq.type} · {eq.siteName}</span>
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
                      <td>{i + 1}</td>
                      <td>{log.date}</td>
                      <td>{log.status === 'working' ? 'شغالة' : log.status === 'breakdown' ? 'عطل' : log.status === 'maintenance' ? 'صيانة' : 'راحة'}</td>
                      <td>{log.hours > 0 ? log.hours : '—'}</td>
                      {showPrice && (
                        <>
                          <td>{log.effectiveRate > 0 ? log.effectiveRate : '—'}</td>
                          <td style={{ fontWeight: 600 }}>{log.cost > 0 ? log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 }) : '—'}</td>
                        </>
                      )}
                      <td>{log.notes || '—'}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
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
            <div className="grand-total">
              <span>إجمالي الفاتورة — {supplier?.name}</span>
              <span style={{ color: '#e8a020' }}>{reportData.grandCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ريال ({reportData.grandHours.toFixed(0)} ساعة)</span>
            </div>
          )}

          <div className="inv-footer">
            <span>⚙️ عيون الحديد — نظام متابعة المعدات</span>
            <span>تم إصداره بتاريخ {format(new Date(), 'dd/MM/yyyy HH:mm')}</span>
          </div>
        </div>
      )}
    </>
  )
}
