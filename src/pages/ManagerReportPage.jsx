import { useEffect, useState } from 'react'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, subWeeks, subMonths, differenceInDays, parseISO } from 'date-fns'
import { getPriceForDate } from '../utils/priceHistory'

function getExpectedDays(eq, from, to) {
  const start = eq.startDate && eq.startDate > from ? eq.startDate : from
  const end   = eq.retiredDate && eq.retiredDate < to ? eq.retiredDate : to
  if (start > end) return 0
  return differenceInDays(parseISO(end), parseISO(start)) + 1
}

export default function ManagerReportPage() {
  const [mode, setMode]     = useState('weekly')
  const [offset, setOffset] = useState(0)
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  function getRange() {
    const now = new Date()
    if (mode === 'weekly') {
      const base = offset === 0 ? now : subWeeks(now, Math.abs(offset))
      return {
        from:  format(startOfWeek(base, { weekStartsOn: 6 }), 'yyyy-MM-dd'),
        to:    format(endOfWeek(base,   { weekStartsOn: 6 }), 'yyyy-MM-dd'),
        label: offset === 0 ? 'هذا الأسبوع' : 'الأسبوع الماضي',
      }
    } else {
      const base = offset === 0 ? now : subMonths(now, Math.abs(offset))
      return {
        from:  format(startOfMonth(base), 'yyyy-MM-dd'),
        to:    format(endOfMonth(base),   'yyyy-MM-dd'),
        label: format(base, 'MMMM yyyy'),
      }
    }
  }

  useEffect(() => { generate() }, [mode, offset])

  async function generate() {
    setLoading(true); setData(null)
    try {
      const { from, to, label } = getRange()

      const [eqSnap, siteSnap, logsSnap] = await Promise.all([
        getDocs(collection(db, 'equipment')),
        getDocs(collection(db, 'sites')),
        getDocs(query(collection(db, 'logs'), where('date', '>=', from), where('date', '<=', to), orderBy('date', 'asc'))),
      ])

      const equipment = eqSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const logs      = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const eqMap     = {}; equipment.forEach(e => eqMap[e.id] = e)
      const siteMap   = {}; siteSnap.docs.forEach(d => siteMap[d.id] = d.data().name)

      // Load priceHistory for used equipment
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

      // Equipment summary
      const eqSummary = {}
      logs.forEach(l => {
        const rate = getRate(l)
        const cost = (l.hours || 0) * rate
        if (!eqSummary[l.equipmentId]) {
          const eq = eqMap[l.equipmentId]
          eqSummary[l.equipmentId] = {
            name: l.equipmentName || eq?.name || '—',
            siteName: l.siteName || eq?.siteName || '—',
            supplierName: l.supplierName || eq?.supplierName || '—',
            hours: 0, cost: 0,
            workDays: 0, breakdownDays: 0, maintenanceDays: 0,
            breakdownReasons: [],
            expectedDays: eq ? getExpectedDays(eq, from, to) : 0,
          }
        }
        const s = eqSummary[l.equipmentId]
        s.hours += l.hours || 0
        s.cost  += cost
        if (l.status === 'working')     s.workDays++
        if (l.status === 'breakdown')   { s.breakdownDays++;   if (l.stopReason) s.breakdownReasons.push(l.stopReason) }
        if (l.status === 'maintenance') s.maintenanceDays++
      })
      const eqList = Object.values(eqSummary).map(s => ({
        ...s, uptime: s.expectedDays > 0 ? Math.round((s.workDays / s.expectedDays) * 100) : 0,
      })).sort((a, b) => b.cost - a.cost)

      // Site summary
      const siteSummary = {}
      logs.forEach(l => {
        const key  = l.siteName || '—'
        const rate = getRate(l)
        if (!siteSummary[key]) siteSummary[key] = { name: key, hours: 0, cost: 0, eqSet: new Set(), breakdowns: 0 }
        siteSummary[key].hours += l.hours || 0
        siteSummary[key].cost  += (l.hours || 0) * rate
        siteSummary[key].eqSet.add(l.equipmentId)
        if (l.status === 'breakdown') siteSummary[key].breakdowns++
      })
      const siteList = Object.values(siteSummary).map(s => ({ ...s, eqCount: s.eqSet.size })).sort((a, b) => b.cost - a.cost)

      // Supplier summary
      const supSummary = {}
      logs.forEach(l => {
        const key  = l.supplierName || '—'
        const rate = getRate(l)
        if (!supSummary[key]) supSummary[key] = { name: key, hours: 0, cost: 0, eqSet: new Set() }
        supSummary[key].hours += l.hours || 0
        supSummary[key].cost  += (l.hours || 0) * rate
        supSummary[key].eqSet.add(l.equipmentId)
      })
      const supList = Object.values(supSummary).map(s => ({ ...s, eqCount: s.eqSet.size })).sort((a, b) => b.cost - a.cost)

      const totalHours    = eqList.reduce((s, e) => s + e.hours, 0)
      const totalCost     = eqList.reduce((s, e) => s + e.cost,  0)
      const totalBreakdowns = eqList.reduce((s, e) => s + e.breakdownDays, 0)
      const topBreakdowns = [...eqList].filter(e => e.breakdownDays > 0).sort((a, b) => b.breakdownDays - a.breakdownDays).slice(0, 5)

      setData({ from, to, label, eqList, siteList, supList, totalHours, totalCost, totalBreakdowns, topBreakdowns, logsCount: logs.length })
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  function copyLink() {
    const { from, to } = getRange()
    const url = `${window.location.origin}${window.location.pathname}?report=1&from=${from}&to=${to}&mode=${mode}`
    navigator.clipboard.writeText(url)
    setCopied(true); setTimeout(() => setCopied(false), 2500)
  }

  function shareWhatsapp() {
    const { label } = getRange()
    const text = data
      ? `تقرير عيون الحديد — ${label}\n\n` +
        `💰 إجمالي التكلفة: ${data.totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ريال\n` +
        `⏱️ إجمالي الساعات: ${data.totalHours.toFixed(0)} ساعة\n` +
        `🏗️ عدد المعدات: ${data.eqList.length}\n` +
        `🔴 أيام عطل: ${data.totalBreakdowns}\n\n${window.location.href}`
      : ''
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  const { label } = getRange()

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body { background: white !important; color: #1a1f2e !important; direction: rtl; font-family: 'IBM Plex Sans Arabic', sans-serif; }
          .print-page { padding: 24px 32px; }
          .report-cover { text-align: center; padding: 40px 0 30px; border-bottom: 3px solid #e8a020; margin-bottom: 28px; }
          .cover-title { font-size: 26px; font-weight: 800; color: #1a1f2e; }
          .cover-sub { font-size: 14px; color: #666; margin-top: 6px; }
          .cover-period { display: inline-block; background: #e8a020; color: #1a1200; padding: 6px 20px; border-radius: 20px; font-size: 13px; font-weight: 700; margin-top: 12px; }
          .kpi-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 28px; }
          .kpi-box { border: 2px solid #e8a020; border-radius: 10px; padding: 14px; text-align: center; }
          .kpi-val { font-size: 22px; font-weight: 800; color: #e8a020; }
          .kpi-lbl { font-size: 11px; color: #555; margin-top: 4px; }
          .section-title { font-size: 14px; font-weight: 800; color: #1a1f2e; border-right: 4px solid #e8a020; padding-right: 10px; margin: 22px 0 10px; }
          .r-table { width: 100%; border-collapse: collapse; font-size: 11px; }
          .r-table th { background: #1a1f2e; color: white; padding: 7px 10px; text-align: right; }
          .r-table td { padding: 6px 10px; border-bottom: 1px solid #eee; }
          .r-table tr:nth-child(even) td { background: #f9f9f9; }
          .uptime-bar { display: inline-block; width: 60px; height: 6px; background: #eee; border-radius: 3px; vertical-align: middle; margin-left: 6px; }
          .uptime-fill { height: 100%; border-radius: 3px; display: block; }
          .report-footer { margin-top: 30px; border-top: 1px solid #ddd; padding-top: 12px; font-size: 10px; color: #999; display: flex; justify-content: space-between; }
        }
        @media screen { .print-only { display: none; } }
      `}</style>

      <div className="page no-print">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="page-title">📨 تقرير المدير</div>
            <div className="page-sub">أسبوعي وشهري جاهز للإرسال</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={copyLink}>{copied ? '✅ تم النسخ' : '🔗 نسخ الرابط'}</button>
            <button className="btn btn-secondary" onClick={shareWhatsapp} disabled={!data}>📲 واتساب</button>
            <button className="btn btn-primary" onClick={() => window.print()} disabled={!data}>🖨️ طباعة PDF</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', background: 'var(--steel-3)', borderRadius: 8, padding: 3 }}>
            {['weekly', 'monthly'].map(m => (
              <button key={m} onClick={() => { setMode(m); setOffset(0) }}
                style={{ padding: '7px 20px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '0.88rem', fontWeight: 500, background: mode === m ? 'var(--accent)' : 'transparent', color: mode === m ? '#1a1200' : 'var(--text-2)', transition: 'all 0.15s' }}>
                {m === 'weekly' ? '📅 أسبوعي' : '📆 شهري'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setOffset(o => o - 1)}>→ السابق</button>
            <div style={{ background: 'var(--steel-3)', border: '1px solid var(--accent)', borderRadius: 8, padding: '7px 18px', fontWeight: 600, fontSize: '0.9rem', color: 'var(--accent)' }}>{label}</div>
            <button className="btn btn-secondary btn-sm" onClick={() => setOffset(o => Math.min(o + 1, 0))} disabled={offset === 0}>التالي ←</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setOffset(0)} disabled={offset === 0}>الحالي</button>
          </div>
        </div>

        {loading ? <div className="spinner" /> : !data ? null : (
          <div className="card">
            <div className="card-header">
              <span className="card-title">معاينة — {data.label}</span>
              <span className="badge badge-gray">{data.logsCount} سجل</span>
            </div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
                {[
                  { val: data.totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 }) + ' ر', lbl: 'إجمالي التكلفة', color: 'var(--accent)' },
                  { val: data.totalHours.toFixed(0) + ' س', lbl: 'إجمالي الساعات', color: 'var(--success)' },
                  { val: data.eqList.length, lbl: 'معدات شغلت', color: 'var(--info)' },
                  { val: data.totalBreakdowns, lbl: 'أيام عطل', color: 'var(--danger)' },
                ].map((k, i) => (
                  <div key={i} style={{ background: 'var(--steel-3)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, textAlign: 'center' }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: k.color }}>{k.val}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 4 }}>{k.lbl}</div>
                  </div>
                ))}
              </div>

              <div style={{ fontWeight: 700, marginBottom: 10, color: 'var(--text-2)', fontSize: '0.85rem' }}>📍 المواقع</div>
              <div className="table-wrap" style={{ marginBottom: 20 }}>
                <table>
                  <thead><tr><th>الموقع</th><th>الساعات</th><th>التكلفة</th><th>المعدات</th><th>أيام عطل</th></tr></thead>
                  <tbody>
                    {data.siteList.map((s, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{s.name}</td>
                        <td>{s.hours.toFixed(0)} س</td>
                        <td style={{ color: 'var(--accent)', fontWeight: 700 }}>{s.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                        <td>{s.eqCount}</td>
                        <td>{s.breakdowns > 0 ? <span className="badge badge-red">{s.breakdowns}</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ fontWeight: 700, marginBottom: 10, color: 'var(--text-2)', fontSize: '0.85rem' }}>🏗️ المعدات</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>المعدة</th><th>الموقع</th><th>الساعات</th><th>التكلفة</th><th>نسبة التشغيل</th><th>عطل</th></tr></thead>
                  <tbody>
                    {data.eqList.map((e, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{e.name}</td>
                        <td><span className="badge badge-blue">{e.siteName}</span></td>
                        <td>{e.hours.toFixed(0)} س</td>
                        <td style={{ color: 'var(--accent)', fontWeight: 700 }}>{e.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 60, height: 6, background: 'var(--steel-4)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${e.uptime}%`, background: e.uptime >= 80 ? 'var(--success)' : e.uptime >= 50 ? 'var(--accent)' : 'var(--danger)', borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: '0.78rem', color: e.uptime >= 80 ? 'var(--success)' : e.uptime >= 50 ? 'var(--accent)' : 'var(--danger)', fontWeight: 600 }}>{e.uptime}%</span>
                          </div>
                        </td>
                        <td>{e.breakdownDays > 0 ? <span className="badge badge-red">{e.breakdownDays} يوم</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {data && (
        <div className="print-page print-only">
          <div className="report-cover">
            <div style={{ fontSize: 32, marginBottom: 8 }}>⚙️</div>
            <div className="cover-title">عيون الحديد — تقرير المعدات</div>
            <div className="cover-sub">{mode === 'weekly' ? 'تقرير أسبوعي' : 'تقرير شهري'}</div>
            <div className="cover-period">{data.label} · {data.from} — {data.to}</div>
            <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>تاريخ الإصدار: {format(new Date(), 'dd/MM/yyyy HH:mm')}</div>
          </div>

          <div className="kpi-grid">
            <div className="kpi-box"><div className="kpi-val">{data.totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</div><div className="kpi-lbl">💰 إجمالي التكلفة (ريال)</div></div>
            <div className="kpi-box"><div className="kpi-val">{data.totalHours.toFixed(0)}</div><div className="kpi-lbl">⏱️ إجمالي الساعات</div></div>
            <div className="kpi-box"><div className="kpi-val">{data.eqList.length}</div><div className="kpi-lbl">🏗️ معدات شغلت</div></div>
            <div className="kpi-box" style={{ borderColor: data.totalBreakdowns > 0 ? '#e05050' : '#e8a020' }}>
              <div className="kpi-val" style={{ color: data.totalBreakdowns > 0 ? '#e05050' : '#3eb87a' }}>{data.totalBreakdowns}</div>
              <div className="kpi-lbl">🔴 أيام عطل</div>
            </div>
          </div>

          <div className="section-title">📍 ملخص المواقع</div>
          <table className="r-table">
            <thead><tr><th>الموقع</th><th>الساعات</th><th>التكلفة (ريال)</th><th>المعدات</th><th>أيام عطل</th></tr></thead>
            <tbody>
              {data.siteList.map((s, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }}>{s.name}</td>
                  <td>{s.hours.toFixed(0)}</td>
                  <td style={{ fontWeight: 700, color: '#e8a020' }}>{s.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td>
                  <td>{s.eqCount}</td>
                  <td style={{ color: s.breakdowns > 0 ? '#e05050' : '#3eb87a' }}>{s.breakdowns > 0 ? s.breakdowns : '✓'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="section-title">🏗️ تفاصيل المعدات</div>
          <table className="r-table">
            <thead><tr><th>المعدة</th><th>الموقع</th><th>المورد</th><th>الساعات</th><th>التكلفة (ريال)</th><th>نسبة التشغيل</th><th>عطل</th><th>صيانة</th></tr></thead>
            <tbody>
              {data.eqList.map((e, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }}>{e.name}</td>
                  <td>{e.siteName}</td>
                  <td>{e.supplierName}</td>
                  <td>{e.hours.toFixed(0)}</td>
                  <td style={{ fontWeight: 700, color: '#e8a020' }}>{e.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td>
                  <td>
                    <span className="uptime-bar">
                      <span className="uptime-fill" style={{ width: `${e.uptime}%`, background: e.uptime >= 80 ? '#3eb87a' : e.uptime >= 50 ? '#e8a020' : '#e05050' }} />
                    </span>
                    {e.uptime}%
                  </td>
                  <td style={{ color: e.breakdownDays > 0 ? '#e05050' : '#3eb87a' }}>{e.breakdownDays > 0 ? e.breakdownDays : '—'}</td>
                  <td>{e.maintenanceDays > 0 ? e.maintenanceDays : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.topBreakdowns.length > 0 && (
            <>
              <div className="section-title">🔴 أكثر المعدات تعطلاً</div>
              <table className="r-table">
                <thead><tr><th>#</th><th>المعدة</th><th>الموقع</th><th>أيام العطل</th><th>أسباب العطل</th></tr></thead>
                <tbody>
                  {data.topBreakdowns.map((e, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 700, color: '#e05050' }}>{i + 1}</td>
                      <td style={{ fontWeight: 700 }}>{e.name}</td>
                      <td>{e.siteName}</td>
                      <td style={{ color: '#e05050', fontWeight: 700 }}>{e.breakdownDays}</td>
                      <td style={{ fontSize: 10, color: '#666' }}>{e.breakdownReasons.slice(0, 3).join(' · ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="section-title">🏢 ملخص الموردين</div>
          <table className="r-table">
            <thead><tr><th>المورد</th><th>الساعات</th><th>التكلفة (ريال)</th><th>المعدات</th></tr></thead>
            <tbody>
              {data.supList.map((s, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }}>{s.name}</td>
                  <td>{s.hours.toFixed(0)}</td>
                  <td style={{ fontWeight: 700, color: '#e8a020' }}>{s.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td>
                  <td>{s.eqCount}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="report-footer">
            <span>⚙️ عيون الحديد — نظام متابعة المعدات</span>
            <span>تم إصداره بتاريخ {format(new Date(), 'dd/MM/yyyy')}</span>
          </div>
        </div>
      )}
    </>
  )
}
