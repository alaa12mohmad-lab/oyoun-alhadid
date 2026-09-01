import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, query, where, orderBy, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek } from 'date-fns'
import { getPriceForDate } from '../utils/priceHistory'
import { InvoicePrint } from './InvoiceArchivePage'
import { useAuth } from '../hooks/useAuth'

function makeInvoiceNo(supplierName, dateFrom) {
  const [year, month] = dateFrom.split('-')
  const short = (supplierName || 'SUP').replace(/\s+/g, '-').substring(0, 10).toUpperCase()
  const seq   = String(Math.floor(Math.random() * 900) + 100)
  return `${year}-${month}-${short}-${seq}`
}

export default function SupplierReportPage() {
  const { userData } = useAuth()
  const [suppliers, setSuppliers]         = useState([])
  const [allEquipment, setAllEquipment]   = useState([])
  const [supplierEquipment, setSupplierEquipment] = useState([])
  const [filters, setFilters] = useState({
    supplierId:  '',
    equipmentId: '',
    dateFrom:    format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    dateTo:      format(endOfMonth(new Date()),   'yyyy-MM-dd'),
    preset:      'month',
    reportType:  'both',
  })
  const [reportData, setReportData] = useState(null)
  const [loading, setLoading]       = useState(false)
  const [generated, setGenerated]   = useState(false)
  const [archiving, setArchiving]   = useState(false)
  const [archived, setArchived]     = useState(false)
  const [archivedInvNo, setArchivedInvNo] = useState('')

  // For print preview
  const [printMode, setPrintMode]   = useState(null) // null | 'supplier' | 'accounting' | 'both'
  const [invoiceData, setInvoiceData] = useState(null)

  useEffect(() => { loadMeta() }, [])

  useEffect(() => {
    if (filters.supplierId) {
      setSupplierEquipment(allEquipment.filter(e => e.supplierId === filters.supplierId))
    } else {
      setSupplierEquipment([])
    }
    setFilters(f => ({ ...f, equipmentId: '' }))
    setGenerated(false); setReportData(null); setArchived(false)
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
    setLoading(true); setGenerated(false); setArchived(false)
    try {
      const eqMap    = {}; allEquipment.forEach(e => eqMap[e.id] = e)
      const supplier = suppliers.find(s => s.id === filters.supplierId)

      let logsSnap = await getDocs(query(
        collection(db, 'logs'),
        where('supplierId', '==', filters.supplierId),
        where('date', '>=', filters.dateFrom),
        where('date', '<=', filters.dateTo),
        orderBy('date', 'asc')
      ))
      let logs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      if (filters.equipmentId) logs = logs.filter(l => l.equipmentId === filters.equipmentId)

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

      const filteredLogs = logs.filter(log => {
        const eq = eqMap[log.equipmentId]
        if (eq?.status === 'retired' && eq?.retiredDate) return log.date <= eq.retiredDate
        return true
      }).map(log => ({
        ...log,
        effectiveRate: getRate(log),
        cost: (log.hours || 0) * getRate(log),
      }))

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
        const e = byEquipment[log.equipmentId]
        e.logs.push(log)
        if (log.status === 'working') { e.totalHours += log.hours || 0; e.totalCost += log.cost }
      })

      const eqList     = Object.values(byEquipment).sort((a,b) => a.name.localeCompare(b.name))
      const grandHours = eqList.reduce((s,e) => s + e.totalHours, 0)
      const grandCost  = eqList.reduce((s,e) => s + e.totalCost,  0)

      setReportData({ supplier, eqList, grandHours, grandCost })
      setGenerated(true)
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function archiveInvoice() {
    if (!reportData) return
    setArchiving(true)
    try {
      const invNo = makeInvoiceNo(reportData.supplier?.name, filters.dateFrom)
      const invData = {
        invoiceNo:       invNo,
        supplierId:      filters.supplierId,
        supplierName:    reportData.supplier?.name || '—',
        supplierContact: reportData.supplier?.contactPerson || '',
        dateFrom:        filters.dateFrom,
        dateTo:          filters.dateTo,
        reportType:      filters.reportType,
        eqList:          reportData.eqList.map(eq => ({
          id: eq.id, name: eq.name, type: eq.type, siteName: eq.siteName,
          hourlyRate: eq.hourlyRate, totalHours: eq.totalHours, totalCost: eq.totalCost,
          logs: eq.logs.map(l => ({
            date: l.date, status: l.status, hours: l.hours || 0,
            effectiveRate: l.effectiveRate, cost: l.cost, notes: l.notes || '',
            stopReason: l.stopReason || '',
          }))
        })),
        grandHours:  reportData.grandHours,
        grandCost:   reportData.grandCost,
        approvedBy:  userData?.name || userData?.email || 'مدير',
        approvedAt:  serverTimestamp(),
        createdAt:   serverTimestamp(),
      }
      await addDoc(collection(db, 'invoices'), invData)
      setArchivedInvNo(invNo)
      setArchived(true)
    } catch(e) { alert('خطأ في الأرشفة: ' + e.message) }
    finally { setArchiving(false) }
  }

  function openInvoicePrint(mode) {
    if (!reportData) return
    const invNo = makeInvoiceNo(reportData.supplier?.name, filters.dateFrom)
    setInvoiceData({
      invoiceNo:       invNo,
      supplierName:    reportData.supplier?.name || '—',
      supplierContact: reportData.supplier?.contactPerson || '',
      dateFrom:        filters.dateFrom,
      dateTo:          filters.dateTo,
      reportType:      filters.reportType,
      eqList:          reportData.eqList,
      grandHours:      reportData.grandHours,
      grandCost:       reportData.grandCost,
      approvedBy:      userData?.name || userData?.email || 'مدير',
      approvedAt:      new Date().toISOString(),
    })
    setPrintMode(mode)
    setTimeout(() => window.print(), 400)
  }

  function exportExcel() {
    if (!reportData) return
    import('xlsx').then(XLSX => {
      const wb = XLSX.utils.book_new()
      const sup = reportData.supplier

      // Both versions in one Excel
      ;[false, true].forEach(showPrice => {
        const label = showPrice ? 'للمحاسبة (بالسعر)' : 'للمورد (بدون سعر)'
        const rows = [
          [`تقرير المورد — ${sup?.name || '—'} | ${label}`],
          [`الفترة: ${filters.dateFrom} — ${filters.dateTo}`],
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
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), showPrice ? 'محاسبة' : 'مورد')
      })

      // Timesheet sheets
      reportData.eqList.forEach(eq => {
        const rows = [
          [`تايم شيت — ${eq.name}`],
          [`الموقع: ${eq.siteName}`], [],
          ['#', 'التاريخ', 'الحالة', 'الساعات', 'سعر/ساعة', 'التكلفة', 'ملاحظات'],
          ...eq.logs.map((l,i) => [i+1, l.date, l.status==='working'?'شغالة':l.status==='breakdown'?'عطل':'صيانة', l.hours||'—', l.effectiveRate, l.cost>0?l.cost.toFixed(2):'—', l.notes||'']),
          [], ['','الإجمالي','',eq.totalHours,'',eq.totalCost.toFixed(2),''],
        ]
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), eq.name.substring(0,28))
      })

      XLSX.writeFile(wb, `فاتورة-${sup?.name}-${filters.dateFrom}.xlsx`)
    })
  }

  return (
    <>
      <div className="page no-print">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="page-title">🏢 تقرير المورد</div>
            <div className="page-sub">تايم شيت وفاتورة احترافية</div>
          </div>
          {generated && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={exportExcel}>📥 Excel</button>
              <button className="btn btn-secondary" onClick={() => openInvoicePrint('supplier')}>🖨️ نسخة المورد</button>
              <button className="btn btn-secondary" onClick={() => openInvoicePrint('accounting')}>🖨️ نسخة المحاسبة</button>
              <button className="btn btn-secondary" onClick={() => openInvoicePrint('both')}>🖨️ النسختين</button>
              {!archived ? (
                <button className="btn btn-primary" onClick={archiveInvoice} disabled={archiving}
                  style={{ background: 'var(--success)', color: '#fff' }}>
                  {archiving ? 'جاري الحفظ...' : '✅ اعتماد وأرشفة'}
                </button>
              ) : (
                <div className="badge badge-green" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
                  ✅ تم الأرشفة — {archivedInvNo}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><span className="card-title">🔍 إعدادات التقرير</span></div>
          <div className="card-body">
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
              </div>
            </div>

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

            <div style={{ marginBottom: 20 }}>
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

            <button className="btn btn-primary" onClick={generate} disabled={loading || !filters.supplierId}>
              {loading ? 'جاري الإنشاء...' : '📊 إنشاء التقرير'}
            </button>
          </div>
        </div>

        {/* Preview */}
        {generated && reportData && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">معاينة — {reportData.supplier?.name}</span>
              <span className="badge badge-gray">{reportData.eqList.length} معدة</span>
            </div>
            <div className="card-body">
              {/* Summary */}
              {(filters.reportType === 'summary' || filters.reportType === 'both') && (
                <>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 10, color: 'var(--text-2)' }}>📊 ملخص المعدات</div>
                  <div className="table-wrap" style={{ marginBottom: 20 }}>
                    <table>
                      <thead><tr><th>#</th><th>المعدة</th><th>النوع</th><th>الموقع</th><th>ساعات العمل</th><th>سعر/ساعة</th><th>الإجمالي (ريال)</th></tr></thead>
                      <tbody>
                        {reportData.eqList.map((eq, i) => (
                          <tr key={eq.id}>
                            <td style={{ color: 'var(--text-3)' }}>{i+1}</td>
                            <td style={{ fontWeight: 600 }}>{eq.name}</td>
                            <td><span className="badge badge-gray">{eq.type}</span></td>
                            <td><span className="badge badge-blue">{eq.siteName}</span></td>
                            <td style={{ fontWeight: 600 }}>{eq.totalHours} س</td>
                            <td style={{ color: 'var(--text-2)' }}>{eq.hourlyRate} ر/س</td>
                            <td style={{ color: 'var(--accent)', fontWeight: 700 }}>{eq.totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                          </tr>
                        ))}
                        <tr style={{ background: 'var(--accent-dim2)', fontWeight: 700 }}>
                          <td colSpan={4}>الإجمالي</td>
                          <td>{reportData.grandHours} س</td>
                          <td></td>
                          <td style={{ color: 'var(--accent)', fontSize: '1.05rem' }}>{reportData.grandCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Timesheets */}
              {(filters.reportType === 'timesheet' || filters.reportType === 'both') && reportData.eqList.map(eq => (
                <div key={eq.id} style={{ marginBottom: 20, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ background: 'var(--steel-3)', padding: '10px 16px', display: 'flex', justifyContent: 'space-between' }}>
                    <div><span style={{ fontWeight: 700 }}>{eq.name}</span><span style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginRight: 10 }}>{eq.type} · {eq.siteName}</span></div>
                    <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{eq.totalHours} س · {eq.totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>#</th><th>التاريخ</th><th>الحالة</th><th>الساعات</th><th>سعر/ساعة</th><th>التكلفة</th><th>ملاحظات</th></tr></thead>
                      <tbody>
                        {eq.logs.map((log, i) => (
                          <tr key={log.id}>
                            <td style={{ color: 'var(--text-3)' }}>{i+1}</td>
                            <td>{log.date}</td>
                            <td><span className={`badge ${log.status==='working'?'badge-green':log.status==='breakdown'?'badge-red':'badge-gold'}`} style={{ fontSize: '0.72rem' }}>{log.status==='working'?'شغالة':log.status==='breakdown'?'عطل':log.status==='maintenance'?'صيانة':'راحة'}</span></td>
                            <td>{log.hours > 0 ? `${log.hours} س` : '—'}</td>
                            <td style={{ color: 'var(--text-2)', fontSize: '0.82rem' }}>{log.effectiveRate > 0 ? `${log.effectiveRate} ر` : '—'}</td>
                            <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{log.cost > 0 ? `${log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر` : '—'}</td>
                            <td style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{log.notes || '—'}</td>
                          </tr>
                        ))}
                        <tr style={{ background: 'var(--steel-3)', fontWeight: 700 }}>
                          <td colSpan={3}>الإجمالي</td>
                          <td>{eq.totalHours} س</td>
                          <td></td>
                          <td style={{ color: 'var(--accent)' }}>{eq.totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {/* Grand total */}
              <div style={{ background: 'var(--accent-dim2)', border: '2px solid var(--accent)', borderRadius: 10, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>إجمالي الفاتورة</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent)' }}>{reportData.grandCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ريال</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{reportData.grandHours} ساعة عمل</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Print area */}
      {invoiceData && printMode && (
        <>
          {(printMode === 'supplier' || printMode === 'both') && (
            <div className="print-inv print-only">
              {printMode === 'both' && <div className="version-title">— نسخة المورد (بدون أسعار) —</div>}
              <InvoiceBody inv={invoiceData} eqList={invoiceData.eqList} showPrice={false} />
            </div>
          )}
          {(printMode === 'accounting' || printMode === 'both') && (
            <div className={`print-inv print-only ${printMode === 'both' ? 'page-break' : ''}`}>
              {printMode === 'both' && <div className="version-title">— نسخة المحاسبة (بالأسعار) —</div>}
              <InvoiceBody inv={invoiceData} eqList={invoiceData.eqList} showPrice={true} />
            </div>
          )}
        </>
      )}
    </>
  )
}

// Inline invoice body for print (same as in archive)
function InvoiceBody({ inv, eqList, showPrice }) {
  const reportType = inv.reportType || 'both'
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #1a1f2e', paddingBottom: 14, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>⚙️ عيون الحديد</div>
          <div style={{ fontSize: 11, color: '#888' }}>نظام متابعة المعدات</div>
          {inv.approvedAt && <div style={{ display: 'inline-block', border: '3px solid #3eb87a', borderRadius: 8, padding: '4px 14px', color: '#3eb87a', fontSize: 13, fontWeight: 800, transform: 'rotate(-5deg)', marginTop: 8 }}>✓ معتمدة</div>}
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#e8a020' }}>فاتورة</div>
          <div style={{ fontSize: 12, color: '#888' }}>رقم: {inv.invoiceNo}</div>
          <div style={{ fontSize: 11, color: '#555' }}>تاريخ الإصدار: {format(new Date(), 'dd/MM/yyyy')}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 14 }}>
        <div><div style={{ fontSize: 10, color: '#999', marginBottom: 3 }}>مقدم من</div><div style={{ fontSize: 15, fontWeight: 700 }}>شركة عيون الحديد</div></div>
        <div><div style={{ fontSize: 10, color: '#999', marginBottom: 3 }}>مقدم إلى</div><div style={{ fontSize: 15, fontWeight: 700 }}>{inv.supplierName}</div>{inv.supplierContact && <div style={{ fontSize: 11, color: '#555' }}>{inv.supplierContact}</div>}</div>
      </div>

      <div style={{ background: '#f5f5f5', padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 600, display: 'inline-block', marginBottom: 14 }}>📅 الفترة: {inv.dateFrom} — {inv.dateTo}</div>
      <hr style={{ border: 'none', borderTop: '2px solid #e8a020', margin: '10px 0 14px' }} />

      {(reportType === 'summary' || reportType === 'both') && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, borderRight: '3px solid #e8a020', paddingRight: 8, margin: '14px 0 8px' }}>ملخص المعدات</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr style={{ background: '#1a1f2e', color: 'white' }}><th style={{ padding: '7px 10px', textAlign: 'right' }}>#</th><th style={{ padding: '7px 10px', textAlign: 'right' }}>المعدة</th><th style={{ padding: '7px 10px', textAlign: 'right' }}>النوع</th><th style={{ padding: '7px 10px', textAlign: 'right' }}>الموقع</th><th style={{ padding: '7px 10px', textAlign: 'right' }}>ساعات العمل</th>{showPrice && <><th style={{ padding: '7px 10px', textAlign: 'right' }}>سعر/ساعة</th><th style={{ padding: '7px 10px', textAlign: 'right' }}>الإجمالي (ريال)</th></>}</tr></thead>
            <tbody>
              {eqList.map((eq, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fafafa' : 'white' }}>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #eee' }}>{i+1}</td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #eee', fontWeight: 700 }}>{eq.name}</td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #eee' }}>{eq.type}</td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #eee' }}>{eq.siteName}</td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #eee', fontWeight: 700 }}>{eq.totalHours}</td>
                  {showPrice && <><td style={{ padding: '6px 10px', borderBottom: '1px solid #eee' }}>{eq.hourlyRate}</td><td style={{ padding: '6px 10px', borderBottom: '1px solid #eee', fontWeight: 700, color: '#e8a020' }}>{eq.totalCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td></>}
                </tr>
              ))}
              <tr style={{ fontWeight: 700, background: '#f0f0f0', borderTop: '2px solid #1a1f2e' }}>
                <td colSpan={4} style={{ padding: '6px 10px' }}>الإجمالي</td>
                <td style={{ padding: '6px 10px' }}>{inv.grandHours}</td>
                {showPrice && <><td style={{ padding: '6px 10px' }}></td><td style={{ padding: '6px 10px', color: '#e8a020' }}>{inv.grandCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td></>}
              </tr>
            </tbody>
          </table>
        </>
      )}

      {(reportType === 'timesheet' || reportType === 'both') && eqList.map((eq, idx) => (
        <div key={idx}>
          <div style={{ fontSize: 12, fontWeight: 700, borderRight: '3px solid #e8a020', paddingRight: 8, margin: '14px 0 6px' }}>تايم شيت — {eq.name}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', background: '#f8f8f8', padding: '7px 12px', borderRadius: '6px 6px 0 0', border: '1px solid #ddd' }}>
            <div><div style={{ fontSize: 13, fontWeight: 700 }}>{eq.name}</div><div style={{ fontSize: 10, color: '#777' }}>{eq.type} · {eq.siteName}</div></div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#e8a020' }}>{eq.totalHours} ساعة{showPrice ? ` · ${eq.totalCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ريال` : ''}</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, border: '1px solid #ddd', borderTop: 'none', marginBottom: 12 }}>
            <thead><tr style={{ background: '#eee' }}><th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>#</th><th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>التاريخ</th><th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>الحالة</th><th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>ساعات العمل</th>{showPrice && <><th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>سعر/ساعة</th><th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>التكلفة (ريال)</th></>}<th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>ملاحظات</th></tr></thead>
            <tbody>
              {(eq.logs || []).map((log, i) => (
                <tr key={i}><td style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}>{i+1}</td><td style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}>{log.date}</td><td style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}>{log.status==='working'?'شغالة':log.status==='breakdown'?'عطل':log.status==='maintenance'?'صيانة':'راحة'}</td><td style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}>{log.hours > 0 ? log.hours : '—'}</td>{showPrice && <><td style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}>{log.effectiveRate > 0 ? log.effectiveRate : '—'}</td><td style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0', fontWeight: 600 }}>{log.cost > 0 ? log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 }) : '—'}</td></>}<td style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}>{log.notes || '—'}</td></tr>
              ))}
              <tr style={{ fontWeight: 700, background: '#f5f5f5', borderTop: '1px solid #ddd' }}>
                <td colSpan={3} style={{ padding: '4px 8px' }}>إجمالي {eq.name}</td>
                <td style={{ padding: '4px 8px' }}>{eq.totalHours} ساعة</td>
                {showPrice && <><td style={{ padding: '4px 8px' }}></td><td style={{ padding: '4px 8px', color: '#e8a020' }}>{eq.totalCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td></>}
                <td style={{ padding: '4px 8px' }}></td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      {showPrice && (
        <div style={{ marginTop: 18, border: '2px solid #1a1f2e', borderRadius: 8, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><div style={{ fontSize: 14, fontWeight: 700 }}>إجمالي المستحقات</div><div style={{ fontSize: 11, color: '#888' }}>{inv.grandHours} ساعة عمل إجمالية</div></div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#e8a020' }}>{inv.grandCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ريال</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, marginTop: 28 }}>
        <div style={{ borderTop: '1px solid #333', paddingTop: 8, textAlign: 'center', fontSize: 11, color: '#555' }}><div style={{ height: 40 }}></div>توقيع المورد / {inv.supplierName}</div>
        <div style={{ borderTop: '1px solid #333', paddingTop: 8, textAlign: 'center', fontSize: 11, color: '#555' }}><div style={{ height: 40 }}></div>توقيع المستلم / عيون الحديد</div>
      </div>

      <div style={{ marginTop: 18, borderTop: '1px solid #eee', paddingTop: 8, fontSize: 9, color: '#aaa', display: 'flex', justifyContent: 'space-between' }}>
        <span>⚙️ عيون الحديد — {inv.invoiceNo}</span>
        <span>معتمد بواسطة: {inv.approvedBy}</span>
      </div>
    </>
  )
}
