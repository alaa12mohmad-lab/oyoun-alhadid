import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

const EMPTY = { name: '', location: '', manager: '', notes: '' }

export default function SitesPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const snap = await getDocs(collection(db, 'sites'))
    setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLoading(false)
  }

  function openAdd() { setForm(EMPTY); setEditId(null); setModal(true) }
  function openEdit(item) {
    setForm({ name: item.name, location: item.location || '', manager: item.manager || '', notes: item.notes || '' })
    setEditId(item.id); setModal(true)
  }

  async function save() {
    if (!form.name) return alert('اسم الموقع مطلوب')
    setSaving(true)
    const data = { ...form, updatedAt: serverTimestamp() }
    if (editId) {
      await updateDoc(doc(db, 'sites', editId), data)
    } else {
      await addDoc(collection(db, 'sites'), { ...data, createdAt: serverTimestamp() })
    }
    setModal(false); setSaving(false); load()
  }

  async function remove(id) {
    if (!confirm('حذف هذا الموقع؟')) return
    await deleteDoc(doc(db, 'sites', id))
    load()
  }

  if (loading) return <div className="spinner" />

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="page-title">📍 المواقع</div>
          <div className="page-sub">{items.length} موقع مسجل</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ إضافة موقع</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {items.length === 0 && (
          <div className="empty-state" style={{ gridColumn: '1/-1' }}>
            <div className="empty-icon">📍</div>
            <div className="empty-text">لا توجد مواقع مضافة</div>
          </div>
        )}
        {items.map(item => (
          <div key={item.id} className="card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div style={{ fontSize: '1.5rem' }}>📍</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => openEdit(item)}>✏️</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(item.id)}>🗑️</button>
              </div>
            </div>
            <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 6 }}>{item.name}</div>
            {item.location && <div style={{ fontSize: '0.82rem', color: 'var(--text-2)', marginBottom: 4 }}>📌 {item.location}</div>}
            {item.manager && <div style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>👤 {item.manager}</div>}
            {item.notes && <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>{item.notes}</div>}
          </div>
        ))}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">{editId ? 'تعديل الموقع' : 'إضافة موقع جديد'}</span>
              <button className="btn btn-icon btn-secondary" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">اسم الموقع *</label>
                <input className="form-control" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="مثال: موقع الرياض" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">الموقع الجغرافي</label>
                  <input className="form-control" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="المنطقة / المدينة" />
                </div>
                <div className="form-group">
                  <label className="form-label">مسؤول الموقع</label>
                  <input className="form-control" value={form.manager} onChange={e => setForm(f => ({ ...f, manager: e.target.value }))} placeholder="اسم المسؤول" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">ملاحظات</label>
                <input className="form-control" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="وصف المشروع أو تفاصيل إضافية" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>إلغاء</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'حفظ...' : 'حفظ'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
