import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { format } from 'date-fns'

const today = format(new Date(), 'yyyy-MM-dd')
const EMPTY = { name: '', siteId: '', supplierId: '', hourlyRate: '', type: '', startDate: today, notes: '' }

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
  const [showRetired, setShowRetired] = useState(false)
  const [retireModal, setRetireModal] = useState(null) // equipment item to retire

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
    setItems(eqSnap.docs.map(d => ({
      id: d.id, ...d.data(),
      siteName: siteMap[d.data().siteId] || '—',
      supplierName: supMap[d.data().supplierId] || '—',
    })))
    setSites(siteList)
    setSuppliers(supList)
    setLoading(false)
  }

  function openAdd() { setForm(EMPTY); setEditId(null); setModal(true) }
  function openEdit(item) {
    setForm({
      name: item.name,
      siteId: item.siteId,
      supplierId: item.supplierId,
      hourlyRate: item.hourlyRate,
      type: item.type || '',
      startDate: item.startDate || today,
      notes: item.notes || '',
    })
    setEditId(item.id); setModal(true)
  }

  async function save() {
    if (!form.name || !form.siteId || !form.supplierId || !form.hourlyRate || !form.startDate) {
      return alert('يرجى تعبئة جميع الحقول المطلوبة')
    }
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
      await addDoc(collection(db, 'equipment'), {
        ...data,
        status: 'active',
        createdAt: serverTimestamp(),
      })
    }
    setModal(false); setSaving(false); loadAll()
  }

  async function retireEquipment(item, retireDate) {
    await updateDoc(doc(db, 'equipment', item.id), {
      status: 'retired',
      retiredDate: retireDate,
      updatedAt: serverTimestamp(),
    })
    setRetireModal(null)
    loadAll()
  }

  async function reactivate(item) {
    if (!confirm('إعادة تفعيل هذه المعدة؟')) return
    await updateDoc(doc(db, 'equipment', item.id), {
      status: 'active',
      retiredDate: null,
      updatedAt: serverTimestamp(),
    })
    loadAll()
  }

  async function remove(id) {
    if (!confirm('حذف هذه المعدة نهائياً؟')) return
    await deleteDoc(doc(db, 'equipment', id))
    loadAll()
  }

  const activeItems = items.filter(i => i.status !== 'retired')
  const retiredItems = items.filter(i => i.status === 'retired')

  const filtered = (showRetired ? retiredItems : activeItems).filter(i => {
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
          <div className="page-sub">
            {activeItems.length} معدة نشطة
            {retiredItems.length > 0 && ` · ${retiredItems.length} متوقفة`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ إضافة معدة</button>
      </div>

      <div className="card">
        <div className="card-header" style={{ gap: 12, flexWrap: 'wrap' }}>
          <input className="form-control" style={{ maxWidth: 200 }}
            placeholder="🔍 بحث..." value={search}
            onChange={e => setSearch(e.target.value)} />
          <select className="form-control" style={{ maxWidth: 180 }} value={filterSite}
            onChange={e => setFilterSite(e.target.value)}>
            <option value="">كل المواقع</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={`btn btn-sm ${!showRetired ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setShowRetired(false)}>
              نشطة ({activeItems.length})
            </button>
            <button
              className={`btn btn-sm ${showRetired ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setShowRetired(true)}>
              متوقفة ({retiredItems.length})
            </button>
          </div>
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
                  <th>تاريخ البداية</th>
                  <th>سعر/ساعة</th>
                  {showRetired && <th>تاريخ الإيقاف</th>}
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
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>{item.startDate || '—'}</td>
                    <td style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      {Number(item.hourlyRate).toLocaleString('ar-SA')} ر/س
                    </td>
                    {showRetired && (
                      <td style={{ fontSize: '0.82rem', color: 'var(--danger)' }}>{item.retiredDate || '—'}</td>
                    )}
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {!showRetired ? (
                          <>
                            <button className="btn btn-secondary btn-sm" onClick={() => openEdit(item)}>✏️</button>
                            <button className="btn btn-danger btn-sm"
                              onClick={() => setRetireModal(item)}
                              title="إيقاف المعدة">⏹️</button>
                          </>
                        ) : (
                          <>
                            <button className="btn btn-secondary btn-sm" onClick={() => reactivate(item)}
                              title="إعادة تفعيل">▶️</button>
                            <button className="btn btn-danger btn-sm" onClick={() => remove(item.id)}>🗑️</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add/Edit Modal */}
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
                  <input className="form-control" value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="مثال: حفارة كوماتسو" />
                </div>
                <div className="form-group">
                  <label className="form-label">النوع</label>
                  <input className="form-control" value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    placeholder="حفارة / رافعة / ..." />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">الموقع *</label>
                  <select className="form-control" value={form.siteId}
                    onChange={e => setForm(f => ({ ...f, siteId: e.target.value }))}>
                    <option value="">اختر الموقع</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">المورد *</label>
                  <select className="form-control" value={form.supplierId}
                    onChange={e => setForm(f => ({ ...f, supplierId: e.target.value }))}>
                    <option value="">اختر المورد</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">تاريخ بداية العمل *</label>
                  <input type="date" className="form-control" value={form.startDate}
                    onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
                  <div className="info-text">⚠️ لن يتم احتساب أي تكلفة قبل هذا التاريخ</div>
                </div>
                <div className="form-group">
                  <label className="form-label">سعر الساعة (ريال) *</label>
                  <input type="number" className="form-control" value={form.hourlyRate}
                    onChange={e => setForm(f => ({ ...f, hourlyRate: e.target.value }))}
                    placeholder="250" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">ملاحظات</label>
                <input className="form-control" value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="أي ملاحظات إضافية..." />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>إلغاء</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'جاري الحفظ...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Retire Modal */}
      {retireModal && (
        <RetireModal
          item={retireModal}
          onConfirm={(date) => retireEquipment(retireModal, date)}
          onClose={() => setRetireModal(null)}
        />
      )}
    </div>
  )
}

function RetireModal({ item, onConfirm, onClose }) {
  const [retireDate, setRetireDate] = useState(format(new Date(), 'yyyy-MM-dd'))

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <span className="modal-title">⏹️ إيقاف المعدة</span>
          <button className="btn btn-icon btn-secondary" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="alert" style={{ background: 'var(--danger-dim)', color: 'var(--danger)', border: '1px solid rgba(224,80,80,0.3)', marginBottom: 16 }}>
            ⚠️ سيتم إيقاف <strong>{item.name}</strong> ولن تظهر في الإدخال بعد تاريخ الإيقاف
          </div>
          <div className="form-group">
            <label className="form-label">تاريخ آخر يوم عمل *</label>
            <input type="date" className="form-control" value={retireDate}
              onChange={e => setRetireDate(e.target.value)}
              min={item.startDate} />
            <div className="info-text">لن تظهر هذه المعدة في أي إدخال بعد هذا التاريخ</div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>إلغاء</button>
          <button className="btn btn-danger" onClick={() => onConfirm(retireDate)}>
            تأكيد الإيقاف
          </button>
        </div>
      </div>
    </div>
  )
}
