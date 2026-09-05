import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

const EMPTY = { name: '', contactPerson: '', phone: '', email: '', notes: '' }

export default function ClientsPage() {
  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal]   = useState(false)
  const [form, setForm]     = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const snap = await getDocs(collection(db, 'clients'))
    setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLoading(false)
  }

  function openAdd() { setForm(EMPTY); setEditId(null); setModal(true) }
  function openEdit(item) {
    setForm({ name: item.name, contactPerson: item.contactPerson || '', phone: item.phone || '', email: item.email || '', notes: item.notes || '' })
    setEditId(item.id); setModal(true)
  }

  async function save() {
    if (!form.name) return alert('يرجى إدخال اسم العميل')
    setSaving(true)
    const data = { ...form, updatedAt: serverTimestamp() }
    if (editId) {
      await updateDoc(doc(db, 'clients', editId), data)
    } else {
      await addDoc(collection(db, 'clients'), { ...data, createdAt: serverTimestamp() })
    }
    setModal(false); setSaving(false); load()
  }

  async function remove(id) {
    if (!confirm('حذف هذا العميل؟')) return
    await deleteDoc(doc(db, 'clients', id)); load()
  }

  const filtered = items.filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()))

  if (loading) return <div className="spinner" />

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <div className="page-title">🏭 العملاء</div>
          <div className="page-sub">{items.length} عميل</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ إضافة عميل</button>
      </div>

      <div className="card">
        <div className="card-header">
          <input className="form-control" style={{ maxWidth: 220 }} placeholder="🔍 بحث..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="table-wrap">
          {filtered.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">🏭</div><div className="empty-text">لا يوجد عملاء</div></div>
          ) : (
            <table>
              <thead><tr><th>اسم العميل</th><th>جهة الاتصال</th><th>الهاتف</th><th>البريد</th><th>ملاحظات</th><th>إجراءات</th></tr></thead>
              <tbody>
                {filtered.map(item => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                    <td style={{ color: 'var(--text-2)' }}>{item.contactPerson || '—'}</td>
                    <td style={{ color: 'var(--text-2)' }}>{item.phone || '—'}</td>
                    <td style={{ color: 'var(--text-2)' }}>{item.email || '—'}</td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-3)' }}>{item.notes || '—'}</td>
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
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <span className="modal-title">{editId ? 'تعديل العميل' : 'إضافة عميل جديد'}</span>
              <button className="btn btn-icon btn-secondary" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">اسم العميل *</label>
                <input className="form-control" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="مثال: شركة الإنشاءات" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">جهة الاتصال</label>
                  <input className="form-control" value={form.contactPerson} onChange={e => setForm(f => ({ ...f, contactPerson: e.target.value }))} placeholder="اسم المسؤول" />
                </div>
                <div className="form-group">
                  <label className="form-label">الهاتف</label>
                  <input className="form-control" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="05xxxxxxxx" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">البريد الإلكتروني</label>
                <input className="form-control" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="example@company.com" />
              </div>
              <div className="form-group">
                <label className="form-label">ملاحظات</label>
                <input className="form-control" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
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
