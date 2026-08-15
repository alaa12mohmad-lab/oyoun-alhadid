import { useEffect, useState, useRef } from 'react'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, subMonths } from 'date-fns'
import { getPriceForDate } from '../utils/priceHistory'

const STATUS_LABELS = { working: 'شغالة', breakdown: 'عطل', maintenance: 'صيانة', idle: 'راحة' }

export default function PdfReportPage() {
  const [filters, setFilters] = useState({
    dateFrom: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    dateTo:   format(endOfMonth(new Date()),   'yyyy-MM-dd'),
    siteId: '', supplierId: '', equipmentId: '', status: '', preset: 'month',
  })
  const [sites, setSites]         = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [equipment, setEquipment] = useState([])
  const [logs, setLogs]           = useState([])
  const [loading, setLoading]     = useState(false)
  const [generated, setGenerated] = useState(false)

  // Summary state
  const [totalHours, setTotalHours]       = useState(0)
  const [totalCost, setTotalCost]         = useState(0)
  const [workingDays, setWorkingDays]     = useState(0)
  const [stoppedDays, setStoppedDays]     = useState(0)
  const [byEquipment, setByEquipment]     = useState({})
  const [processedLogs, setProcessedLogs] = useState([])

  useEffect(() => { loadMeta() }, [])

  async function loadMeta() {
    const [eqSnap, siteSnap, supSnap] = await Promise.all([
      getDocs(collection(db, 'equipment')),
      getDocs(collection(db, 'sites')),
      getDocs(collection(db, 'suppliers')),
    ])
    setEquipment(eqSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setSites(siteSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setSuppliers(supSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  function applyPreset(preset) {
    const now = new Date()
    let from, to
    if (preset === 'week') {
      from = startOfWeek(now, { weekStartsOn: 6 })
      to   = endOfWeek(now, { weekStartsOn: 6 })
    } else if (preset === 'month') {
      from = startOfMonth(now); to = endOfMonth(now)
    } else if (preset === 'lastmonth') {
      from = startOfMonth(subMonths(now, 1)); to = endOfMonth(subMonths(now, 1))
    }
    setFilters(f => ({ ...f, preset, dateFrom: format(from, 'yyyy-MM-dd'), dateTo: format(to, 'yyyy-MM-dd') }))
  }

  async function generate() {
    setLoading(true); setGenerated(false)
    try {
      let q = query(
        collection(db, 'logs'),
        where('date', '>=', filters.dateFrom),
        where('date', '<=', filters.dateTo),
        orderBy('date', 'asc')
      )
      const snap = await getDocs(q)
      let result = snap.docs.map(d => ({ id: d.id, ...d.data() }))

      if (filters.siteId)      result = result.filter(l => l.siteId === filters.siteId)
      if (filters.supplierId)  result = result.filter(l => l.supplierId === filters.supplierId)
      if (filters.equipmentId) result = result.filter(l => l.equipmentId === filters.equipmentId)
      if (filters.status)      result = result.filter(l => l.status === filters.status)

      // Load priceHistory for used equipment
      const usedEqIds = [...new Set(result.map(l => l.equipmentId))]
      const eqMap = {}; equipment.forEach(e => eqMap[e.id] = e)
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

      const processed = result.map(log => ({
        ...log,
        effectiveRate: getRate(log),
        cost: (log.hours || 0) * getRate(log),
      }))

      const tHours   = processed.reduce((s, l) => s + (l.hours || 0), 0)
      const tCost    = processed.reduce((s, l) => s + l.cost, 0)
      const wDays    = processed.filter(l => l.status === 'working').length
      const sDays    = processed.filter(l => l.status !== 'working').length

      const byEq = {}
      processed.forEach(l => {
        if (!byEq[l.equipmentId]) byEq[l.equipmentId] = { name: l.equipmentName || '—', hours: 0, cost: 0, records: 0 }
        byEq[l.equipmentId].hours   += l.hours || 0
        byEq[l.equipmentId].cost    += l.cost
        byEq[l.equipmentId].records++
      })

      setLogs(processed)
      setProcessedLogs(processed)
      setTotalHours(tHours)
      setTotalCost(tCost)
      setWorkingDays(wDays)
      setStoppedDays(sDays)
      setByEquipment(byEq)
      setGenerated(true)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  function printPdf() { window.print() }

  const siteName     = sites.find(s => s.id === filters.siteId)?.name     || 'كل المواقع'
  const supplierName = suppliers.find(s => s.id === filters.supplierId)?.name || 'كل الموردين'
  const eqName       = equipment.find(e => e.id === filters.equipmentId)?.name || 'كل المعدات'

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body { background: white !important; color: #1a1f2e !important; direction: rtl; font-family: 'IBM Plex Sans Arabic', sans-serif; }
          .print-area { padding: 20px; }
          .r-table { width: 100%; border-collapse: collapse; font-size: 11px; }
          .r-table th { background: #1a1f2e; color: white; padding: 7px 10px; text-align: right; }
          .r-table td { padding: 6px 10px; border-bottom: 1px solid #eee; }
          .r-table tr:nth-child(even) td { background: #f9f9f9; }
          .print-header { text-align: center; margin-bottom: 20px; border-bottom: 3px solid #e8a020; padding-bottom: 12px; }
          .kpi-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin: 16px 0; }
          .kpi-box { border: 2px solid #e8a020; border-radius: 8px; padding: 10px; text-align: center; }
          .kpi-val { font-size: 20px; font-weight: 800; color: #e8a020; }
          .kpi-lbl { font-size: 10px; color: #666; margin-top: 3px; }
          .section-title { font-size: 13px; font-weight: 800; color: #1a1f2e; border-right: 4px solid #e8a020; padding-right: 8px; margin: 18px 0 8px; }
          .print-footer { margin-top: 24px; border-top: 1px solid #ddd; padding-top: 10px; font-size: 10px; color: #999; display: flex; justify-content: space-between; }
        }
        @media screen { .print-only { display: none; } }
      `}</style>

      <div className="page no-print">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="page-title">📄 تقرير PDF مخصص</div>
            <div className="page-sub">اختر الفلاتر وأنشئ التقرير</div>
          </div>
          {generated && <button className="btn btn-primary" onClick={printPdf}>🖨️ طباعة / حفظ PDF</button>}
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><span className="card-title">🔍 الفلاتر</span></div>
          <div className="card-body">
            <div style={{ marginBottom: 14 }}>
              <label className="form-label">فترة زمنية سريعة</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[{ key: 'week', label: 'هذا الأسبوع' }, { key: 'month', label: 'هذا الشهر' }, { key: 'lastmonth', label: 'الشهر الماضي' }, { key: 'custom', label: 'مخصص' }].map(p => (
                  <button key={p.key} type="button" onClick={() => p.key !== 'custom' && applyPreset(p.key)}
                    style={{ padding: '6px 14px', borderRadius: 20, cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '0.82rem', border: '1px solid', background: filters.preset === p.key ? 'var(--accent)' : 'var(--steel-3)', color: filters.preset === p.key ? '#1a1200' : 'var(--text-2)', borderColor: filters.preset === p.key ? 'var(--accent)' : 'var(--border)' }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">من تاريخ</label>
                <input type="date" className="form-control" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value, preset: 'custom' }))} />
              </div>
              <div className="form-group">
                <label className="form-label">إلى تاريخ</label>
                <input type="date" className="form-control" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value, preset: 'custom' }))} />
              </div>
            </div>
            <div className="form-row-3">
              <div className="form-group">
                <label className="form-label">الموقع</label>
                <select className="form-control" value={filters.siteId} onChange={e => setFilters(f => ({ ...f, siteId: e.target.value, equipmentId: '' }))}>
                  <option value="">كل المواقع</option>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">المورد</label>
                <select className="form-control" value={filters.supplierId} onChange={e => setFilters(f => ({ ...f, supplierId: e.target.value }))}>
                  <option value="">كل الموردين</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">المعدة</label>
                <select className="form-control" value={filters.equipmentId} onChange={e => setFilters(f => ({ ...f, equipmentId: e.target.value }))}>
                  <option value="">كل المعدات</option>
                  {(filters.siteId ? equipment.filter(e => e.siteId === filters.siteId) : equipment).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">حالة المعدة</label>
              <select className="form-control" style={{ maxWidth: 220 }} value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
                <option value="">كل الحالات</option>
                <option value="working">شغالة</option>
                <option value="breakdown">عطل</option>
                <option value="maintenance">صيانة</option>
                <option value="idle">متوقفة</option>
              </select>
            </div>
            <button className="btn btn-primary" onClick={generate} disabled={loading}>
              {loading ? 'جاري الإنشاء...' : '📊 إنشاء التقرير'}
            </button>
          </div>
        </div>

        {generated && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">معاينة التقرير — {logs.length} سجل</span>
              <button className="btn btn-primary btn-sm" onClick={printPdf}>🖨️ طباعة PDF</button>
            </div>
            <div className="card-body">
              <div className="report-summary" style={{ marginBottom: 16 }}>
                {[
                  { val: totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 }) + ' ر', lbl: 'إجمالي التكلفة', color: 'var(--accent)' },
                  { val: totalHours.toFixed(1) + ' س', lbl: 'إجمالي الساعات', color: 'var(--success)' },
                  { val: workingDays, lbl: 'أيام تشغيل', color: 'var(--success)' },
                  { val: stoppedDays, lbl: 'أيام توقف', color: 'var(--danger)' },
                ].map((k, i) => (
                  <div key={i} className="summary-box">
                    <div className="val" style={{ color: k.color }}>{k.val}</div>
                    <div className="lbl">{k.lbl}</div>
                  </div>
                ))}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>#</th><th>التاريخ</th><th>المعدة</th><th>الموقع</th><th>المورد</th><th>الحالة</th><th>الساعات</th><th>سعر/س</th><th>التكلفة</th><th>ملاحظات</th></tr>
                  </thead>
                  <tbody>
                    {logs.map((log, i) => (
                      <tr key={log.id}>
                        <td style={{ color: 'var(--text-3)' }}>{i + 1}</td>
                        <td>{log.date}</td>
                        <td style={{ fontWeight: 500 }}>{log.equipmentName}</td>
                        <td>{log.siteName || '—'}</td>
                        <td>{log.supplierName || '—'}</td>
                        <td><span className={`badge ${log.status === 'working' ? 'badge-green' : log.status === 'breakdown' ? 'badge-red' : 'badge-gold'}`}>{STATUS_LABELS[log.status] || '—'}</span></td>
                        <td>{log.hours > 0 ? `${log.hours} س` : '—'}</td>
                        <td style={{ color: 'var(--accent)' }}>{log.effectiveRate > 0 ? `${log.effectiveRate} ر` : '—'}</td>
                        <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{log.cost > 0 ? `${log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر` : '—'}</td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{log.notes || '—'}</td>
                      </tr>
                    ))}
                    <tr style={{ background: 'var(--accent-dim2)', fontWeight: 700 }}>
                      <td colSpan={6} style={{ color: 'var(--text-2)' }}>الإجمالي</td>
                      <td>{totalHours.toFixed(1)} س</td>
                      <td></td>
                      <td style={{ color: 'var(--accent)' }}>{totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {generated && (
        <div className="print-area print-only">
          <div className="print-header">
            <div style={{ fontSize: 22, fontWeight: 800, color: '#1a1f2e' }}>⚙️ عيون الحديد — تقرير المعدات</div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
              الفترة: {filters.dateFrom} — {filters.dateTo} | الموقع: {siteName} | المورد: {supplierName} | المعدة: {eqName}
            </div>
            <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>تاريخ الطباعة: {format(new Date(), 'dd/MM/yyyy HH:mm')}</div>
          </div>

          <div className="kpi-grid">
            <div className="kpi-box"><div className="kpi-val">{totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</div><div className="kpi-lbl">💰 إجمالي التكلفة (ريال)</div></div>
            <div className="kpi-box"><div className="kpi-val">{totalHours.toFixed(1)}</div><div className="kpi-lbl">⏱️ إجمالي الساعات</div></div>
            <div className="kpi-box"><div className="kpi-val" style={{ color: '#3eb87a' }}>{workingDays}</div><div className="kpi-lbl">✅ أيام تشغيل</div></div>
            <div className="kpi-box"><div className="kpi-val" style={{ color: '#e05050' }}>{stoppedDays}</div><div className="kpi-lbl">🔴 أيام توقف</div></div>
          </div>

          {Object.keys(byEquipment).length > 1 && (
            <>
              <div className="section-title">ملخص المعدات</div>
              <table className="r-table">
                <thead><tr><th>المعدة</th><th>الساعات</th><th>التكلفة (ريال)</th><th>عدد السجلات</th></tr></thead>
                <tbody>
                  {Object.values(byEquipment).map((e, i) => (
                    <tr key={i}><td>{e.name}</td><td>{e.hours.toFixed(1)}</td><td>{e.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td><td>{e.records}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="section-title">تفاصيل السجلات</div>
          <table className="r-table">
            <thead><tr><th>#</th><th>التاريخ</th><th>المعدة</th><th>الموقع</th><th>المورد</th><th>الحالة</th><th>الساعات</th><th>سعر/س</th><th>التكلفة</th><th>ملاحظات</th></tr></thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={log.id}>
                  <td>{i + 1}</td><td>{log.date}</td><td>{log.equipmentName}</td>
                  <td>{log.siteName || '—'}</td><td>{log.supplierName || '—'}</td>
                  <td>{STATUS_LABELS[log.status] || '—'}{log.stopReason ? ` (${log.stopReason})` : ''}</td>
                  <td>{log.hours > 0 ? log.hours : '—'}</td>
                  <td>{log.effectiveRate > 0 ? log.effectiveRate : '—'}</td>
                  <td style={{ fontWeight: 700, color: '#e8a020' }}>{log.cost > 0 ? log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 }) : '—'}</td>
                  <td>{log.notes || '—'}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 'bold', background: '#f0f0f0' }}>
                <td colSpan={6}>الإجمالي</td>
                <td>{totalHours.toFixed(1)}</td><td></td>
                <td style={{ color: '#e8a020' }}>{totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td>
                <td></td>
              </tr>
            </tbody>
          </table>

          <div className="print-footer">
            <span>⚙️ عيون الحديد — نظام متابعة المعدات</span>
            <span>تم إصداره بتاريخ {format(new Date(), 'dd/MM/yyyy')}</span>
          </div>
        </div>
      )}
    </>
  )
}
