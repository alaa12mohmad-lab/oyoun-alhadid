import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

const EMPTY = { name: '', phone: '', contactPerson: '', notes: '' }

export default function SuppliersPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const snap = await getDocs(collection(db, 'suppliers'))
    setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLoading(false)
  }

  function openAdd() { setForm(EMPTY); setEditId(null); setModal(true) }
  function openEdit(item) {
    setForm({ name: item.name, phone: item.phone || '', contactPerson: item.contactPerson || '', notes: item.notes || '' })
    setEditId(item.id); setModal(true)
  }

  async function save() {
    if (!form.name) return alert('اسم المورد مطلوب')
    setSaving(true)
    const data = { ...form, updatedAt: serverTimestamp() }
    if (editId) {
      await updateDoc(doc(db, 'suppliers', editId), data)
    } else {
      await addDoc(collection(db, 'suppliers'), { ...data, createdAt: serverTimestamp() })
    }
    setModal(false); setSaving(false); load()
  }

  async function remove(id) {
    if (!confirm('حذف هذا المورد؟')) return
    await deleteDoc(doc(db, 'suppliers', id))
    load()
  }

  if (loading) return <div className="spinner" />

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="page-title">🏢 الموردون</div>
          <div className="page-sub">{items.length} مورد مسجل</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ إضافة مورد</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🏢</div>
              <div className="empty-text">لا يوجد موردون مضافون</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>اسم المورد</th>
                  <th>جهة الاتصال</th>
                  <th>الهاتف</th>
                  <th>ملاحظات</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                    <td style={{ color: 'var(--text-2)' }}>{item.contactPerson || '—'}</td>
                    <td style={{ direction: 'ltr', textAlign: 'right' }}>{item.phone || '—'}</td>
                    <td style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>{item.notes || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(item)}>✏️</button>
                        <button className="btn btn-danger btn-sm" onClick={() => remove(item.id)}>🗑️</button>
                      </div>
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
              <span className="modal-title">{editId ? 'تعديل المورد' : 'إضافة مورد جديد'}</span>
              <button className="btn btn-icon btn-secondary" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">اسم المورد *</label>
                  <input className="form-control" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="اسم الشركة أو المورد" />
                </div>
                <div className="form-group">
                  <label className="form-label">مسؤول التواصل</label>
                  <input className="form-control" value={form.contactPerson} onChange={e => setForm(f => ({ ...f, contactPerson: e.target.value }))} placeholder="اسم الشخص" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">رقم الهاتف</label>
                <input className="form-control" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="05xxxxxxxx" style={{ direction: 'ltr' }} />
              </div>
              <div className="form-group">
                <label className="form-label">ملاحظات</label>
                <input className="form-control" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="تفاصيل العقد أو الاتفاقية" />
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
