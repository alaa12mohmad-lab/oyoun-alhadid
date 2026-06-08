import { useEffect, useState } from 'react'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { startOfWeek, endOfWeek, format } from 'date-fns'

export default function SupervisorDashboard({ setActivePage }) {
  const { userData } = useAuth()
  const [equipment, setEquipment] = useState([])
  const [weekLogs, setWeekLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const siteId = userData?.siteId
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 6 })
    const weekEnd = endOfWeek(new Date(), { weekStartsOn: 6 })

    const [eqSnap, logsSnap] = await Promise.all([
      getDocs(query(collection(db, 'equipment'), where('siteId', '==', siteId))),
      getDocs(query(collection(db, 'logs'),
        where('siteId', '==', siteId),
        where('date', '>=', format(weekStart, 'yyyy-MM-dd')),
        where('date', '<=', format(weekEnd, 'yyyy-MM-dd')),
        orderBy('date', 'desc')
      )),
    ])

    const eqList = eqSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const eqMap = {}
    eqList.forEach(e => eqMap[e.id] = e)

    const logs = logsSnap.docs.map(d => {
      const log = { id: d.id, ...d.data() }
      const eq = eqMap[log.equipmentId]
      return { ...log, cost: (log.hours || 0) * (eq?.hourlyRate || 0) }
    })

    setEquipment(eqList)
    setWeekLogs(logs)
    setLoading(false)
  }

  const totalHours = weekLogs.reduce((s, l) => s + (l.hours || 0), 0)
  const totalCost = weekLogs.reduce((s, l) => s + l.cost, 0)

  if (loading) return <div className="spinner" />

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">📊 موقع: {userData?.siteName}</div>
        <div className="page-sub">هذا الأسبوع</div>
      </div>

      <div className="stats-grid">
        <div className="stat-card gold">
          <div className="stat-icon">🏗️</div>
          <div className="stat-value">{equipment.length}</div>
          <div className="stat-label">معدة في موقعك</div>
        </div>
        <div className="stat-card green">
          <div className="stat-icon">⏱️</div>
          <div className="stat-value">{totalHours.toFixed(1)}</div>
          <div className="stat-label">ساعة هذا الأسبوع</div>
        </div>
        <div className="stat-card red">
          <div className="stat-icon">💰</div>
          <div className="stat-value">{totalCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</div>
          <div className="stat-label">تكلفة الأسبوع (ريال)</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon">📋</div>
          <div className="stat-value">{weekLogs.length}</div>
          <div className="stat-label">سجل دوام</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">🏗️ معدات موقعك</span>
            <button className="btn btn-primary btn-sm" onClick={() => setActivePage('log')}>+ تسجيل دوام</button>
          </div>
          <div className="table-wrap">
            {equipment.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">🏗️</div><div className="empty-text">لا توجد معدات مسجلة</div></div>
            ) : (
              <table>
                <thead><tr><th>المعدة</th><th>سعر/ساعة</th><th>المورد</th></tr></thead>
                <tbody>
                  {equipment.map(eq => (
                    <tr key={eq.id}>
                      <td style={{ fontWeight: 500 }}>{eq.name}</td>
                      <td style={{ color: 'var(--accent)' }}>{Number(eq.hourlyRate).toLocaleString('ar-SA')} ر</td>
                      <td style={{ color: 'var(--text-2)', fontSize: '0.82rem' }}>{eq.supplierName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">📋 آخر سجلات هذا الأسبوع</span>
          </div>
          <div className="table-wrap">
            {weekLogs.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">📭</div><div className="empty-text">لا توجد سجلات هذا الأسبوع</div></div>
            ) : (
              <table>
                <thead><tr><th>التاريخ</th><th>المعدة</th><th>الساعات</th><th>التكلفة</th></tr></thead>
                <tbody>
                  {weekLogs.slice(0, 6).map(log => (
                    <tr key={log.id}>
                      <td style={{ fontSize: '0.82rem' }}>{log.date}</td>
                      <td style={{ fontWeight: 500 }}>{log.equipmentName}</td>
                      <td>{log.hours} س</td>
                      <td style={{ color: 'var(--accent)' }}>{log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
