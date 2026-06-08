import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, query, where, orderBy, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { format } from 'date-fns'

export default function LogPage() {
  const { userData } = useAuth()
  const [equipment, setEquipment] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ equipmentId: '', hours: '', date: format(new Date(), 'yyyy-MM-dd'), notes: '' })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const siteId = userData?.siteId
    const [eqSnap, logsSnap] = await Promise.all([
      getDocs(query(collection(db, 'equipment'), where('siteId', '==', siteId))),
      getDocs(query(collection(db, 'logs'), where('siteId', '==', siteId), orderBy('date', 'desc'))),
    ])
    const eqList = eqSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const eqMap = {}
    eqList.forEach(e => eqMap[e.id] = e)
    setEquipment(eqList)
    setLogs(logsSnap.docs.map(d => {
      const log = { id: d.id, ...d.data() }
      const eq = eqMap[log.equipmentId]
      return { ...log, equipmentName: eq?.name || '—', cost: (log.hours || 0) * (eq?.hourlyRate || 0) }
    }))
    setLoading(false)
  }

  async function submit() {
    if (!form.equipmentId || !form.hours || !form.date) return alert('يرجى تعبئة جميع الحقول')
    const hours = parseFloat(form.hours)
    if (isNaN(hours) || hours <= 0 || hours > 24) return alert('عدد الساعات يجب أن يكون بين 1 و 24')
    setSaving(true)
    const eq = equipment.find(e => e.id === form.equipmentId)
    await addDoc(collection(db, 'logs'), {
      equipmentId: form.equipmentId,
      equipmentName: eq?.name || '',
      siteId: userData.siteId,
      siteName: userData.siteName || '',
      supplierId: eq?.supplierId || '',
      supplierName: eq?.supplierName || '',
      hourlyRate: eq?.hourlyRate || 0,
      hours,
      date: form.date,
      notes: form.notes,
      supervisorId: userData.uid,
      supervisorName: userData.name || userData.email,
      createdAt: serverTimestamp(),
    })
    setForm(f => ({ ...f, equipmentId: '', hours: '', notes: '' }))
    setSaving(false)
    setSuccess(true)
    setTimeout(() => setSuccess(false), 3000)
    loadData()
  }

  async function removeLog(id) {
    if (!confirm('حذف هذا السجل؟')) return
    await deleteDoc(doc(db, 'logs', id))
    loadData()
  }

  if (loading) return <div className="spinner" />

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">⏱️ تسجيل الدوام</div>
        <div className="page-sub">موقع: {userData?.siteName}</div>
      </div>

      <div className="log-form-card">
        <div style={{ fontWeight: 600, marginBottom: 16, fontSize: '0.9rem' }}>📝 تسجيل ساعات جديدة</div>
        {success && <div className="alert alert-success">✅ تم تسجيل الدوام بنجاح</div>}
        <div className="form-row-3">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">المعدة *</label>
            <select className="form-control" value={form.equipmentId} onChange={e => setForm(f => ({ ...f, equipmentId: e.target.value }))}>
              <option value="">اختر المعدة</option>
              {equipment.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">التاريخ *</label>
            <input type="date" className="form-control" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">عدد الساعات *</label>
            <input type="number" className="form-control" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} placeholder="0" min="0.5" max="24" step="0.5" />
          </div>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">ملاحظات (اختياري)</label>
            <input className="form-control" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="أي ملاحظة على دوام اليوم..." />
          </div>
          <button className="btn btn-primary" onClick={submit} disabled={saving} style={{ padding: '9px 24px' }}>
            {saving ? 'جاري الحفظ...' : '✓ تسجيل'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">📋 سجل الدوام — {userData?.siteName}</span>
          <span className="badge badge-gray">{logs.length} سجل</span>
        </div>
        <div className="table-wrap">
          {logs.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">📋</div><div className="empty-text">لا توجد سجلات بعد</div></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المعدة</th>
                  <th>الساعات</th>
                  <th>التكلفة</th>
                  <th>ملاحظات</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id}>
                    <td>{log.date}</td>
                    <td style={{ fontWeight: 500 }}>{log.equipmentName}</td>
                    <td>{log.hours} س</td>
                    <td style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      {log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر
                    </td>
                    <td style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>{log.notes || '—'}</td>
                    <td>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => removeLog(log.id)}>🗑️</button>
                    </td>
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
