import { useEffect, useState } from 'react'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { startOfWeek, endOfWeek, addWeeks, subWeeks, format } from 'date-fns'
import { getPriceForDate } from '../utils/priceHistory'

function getWeekRange(date) {
  const start = startOfWeek(date, { weekStartsOn: 6 })
  const end   = endOfWeek(date,   { weekStartsOn: 6 })
  return { start, end }
}

export default function ReportsPage() {
  const { userData } = useAuth()
  const [weekDate, setWeekDate] = useState(new Date())
  const [loading, setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('equipment')
  const [eqRows, setEqRows]     = useState([])
  const [siteRows, setSiteRows] = useState([])
  const [supRows, setSupRows]   = useState([])
  const [totalHours, setTotalHours] = useState(0)
  const [totalCost, setTotalCost]   = useState(0)
  const [logsCount, setLogsCount]   = useState(0)
  const [rawLogs, setRawLogs]       = useState([])
  const [weekStart, setWeekStart]   = useState('')
  const [weekEnd, setWeekEnd]       = useState('')

  const { start, end } = getWeekRange(weekDate)
  const startStr = format(start, 'yyyy-MM-dd')
  const endStr   = format(end,   'yyyy-MM-dd')

  useEffect(() => { loadReport() }, [weekDate])

  async function loadReport() {
    setLoading(true)
    setWeekStart(startStr)
    setWeekEnd(endStr)
    try {
      const [eqSnap, logsSnap] = await Promise.all([
        getDocs(collection(db, 'equipment')),
        getDocs(query(
          collection(db, 'logs'),
          where('date', '>=', startStr),
          where('date', '<=', endStr),
          orderBy('date', 'asc')
        ))
      ])

      const eqList = eqSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const logs   = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const eqMap  = {}
      eqList.forEach(e => eqMap[e.id] = e)

      const usedEqIds = [...new Set(logs.map(l => l.equipmentId))]

      const histories = {}
      await Promise.all(usedEqIds.map(async eqId => {
        const snap = await getDocs(
          query(collection(db, 'equipment', eqId, 'priceHistory'), orderBy('fromDate', 'asc'))
        )
        histories[eqId] = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      }))

      function getRate(log) {
        const history  = histories[log.equipmentId] || []
        const fallback = eqMap[log.equipmentId]?.hourlyRate || log.hourlyRate || 0
        return getPriceForDate(history, log.date, fallback)
      }

      const eqSummary = {}
      logs.forEach(log => {
        const eq   = eqMap[log.equipmentId] || {}
        const rate = getRate(log)
        const cost = (log.hours || 0) * rate
        if (!eqSummary[log.equipmentId]) {
          eqSummary[log.equipmentId] = {
            name: log.equipmentName || eq.name || '—',
            siteName: log.siteName || eq.siteName || '—',
            supplierName: log.supplierName || eq.supplierName || '—',
            hours: 0, cost: 0, days: new Set(),
          }
        }
        eqSummary[log.equipmentId].hours += log.hours || 0
        eqSummary[log.equipmentId].cost  += cost
        eqSummary[log.equipmentId].days.add(log.date)
      })
      const eqList2 = Object.values(eqSummary)
        .map(s => ({ ...s, days: s.days.size }))
        .sort((a, b) => b.cost - a.cost)

      const siteSummary = {}
      logs.forEach(log => {
        const key  = log.siteName || '—'
        const rate = getRate(log)
        if (!siteSummary[key]) siteSummary[key] = { name: key, hours: 0, cost: 0, count: 0 }
        siteSummary[key].hours += log.hours || 0
        siteSummary[key].cost  += (log.hours || 0) * rate
        siteSummary[key].count++
      })
      const siteList = Object.values(siteSummary).sort((a, b) => b.cost - a.cost)

      const supSummary = {}
      logs.forEach(log => {
        const key  = log.supplierName || '—'
        const rate = getRate(log)
        if (!supSummary[key]) supSummary[key] = { name: key, hours: 0, cost: 0, equipment: new Set() }
        supSummary[key].hours += log.hours || 0
        supSummary[key].cost  += (log.hours || 0) * rate
        supSummary[key].equipment.add(log.equipmentName || '—')
      })
      const supList = Object.values(supSummary)
        .map(s => ({ ...s, equipment: [...s.equipment] }))
        .sort((a, b) => b.cost - a.cost)

      const tHours = eqList2.reduce((s, r) => s + r.hours, 0)
      const tCost  = eqList2.reduce((s, r) => s + r.cost,  0)

      const logsWithRate = logs.map(l => ({
        ...l, effectiveRate: getRate(l), cost: (l.hours || 0) * getRate(l)
      }))

      setEqRows(eqList2)
      setSiteRows(siteList)
      setSupRows(supList)
      setTotalHours(tHours)
      setTotalCost(tCost)
      setLogsCount(logs.length)
      setRawLogs(logsWithRate)

    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  function exportExcel() {
    import('xlsx').then(XLSX => {
      const wb = XLSX.utils.book_new()
      const eqData = [
        ['التقرير الأسبوعي — عيون الحديد'],
        [`الأسبوع: ${format(start, 'dd/MM/yyyy')} — ${format(end, 'dd/MM/yyyy')}`],
        ['الأسعار محسوبة حسب تاريخ سريان كل سعر'],
        [],
        ['المعدة', 'الموقع', 'المورد', 'الساعات', 'التكلفة (ريال)', 'أيام العمل'],
        ...eqRows.map(r => [r.name, r.siteName, r.supplierName, r.hours, r.cost.toFixed(2), r.days]),
        [], ['الإجمالي', '', '', totalHours, totalCost.toFixed(2), ''],
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(eqData), 'المعدات')
      const detailData = [
        ['تفاصيل السجلات'], [],
        ['التاريخ', 'المعدة', 'الموقع', 'المورد', 'الساعات', 'سعر/ساعة المطبق', 'التكلفة', 'المشرف'],
        ...rawLogs.map(l => [l.date, l.equipmentName||'—', l.siteName||'—', l.supplierName||'—', l.hours, l.effectiveRate, l.cost.toFixed(2), l.supervisorName||'—']),
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailData), 'التفاصيل')
      XLSX.writeFile(wb, `تقرير-عيون-الحديد-${startStr}.xlsx`)
    })
  }

  const tabStyle = t => ({
    padding: '8px 18px', cursor: 'pointer', border: 'none', borderRadius: 'var(--radius-sm)',
    fontFamily: 'var(--font)', fontSize: '0.88rem', fontWeight: 500,
    background: activeTab === t ? 'var(--accent-dim)' : 'transparent',
    color: activeTab === t ? 'var(--accent)' : 'var(--text-2)',
    transition: 'all 0.15s',
  })

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="page-title">📋 التقارير الأسبوعية</div>
          <div className="page-sub">الأسعار محسوبة حسب تاريخ سريان كل سعر</div>
        </div>
        <button className="btn btn-secondary" onClick={exportExcel} disabled={logsCount === 0}>📥 تصدير Excel</button>
      </div>

      <div className="report-week-selector">
        <button className="btn btn-secondary btn-sm" onClick={() => setWeekDate(d => subWeeks(d, 1))}>→ السابق</button>
        <div className="week-display">{format(start, 'dd/MM/yyyy')} — {format(end, 'dd/MM/yyyy')}</div>
        <button className="btn btn-secondary btn-sm" onClick={() => setWeekDate(d => addWeeks(d, 1))}>التالي ←</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setWeekDate(new Date())}>الحالي</button>
      </div>

      <div className="report-summary">
        <div className="summary-box"><div className="val">{loading ? '...' : totalHours.toFixed(1)}</div><div className="lbl">إجمالي الساعات</div></div>
        <div className="summary-box"><div className="val">{loading ? '...' : totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</div><div className="lbl">إجمالي التكلفة (ريال)</div></div>
        <div className="summary-box"><div className="val">{loading ? '...' : eqRows.length}</div><div className="lbl">معدات شغلت</div></div>
        <div className="summary-box"><div className="val">{loading ? '...' : logsCount}</div><div className="lbl">سجل دوام</div></div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--steel-3)', padding: 4, borderRadius: 'var(--radius-sm)', width: 'fit-content' }}>
        <button style={tabStyle('equipment')} onClick={() => setActiveTab('equipment')}>🏗️ المعدات</button>
        <button style={tabStyle('sites')}     onClick={() => setActiveTab('sites')}>📍 المواقع</button>
        <button style={tabStyle('suppliers')} onClick={() => setActiveTab('suppliers')}>🏢 الموردون</button>
      </div>

      {loading ? <div className="spinner" /> : (
        <div className="card">
          <div className="table-wrap">
            {activeTab === 'equipment' && (
              eqRows.length === 0
                ? <div className="empty-state"><div className="empty-icon">📊</div><div className="empty-text">لا توجد سجلات</div></div>
                : <table>
                    <thead><tr><th>المعدة</th><th>الموقع</th><th>المورد</th><th>الساعات</th><th>التكلفة</th><th>أيام عمل</th></tr></thead>
                    <tbody>
                      {eqRows.map((r, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{r.name}</td>
                          <td><span className="badge badge-blue">{r.siteName}</span></td>
                          <td style={{ color: 'var(--text-2)' }}>{r.supplierName}</td>
                          <td>{r.hours.toFixed(1)} س</td>
                          <td style={{ color: 'var(--accent)', fontWeight: 700 }}>{r.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                          <td><span className="badge badge-gray">{r.days} أيام</span></td>
                        </tr>
                      ))}
                      <tr style={{ background: 'var(--accent-dim2)', fontWeight: 700 }}>
                        <td colSpan={3} style={{ color: 'var(--text-2)' }}>الإجمالي</td>
                        <td>{totalHours.toFixed(1)} س</td>
                        <td style={{ color: 'var(--accent)', fontSize: '1.05rem' }}>{totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
            )}
            {activeTab === 'sites' && (
              siteRows.length === 0
                ? <div className="empty-state"><div className="empty-icon">📍</div><div className="empty-text">لا توجد بيانات</div></div>
                : <table>
                    <thead><tr><th>#</th><th>الموقع</th><th>الساعات</th><th>التكلفة</th><th>السجلات</th><th>النسبة</th></tr></thead>
                    <tbody>
                      {siteRows.map((r, i) => (
                        <tr key={i}>
                          <td style={{ color: 'var(--text-3)' }}>{i + 1}</td>
                          <td style={{ fontWeight: 600 }}>{r.name}</td>
                          <td>{r.hours.toFixed(1)} س</td>
                          <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{r.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                          <td><span className="badge badge-gray">{r.count}</span></td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ flex: 1, height: 6, background: 'var(--steel-4)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${totalCost > 0 ? (r.cost / totalCost * 100) : 0}%`, background: 'var(--accent)', borderRadius: 3 }} />
                              </div>
                              <span style={{ fontSize: '0.78rem', color: 'var(--text-2)', minWidth: 36 }}>
                                {totalCost > 0 ? (r.cost / totalCost * 100).toFixed(1) : 0}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
            )}
            {activeTab === 'suppliers' && (
              supRows.length === 0
                ? <div className="empty-state"><div className="empty-icon">🏢</div><div className="empty-text">لا توجد بيانات</div></div>
                : <table>
                    <thead><tr><th>المورد</th><th>الساعات</th><th>التكلفة</th><th>المعدات</th></tr></thead>
                    <tbody>
                      {supRows.map((r, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{r.name}</td>
                          <td>{r.hours.toFixed(1)} س</td>
                          <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{r.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                          <td style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>{r.equipment.join('، ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
