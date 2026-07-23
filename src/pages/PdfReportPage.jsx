import { useEffect, useState, useRef } from 'react'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, subMonths } from 'date-fns'

const STATUS_LABELS = { working: 'شغالة', breakdown: 'عطل', maintenance: 'صيانة', idle: 'متوقفة' }

export default function PdfReportPage() {
  const [equipment, setEquipment] = useState([])
  const [sites, setSites] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [generated, setGenerated] = useState(false)
  const printRef = useRef()

  // Filters
  const [filters, setFilters] = useState({
    dateFrom: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    dateTo: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
    siteId: '',
    supplierId: '',
    equipmentId: '',
    status: '',
    preset: 'month',
  })

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
      to = endOfWeek(now, { weekStartsOn: 6 })
    } else if (preset === 'month') {
      from = startOfMonth(now); to = endOfMonth(now)
    } else if (preset === 'lastmonth') {
      from = startOfMonth(subMonths(now, 1)); to = endOfMonth(subMonths(now, 1))
    }
    setFilters(f => ({ ...f, preset, dateFrom: format(from, 'yyyy-MM-dd'), dateTo: format(to, 'yyyy-MM-dd') }))
  }

  async function generate() {
    setLoading(true)
    setGenerated(false)
    try {
      let q = query(
        collection(db, 'logs'),
        where('date', '>=', filters.dateFrom),
        where('date', '<=', filters.dateTo),
        orderBy('date', 'asc')
      )
      const snap = await getDocs(q)
      let result = snap.docs.map(d => ({ id: d.id, ...d.data() }))

      if (filters.siteId) result = result.filter(l => l.siteId === filters.siteId)
      if (filters.supplierId) result = result.filter(l => l.supplierId === filters.supplierId)
      if (filters.equipmentId) result = result.filter(l => l.equipmentId === filters.equipmentId)
      if (filters.status) result = result.filter(l => l.status === filters.status)

      const eqMap = {}
      equipment.forEach(e => eqMap[e.id] = e)
      result = result.map(l => {
        const eq = eqMap[l.equipmentId]
        return { ...l, cost: (l.hours || 0) * (l.hourlyRate || eq?.hourlyRate || 0) }
      })

      setLogs(result)
      setGenerated(true)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  function printPdf() {
    window.print()
  }

  // Summary calculations
  const totalHours = logs.reduce((s, l) => s + (l.hours || 0), 0)
  const totalCost = logs.reduce((s, l) => s + l.cost, 0)
  const workingDays = logs.filter(l => l.status === 'working').length
  const stoppedDays = logs.filter(l => l.status !== 'working').length

  // Group by equipment
  const byEquipment = {}
  logs.forEach(l => {
    if (!byEquipment[l.equipmentId]) byEquipment[l.equipmentId] = { name: l.equipmentName, hours: 0, cost: 0, records: 0 }
    byEquipment[l.equipmentId].hours += l.hours || 0
    byEquipment[l.equipmentId].cost += l.cost
    byEquipment[l.equipmentId].records++
  })

  const siteName = sites.find(s => s.id === filters.siteId)?.name || 'كل المواقع'
  const supplierName = suppliers.find(s => s.id === filters.supplierId)?.name || 'كل الموردين'
  const eqName = equipment.find(e => e.id === filters.equipmentId)?.name || 'كل المعدات'

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { background: white !important; color: black !important; }
          .print-area { padding: 20px; font-family: 'IBM Plex Sans Arabic', sans-serif; direction: rtl; }
          .print-table { width: 100%; border-collapse: collapse; font-size: 11px; }
          .print-table th { background: #1a1f2e; color: white; padding: 6px 10px; text-align: right; }
          .print-table td { padding: 5px 10px; border-bottom: 1px solid #ddd; }
          .print-table tr:nth-child(even) td { background: #f8f8f8; }
          .summary-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin: 16px 0; }
          .summary-box { border: 1px solid #ddd; border-radius: 6px; padding: 10px; text-align: center; }
          .summary-box .val { font-size: 18px; font-weight: 700; color: #e8a020; }
          .summary-box .lbl { font-size: 10px; color: #666; }
          .report-header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #e8a020; padding-bottom: 12px; }
          .report-title { font-size: 20px; font-weight: 700; color: #1a1f2e; }
          .report-sub { font-size: 12px; color: #666; margin-top: 4px; }
          .section-title { font-size: 13px; font-weight: 700; margin: 16px 0 8px; color: #1a1f2e; border-right: 3px solid #e8a020; padding-right: 8px; }
        }
        @media screen {
          .print-only { display: none; }
        }
      `}</style>

      <div className="page no-print">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="page-title">📄 تقرير PDF مخصص</div>
            <div className="page-sub">اختر الفلاتر وأنشئ التقرير</div>
          </div>
          {generated && (
            <button className="btn btn-primary" onClick={printPdf}>🖨️ طباعة / حفظ PDF</button>
          )}
        </div>

        {/* Filters */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><span className="card-title">🔍 الفلاتر</span></div>
          <div className="card-body">
            {/* Date presets */}
            <div style={{ marginBottom: 14 }}>
              <label className="form-label">فترة زمنية سريعة</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { key: 'week', label: 'هذا الأسبوع' },
                  { key: 'month', label: 'هذا الشهر' },
                  { key: 'lastmonth', label: 'الشهر الماضي' },
                  { key: 'custom', label: 'مخصص' },
                ].map(p => (
                  <button key={p.key} type="button"
                    onClick={() => p.key !== 'custom' && applyPreset(p.key)}
                    style={{
                      padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
                      fontFamily: 'var(--font)', fontSize: '0.82rem', border: '1px solid',
                      background: filters.preset === p.key ? 'var(--accent)' : 'var(--steel-3)',
                      color: filters.preset === p.key ? '#1a1200' : 'var(--text-2)',
                      borderColor: filters.preset === p.key ? 'var(--accent)' : 'var(--border)',
                    }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-row">
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

            <div className="form-row-3">
              <div className="form-group">
                <label className="form-label">الموقع</label>
                <select className="form-control" value={filters.siteId}
                  onChange={e => setFilters(f => ({ ...f, siteId: e.target.value, equipmentId: '' }))}>
                  <option value="">كل المواقع</option>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">المورد</label>
                <select className="form-control" value={filters.supplierId}
                  onChange={e => setFilters(f => ({ ...f, supplierId: e.target.value }))}>
                  <option value="">كل الموردين</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">المعدة</label>
                <select className="form-control" value={filters.equipmentId}
                  onChange={e => setFilters(f => ({ ...f, equipmentId: e.target.value }))}>
                  <option value="">كل المعدات</option>
                  {(filters.siteId ? equipment.filter(e => e.siteId === filters.siteId) : equipment)
                    .map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">حالة المعدة</label>
              <select className="form-control" style={{ maxWidth: 220 }} value={filters.status}
                onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
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

        {/* Preview */}
        {generated && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">معاينة التقرير — {logs.length} سجل</span>
              <button className="btn btn-primary btn-sm" onClick={printPdf}>🖨️ طباعة PDF</button>
            </div>
            <div className="card-body">
              <div className="report-summary" style={{ marginBottom: 16 }}>
                <div className="summary-box">
                  <div className="val">{totalHours.toFixed(1)}</div>
                  <div className="lbl">إجمالي الساعات</div>
                </div>
                <div className="summary-box">
                  <div className="val">{totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</div>
                  <div className="lbl">إجمالي التكلفة (ريال)</div>
                </div>
                <div className="summary-box">
                  <div className="val" style={{ color: 'var(--success)' }}>{workingDays}</div>
                  <div className="lbl">أيام تشغيل</div>
                </div>
                <div className="summary-box">
                  <div className="val" style={{ color: 'var(--danger)' }}>{stoppedDays}</div>
                  <div className="lbl">أيام توقف</div>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>التاريخ</th>
                      <th>المعدة</th>
                      <th>الموقع</th>
                      <th>المورد</th>
                      <th>الحالة</th>
                      <th>الساعات</th>
                      <th>سعر/س</th>
                      <th>التكلفة</th>
                      <th>ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log, i) => (
                      <tr key={log.id}>
                        <td style={{ color: 'var(--text-3)' }}>{i + 1}</td>
                        <td>{log.date}</td>
                        <td style={{ fontWeight: 500 }}>{log.equipmentName}</td>
                        <td>{log.siteName || '—'}</td>
                        <td>{log.supplierName || '—'}</td>
                        <td>
                          <span className={`badge ${log.status === 'working' ? 'badge-green' : log.status === 'breakdown' ? 'badge-red' : 'badge-gold'}`}>
                            {STATUS_LABELS[log.status] || '—'}
                          </span>
                          {log.stopReason && <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>{log.stopReason}</div>}
                        </td>
                        <td>{log.hours > 0 ? `${log.hours} س` : '—'}</td>
                        <td>{log.hourlyRate > 0 ? `${log.hourlyRate} ر` : '—'}</td>
                        <td style={{ color: 'var(--accent)', fontWeight: 600 }}>
                          {log.cost > 0 ? `${log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر` : '—'}
                        </td>
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

      {/* Print area */}
      {generated && (
        <div className="print-area print-only">
          <div className="report-header">
            <div className="report-title">⚙️ عيون الحديد — تقرير المعدات</div>
            <div className="report-sub">
              الفترة: {filters.dateFrom} — {filters.dateTo} |
              الموقع: {siteName} | المورد: {supplierName} | المعدة: {eqName}
            </div>
            <div className="report-sub">تاريخ الطباعة: {format(new Date(), 'dd/MM/yyyy HH:mm')}</div>
          </div>

          <div className="summary-grid">
            <div className="summary-box"><div className="val">{totalHours.toFixed(1)}</div><div className="lbl">إجمالي الساعات</div></div>
            <div className="summary-box"><div className="val">{totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</div><div className="lbl">إجمالي التكلفة</div></div>
            <div className="summary-box"><div className="val">{workingDays}</div><div className="lbl">أيام تشغيل</div></div>
            <div className="summary-box"><div className="val">{stoppedDays}</div><div className="lbl">أيام توقف</div></div>
          </div>

          {Object.keys(byEquipment).length > 1 && (
            <>
              <div className="section-title">ملخص المعدات</div>
              <table className="print-table">
                <thead><tr><th>المعدة</th><th>الساعات</th><th>التكلفة (ريال)</th><th>عدد السجلات</th></tr></thead>
                <tbody>
                  {Object.values(byEquipment).map((e, i) => (
                    <tr key={i}>
                      <td>{e.name}</td>
                      <td>{e.hours.toFixed(1)}</td>
                      <td>{e.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td>
                      <td>{e.records}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="section-title">تفاصيل السجلات</div>
          <table className="print-table">
            <thead>
              <tr>
                <th>#</th><th>التاريخ</th><th>المعدة</th><th>الموقع</th>
                <th>المورد</th><th>الحالة</th><th>الساعات</th><th>سعر/س</th><th>التكلفة</th><th>ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={log.id}>
                  <td>{i + 1}</td>
                  <td>{log.date}</td>
                  <td>{log.equipmentName}</td>
                  <td>{log.siteName || '—'}</td>
                  <td>{log.supplierName || '—'}</td>
                  <td>{STATUS_LABELS[log.status] || '—'}{log.stopReason ? ` (${log.stopReason})` : ''}</td>
                  <td>{log.hours > 0 ? `${log.hours}` : '—'}</td>
                  <td>{log.hourlyRate > 0 ? log.hourlyRate : '—'}</td>
                  <td>{log.cost > 0 ? log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 }) : '—'}</td>
                  <td>{log.notes || '—'}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 'bold', background: '#f0f0f0' }}>
                <td colSpan={6}>الإجمالي</td>
                <td>{totalHours.toFixed(1)}</td>
                <td></td>
                <td>{totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
