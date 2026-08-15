import { useEffect, useState } from 'react'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { getPriceForDate } from '../utils/priceHistory'

const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')
const monthEnd   = format(endOfMonth(new Date()),   'yyyy-MM-dd')
const monthName  = format(new Date(), 'MMMM yyyy')
const today      = format(new Date(), 'yyyy-MM-dd')

function getExpectedDays(eq) {
  const { differenceInDays, parseISO } = require ? null : null
  const start = eq.startDate && eq.startDate > monthStart ? eq.startDate : monthStart
  const end   = eq.retiredDate && eq.retiredDate < today  ? eq.retiredDate : today
  if (start > end) return 0
  const s = new Date(start), e = new Date(end)
  return Math.round((e - s) / 86400000) + 1
}

export default function AdminDashboard({ setActivePage }) {
  const [loading, setLoading]       = useState(true)
  const [stats, setStats]           = useState({})
  const [eqRows, setEqRows]         = useState([])
  const [siteRows, setSiteRows]     = useState([])
  const [breakdowns, setBreakdowns] = useState([])
  const [recentLogs, setRecentLogs] = useState([])
  const [topWorkers, setTopWorkers] = useState([])
  const [totalCost, setTotalCost]   = useState(0)
  const [totalHours, setTotalHours] = useState(0)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    try {
      const [eqSnap, siteSnap, logsSnap] = await Promise.all([
        getDocs(collection(db, 'equipment')),
        getDocs(collection(db, 'sites')),
        getDocs(query(
          collection(db, 'logs'),
          where('date', '>=', monthStart),
          where('date', '<=', monthEnd),
          orderBy('date', 'desc')
        )),
      ])

      const equipment = eqSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const logs      = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const eqMap     = {}; equipment.forEach(e => eqMap[e.id] = e)

      // Load priceHistory for all equipment in logs
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

      // Overall stats
      const breakdownLogs   = logs.filter(l => l.status === 'breakdown')
      const maintenanceLogs = logs.filter(l => l.status === 'maintenance')
      const activeEq        = equipment.filter(e => e.status !== 'retired').length

      // Per-equipment summary
      const eqSummary = {}
      logs.forEach(l => {
        const rate = getRate(l)
        const cost = (l.hours || 0) * rate
        if (!eqSummary[l.equipmentId]) {
          const eq = eqMap[l.equipmentId]
          eqSummary[l.equipmentId] = {
            name: l.equipmentName || eq?.name || '—',
            siteName: l.siteName || eq?.siteName || '—',
            hourlyRate: rate,
            hours: 0, cost: 0,
            workDays: 0, breakdownDays: 0, maintenanceDays: 0,
            breakdownReasons: [],
            expectedDays: eq ? getExpectedDays(eq) : 0,
          }
        }
        const s = eqSummary[l.equipmentId]
        s.hours += l.hours || 0
        s.cost  += cost
        if (l.status === 'working')     s.workDays++
        if (l.status === 'breakdown')   { s.breakdownDays++;   if (l.stopReason) s.breakdownReasons.push(l.stopReason) }
        if (l.status === 'maintenance') s.maintenanceDays++
      })

      const eqList = Object.entries(eqSummary).map(([id, s]) => ({
        id, ...s,
        uptime: s.expectedDays > 0 ? Math.round((s.workDays / s.expectedDays) * 100) : 0,
      })).sort((a, b) => b.cost - a.cost)

      const tHours = eqList.reduce((s, r) => s + r.hours, 0)
      const tCost  = eqList.reduce((s, r) => s + r.cost,  0)

      // Breakdowns ranking
      const bdList = eqList.filter(e => e.breakdownDays > 0).sort((a, b) => b.breakdownDays - a.breakdownDays).slice(0, 6)

      // Per-site summary
      const siteSummary = {}
      logs.forEach(l => {
        const key  = l.siteName || '—'
        const rate = getRate(l)
        if (!siteSummary[key]) siteSummary[key] = { name: key, hours: 0, cost: 0, eqCount: new Set() }
        siteSummary[key].hours += l.hours || 0
        siteSummary[key].cost  += (l.hours || 0) * rate
        siteSummary[key].eqCount.add(l.equipmentId)
      })
      const siteList = Object.values(siteSummary)
        .map(s => ({ ...s, eqCount: s.eqCount.size }))
        .sort((a, b) => b.cost - a.cost)

      // Recent logs with correct cost
      const recent = logs.slice(0, 8).map(l => ({
        ...l, cost: (l.hours || 0) * getRate(l)
      }))

      // Top supervisors
      const workerMap = {}
      logs.filter(l => l.status === 'working').forEach(l => {
        const key = l.supervisorName || '—'
        if (!workerMap[key]) workerMap[key] = { name: key, hours: 0, logs: 0 }
        workerMap[key].hours += l.hours || 0
        workerMap[key].logs++
      })
      const workers = Object.values(workerMap).sort((a, b) => b.hours - a.hours).slice(0, 5)

      setStats({ equipment: activeEq, sites: siteList.length, breakdowns: breakdownLogs.length, maintenance: maintenanceLogs.length, totalLogs: logs.length })
      setTotalHours(tHours)
      setTotalCost(tCost)
      setEqRows(eqList)
      setSiteRows(siteList)
      setBreakdowns(bdList)
      setRecentLogs(recent)
      setTopWorkers(workers)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  if (loading) return <div className="spinner" />

  const maxSiteCost = Math.max(...siteRows.map(s => s.cost), 1)

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">📊 لوحة التحكم</div>
          <div className="page-sub">📅 {monthName}</div>
        </div>
        <button className="btn btn-primary" onClick={() => setActivePage('quickentry')}>⚡ إدخال سريع</button>
      </div>

      {/* KPI Cards */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <div className="stat-card gold">
          <div className="stat-icon">💰</div>
          <div className="stat-value" style={{ fontSize: '1.5rem' }}>{totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</div>
          <div className="stat-label">إجمالي التكلفة (ريال)</div>
        </div>
        <div className="stat-card green">
          <div className="stat-icon">⏱️</div>
          <div className="stat-value">{totalHours.toFixed(0)}</div>
          <div className="stat-label">إجمالي الساعات</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon">🏗️</div>
          <div className="stat-value">{stats.equipment}</div>
          <div className="stat-label">معدات نشطة</div>
        </div>
        <div className="stat-card red">
          <div className="stat-icon">🔴</div>
          <div className="stat-value">{stats.breakdowns}</div>
          <div className="stat-label">أيام عطل</div>
        </div>
        <div className="stat-card gold">
          <div className="stat-icon">🔧</div>
          <div className="stat-value">{stats.maintenance}</div>
          <div className="stat-label">أيام صيانة</div>
        </div>
      </div>

      {/* Site chart + Breakdowns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><span className="card-title">📍 تكلفة المواقع — {monthName}</span></div>
          <div className="card-body">
            {siteRows.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">📍</div><div className="empty-text">لا توجد بيانات</div></div>
            ) : siteRows.map((site, i) => (
              <div key={i} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{site.name}</span>
                  <div style={{ textAlign: 'left' }}>
                    <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.88rem' }}>
                      {site.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر
                    </span>
                    <span style={{ color: 'var(--text-3)', fontSize: '0.75rem', marginRight: 8 }}>
                      {site.hours.toFixed(0)} س · {site.eqCount} معدة
                    </span>
                  </div>
                </div>
                <div style={{ height: 10, background: 'var(--steel-4)', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(site.cost / maxSiteCost) * 100}%`, background: `hsl(${200 + i * 40}, 70%, 55%)`, borderRadius: 5, transition: 'width 0.6s ease' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">🔴 أكثر المعدات تعطلاً</span>
            <span className="badge badge-red">{breakdowns.length} معدة</span>
          </div>
          <div className="card-body" style={{ padding: '12px 20px' }}>
            {breakdowns.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">✅</div><div className="empty-text">لا توجد أعطال هذا الشهر</div></div>
            ) : breakdowns.map((eq, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < breakdowns.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: i === 0 ? '#e05050' : i === 1 ? '#e07030' : 'var(--steel-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{eq.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{eq.siteName}{eq.breakdownReasons.length > 0 && ` · ${eq.breakdownReasons[0]}`}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: 'var(--danger)', fontWeight: 700 }}>{eq.breakdownDays}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>يوم</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Equipment uptime */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span className="card-title">📈 نسبة تشغيل المعدات — {monthName}</span>
          <span className="badge badge-gray">{eqRows.length} معدة</span>
        </div>
        <div className="card-body">
          {eqRows.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">📊</div><div className="empty-text">لا توجد بيانات</div></div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {eqRows.map((eq, i) => (
                <div key={i} style={{ background: 'var(--steel-3)', borderRadius: 8, padding: '12px 14px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{eq.name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>{eq.siteName}</div>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: eq.uptime >= 80 ? 'var(--success)' : eq.uptime >= 50 ? 'var(--accent)' : 'var(--danger)' }}>{eq.uptime}%</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-3)' }}>تشغيل</div>
                    </div>
                  </div>
                  <div style={{ height: 6, background: 'var(--steel-4)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ height: '100%', borderRadius: 3, width: `${eq.uptime}%`, background: eq.uptime >= 80 ? 'var(--success)' : eq.uptime >= 50 ? 'var(--accent)' : 'var(--danger)', transition: 'width 0.6s ease' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, fontSize: '0.72rem' }}>
                    <span style={{ color: 'var(--success)' }}>✅ {eq.workDays} شغل</span>
                    {eq.breakdownDays > 0 && <span style={{ color: 'var(--danger)' }}>🔴 {eq.breakdownDays} عطل</span>}
                    {eq.maintenanceDays > 0 && <span style={{ color: 'var(--accent)' }}>🔧 {eq.maintenanceDays} صيانة</span>}
                    <span style={{ color: 'var(--accent)', marginRight: 'auto', fontWeight: 600 }}>
                      {eq.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent logs + Top supervisors */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">🕐 آخر السجلات</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setActivePage('reports')}>كل التقارير</button>
          </div>
          <div className="table-wrap">
            {recentLogs.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">📭</div><div className="empty-text">لا توجد سجلات</div></div>
            ) : (
              <table>
                <thead><tr><th>التاريخ</th><th>المعدة</th><th>الموقع</th><th>الحالة</th><th>الساعات</th><th>التكلفة</th></tr></thead>
                <tbody>
                  {recentLogs.map(log => (
                    <tr key={log.id}>
                      <td style={{ fontSize: '0.82rem' }}>{log.date}</td>
                      <td style={{ fontWeight: 500, fontSize: '0.85rem' }}>{log.equipmentName}</td>
                      <td><span className="badge badge-blue" style={{ fontSize: '0.72rem' }}>{log.siteName || '—'}</span></td>
                      <td><span className={`badge ${log.status === 'working' ? 'badge-green' : log.status === 'breakdown' ? 'badge-red' : 'badge-gold'}`} style={{ fontSize: '0.72rem' }}>
                        {log.status === 'working' ? 'شغالة' : log.status === 'breakdown' ? 'عطل' : log.status === 'maintenance' ? 'صيانة' : 'راحة'}
                      </span></td>
                      <td style={{ fontSize: '0.85rem' }}>{log.hours > 0 ? `${log.hours} س` : '—'}</td>
                      <td style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.85rem' }}>
                        {log.cost > 0 ? `${log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">👷 أنشط المشرفين</span></div>
          <div className="card-body" style={{ padding: '12px 20px' }}>
            {topWorkers.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">👷</div><div className="empty-text">لا توجد بيانات</div></div>
            ) : topWorkers.map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < topWorkers.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-dim)', border: '1px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>{w.name.charAt(0)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{w.name}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>{w.logs} سجل</div>
                </div>
                <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.9rem' }}>{w.hours} س</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
