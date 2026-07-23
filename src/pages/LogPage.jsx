import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, query, where, orderBy, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { format } from 'date-fns'

const STATUS_OPTIONS = [
  { value: 'working', label: 'شغالة', color: 'badge-green' },
  { value: 'breakdown', label: 'عطل', color: 'badge-red' },
  { value: 'maintenance', label: 'صيانة', color: 'badge-gold' },
  { value: 'idle', label: 'متوقفة / راحة', color: 'badge-gray' },
]

export default function LogPage() {
  const { userData } = useAuth()
  const isAdmin = userData?.role === 'admin'

  const [equipment, setEquipment] = useState([])
  const [sites, setSites] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterSite, setFilterSite] = useState(isAdmin ? '' : userData?.siteId)
  const [form, setForm] = useState({
    equipmentId: '',
    hours: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    status: 'working',
    stopReason: '',
    notes: '',
    siteId: isAdmin ? '' : userData?.siteId,
  })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => { loadData() }, [filterSite])

  async function loadData() {
    setLoading(true)
    try {
      const [siteSnap, eqSnap, logsSnap] = await Promise.all([
        getDocs(collection(db, 'sites')),
        isAdmin
          ? getDocs(collection(db, 'equipment'))
          : getDocs(query(collection(db, 'equipment'), where('siteId', '==', userData?.siteId))),
        isAdmin && filterSite
          ? getDocs(query(collection(db, 'logs'), where('siteId', '==', filterSite), orderBy('date', 'desc')))
          : isAdmin
            ? getDocs(query(collection(db, 'logs'), orderBy('date', 'desc')))
            : getDocs(query(collection(db, 'logs'), where('siteId', '==', userData?.siteId), orderBy('date', 'desc'))),
      ])

      const siteList = siteSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const eqList = eqSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const eqMap = {}
      eqList.forEach(e => eqMap[e.id] = e)

      setSites(siteList)
      setEquipment(eqList)
      setLogs(logsSnap.docs.map(d => {
        const log = { id: d.id, ...d.data() }
        const eq = eqMap[log.equipmentId]
        return { ...log, cost: (log.hours || 0) * (eq?.hourlyRate || log.hourlyRate || 0) }
      }))
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  // Filter equipment by selected site (admin)
  const filteredEquipment = isAdmin && form.siteId
    ? equipment.filter(e => e.siteId === form.siteId)
    : equipment

  async function submit() {
    if (!form.equipmentId || !form.date) return alert('يرجى اختيار المعدة والتاريخ')
    if (form.status === 'working' && (!form.hours || parseFloat(form.hours) <= 0)) return alert('يرجى إدخال عدد الساعات')
    if (form.status !== 'working' && !form.stopReason) return alert('يرجى إدخال سبب التوقف')

    setSaving(true)
    const eq = equipment.find(e => e.id === form.equipmentId)
    const siteId = isAdmin ? (form.siteId || eq?.siteId) : userData?.siteId
    const site = sites.find(s => s.id === siteId)
    const hours = form.status === 'working' ? parseFloat(form.hours) : 0

    await addDoc(collection(db, 'logs'), {
      equipmentId: form.equipmentId,
      equipmentName: eq?.name || '',
      siteId,
      siteName: site?.name || eq?.siteName || '',
      supplierId: eq?.supplierId || '',
      supplierName: eq?.supplierName || '',
      hourlyRate: eq?.hourlyRate || 0,
      hours,
      status: form.status,
      stopReason: form.status !== 'working' ? form.stopReason : '',
      date: form.date,
      notes: form.notes,
      supervisorId: userData.uid,
      supervisorName: userData.name || userData.email,
      createdAt: serverTimestamp(),
    })

    setForm(f => ({ ...f, equipmentId: '', hours: '', notes: '', stopReason: '', status: 'working' }))
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

  const statusInfo = (val) => STATUS_OPTIONS.find(s => s.value === val) || STATUS_OPTIONS[0]

  if (loading) return <div className="spinner" />

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">⏱️ تسجيل الدوام</div>
        <div className="page-sub">{isAdmin ? 'كل المواقع' : `موقع: ${userData?.siteName}`}</div>
      </div>

      {/* Form */}
      <div className="log-form-card">
        <div style={{ fontWeight: 600, marginBottom: 16, fontSize: '0.9rem' }}>📝 تسجيل يومي جديد</div>
        {success && <div className="alert alert-success">✅ تم التسجيل بنجاح</div>}

        <div className="form-row-3">
          {/* Admin: site selector */}
          {isAdmin && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">الموقع</label>
              <select className="form-control" value={form.siteId}
                onChange={e => setForm(f => ({ ...f, siteId: e.target.value, equipmentId: '' }))}>
                <option value="">كل المواقع</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">المعدة *</label>
            <select className="form-control" value={form.equipmentId}
              onChange={e => setForm(f => ({ ...f, equipmentId: e.target.value }))}>
              <option value="">اختر المعدة</option>
              {filteredEquipment.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">التاريخ *</label>
            <input type="date" className="form-control" value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
        </div>

        {/* Status */}
        <div style={{ marginTop: 14, marginBottom: 4 }}>
          <label className="form-label">حالة المعدة *</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {STATUS_OPTIONS.map(s => (
              <button key={s.value} type="button"
                onClick={() => setForm(f => ({ ...f, status: s.value, hours: s.value !== 'working' ? '' : f.hours }))}
                style={{
                  padding: '6px 16px', borderRadius: 20, cursor: 'pointer', fontFamily: 'var(--font)',
                  fontSize: '0.85rem', fontWeight: 500, border: '1px solid',
                  background: form.status === s.value ? 'var(--accent)' : 'var(--steel-3)',
                  color: form.status === s.value ? '#1a1200' : 'var(--text-2)',
                  borderColor: form.status === s.value ? 'var(--accent)' : 'var(--border)',
                  transition: 'all 0.15s',
                }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-row" style={{ marginTop: 12 }}>
          {form.status === 'working' ? (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">عدد ساعات العمل *</label>
              <input type="number" className="form-control" value={form.hours}
                onChange={e => setForm(f => ({ ...f, hours: e.target.value }))}
                placeholder="0" min="0.5" max="24" step="0.5" />
            </div>
          ) : (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">سبب التوقف *</label>
              <input className="form-control" value={form.stopReason}
                onChange={e => setForm(f => ({ ...f, stopReason: e.target.value }))}
                placeholder={form.status === 'breakdown' ? 'وصف العطل...' : 'نوع الصيانة...'} />
            </div>
          )}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">ملاحظات (اختياري)</label>
            <input className="form-control" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="أي ملاحظة إضافية..." />
          </div>
        </div>

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={submit} disabled={saving} style={{ padding: '9px 28px' }}>
            {saving ? 'جاري الحفظ...' : '✓ تسجيل'}
          </button>
        </div>
      </div>

      {/* Filter (admin) */}
      {isAdmin && (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <label className="form-label" style={{ marginBottom: 0 }}>فلتر السجلات:</label>
          <select className="form-control" style={{ maxWidth: 200 }} value={filterSite}
            onChange={e => setFilterSite(e.target.value)}>
            <option value="">كل المواقع</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      {/* Logs table */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">📋 سجل الدوام</span>
          <span className="badge badge-gray">{logs.length} سجل</span>
        </div>
        <div className="table-wrap">
          {logs.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">📋</div><div className="empty-text">لا توجد سجلات</div></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المعدة</th>
                  {isAdmin && <th>الموقع</th>}
                  <th>الحالة</th>
                  <th>الساعات</th>
                  <th>التكلفة</th>
                  <th>ملاحظات</th>
                  <th>المسجّل</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => {
                  const st = statusInfo(log.status)
                  return (
                    <tr key={log.id}>
                      <td>{log.date}</td>
                      <td style={{ fontWeight: 500 }}>{log.equipmentName}</td>
                      {isAdmin && <td><span className="badge badge-blue">{log.siteName || '—'}</span></td>}
                      <td>
                        <span className={`badge ${st.color}`}>{st.label}</span>
                        {log.stopReason && <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 2 }}>{log.stopReason}</div>}
                      </td>
                      <td>{log.hours > 0 ? `${log.hours} س` : '—'}</td>
                      <td style={{ color: log.cost > 0 ? 'var(--accent)' : 'var(--text-3)', fontWeight: 600 }}>
                        {log.cost > 0 ? `${log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر` : '—'}
                      </td>
                      <td style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>{log.notes || '—'}</td>
                      <td style={{ color: 'var(--text-2)', fontSize: '0.78rem' }}>{log.supervisorName || '—'}</td>
                      <td>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => removeLog(log.id)}>🗑️</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
