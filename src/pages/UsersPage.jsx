import { useEffect, useState } from 'react'
import { collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { createUserWithEmailAndPassword, deleteUser } from 'firebase/auth'
import { auth, db } from '../firebase'

const EMPTY = { name: '', email: '', password: '', role: 'supervisor', siteId: '' }

export default function UsersPage() {
  const [users, setUsers] = useState([])
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [usrSnap, siteSnap] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'sites')),
    ])
    const siteList = siteSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const siteMap = {}
    siteList.forEach(s => siteMap[s.id] = s.name)
    setUsers(usrSnap.docs.map(d => ({
      id: d.id, ...d.data(),
      siteName: siteMap[d.data().siteId] || '—'
    })))
    setSites(siteList)
    setLoading(false)
  }

  function openAdd() { setForm(EMPTY); setErr(''); setModal(true) }

  async function save() {
    if (!form.name || !form.email || !form.password) return setErr('يرجى تعبئة جميع الحقول المطلوبة')
    if (form.password.length < 6) return setErr('كلمة المرور 6 أحرف على الأقل')
    if (form.role === 'supervisor' && !form.siteId) return setErr('يرجى اختيار موقع للمشرف')

    setSaving(true); setErr('')
    let createdUser = null

    try {
      // Step 1: Create in Firebase Auth
      const cred = await createUserWithEmailAndPassword(auth, form.email, form.password)
      createdUser = cred.user

      // Step 2: Create in Firestore
      const site = sites.find(s => s.id === form.siteId)
      await setDoc(doc(db, 'users', createdUser.uid), {
        name: form.name,
        email: form.email,
        role: form.role,
        siteId: form.siteId || null,
        siteName: site?.name || null,
        createdAt: serverTimestamp(),
      })

      // Success
      setModal(false)
      setForm(EMPTY)
      loadAll()

    } catch (e) {
      // Rollback: if Auth succeeded but Firestore failed → delete from Auth
      if (createdUser) {
        try { await deleteUser(createdUser) } catch (_) {}
      }

      if (e.code === 'auth/email-already-in-use') {
        setErr('البريد الإلكتروني مستخدم مسبقاً — تحقق من Firestore إذا كان المستخدم موجود بدون بيانات')
      } else if (e.code === 'auth/weak-password') {
        setErr('كلمة المرور ضعيفة جداً')
      } else if (e.code === 'auth/invalid-email') {
        setErr('صيغة البريد الإلكتروني غير صحيحة')
      } else {
        setErr('خطأ: ' + (e.message || 'حاول مرة أخرى'))
      }
    } finally {
      setSaving(false)
    }
  }

  async function remove(id) {
    if (!confirm('حذف هذا المستخدم من قاعدة البيانات؟')) return
    await deleteDoc(doc(db, 'users', id))
    loadAll()
  }

  const roleLabel = {
    admin:      { text: 'مدير',   cls: 'badge-gold' },
    supervisor: { text: 'مشرف',   cls: 'badge-blue' },
    viewer:     { text: 'مشاهد',  cls: 'badge-gray' },
  }

  if (loading) return <div className="spinner" />

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="page-title">👥 المستخدمون</div>
          <div className="page-sub">{users.length} مستخدم مسجل</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ إضافة مستخدم</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {users.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">👥</div><div className="empty-text">لا يوجد مستخدمون</div></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>البريد</th>
                  <th>الصلاحية</th>
                  <th>الموقع</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.name}</td>
                    <td style={{ direction: 'ltr', textAlign: 'right', color: 'var(--text-2)', fontSize: '0.85rem' }}>{u.email}</td>
                    <td><span className={`badge ${roleLabel[u.role]?.cls || 'badge-gray'}`}>{roleLabel[u.role]?.text || u.role}</span></td>
                    <td>
                      {u.role === 'supervisor'
                        ? <span className="badge badge-blue">{u.siteName}</span>
                        : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    </td>
                    <td>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(u.id)}>🗑️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">إضافة مستخدم جديد</span>
              <button className="btn btn-icon btn-secondary" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {err && <div className="alert alert-error">⚠️ {err}</div>}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">الاسم *</label>
                  <input className="form-control" value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="الاسم الكامل" />
                </div>
                <div className="form-group">
                  <label className="form-label">الصلاحية *</label>
                  <select className="form-control" value={form.role}
                    onChange={e => setForm(f => ({ ...f, role: e.target.value, siteId: '' }))}>
                    <option value="supervisor">مشرف موقع</option>
                    <option value="viewer">مشاهد</option>
                    <option value="admin">مدير النظام</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">البريد الإلكتروني *</label>
                <input type="email" className="form-control" value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="email@company.com" style={{ direction: 'ltr' }} />
              </div>
              <div className="form-group">
                <label className="form-label">كلمة المرور *</label>
                <input type="password" className="form-control" value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="6 أحرف على الأقل" />
              </div>
              {form.role === 'supervisor' && (
                <div className="form-group">
                  <label className="form-label">الموقع *</label>
                  <select className="form-control" value={form.siteId}
                    onChange={e => setForm(f => ({ ...f, siteId: e.target.value }))}>
                    <option value="">اختر الموقع</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>إلغاء</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'جاري الإنشاء...' : 'إنشاء الحساب'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
