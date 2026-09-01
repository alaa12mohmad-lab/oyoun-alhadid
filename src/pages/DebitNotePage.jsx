import { useEffect, useState } from 'react'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { getPriceForDate } from '../utils/priceHistory'
import { printInvoiceInWindow } from '../utils/printInvoice'

// ── Print debit note in new window ───────────────────────────────
function printDebitNote(data) {
  const { supplier, dateFrom, dateTo, eqRows, grandActual, grandInvoiced, grandDiff } = data

  const eqRowsHtml = eqRows.map((eq, i) => `
    <tr style="${eq.diff > 0 ? 'background:#fff8f0' : ''}">
      <td>${i + 1}</td>
      <td style="font-weight:700">${eq.name}</td>
      <td>${eq.siteName}</td>
      <td>${eq.actualHours} س</td>
      <td style="font-weight:700">${eq.actualCost.toLocaleString('ar-SA', {maximumFractionDigits:0})} ر</td>
      <td style="color:#888">${eq.invNo || '—'}</td>
      <td style="font-weight:700">${eq.invAmount > 0 ? eq.invAmount.toLocaleString('ar-SA', {maximumFractionDigits:0}) + ' ر' : '—'}</td>
      <td style="font-weight:800;color:${eq.diff > 0 ? '#e05050' : eq.diff < 0 ? '#3eb87a' : '#888'}">
        ${eq.diff > 0 ? '+' : ''}${eq.diff !== 0 ? eq.diff.toLocaleString('ar-SA', {maximumFractionDigits:0}) + ' ر' : '✓ مطابق'}
      </td>
    </tr>
  `).join('')

  const timesheetsHtml = eqRows.filter(eq => eq.logs.length > 0).map(eq => `
    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;border-right:3px solid #e8a020;padding-right:8px;margin:14px 0 6px">
        تايم شيت — ${eq.name}
        ${eq.diff > 0 ? `<span style="color:#e05050;font-size:11px;margin-right:8px">(فارق: ${eq.diff.toLocaleString('ar-SA',{maximumFractionDigits:0})} ر)</span>` : ''}
      </div>
      <div style="display:flex;justify-content:space-between;background:#f8f8f8;padding:7px 12px;border-radius:6px 6px 0 0;border:1px solid #ddd">
        <div>
          <span style="font-size:13px;font-weight:700">${eq.name}</span>
          <span style="font-size:10px;color:#777;margin-right:8px">${eq.siteName}</span>
        </div>
        <span style="font-size:12px;font-weight:700;color:#e8a020">${eq.actualHours} ساعة · ${eq.actualCost.toLocaleString('ar-SA',{maximumFractionDigits:0})} ريال فعلي</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:10px;border:1px solid #ddd;border-top:none">
        <thead><tr style="background:#eee">
          <th style="padding:5px 8px;text-align:right;border-bottom:1px solid #ddd">#</th>
          <th style="padding:5px 8px;text-align:right;border-bottom:1px solid #ddd">التاريخ</th>
          <th style="padding:5px 8px;text-align:right;border-bottom:1px solid #ddd">الحالة</th>
          <th style="padding:5px 8px;text-align:right;border-bottom:1px solid #ddd">ساعات العمل</th>
          <th style="padding:5px 8px;text-align:right;border-bottom:1px solid #ddd">سعر/ساعة</th>
          <th style="padding:5px 8px;text-align:right;border-bottom:1px solid #ddd">التكلفة (ريال)</th>
          <th style="padding:5px 8px;text-align:right;border-bottom:1px solid #ddd">ملاحظات</th>
        </tr></thead>
        <tbody>
          ${eq.logs.map((log, i) => `
            <tr>
              <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${i+1}</td>
              <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${log.date}</td>
              <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${log.status==='working'?'شغالة':log.status==='breakdown'?'عطل':log.status==='maintenance'?'صيانة':'راحة'}</td>
              <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${log.hours > 0 ? log.hours : '—'}</td>
              <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${log.effectiveRate > 0 ? log.effectiveRate : '—'}</td>
              <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;font-weight:600">${log.cost > 0 ? log.cost.toLocaleString('ar-SA',{maximumFractionDigits:0}) : '—'}</td>
              <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${log.notes || '—'}</td>
            </tr>
          `).join('')}
          <tr style="font-weight:700;background:#f5f5f5;border-top:1px solid #ddd">
            <td colspan="3" style="padding:4px 8px">إجمالي ${eq.name}</td>
            <td style="padding:4px 8px">${eq.actualHours} ساعة</td>
            <td style="padding:4px 8px"></td>
            <td style="padding:4px 8px;color:#e8a020">${eq.actualCost.toLocaleString('ar-SA',{maximumFractionDigits:0})}</td>
            <td style="padding:4px 8px"></td>
          </tr>
        </tbody>
      </table>
    </div>
  `).join('')

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>ديبت نوت — ${supplier?.name}</title>
  <style>
    * { box-sizing:border-box; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
    body { background:white; color:#1a1f2e; direction:rtl; font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif; margin:0; padding:24px 32px; }
    table { width:100%; border-collapse:collapse; font-size:11px; }
    th { background:#1a1f2e; color:white; padding:7px 10px; text-align:right; }
    td { padding:6px 10px; border-bottom:1px solid #eee; }
    tr:nth-child(even) td { background:#fafafa; }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a1f2e;padding-bottom:14px;margin-bottom:16px">
    <div>
      <div style="font-size:20px;font-weight:800">⚙️ عيون الحديد</div>
      <div style="font-size:11px;color:#888">نظام متابعة المعدات</div>
    </div>
    <div style="text-align:left">
      <div style="font-size:26px;font-weight:900;color:#e05050">إشعار خصم (ديبت نوت)</div>
      <div style="font-size:11px;color:#888">تاريخ الإصدار: ${format(new Date(), 'dd/MM/yyyy')}</div>
    </div>
  </div>

  <!-- Parties -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:14px">
    <div>
      <div style="font-size:10px;color:#999;margin-bottom:3px">مُعدّ من</div>
      <div style="font-size:15px;font-weight:700">شركة عيون الحديد</div>
    </div>
    <div>
      <div style="font-size:10px;color:#999;margin-bottom:3px">موجّه إلى</div>
      <div style="font-size:15px;font-weight:700">${supplier?.name || '—'}</div>
      ${supplier?.contactPerson ? `<div style="font-size:11px;color:#555">${supplier.contactPerson}</div>` : ''}
    </div>
  </div>

  <div style="background:#f5f5f5;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:600;display:inline-block;margin-bottom:16px">
    📅 الفترة: ${dateFrom} — ${dateTo}
  </div>
  <hr style="border:none;border-top:2px solid #e8a020;margin:10px 0 16px" />

  <!-- Summary comparison table -->
  <div style="font-size:12px;font-weight:700;border-right:3px solid #e8a020;padding-right:8px;margin-bottom:10px">
    جدول المقارنة — الفعلي مقابل الفواتير
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>المعدة</th>
        <th>الموقع</th>
        <th>ساعات فعلية</th>
        <th>تكلفة فعلية (ريال)</th>
        <th>رقم فاتورة المورد</th>
        <th>قيمة الفاتورة (ريال)</th>
        <th>الفارق (ريال)</th>
      </tr>
    </thead>
    <tbody>
      ${eqRowsHtml}
      <tr style="font-weight:700;background:#1a1f2e;color:white">
        <td colspan="3">الإجمالي</td>
        <td></td>
        <td>${grandActual.toLocaleString('ar-SA',{maximumFractionDigits:0})} ر</td>
        <td></td>
        <td>${grandInvoiced.toLocaleString('ar-SA',{maximumFractionDigits:0})} ر</td>
        <td style="color:${grandDiff > 0 ? '#ff9999' : '#99ffcc'};font-size:14px">
          ${grandDiff > 0 ? '+' : ''}${grandDiff.toLocaleString('ar-SA',{maximumFractionDigits:0})} ر
        </td>
      </tr>
    </tbody>
  </table>

  <!-- Debit note box -->
  ${grandDiff > 0 ? `
    <div style="margin-top:20px;border:3px solid #e05050;border-radius:8px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;background:#fff8f8">
      <div>
        <div style="font-size:14px;font-weight:700;color:#e05050">إجمالي مبلغ الديبت نوت المطلوب</div>
        <div style="font-size:11px;color:#888;margin-top:4px">الفارق بين فواتير المورد والعمل الفعلي</div>
      </div>
      <div style="font-size:28px;font-weight:900;color:#e05050">${grandDiff.toLocaleString('ar-SA',{maximumFractionDigits:0})} ريال</div>
    </div>
  ` : `
    <div style="margin-top:20px;border:2px solid #3eb87a;border-radius:8px;padding:14px 20px;background:#f0fff8;text-align:center;font-size:14px;font-weight:700;color:#3eb87a">
      ✅ الفواتير مطابقة للعمل الفعلي — لا يوجد فارق
    </div>
  `}

  <!-- Timesheets -->
  <div style="page-break-before:always"></div>
  <div style="font-size:13px;font-weight:700;margin-bottom:14px;color:#1a1f2e">📅 تفاصيل الدوام الفعلي</div>
  ${timesheetsHtml}

  <!-- Signatures -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:28px">
    <div style="border-top:1px solid #333;padding-top:8px;text-align:center;font-size:11px;color:#555">
      <div style="height:40px"></div>توقيع المورد / ${supplier?.name}
    </div>
    <div style="border-top:1px solid #333;padding-top:8px;text-align:center;font-size:11px;color:#555">
      <div style="height:40px"></div>توقيع المُعدّ / عيون الحديد
    </div>
  </div>

  <div style="margin-top:18px;border-top:1px solid #eee;padding-top:8px;font-size:9px;color:#aaa;display:flex;justify-content:space-between">
    <span>⚙️ عيون الحديد — إشعار خصم</span>
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
export default function DebitNotePage() {
  const [suppliers, setSuppliers]       = useState([])
  const [allEquipment, setAllEquipment] = useState([])
  const [filters, setFilters] = useState({
    supplierId: '',
    dateFrom: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    dateTo:   format(endOfMonth(new Date()),   'yyyy-MM-dd'),
    preset: 'month',
  })
  const [eqRows, setEqRows]   = useState([])    // equipment with actual data + invoice fields
  const [loading, setLoading] = useState(false)
  const [generated, setGenerated] = useState(false)

  useEffect(() => { loadMeta() }, [])

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
    if (preset === 'month')     { from = startOfMonth(now); to = endOfMonth(now) }
    if (preset === 'lastmonth') { from = startOfMonth(subMonths(now,1)); to = endOfMonth(subMonths(now,1)) }
    setFilters(f => ({ ...f, preset, dateFrom: format(from,'yyyy-MM-dd'), dateTo: format(to,'yyyy-MM-dd') }))
  }

  async function generate() {
    if (!filters.supplierId) return alert('يرجى اختيار المورد')
    setLoading(true); setGenerated(false)
    try {
      const eqMap = {}; allEquipment.forEach(e => eqMap[e.id] = e)

      const logsSnap = await getDocs(query(
        collection(db, 'logs'),
        where('supplierId', '==', filters.supplierId),
        where('date', '>=', filters.dateFrom),
        where('date', '<=', filters.dateTo),
        orderBy('date', 'asc')
      ))
      const logs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }))

      // Load priceHistory
      const usedEqIds = [...new Set(logs.map(l => l.equipmentId))]
      const histories = {}
      await Promise.all(usedEqIds.map(async eqId => {
        const s = await getDocs(query(collection(db, 'equipment', eqId, 'priceHistory'), orderBy('fromDate', 'asc')))
        histories[eqId] = s.docs.map(d => ({ id: d.id, ...d.data() }))
      }))

      function getRate(log) {
        return getPriceForDate(histories[log.equipmentId] || [], log.date, eqMap[log.equipmentId]?.hourlyRate || log.hourlyRate || 0)
      }

      // Filter retired + process logs
      const processedLogs = logs
        .filter(log => { const eq = eqMap[log.equipmentId]; return !(eq?.status === 'retired' && eq?.retiredDate && log.date > eq.retiredDate) })
        .map(log => ({ ...log, effectiveRate: getRate(log), cost: (log.hours || 0) * getRate(log) }))

      // Group by equipment
      const byEq = {}
      processedLogs.forEach(log => {
        if (!byEq[log.equipmentId]) {
          const eq = eqMap[log.equipmentId]
          byEq[log.equipmentId] = {
            id: log.equipmentId,
            name: log.equipmentName || eq?.name || '—',
            siteName: log.siteName || eq?.siteName || '—',
            logs: [], actualHours: 0, actualCost: 0,
            // Invoice fields (user fills these)
            invNo: '', invAmount: '',
          }
        }
        byEq[log.equipmentId].logs.push(log)
        if (log.status === 'working') {
          byEq[log.equipmentId].actualHours += log.hours || 0
          byEq[log.equipmentId].actualCost  += log.cost
        }
      })

      setEqRows(Object.values(byEq).sort((a,b) => a.name.localeCompare(b.name)))
      setGenerated(true)
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  // Update invoice fields per equipment
  function updateEq(id, field, value) {
    setEqRows(rows => rows.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  // Computed totals
  const grandActual   = eqRows.reduce((s,r) => s + r.actualCost, 0)
  const grandInvoiced = eqRows.reduce((s,r) => s + (parseFloat(r.invAmount) || 0), 0)
  const grandDiff     = grandInvoiced - grandActual

  const supplier = suppliers.find(s => s.id === filters.supplierId)

  function doPrint() {
    const rows = eqRows.map(r => ({
      ...r,
      invAmount: parseFloat(r.invAmount) || 0,
      diff: (parseFloat(r.invAmount) || 0) - r.actualCost,
    }))
    printDebitNote({
      supplier,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      eqRows: rows,
      grandActual,
      grandInvoiced,
      grandDiff,
    })
  }

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="page-title">📋 ديبت نوت المورد</div>
          <div className="page-sub">مقارنة الفواتير بالعمل الفعلي</div>
        </div>
        {generated && (
          <button className="btn btn-danger" onClick={doPrint}>
            🖨️ طباعة إشعار الخصم
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><span className="card-title">🔍 الإعدادات</span></div>
        <div className="card-body">
          <div className="form-group" style={{ maxWidth: 320 }}>
            <label className="form-label">المورد *</label>
            <select className="form-control" value={filters.supplierId}
              onChange={e => { setFilters(f => ({ ...f, supplierId: e.target.value })); setGenerated(false) }}>
              <option value="">اختر المورد</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label className="form-label">الفترة الزمنية</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[{key:'month',label:'هذا الشهر'},{key:'lastmonth',label:'الشهر الماضي'},{key:'custom',label:'مخصص'}].map(p => (
                <button key={p.key} type="button" onClick={() => p.key !== 'custom' && applyPreset(p.key)}
                  style={{ padding:'6px 14px', borderRadius:20, cursor:'pointer', fontFamily:'var(--font)', fontSize:'0.82rem', border:'1px solid', background: filters.preset===p.key?'var(--accent)':'var(--steel-3)', color: filters.preset===p.key?'#1a1200':'var(--text-2)', borderColor: filters.preset===p.key?'var(--accent)':'var(--border)' }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-row" style={{ marginBottom: 20 }}>
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
          <button className="btn btn-primary" onClick={generate} disabled={loading || !filters.supplierId}>
            {loading ? 'جاري التحميل...' : '📊 تحميل البيانات'}
          </button>
        </div>
      </div>

      {/* Main comparison table */}
      {generated && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">مقارنة الفعلي بالفواتير — {supplier?.name}</span>
            <span className="badge badge-gray">{eqRows.length} معدة</span>
          </div>
          <div className="card-body">

            {/* Info */}
            <div style={{ background: 'var(--steel-3)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: '0.85rem', color: 'var(--text-2)' }}>
              💡 أدخل <strong>رقم فاتورة المورد</strong> و<strong>قيمتها</strong> لكل معدة — النظام يحسب الفارق تلقائياً
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>المعدة</th>
                    <th>الموقع</th>
                    <th>ساعات فعلية</th>
                    <th>تكلفة فعلية (ريال)</th>
                    <th>رقم فاتورة المورد</th>
                    <th>قيمة الفاتورة (ريال)</th>
                    <th>الفارق (ريال)</th>
                  </tr>
                </thead>
                <tbody>
                  {eqRows.map(eq => {
                    const invAmt = parseFloat(eq.invAmount) || 0
                    const diff   = invAmt > 0 ? invAmt - eq.actualCost : null
                    return (
                      <tr key={eq.id} style={{ background: diff > 0 ? 'rgba(224,80,80,0.06)' : diff < 0 ? 'rgba(62,184,122,0.06)' : 'transparent' }}>
                        <td style={{ fontWeight: 600 }}>{eq.name}</td>
                        <td><span className="badge badge-blue">{eq.siteName}</span></td>
                        <td style={{ fontWeight: 600 }}>{eq.actualHours} س</td>
                        <td style={{ color: 'var(--accent)', fontWeight: 700 }}>
                          {eq.actualCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر
                        </td>
                        <td>
                          <input
                            className="form-control"
                            style={{ maxWidth: 140, fontSize: '0.82rem', padding: '5px 10px' }}
                            placeholder="مثال: INV-2026-001"
                            value={eq.invNo}
                            onChange={e => updateEq(eq.id, 'invNo', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="form-control"
                            style={{ maxWidth: 120, fontSize: '0.82rem', padding: '5px 10px' }}
                            placeholder="0"
                            value={eq.invAmount}
                            onChange={e => updateEq(eq.id, 'invAmount', e.target.value)}
                          />
                        </td>
                        <td>
                          {diff === null ? (
                            <span style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>— أدخل الفاتورة</span>
                          ) : diff === 0 ? (
                            <span className="badge badge-green">✓ مطابق</span>
                          ) : diff > 0 ? (
                            <div>
                              <span style={{ color: 'var(--danger)', fontWeight: 700, fontSize: '0.95rem' }}>
                                +{diff.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر
                              </span>
                              <div style={{ fontSize: '0.7rem', color: 'var(--danger)', marginTop: 2 }}>ديبت نوت على المورد</div>
                            </div>
                          ) : (
                            <div>
                              <span style={{ color: 'var(--success)', fontWeight: 700, fontSize: '0.95rem' }}>
                                {diff.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر
                              </span>
                              <div style={{ fontSize: '0.7rem', color: 'var(--success)', marginTop: 2 }}>فاتورة أقل من الفعلي</div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
              <div style={{ background: 'var(--steel-3)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--accent)' }}>
                  {grandActual.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: 4 }}>إجمالي الفعلي</div>
              </div>
              <div style={{ background: 'var(--steel-3)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-1)' }}>
                  {grandInvoiced.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: 4 }}>إجمالي الفواتير</div>
              </div>
              <div style={{ background: grandDiff > 0 ? 'rgba(224,80,80,0.1)' : grandDiff < 0 ? 'rgba(62,184,122,0.1)' : 'var(--steel-3)', border: `2px solid ${grandDiff > 0 ? 'var(--danger)' : grandDiff < 0 ? 'var(--success)' : 'var(--border)'}`, borderRadius: 10, padding: '14px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: grandDiff > 0 ? 'var(--danger)' : grandDiff < 0 ? 'var(--success)' : 'var(--text-3)' }}>
                  {grandDiff !== 0 ? (grandDiff > 0 ? '+' : '') + grandDiff.toLocaleString('ar-SA', { maximumFractionDigits: 0 }) + ' ر' : '✓ مطابق'}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: 4 }}>
                  {grandDiff > 0 ? '🔴 ديبت نوت على المورد' : grandDiff < 0 ? '🟢 فواتير أقل من الفعلي' : 'مطابق'}
                </div>
              </div>
            </div>

            {grandDiff > 0 && (
              <div style={{ marginTop: 16, background: 'rgba(224,80,80,0.08)', border: '2px solid var(--danger)', borderRadius: 10, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--danger)' }}>إجمالي الديبت نوت المطلوب من المورد</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: 4 }}>يجب على المورد إصدار ديبت نوت بهذا المبلغ</div>
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--danger)' }}>
                  {grandDiff.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ريال
                </div>
              </div>
            )}

            {/* Timesheets preview */}
            <div style={{ marginTop: 24 }}>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 12, color: 'var(--text-2)' }}>📅 تفاصيل الدوام الفعلي</div>
              {eqRows.map(eq => (
                <div key={eq.id} style={{ marginBottom: 16, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ background: 'var(--steel-3)', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 700 }}>{eq.name}</span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginRight: 10 }}>{eq.siteName}</span>
                    </div>
                    <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.85rem' }}>
                      {eq.actualHours} س · {eq.actualCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر
                    </span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>#</th><th>التاريخ</th><th>الحالة</th><th>الساعات</th><th>سعر/ساعة</th><th>التكلفة</th><th>ملاحظات</th></tr>
                      </thead>
                      <tbody>
                        {eq.logs.map((log, i) => (
                          <tr key={log.id}>
                            <td style={{ color: 'var(--text-3)' }}>{i+1}</td>
                            <td>{log.date}</td>
                            <td><span className={`badge ${log.status==='working'?'badge-green':log.status==='breakdown'?'badge-red':'badge-gold'}`} style={{ fontSize:'0.72rem' }}>
                              {log.status==='working'?'شغالة':log.status==='breakdown'?'عطل':log.status==='maintenance'?'صيانة':'راحة'}
                            </span></td>
                            <td>{log.hours > 0 ? `${log.hours} س` : '—'}</td>
                            <td style={{ color: 'var(--text-2)', fontSize: '0.82rem' }}>{log.effectiveRate > 0 ? `${log.effectiveRate} ر` : '—'}</td>
                            <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{log.cost > 0 ? `${log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر` : '—'}</td>
                            <td style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{log.notes || '—'}</td>
                          </tr>
                        ))}
                        <tr style={{ background: 'var(--steel-3)', fontWeight: 700 }}>
                          <td colSpan={3}>الإجمالي</td>
                          <td>{eq.actualHours} س</td>
                          <td></td>
                          <td style={{ color: 'var(--accent)' }}>{eq.actualCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
