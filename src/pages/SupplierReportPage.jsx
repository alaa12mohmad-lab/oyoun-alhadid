import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, query, where, orderBy, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek } from 'date-fns'
import { getPriceForDate } from '../utils/priceHistory'
import { useAuth } from '../hooks/useAuth'
import { printInvoiceInWindow } from '../utils/printInvoice'


function makeInvoiceNo(supplierName, dateFrom) {
  const [year, month] = dateFrom.split('-')
  const short = (supplierName || 'SUP').replace(/\s+/g, '-').substring(0, 10).toUpperCase()
  const seq   = String(Math.floor(Math.random() * 900) + 100)
  return `${year}-${month}-${short}-${seq}`
}

export default function SupplierReportPage() {
  const { userData } = useAuth()
  const [suppliers, setSuppliers]       = useState([])
  const [allEquipment, setAllEquipment] = useState([])
  const [supplierEquipment, setSupplierEquipment] = useState([])
  const [filters, setFilters] = useState({
    supplierId: '', equipmentId: '',
    dateFrom: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    dateTo:   format(endOfMonth(new Date()),   'yyyy-MM-dd'),
    preset: 'month', reportType: 'both',
  })
  const [reportData, setReportData] = useState(null)
  const [loading, setLoading]       = useState(false)
  const [generated, setGenerated]   = useState(false)
  const [archiving, setArchiving]   = useState(false)
  const [eqRowsWithTransport, setEqRowsWithTransport] = useState([])
  const [archived, setArchived]     = useState(false)
  const [archivedInvNo, setArchivedInvNo] = useState('')

  useEffect(() => { loadMeta() }, [])

  useEffect(() => {
    if (filters.supplierId) setSupplierEquipment(allEquipment.filter(e => e.supplierId === filters.supplierId))
    else setSupplierEquipment([])
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

      let logs = (await getDocs(query(
        collection(db, 'logs'),
        where('supplierId', '==', filters.supplierId),
        where('date', '>=', filters.dateFrom),
        where('date', '<=', filters.dateTo),
        orderBy('date', 'asc')
      ))).docs.map(d => ({ id: d.id, ...d.data() }))

      if (filters.equipmentId) logs = logs.filter(l => l.equipmentId === filters.equipmentId)

      const usedEqIds = [...new Set(logs.map(l => l.equipmentId))]
      const histories = {}
      await Promise.all(usedEqIds.map(async eqId => {
        const s = await getDocs(query(collection(db, 'equipment', eqId, 'priceHistory'), orderBy('fromDate', 'asc')))
        histories[eqId] = s.docs.map(d => ({ id: d.id, ...d.data() }))
      }))

      function getRate(log) {
        return getPriceForDate(histories[log.equipmentId] || [], log.date, eqMap[log.equipmentId]?.hourlyRate || log.hourlyRate || 0)
      }

      const filteredLogs = logs
        .filter(log => { const eq = eqMap[log.equipmentId]; return !(eq?.status === 'retired' && eq?.retiredDate && log.date > eq.retiredDate) })
        .map(log => ({ ...log, effectiveRate: getRate(log), cost: (log.hours || 0) * getRate(log) }))

      // Find last working day per retired equipment
      const lastWorkingDay = {}
      filteredLogs.forEach(log => {
        const eq = eqMap[log.equipmentId]
        if (eq?.status === 'retired' && log.status === 'working') {
          if (!lastWorkingDay[log.equipmentId] || log.date > lastWorkingDay[log.equipmentId])
            lastWorkingDay[log.equipmentId] = log.date
        }
      })

      // Mark last working day
      const markedLogs = filteredLogs.map(log => ({
        ...log,
        isLastWorkingDay: lastWorkingDay[log.equipmentId] === log.date && log.status === 'working',
      }))

      const byEq = {}
      markedLogs.forEach(log => {
        if (!byEq[log.equipmentId]) {
          const eq = eqMap[log.equipmentId]
          byEq[log.equipmentId] = { id: log.equipmentId, name: log.equipmentName || eq?.name || '—', type: eq?.type || '—', siteName: log.siteName || eq?.siteName || '—', hourlyRate: getRate(log), logs: [], totalHours: 0, totalCost: 0, transport: 0, transportNote: '' }
        }
        byEq[log.equipmentId].logs.push(log)
        if (log.status === 'working') { byEq[log.equipmentId].totalHours += log.hours || 0; byEq[log.equipmentId].totalCost += log.cost }
      })

      const eqList     = Object.values(byEq).sort((a,b) => a.name.localeCompare(b.name))
      const grandHours = eqList.reduce((s,e) => s + e.totalHours, 0)
      const grandCost  = eqList.reduce((s,e) => s + e.totalCost,  0)
      setReportData({ supplier, eqList, grandHours, grandCost })
      setEqRowsWithTransport(eqList.map(eq => ({ ...eq })))
      setGenerated(true)
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  function updateTransport(id, field, value) {
    setEqRowsWithTransport(rows => rows.map(r => {
      if (r.id !== id) return r
      return { ...r, [field]: field === 'transport' ? (parseFloat(value) || 0) : value }
    }))
  }

  function doPrint(mode) {
    if (!reportData) return
    const inv = {
      invoiceNo:       makeInvoiceNo(reportData.supplier?.name, filters.dateFrom),
      supplierName:    reportData.supplier?.name || '—',
      supplierContact: reportData.supplier?.contactPerson || '',
      dateFrom: filters.dateFrom, dateTo: filters.dateTo,
      reportType: filters.reportType,
      eqList: eqRowsWithTransport.length > 0 ? eqRowsWithTransport : reportData.eqList,
      grandHours: reportData.grandHours,
      grandCost: reportData.grandCost,
      grandTransport: eqRowsWithTransport.reduce((s,r) => s + (r.transport||0), 0),
      approvedBy: userData?.name || userData?.email || 'مدير',
      approvedAt: null,
    }
    printInvoiceInWindow(inv, mode)
  }

  async function archiveInvoice() {
    if (!reportData) return
    setArchiving(true)
    try {
      const invNo = makeInvoiceNo(reportData.supplier?.name, filters.dateFrom)
      await addDoc(collection(db, 'invoices'), {
        invoiceNo: invNo,
        supplierId: filters.supplierId,
        supplierName: reportData.supplier?.name || '—',
        supplierContact: reportData.supplier?.contactPerson || '',
        dateFrom: filters.dateFrom, dateTo: filters.dateTo,
        reportType: filters.reportType,
        eqList: reportData.eqList.map(eq => ({
          id: eq.id, name: eq.name, type: eq.type, siteName: eq.siteName,
          hourlyRate: eq.hourlyRate, totalHours: eq.totalHours, totalCost: eq.totalCost,
          logs: eq.logs.map(l => ({ date: l.date, status: l.status, hours: l.hours||0, effectiveRate: l.effectiveRate, cost: l.cost, notes: l.notes||'', stopReason: l.stopReason||'' }))
        })),
        grandHours: reportData.grandHours,
      grandCost: reportData.grandCost,
      grandTransport: eqRowsWithTransport.reduce((s,r) => s + (r.transport||0), 0),
        approvedBy: userData?.name || userData?.email || 'مدير',
        approvedAt: serverTimestamp(), createdAt: serverTimestamp(),
      })
      setArchivedInvNo(invNo); setArchived(true)
    } catch(e) { alert('خطأ: ' + e.message) }
    finally { setArchiving(false) }
  }

  function exportExcel() {
    if (!reportData) return
    import('xlsx').then(XLSX => {
      const wb = XLSX.utils.book_new()
      ;[false, true].forEach(showPrice => {
        const rows = [
          [`تقرير المورد — ${reportData.supplier?.name}`],
          [`الفترة: ${filters.dateFrom} — ${filters.dateTo}`],
          [],
          showPrice ? ['#','المعدة','النوع','الموقع','ساعات العمل','سعر/ساعة','الإجمالي (ريال)'] : ['#','المعدة','النوع','الموقع','ساعات العمل'],
          ...reportData.eqList.map((e,i) => showPrice ? [i+1,e.name,e.type,e.siteName,e.totalHours,e.hourlyRate,e.totalCost.toFixed(2)] : [i+1,e.name,e.type,e.siteName,e.totalHours]),
          [],
          showPrice ? ['','الإجمالي','','',reportData.grandHours,'',reportData.grandCost.toFixed(2)] : ['','الإجمالي','','',reportData.grandHours],
        ]
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), showPrice ? 'محاسبة' : 'مورد')
      })
      reportData.eqList.forEach(eq => {
        const rows = [
          [`تايم شيت — ${eq.name}`], [`الموقع: ${eq.siteName}`], [],
          ['#','التاريخ','الحالة','الساعات','سعر/ساعة','التكلفة','ملاحظات'],
          ...eq.logs.map((l,i) => [i+1,l.date,l.status==='working'?'شغالة':l.status==='breakdown'?'عطل':'صيانة',l.hours||'—',l.effectiveRate,l.cost>0?l.cost.toFixed(2):'—',l.notes||'']),
          [],['','الإجمالي','',eq.totalHours,'',eq.totalCost.toFixed(2),''],
        ]
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), eq.name.substring(0,28))
      })
      XLSX.writeFile(wb, `مسودة-${reportData.supplier?.name}-${filters.dateFrom}.xlsx`)
    })
  }

  return (
    <>
      <div className="page">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="page-title">🏢 تقرير المورد</div>
            <div className="page-sub">تايم شيت ومسودة</div>
          </div>
          {generated && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={exportExcel}>📥 Excel</button>
              <button className="btn btn-secondary" onClick={() => doPrint('supplier')}>🖨️ نسخة المورد</button>
              <button className="btn btn-secondary" onClick={() => doPrint('accounting')}>🖨️ نسخة المحاسبة</button>
              <button className="btn btn-secondary" onClick={() => doPrint('both')}>🖨️ النسختين</button>
              {!archived
                ? <button className="btn btn-primary" onClick={archiveInvoice} disabled={archiving} style={{ background: 'var(--success)', color: '#fff' }}>
                    {archiving ? 'جاري الحفظ...' : '✅ اعتماد وأرشفة'}
                  </button>
                : <span className="badge badge-green" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>✅ {archivedInvNo}</span>
              }
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
                <select className="form-control" value={filters.supplierId} onChange={e => setFilters(f => ({ ...f, supplierId: e.target.value }))}>
                  <option value="">اختر المورد</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">المعدة</label>
                <select className="form-control" value={filters.equipmentId} onChange={e => setFilters(f => ({ ...f, equipmentId: e.target.value }))} disabled={!filters.supplierId}>
                  <option value="">كل المعدات</option>
                  {supplierEquipment.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label className="form-label">الفترة الزمنية</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[{key:'week',label:'هذا الأسبوع'},{key:'month',label:'هذا الشهر'},{key:'lastmonth',label:'الشهر الماضي'},{key:'custom',label:'مخصص'}].map(p => (
                  <button key={p.key} type="button" onClick={() => p.key !== 'custom' && applyPreset(p.key)}
                    style={{ padding:'6px 14px', borderRadius:20, cursor:'pointer', fontFamily:'var(--font)', fontSize:'0.82rem', border:'1px solid', background: filters.preset===p.key?'var(--accent)':'var(--steel-3)', color: filters.preset===p.key?'#1a1200':'var(--text-2)', borderColor: filters.preset===p.key?'var(--accent)':'var(--border)' }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-row" style={{ marginBottom: 16 }}>
              <div className="form-group">
                <label className="form-label">من تاريخ</label>
                <input type="date" className="form-control" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value, preset: 'custom' }))} />
              </div>
              <div className="form-group">
                <label className="form-label">إلى تاريخ</label>
                <input type="date" className="form-control" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value, preset: 'custom' }))} />
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label className="form-label">نوع التقرير</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[{key:'both',label:'📋 ملخص + تايم شيت'},{key:'summary',label:'📊 ملخص فقط'},{key:'timesheet',label:'📅 تايم شيت فقط'}].map(t => (
                  <button key={t.key} type="button" onClick={() => setFilters(f => ({ ...f, reportType: t.key }))}
                    style={{ padding:'7px 16px', borderRadius:8, cursor:'pointer', fontFamily:'var(--font)', fontSize:'0.85rem', border:'1px solid', background: filters.reportType===t.key?'var(--accent)':'var(--steel-3)', color: filters.reportType===t.key?'#1a1200':'var(--text-2)', borderColor: filters.reportType===t.key?'var(--accent)':'var(--border)' }}>
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

        {/* Screen preview */}
        {generated && reportData && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">معاينة — {reportData.supplier?.name}</span>
              <span className="badge badge-gray">{reportData.eqList.length} معدة</span>
            </div>
            <div className="card-body">
              {(filters.reportType === 'summary' || filters.reportType === 'both') && (
                <>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 10, color: 'var(--text-2)' }}>📊 ملخص المعدات</div>
                  <div className="table-wrap" style={{ marginBottom: 20 }}>
                    <table>
                      <thead><tr><th>#</th><th>المعدة</th><th>النوع</th><th>الموقع</th><th>ساعات العمل</th><th>سعر/ساعة</th><th>إجمالي الساعات</th><th>مصاريف نقل</th><th>ملاحظة النقل</th><th>الإجمالي</th></tr></thead>
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
                            <td>
                              <input type="number" className="form-control"
                                style={{ maxWidth: 100, fontSize: '0.82rem', padding: '5px 8px' }}
                                placeholder="0"
                                value={eqRowsWithTransport.find(r => r.id === eq.id)?.transport || ''}
                                onChange={e => updateTransport(eq.id, 'transport', e.target.value)} />
                            </td>
                            <td>
                              <input className="form-control"
                                style={{ maxWidth: 130, fontSize: '0.82rem', padding: '5px 8px' }}
                                placeholder="مثال: من جدة"
                                value={eqRowsWithTransport.find(r => r.id === eq.id)?.transportNote || ''}
                                onChange={e => updateTransport(eq.id, 'transportNote', e.target.value)} />
                            </td>
                            <td style={{ color: 'var(--info)', fontWeight: 700 }}>
                              {(eq.totalCost + (eqRowsWithTransport.find(r => r.id === eq.id)?.transport || 0)).toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر
                            </td>
                          </tr>
                        ))}
                        <tr style={{ background: 'var(--accent-dim2)', fontWeight: 700 }}>
                          <td colSpan={4}>الإجمالي</td>
                          <td>{reportData.grandHours} س</td>
                          <td></td>
                          <td style={{ color: 'var(--accent)' }}>{reportData.grandCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                          <td style={{ color: 'var(--accent)' }}>{eqRowsWithTransport.reduce((s,r)=>s+(r.transport||0),0).toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                          <td></td>
                          <td style={{ color: 'var(--info)', fontSize: '1.05rem' }}>
                            {(reportData.grandCost + eqRowsWithTransport.reduce((s,r)=>s+(r.transport||0),0)).toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}
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
                          <tr key={log.id} style={{ background: log.isLastWorkingDay ? 'rgba(224,80,80,0.08)' : 'transparent' }}>
                            <td style={{ color: 'var(--text-3)' }}>{i+1}</td>
                            <td>
                              {log.date}
                              {log.isLastWorkingDay && <div style={{ fontSize: '0.68rem', color: 'var(--danger)', fontWeight: 700, marginTop: 2 }}>🔴 آخر يوم عمل</div>}
                            </td>
                            <td><span className={`badge ${log.status==='working'?'badge-green':log.status==='breakdown'?'badge-red':'badge-gold'}`} style={{ fontSize:'0.72rem' }}>{log.status==='working'?'شغالة':log.status==='breakdown'?'عطل':log.status==='maintenance'?'صيانة':'راحة'}</span></td>
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
              <div style={{ background: 'var(--accent-dim2)', border: '2px solid var(--accent)', borderRadius: 10, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>الإجمالي</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent)' }}>{reportData.grandCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ريال</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{reportData.grandHours} ساعة عمل</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>


    </>
  )
}

// ── Reusable invoice body ─────────────────────────────────────────
export function InvoiceBody({ inv, showPrice }) {
  const eqList     = inv.eqList    || []
  const reportType = inv.reportType || 'both'
  const approvedAt = inv.approvedAt
    ? (inv.approvedAt.seconds ? new Date(inv.approvedAt.seconds * 1000) : new Date(inv.approvedAt))
    : null

  return (
    <>
      {/* Header */}
      <div className="inv-h">
        <div>
          <div className="inv-logo">⚙️ عيون الحديد</div>
          <div style={{ fontSize: 11, color: '#888' }}>نظام متابعة المعدات</div>
          {approvedAt && <div className="inv-stamp">✓ معتمدة</div>}
        </div>
        <div className="inv-title-block">
          <div className="inv-title">مسودة</div>
          <div className="inv-no">رقم: {inv.invoiceNo}</div>
          <div className="inv-no">تاريخ الإصدار: {format(new Date(), 'dd/MM/yyyy')}</div>
          {approvedAt && <div className="inv-no">تاريخ الاعتماد: {format(approvedAt, 'dd/MM/yyyy')}</div>}
        </div>
      </div>

      {/* Parties */}
      <div className="inv-parties">
        <div>
          <div className="inv-p-label">مقدم من</div>
          <div className="inv-p-name">شركة عيون الحديد</div>
        </div>
        <div>
          <div className="inv-p-label">مقدم إلى</div>
          <div className="inv-p-name">{inv.supplierName}</div>
          {inv.supplierContact && <div className="inv-p-sub">{inv.supplierContact}</div>}
        </div>
      </div>

      <div className="inv-period">📅 الفترة: {inv.dateFrom} — {inv.dateTo}</div>
      <hr className="inv-divider-gold" />

      {/* Summary */}
      {(reportType === 'summary' || reportType === 'both') && (
        <>
          <div className="inv-section">ملخص المعدات</div>
          <table className="inv-table">
            <thead>
              <tr>
                <th>#</th><th>المعدة</th><th>النوع</th><th>الموقع</th><th>ساعات العمل</th>
                {showPrice && <><th>سعر/ساعة (ريال)</th><th>الإجمالي (ريال)</th></>}
              </tr>
            </thead>
            <tbody>
              {eqList.map((eq, i) => (
                <tr key={i}>
                  <td>{i+1}</td>
                  <td style={{ fontWeight: 700 }}>{eq.name}</td>
                  <td>{eq.type}</td>
                  <td>{eq.siteName}</td>
                  <td style={{ fontWeight: 700 }}>{eq.totalHours}</td>
                  {showPrice && <><td>{eq.hourlyRate}</td><td style={{ fontWeight: 700, color: '#e8a020' }}>{eq.totalCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td></>}
                </tr>
              ))}
              <tr className="inv-total-row">
                <td colSpan={4}>الإجمالي</td>
                <td>{inv.grandHours}</td>
                {showPrice && <><td></td><td style={{ color: '#e8a020' }}>{inv.grandCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td></>}
              </tr>
            </tbody>
          </table>
        </>
      )}

      {/* Timesheets */}
      {(reportType === 'timesheet' || reportType === 'both') && eqList.map((eq, idx) => (
        <div key={idx}>
          <div className="inv-section">تايم شيت — {eq.name}</div>
          <div className="ts-header">
            <div>
              <div className="ts-eq-name">{eq.name}</div>
              <div className="ts-eq-sub">{eq.type} · {eq.siteName}</div>
            </div>
            <div className="ts-total-label">
              {eq.totalHours} ساعة{showPrice ? ` · ${eq.totalCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ريال` : ''}
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
              {(eq.logs || []).map((log, i) => (
                <tr key={i}>
                  <td>{i+1}</td>
                  <td>
                    {log.date}
                    {log.isLastWorkingDay && <div style={{ color: '#e05050', fontWeight: 700, fontSize: 9 }}>🔴 آخر يوم عمل</div>}
                  </td>
                  <td>{log.status==='working'?'شغالة':log.status==='breakdown'?'عطل':log.status==='maintenance'?'صيانة':'راحة'}</td>
                  <td>{log.hours > 0 ? log.hours : '—'}</td>
                  {showPrice && <><td>{log.effectiveRate > 0 ? log.effectiveRate : '—'}</td><td style={{ fontWeight: 600 }}>{log.cost > 0 ? log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 }) : '—'}</td></>}
                  <td>{log.notes || '—'}</td>
                </tr>
              ))}
              <tr className="ts-total-row">
                <td colSpan={3}>إجمالي {eq.name}</td>
                <td>{eq.totalHours} ساعة</td>
                {showPrice && <><td></td><td style={{ color: '#e8a020' }}>{eq.totalCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td></>}
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      {/* Grand total */}
      {showPrice && (
        <div className="grand-box">
          <div>
            <div className="grand-label">إجمالي المستحقات</div>
            <div className="grand-hours">{inv.grandHours} ساعة عمل إجمالية</div>
          </div>
          <div className="grand-amount">{inv.grandCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ريال</div>
        </div>
      )}

      {/* Signatures */}
      <div className="sigs">
        <div className="sig-box"><div style={{ height: 40 }}></div>توقيع المورد / {inv.supplierName}</div>
        <div className="sig-box"><div style={{ height: 40 }}></div>توقيع المستلم / عيون الحديد</div>
      </div>

      {/* Footer */}
      <div className="inv-footer-bar">
        <span>⚙️ عيون الحديد — {inv.invoiceNo}</span>
        <span>معتمد بواسطة: {inv.approvedBy}{approvedAt ? ` | ${format(approvedAt, 'dd/MM/yyyy HH:mm')}` : ''}</span>
      </div>
    </>
  )
}
