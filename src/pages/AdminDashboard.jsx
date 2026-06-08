import { useEffect, useState } from 'react'
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore'
import { db } from '../firebase'
import { startOfWeek, endOfWeek, format } from 'date-fns'
import { ar } from 'date-fns/locale'

export default function AdminDashboard({ setActivePage }) {
  const [stats, setStats] = useState({ equipment: 0, sites: 0, suppliers: 0, users: 0 })
  const [weekHours, setWeekHours] = useState(0)
  const [weekCost, setWeekCost] = useState(0)
  const [recentLogs, setRecentLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    try {
      const [eqSnap, siteSnap, supSnap, usrSnap] = await Promise.all([
        getDocs(collection(db, 'equipment')),
        getDocs(collection(db, 'sites')),
        getDocs(collection(db, 'suppliers')),
        getDocs(collection(db, 'users')),
      ])

      const equipment = eqSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const eqMap = {}
      equipment.forEach(e => { eqMap[e.id] = e })

      const weekStart = startOfWeek(new Date(), { weekStartsOn: 6 })
      const weekEnd = endOfWeek(new Date(), { weekStartsOn: 6 })

      const logsSnap = await getDocs(
        query(collection(db, 'logs'),
          where('date', '>=', format(weekStart, 'yyyy-MM-dd')),
          where('date', '<=', format(weekEnd, 'yyyy-MM-dd')),
          orderBy('date', 'desc')
        )
      )

      let totalHours = 0, totalCost = 0
      const logs = logsSnap.docs.map(d => {
        const log = { id: d.id, ...d.data() }
        const eq = eqMap[log.equipmentId]
        const cost = (log.hours || 0) * (eq?.hourlyRate || 0)
        totalHours += log.hours || 0
        totalCost += cost
        return { ...log, equipmentName: eq?.name || '—', cost }
      })

      setStats({
        equipment: eqSnap.size,
        sites: siteSnap.size,
        suppliers: supSnap.size,
        users: usrSnap.size,
      })
      setWeekHours(totalHours)
      setWeekCost(totalCost)
      setRecentLogs(logs.slice(0, 8))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div className="spinner" />

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">لوحة التحكم</div>
        <div className="page-sub">نظرة عامة على المعدات والتكاليف</div>
      </div>

      <div className="stats-grid">
        <div className="stat-card gold" style={{ cursor: 'pointer' }} onClick={() => setActivePage('equipment')}>
          <div className="stat-icon">🏗️</div>
          <div className="stat-value">{stats.equipment}</div>
          <div className="stat-label">معدة مسجلة</div>
        </div>
        <div className="stat-card blue" style={{ cursor: 'pointer' }} onClick={() => setActivePage('sites')}>
          <div className="stat-icon">📍</div>
          <div className="stat-value">{stats.sites}</div>
          <div className="stat-label">موقع عمل</div>
        </div>
        <div className="stat-card green">
          <div className="stat-icon">⏱️</div>
          <div className="stat-value">{weekHours.toFixed(0)}</div>
          <div className="stat-label">ساعة هذا الأسبوع</div>
        </div>
        <div className="stat-card red">
          <div className="stat-icon">💰</div>
          <div className="stat-value">{weekCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</div>
          <div className="stat-label">تكلفة الأسبوع (ريال)</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">📋 آخر سجلات الدوام (هذا الأسبوع)</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setActivePage('reports')}>
            عرض التقارير
          </button>
        </div>
        <div className="table-wrap">
          {recentLogs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <div className="empty-text">لا توجد سجلات هذا الأسبوع</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المعدة</th>
                  <th>الموقع</th>
                  <th>الساعات</th>
                  <th>التكلفة</th>
                  <th>المشرف</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.map(log => (
                  <tr key={log.id}>
                    <td>{log.date}</td>
                    <td style={{ fontWeight: 500 }}>{log.equipmentName}</td>
                    <td><span className="badge badge-blue">{log.siteName || '—'}</span></td>
                    <td>{log.hours} س</td>
                    <td style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      {log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر
                    </td>
                    <td style={{ color: 'var(--text-2)', fontSize: '0.82rem' }}>{log.supervisorName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
