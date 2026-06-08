import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

const EMPTY = { name: '', siteId: '', supplierId: '', hourlyRate: '', type: '', notes: '' }

export default function EquipmentPage() {
  const [items, setItems] = useState([])
  const [sites, setSites] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filterSite, setFilterSite] = useState('')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [eqSnap, siteSnap, supSnap] = await Promise.all([
      getDocs(collection(db, 'equipment')),
      getDocs(collection(db, 'sites')),
      getDocs(collection(db, 'suppliers')),
    ])
    const siteList = siteSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const supList = supSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const siteMap = {}, supMap = {}
    siteList.forEach(s => siteMap[s.id] = s.name)
    supList.forEach(s => supMap[s.id] = s.name)
    const eqList = eqSnap.docs.map(d => ({
      id: d.id, ...d.data(),
      siteName: siteMap[d.data().siteId] || '—',
      supplierName: supMap[d.data().supplierId] || '—',
    }))
    setItems(eqList)
    setSites(siteList)
    setSuppliers(supList)
    setLoading(false)
  }

  function openAdd() { setForm(EMPTY); setEditId(null); setModal(true) }
  function openEdit(item) {
    setForm({ name: item.name, siteId: item.siteId, supplierId: item.supplierId, hourlyRate: item.hourlyRate, type: item.type || '', notes: item.notes || '' })
    setEditId(item.id); setModal(true)
  }

  async function save() {
    if (!form.name || !form.siteId || !form.supplierId || !form.hourlyRate) return alert('يرجى تعبئة الحقول المطلوبة')
    setSaving(true)
    const site = sites.find(s => s.id === form.siteId)
    const supplier = suppliers.find(s => s.id === form.supplierId)
    const data = {
      ...form,
      hourlyRate: parseFloat(form.hourlyRate),
      siteName: site?.name || '',
      supplierName: supplier?.name || '',
      updatedAt: serverTimestamp(),
    }
    if (editId) {
      await updateDoc(doc(db, 'equipment', editId), data)
    } else {
      await addDoc(collection(db, 'equipment'), { ...data, createdAt: serverTimestamp() })
    }
    setModal(false); setSaving(false); loadAll()
  }

  async function remove(id) {
    if (!confirm('حذف هذه المعدة؟')) return
    await deleteDoc(doc(db, 'equipment', id))
    loadAll()
  }

  const filtered = items.filter(i => {
    const q = search.toLowerCase()
    const matchQ = !q || i.name.toLowerCase().includes(q) || i.supplierName.toLowerCase().includes(q)
    const matchSite = !filterSite || i.siteId === filterSite
    return matchQ && matchSite
  })

  if (loading) return <div className="spinner" />

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="page-title">🏗️ المعدات</div>
          <div className="page-sub">{items.length} معدة مسجلة</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ إضافة معدة</button>
      </div>

      <div className="card">
        <div className="card-header" style={{ gap: 12, flexWrap: 'wrap' }}>
          <input className="form-control" style={{ maxWidth: 220, marginBottom: 0 }} placeholder="🔍 بحث..." value={search} onChange={e => setSearch(e.target.value)} />
          <select className="form-control" style={{ maxWidth: 180, marginBottom: 0 }} value={filterSite} onChange={e => setFilterSite(e.target.value)}>
            <option value="">كل المواقع</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          {filtered.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">🏗️</div><div className="empty-text">لا توجد معدات</div></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>اسم المعدة</th>
                  <th>النوع</th>
                  <th>الموقع</th>
                  <th>المورد</th>
                  <th>سعر/ساعة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                    <td><span className="badge badge-gray">{item.type || '—'}</span></td>
                    <td><span className="badge badge-blue">{item.siteName}</span></td>
                    <td style={{ color: 'var(--text-2)' }}>{item.supplierName}</td>
                    <td style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      {Number(item.hourlyRate).toLocaleString('ar-SA')} ر/س
                    </td>
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
              <span className="modal-title">{editId ? 'تعديل المعدة' : 'إضافة معدة جديدة'}</span>
              <button className="btn btn-icon btn-secondary" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">اسم المعدة *</label>
                  <input className="form-control" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="مثال: حفارة كوماتسو" />
                </div>
                <div className="form-group">
                  <label className="form-label">النوع</label>
                  <input className="form-control" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} placeholder="حفارة / رافعة / ..." />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">الموقع *</label>
                  <select className="form-control" value={form.siteId} onChange={e => setForm(f => ({ ...f, siteId: e.target.value }))}>
                    <option value="">اختر الموقع</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">المورد *</label>
                  <select className="form-control" value={form.supplierId} onChange={e => setForm(f => ({ ...f, supplierId: e.target.value }))}>
                    <option value="">اختر المورد</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">سعر الساعة (ريال) *</label>
                <input type="number" className="form-control" value={form.hourlyRate} onChange={e => setForm(f => ({ ...f, hourlyRate: e.target.value }))} placeholder="250" />
              </div>
              <div className="form-group">
                <label className="form-label">ملاحظات</label>
                <input className="form-control" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="أي ملاحظات إضافية..." />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>إلغاء</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
