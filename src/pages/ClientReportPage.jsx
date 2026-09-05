import { useEffect, useState } from 'react'
import { collection, getDocs, query, where, orderBy, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek } from 'date-fns'
import { getPriceForDate } from '../utils/priceHistory'
import { useAuth } from '../hooks/useAuth'

function makeRefNo(clientName, dateFrom) {
  const [year, month] = dateFrom.split('-')
  const short = (clientName || 'CLI').replace(/\s+/g, '-').substring(0, 10).toUpperCase()
  const seq   = String(Math.floor(Math.random() * 900) + 100)
  return `DRAFT-${year}-${month}-${short}-${seq}`
}

// ── Print draft in new window ─────────────────────────────────────
function printDraft(data) {
  const { client, dateFrom, dateTo, eqRows, grandTotal, refNo } = data

  const summaryHtml = eqRows.map((eq, i) => `
    <tr>
      <td>${i + 1}</td>
      <td style="font-weight:700">${eq.name}</td>
      <td>${eq.type || '—'}</td>
      <td>${eq.siteName || '—'}</td>
      <td style="font-weight:700">${eq.actualHours}</td>
      <td>${eq.clientRate}</td>
      <td style="font-weight:700;color:#e8a020">${eq.subtotal.toLocaleString('ar-SA', {maximumFractionDigits:0})}</td>
      <td>${eq.transport > 0 ? eq.transport.toLocaleString('ar-SA', {maximumFractionDigits:0}) : '—'}</td>
      <td style="font-weight:800;color:#1a6fa0">${eq.total.toLocaleString('ar-SA', {maximumFractionDigits:0})}</td>
    </tr>
  `).join('')

  const timesheetsHtml = eqRows.map(eq => `
    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;border-right:3px solid #1a6fa0;padding-right:8px;margin:14px 0 6px">${eq.name} — تفاصيل الدوام</div>
      <div style="display:flex;justify-content:space-between;background:#f0f7ff;padding:7px 12px;border-radius:6px 6px 0 0;border:1px solid #cce0ff">
        <div><span style="font-size:13px;font-weight:700">${eq.name}</span><span style="font-size:10px;color:#777;margin-right:8px">${eq.type} · ${eq.siteName}</span></div>
        <span style="font-size:12px;font-weight:700;color:#1a6fa0">${eq.actualHours} ساعة · ${eq.subtotal.toLocaleString('ar-SA',{maximumFractionDigits:0})} ريال</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:10px;border:1px solid #ddd;border-top:none;margin-bottom:4px">
        <thead><tr style="background:#eee">
          <th style="padding:5px 8px;text-align:right">#</th>
          <th style="padding:5px 8px;text-align:right">التاريخ</th>
          <th style="padding:5px 8px;text-align:right">الحالة</th>
          <th style="padding:5px 8px;text-align:right">ساعات العمل</th>
          <th style="padding:5px 8px;text-align:right">ملاحظات</th>
        </tr></thead>
        <tbody>
          ${eq.logs.map((log, i) => `
            <tr>
              <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${i+1}</td>
              <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${log.date}</td>
              <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${log.status==='working'?'شغالة':log.status==='breakdown'?'عطل':log.status==='maintenance'?'صيانة':'راحة'}</td>
              <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${log.hours > 0 ? log.hours : '—'}</td>
              <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${log.notes || '—'}</td>
            </tr>
          `).join('')}
          <tr style="font-weight:700;background:#f0f7ff;border-top:1px solid #ddd">
            <td colspan="3" style="padding:4px 8px">إجمالي ${eq.name}</td>
            <td style="padding:4px 8px">${eq.actualHours} ساعة</td>
            <td style="padding:4px 8px"></td>
          </tr>
        </tbody>
      </table>
      ${eq.transport > 0 ? `<div style="font-size:11px;color:#555;padding:4px 8px;background:#fffbe6;border:1px solid #ffe58f;border-radius:4px">🚛 مصاريف نقل: ${eq.transport.toLocaleString('ar-SA',{maximumFractionDigits:0})} ريال — ${eq.transportNote || ''}</div>` : ''}
    </div>
  `).join('')

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>مسودة فاتورة — ${client?.name}</title>
  <style>
    * { box-sizing:border-box; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
    body { background:white; color:#1a1f2e; direction:rtl; font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif; margin:0; padding:24px 32px; }
    table { width:100%; border-collapse:collapse; font-size:11px; }
    th { background:#1a3a5c; color:white; padding:7px 10px; text-align:right; }
    td { padding:6px 10px; border-bottom:1px solid #eee; }
    tr:nth-child(even) td { background:#f8fbff; }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a3a5c;padding-bottom:14px;margin-bottom:16px">
    <div>
      <div style="font-size:20px;font-weight:800">⚙️ عيون الحديد</div>
      <div style="font-size:11px;color:#888">نظام متابعة المعدات</div>
    </div>
    <div style="text-align:left">
      <div style="font-size:26px;font-weight:900;color:#1a6fa0">مسودة فاتورة</div>
      <div style="font-size:11px;color:#888">رقم المرجع: ${refNo}</div>
      <div style="font-size:11px;color:#888">تاريخ الإصدار: ${format(new Date(), 'dd/MM/yyyy')}</div>
      <div style="display:inline-block;background:#fff3cd;color:#856404;padding:3px 12px;border-radius:20px;font-size:10px;font-weight:700;margin-top:4px">⚠️ مسودة</div>
    </div>
  </div>

  <!-- Parties -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:14px">
    <div>
      <div style="font-size:10px;color:#999;margin-bottom:3px">مُعدّ من</div>
      <div style="font-size:15px;font-weight:700">شركة عيون الحديد</div>
    </div>
    <div>
      <div style="font-size:10px;color:#999;margin-bottom:3px">مُقدّم إلى</div>
      <div style="font-size:15px;font-weight:700">${client?.name || '—'}</div>
      ${client?.contactPerson ? `<div style="font-size:11px;color:#555">${client.contactPerson}</div>` : ''}
      ${client?.phone ? `<div style="font-size:11px;color:#555">${client.phone}</div>` : ''}
    </div>
  </div>

  <div style="background:#f0f7ff;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:600;display:inline-block;margin-bottom:16px;color:#1a3a5c">
    📅 الفترة: ${dateFrom} — ${dateTo}
  </div>
  <hr style="border:none;border-top:2px solid #1a6fa0;margin:10px 0 16px" />

  <!-- Summary table -->
  <div style="font-size:12px;font-weight:700;border-right:3px solid #1a6fa0;padding-right:8px;margin-bottom:10px">ملخص المعدات</div>
  <table>
    <thead>
      <tr>
        <th>#</th><th>المعدة</th><th>النوع</th><th>الموقع</th>
        <th>ساعات العمل</th><th>سعر/ساعة (ريال)</th><th>إجمالي الساعات</th>
        <th>مصاريف نقل (ريال)</th><th>الإجمالي (ريال)</th>
      </tr>
    </thead>
    <tbody>
      ${summaryHtml}
      <tr style="font-weight:700;background:#1a3a5c;color:white">
        <td colspan="6">الإجمالي</td>
        <td>${eqRows.reduce((s,r)=>s+r.subtotal,0).toLocaleString('ar-SA',{maximumFractionDigits:0})}</td>
        <td>${eqRows.reduce((s,r)=>s+r.transport,0).toLocaleString('ar-SA',{maximumFractionDigits:0})}</td>
        <td style="font-size:14px">${grandTotal.toLocaleString('ar-SA',{maximumFractionDigits:0})}</td>
      </tr>
    </tbody>
  </table>

  <!-- Grand total box -->
  <div style="margin-top:20px;border:3px solid #1a3a5c;border-radius:8px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="font-size:14px;font-weight:700">إجمالي المبلغ المستحق</div>
      <div style="font-size:11px;color:#888;margin-top:4px">شامل مصاريف النقل</div>
    </div>
    <div style="font-size:28px;font-weight:900;color:#1a6fa0">${grandTotal.toLocaleString('ar-SA',{maximumFractionDigits:0})} ريال</div>
  </div>

  <!-- Timesheets -->
  <div style="page-break-before:always"></div>
  <div style="font-size:13px;font-weight:700;margin-bottom:14px;color:#1a3a5c">📅 تفاصيل الدوام الفعلي</div>
  ${timesheetsHtml}

  <!-- Signatures -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:28px">
    <div style="border-top:1px solid #333;padding-top:8px;text-align:center;font-size:11px;color:#555">
      <div style="height:40px"></div>توقيع العميل / ${client?.name}
    </div>
    <div style="border-top:1px solid #333;padding-top:8px;text-align:center;font-size:11px;color:#555">
      <div style="height:40px"></div>توقيع المُعدّ / عيون الحديد
    </div>
  </div>

  <div style="margin-top:18px;border-top:1px solid #eee;padding-top:8px;font-size:9px;color:#aaa;display:flex;justify-content:space-between">
    <span>⚙️ عيون الحديد — مسودة فاتورة | ${refNo}</span>
    <span>تم إصداره بتاريخ ${format(new Date(), 'dd/MM/yyyy HH:mm')}</span>
  </div>

  <script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};</script>
</body>
</html>`

  const w = window.open('', '_blank', 'width=1000,height=800')
  if (!w) { alert('يرجى السماح بالنوافذ المنبثقة'); return }
  w.document.write(html)
  w.document.close()
}

// ── Main Component ────────────────────────────────────────────────
export default function ClientReportPage() {
  const { userData } = useAuth()
  const [clients, setClients]       = useState([])
  const [allEquipment, setAllEquipment] = useState([])
  const [clientEquipment, setClientEquipment] = useState([])
  const [filters, setFilters] = useState({
    clientId: '', equipmentId: '',
    dateFrom: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    dateTo:   format(endOfMonth(new Date()),   'yyyy-MM-dd'),
    preset: 'month', reportType: 'both',
  })
  const [eqRows, setEqRows]     = useState([])
  const [loading, setLoading]   = useState(false)
  const [generated, setGenerated] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [savedRef, setSavedRef] = useState('')

  useEffect(() => { loadMeta() }, [])

  useEffect(() => {
    if (filters.clientId) {
      setClientEquipment(allEquipment.filter(e => e.clientId === filters.clientId))
    } else {
      setClientEquipment([])
    }
    setFilters(f => ({ ...f, equipmentId: '' }))
    setGenerated(false); setEqRows([]); setSaved(false)
  }, [filters.clientId, allEquipment])

  async function loadMeta() {
    const [cliSnap, eqSnap] = await Promise.all([
      getDocs(collection(db, 'clients')),
      getDocs(collection(db, 'equipment')),
    ])
    setClients(cliSnap.docs.map(d => ({ id: d.id, ...d.data() })))
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
    if (!filters.clientId) return alert('يرجى اختيار العميل')
    setLoading(true); setGenerated(false); setSaved(false)
    try {
      const eqMap = {}; allEquipment.forEach(e => eqMap[e.id] = e)
      const client = clients.find(c => c.id === filters.clientId)

      // Get equipment IDs for this client
      const clientEqIds = allEquipment
        .filter(e => e.clientId === filters.clientId)
        .map(e => e.id)

      if (clientEqIds.length === 0) {
        alert('لا توجد معدات مرتبطة بهذا العميل')
        setLoading(false); return
      }

      // Filter by specific equipment if selected
      const targetEqIds = filters.equipmentId ? [filters.equipmentId] : clientEqIds

      // Get logs for these equipment in date range
      const logsSnap = await getDocs(query(
        collection(db, 'logs'),
        where('date', '>=', filters.dateFrom),
        where('date', '<=', filters.dateTo),
        orderBy('date', 'asc')
      ))
      let logs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(l => targetEqIds.includes(l.equipmentId))

      // Load clientPriceHistory for equipment
      const histories = {}
      await Promise.all(targetEqIds.map(async eqId => {
        const s = await getDocs(query(collection(db, 'equipment', eqId, 'clientPriceHistory'), orderBy('fromDate', 'asc')))
        histories[eqId] = s.docs.map(d => ({ id: d.id, ...d.data() }))
      }))

      function getClientRate(log) {
        const history  = histories[log.equipmentId] || []
        const fallback = eqMap[log.equipmentId]?.clientRate || 0
        return getPriceForDate(history, log.date, fallback)
      }

      // Filter retired
      const filteredLogs = logs.filter(log => {
        const eq = eqMap[log.equipmentId]
        if (eq?.status === 'retired' && eq?.retiredDate) return log.date <= eq.retiredDate
        return true
      })

      // Group by equipment
      const byEq = {}
      filteredLogs.forEach(log => {
        if (!byEq[log.equipmentId]) {
          const eq = eqMap[log.equipmentId]
          byEq[log.equipmentId] = {
            id: log.equipmentId,
            name: log.equipmentName || eq?.name || '—',
            type: eq?.type || '—',
            siteName: log.siteName || eq?.siteName || '—',
            clientRate: getClientRate(log),
            logs: [], actualHours: 0,
            transport: 0, transportNote: '',
          }
        }
        byEq[log.equipmentId].logs.push({ ...log, clientRate: getClientRate(log) })
        if (log.status === 'working') byEq[log.equipmentId].actualHours += log.clientHours || 0
      })

      const rows = Object.values(byEq)
        .map(eq => ({
          ...eq,
          subtotal: eq.actualHours * eq.clientRate,
          total: eq.actualHours * eq.clientRate + eq.transport,
        }))
        .sort((a,b) => a.name.localeCompare(b.name))

      setEqRows(rows)
      setGenerated(true)
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  // Update transport per equipment
  function updateEq(id, field, value) {
    setEqRows(rows => rows.map(r => {
      if (r.id !== id) return r
      const updated = { ...r, [field]: field === 'transport' ? (parseFloat(value) || 0) : value }
      updated.total = updated.actualHours * updated.clientRate + updated.transport
      return updated
    }))
  }

  const grandSubtotal  = eqRows.reduce((s,r) => s + r.subtotal, 0)
  const grandTransport = eqRows.reduce((s,r) => s + r.transport, 0)
  const grandTotal     = grandSubtotal + grandTransport
  const client         = clients.find(c => c.id === filters.clientId)

  function doPrint() {
    const refNo = makeRefNo(client?.name, filters.dateFrom)
    printDraft({
      client, dateFrom: filters.dateFrom, dateTo: filters.dateTo,
      eqRows, grandTotal, refNo,
    })
  }

  async function saveToArchive() {
    if (!generated || eqRows.length === 0) return
    setSaving(true)
    try {
      const refNo = makeRefNo(client?.name, filters.dateFrom)
      await addDoc(collection(db, 'clientDrafts'), {
        refNo,
        clientId:      filters.clientId,
        clientName:    client?.name || '—',
        clientContact: client?.contactPerson || '',
        clientPhone:   client?.phone || '',
        dateFrom:      filters.dateFrom,
        dateTo:        filters.dateTo,
        reportType:    filters.reportType,
        eqList: eqRows.map(eq => ({
          id: eq.id, name: eq.name, type: eq.type, siteName: eq.siteName,
          clientRate: eq.clientRate, actualHours: eq.actualHours,
          subtotal: eq.subtotal, transport: eq.transport,
          transportNote: eq.transportNote, total: eq.total,
          logs: eq.logs.map(l => ({ date: l.date, status: l.status, hours: l.hours||0, notes: l.notes||'' }))
        })),
        grandSubtotal, grandTransport, grandTotal,
        createdBy: userData?.name || userData?.email || 'مدير',
        createdAt: serverTimestamp(),
      })
      setSavedRef(refNo); setSaved(true)
    } catch(e) { alert('خطأ في الحفظ: ' + e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="page-title">🏭 مسودة فاتورة العميل</div>
          <div className="page-sub">تايم شيت ومسودة للعميل</div>
        </div>
        {generated && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={doPrint}>🖨️ طباعة المسودة</button>
            {!saved
              ? <button className="btn btn-primary" onClick={saveToArchive} disabled={saving}
                  style={{ background: 'var(--success)', color: '#fff' }}>
                  {saving ? 'جاري الحفظ...' : '📁 حفظ في الأرشيف'}
                </button>
              : <span className="badge badge-green" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>✅ {savedRef}</span>
            }
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><span className="card-title">🔍 الإعدادات</span></div>
        <div className="card-body">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">العميل *</label>
              <select className="form-control" value={filters.clientId}
                onChange={e => setFilters(f => ({ ...f, clientId: e.target.value }))}>
                <option value="">اختر العميل</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">المعدة</label>
              <select className="form-control" value={filters.equipmentId}
                onChange={e => setFilters(f => ({ ...f, equipmentId: e.target.value }))}
                disabled={!filters.clientId}>
                <option value="">كل المعدات</option>
                {clientEquipment.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
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
              <input type="date" className="form-control" value={filters.dateFrom}
                onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value, preset: 'custom' }))} />
            </div>
            <div className="form-group">
              <label className="form-label">إلى تاريخ</label>
              <input type="date" className="form-control" value={filters.dateTo}
                onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value, preset: 'custom' }))} />
            </div>
          </div>
          <button className="btn btn-primary" onClick={generate} disabled={loading || !filters.clientId}>
            {loading ? 'جاري التحميل...' : '📊 إنشاء المسودة'}
          </button>
        </div>
      </div>

      {/* Preview */}
      {generated && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">مسودة — {client?.name}</span>
            <span className="badge" style={{ background: '#fff3cd', color: '#856404' }}>⚠️ مسودة</span>
          </div>
          <div className="card-body">
            <div style={{ background: 'var(--steel-3)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: '0.85rem', color: 'var(--text-2)' }}>
              💡 أدخل <strong>مصاريف النقل</strong> لكل معدة لو وجدت — ستُضاف للإجمالي تلقائياً
            </div>

            {/* Equipment table with transport input */}
            <div className="table-wrap" style={{ marginBottom: 20 }}>
              <table>
                <thead>
                  <tr>
                    <th>المعدة</th><th>الموقع</th><th>ساعات العمل</th>
                    <th>سعر/ساعة (ريال)</th><th>إجمالي الساعات</th>
                    <th>مصاريف نقل (ريال)</th><th>ملاحظة النقل</th><th>الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {eqRows.map(eq => (
                    <tr key={eq.id}>
                      <td style={{ fontWeight: 600 }}>{eq.name}</td>
                      <td><span className="badge badge-blue">{eq.siteName}</span></td>
                      <td style={{ fontWeight: 600 }}>{eq.actualHours} س</td>
                      <td style={{ color: 'var(--text-2)' }}>{eq.clientRate} ر/س</td>
                      <td style={{ color: 'var(--accent)', fontWeight: 700 }}>
                        {eq.subtotal.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر
                      </td>
                      <td>
                        <input type="number" className="form-control"
                          style={{ maxWidth: 110, fontSize: '0.82rem', padding: '5px 10px' }}
                          placeholder="0" value={eq.transport || ''}
                          onChange={e => updateEq(eq.id, 'transport', e.target.value)} />
                      </td>
                      <td>
                        <input className="form-control"
                          style={{ maxWidth: 150, fontSize: '0.82rem', padding: '5px 10px' }}
                          placeholder="مثال: من جدة" value={eq.transportNote || ''}
                          onChange={e => updateEq(eq.id, 'transportNote', e.target.value)} />
                      </td>
                      <td style={{ color: 'var(--info)', fontWeight: 700 }}>
                        {eq.total.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--accent-dim2)', fontWeight: 700 }}>
                    <td colSpan={4}>الإجمالي</td>
                    <td style={{ color: 'var(--accent)' }}>{grandSubtotal.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                    <td style={{ color: 'var(--accent)' }}>{grandTransport > 0 ? grandTransport.toLocaleString('ar-SA', { maximumFractionDigits: 0 }) + ' ر' : '—'}</td>
                    <td></td>
                    <td style={{ color: 'var(--info)', fontSize: '1.05rem' }}>{grandTotal.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Grand total */}
            <div style={{ background: 'rgba(26,111,160,0.08)', border: '2px solid #1a6fa0', borderRadius: 10, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1a6fa0' }}>إجمالي المسودة</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: 4 }}>شامل مصاريف النقل</div>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1a6fa0' }}>
                  {grandTotal.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ريال
                </div>
              </div>
            </div>

            {/* Timesheets */}
            {(filters.reportType === 'both' || filters.reportType === 'timesheet') && (
              <>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 12, color: 'var(--text-2)' }}>📅 تفاصيل الدوام الفعلي</div>
                {eqRows.map(eq => (
                  <div key={eq.id} style={{ marginBottom: 16, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ background: 'var(--steel-3)', padding: '10px 16px', display: 'flex', justifyContent: 'space-between' }}>
                      <div><span style={{ fontWeight: 700 }}>{eq.name}</span><span style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginRight: 10 }}>{eq.siteName}</span></div>
                      <span style={{ color: '#1a6fa0', fontWeight: 700 }}>{eq.actualHours} س</span>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>#</th><th>التاريخ</th><th>الحالة</th><th>الساعات</th><th>ملاحظات</th></tr></thead>
                        <tbody>
                          {eq.logs.map((log, i) => (
                            <tr key={log.id}>
                              <td style={{ color: 'var(--text-3)' }}>{i+1}</td>
                              <td>{log.date}</td>
                              <td><span className={`badge ${log.status==='working'?'badge-green':log.status==='breakdown'?'badge-red':'badge-gold'}`} style={{ fontSize:'0.72rem' }}>
                                {log.status==='working'?'شغالة':log.status==='breakdown'?'عطل':log.status==='maintenance'?'صيانة':'راحة'}
                              </span></td>
                              <td>{log.hours > 0 ? `${log.hours} س` : '—'}</td>
                              <td style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{log.notes || '—'}</td>
                            </tr>
                          ))}
                          <tr style={{ background: 'var(--steel-3)', fontWeight: 700 }}>
                            <td colSpan={3}>الإجمالي</td>
                            <td>{eq.actualHours} س</td>
                            <td></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
