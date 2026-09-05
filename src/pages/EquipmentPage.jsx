import { useEffect, useState } from 'react'
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy, where, writeBatch
} from 'firebase/firestore'
import { db } from '../firebase'
import { format } from 'date-fns'

const today = format(new Date(), 'yyyy-MM-dd')
const EMPTY = { name: '', siteId: '', supplierId: '', hourlyRate: '', type: '', startDate: '', notes: '', clientId: '', clientRate: '' }

export default function EquipmentPage() {
  const [items, setItems]           = useState([])
  const [sites, setSites]           = useState([])
  const [suppliers, setSuppliers]   = useState([])
  const [clients, setClients]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [modal, setModal]           = useState(false)
  const [form, setForm]             = useState(EMPTY)
  const [editId, setEditId]         = useState(null)
  const [saving, setSaving]         = useState(false)
  const [search, setSearch]         = useState('')
  const [filterSite, setFilterSite] = useState('')
  const [showRetired, setShowRetired]     = useState(false)
  const [retireModal, setRetireModal]     = useState(null)
  const [editRetireModal, setEditRetireModal] = useState(null)
  const [deleteModal, setDeleteModal]     = useState(null)
  const [deleting, setDeleting]           = useState(false)
  const [initLoading, setInitLoading]     = useState(false)
  const [initMsg, setInitMsg]             = useState('')

  // Price history modal
  const [priceModal, setPriceModal]     = useState(null)
  const [priceHistory, setPriceHistory] = useState([])
  const [priceForm, setPriceForm]       = useState({ price: '', fromDate: today })
  const [priceSaving, setPriceSaving]   = useState(false)
  const [priceErr, setPriceErr]         = useState('')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [eqSnap, siteSnap, supSnap, cliSnap] = await Promise.all([
      getDocs(collection(db, 'equipment')),
      getDocs(collection(db, 'sites')),
      getDocs(collection(db, 'suppliers')),
      getDocs(collection(db, 'clients')),
    ])
    const siteList = siteSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const supList  = supSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const siteMap  = {}, supMap = {}
    siteList.forEach(s => siteMap[s.id] = s.name)
    supList.forEach(s => supMap[s.id]   = s.name)
    setItems(eqSnap.docs.map(d => ({
      id: d.id, ...d.data(),
      siteName:     siteMap[d.data().siteId]   || '—',
      supplierName: supMap[d.data().supplierId] || '—',
    })))
    setSites(siteList)
    setSuppliers(supList)
    setClients(cliSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLoading(false)
  }

  // ── Bulk init prices ──────────────────────────────────────────
  async function initAllPrices() {
    if (!confirm('سيتم إنشاء سجل أسعار لكل المعدات التي ليس لها سجل. هل تريد المتابعة؟')) return
    setInitLoading(true); setInitMsg('')
    let count = 0
    try {
      const allLogsSnap = await getDocs(query(collection(db, 'logs'), orderBy('date', 'asc')))
      const earliestDate = {}
      allLogsSnap.docs.forEach(d => {
        const log = d.data()
        if (!earliestDate[log.equipmentId] || log.date < earliestDate[log.equipmentId])
          earliestDate[log.equipmentId] = log.date
      })
      for (const eq of items) {
        if (eq.status === 'retired') continue
        const snap = await getDocs(collection(db, 'equipment', eq.id, 'priceHistory'))
        if (snap.empty && eq.hourlyRate) {
          await addDoc(collection(db, 'equipment', eq.id, 'priceHistory'), {
            price: parseFloat(eq.hourlyRate),
            fromDate: earliestDate[eq.id] || eq.startDate || today,
            toDate: null, createdAt: serverTimestamp(),
          })
          count++
        }
      }
      setInitMsg(`✅ تم تهيئة ${count} معدة`)
    } catch (e) { setInitMsg('❌ خطأ: ' + e.message) }
    finally { setInitLoading(false) }
  }

  // ── Price history ─────────────────────────────────────────────
  async function openPriceModal(item) {
    setPriceModal(item); setPriceForm({ price: '', fromDate: today }); setPriceErr('')
    const snap = await getDocs(query(collection(db, 'equipment', item.id, 'priceHistory'), orderBy('fromDate', 'desc')))
    setPriceHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  async function addPriceEntry() {
    if (!priceForm.price || !priceForm.fromDate) return setPriceErr('يرجى إدخال السعر والتاريخ')
    setPriceSaving(true); setPriceErr('')
    try {
      const newPrice = parseFloat(priceForm.price)
      const fromDate = priceForm.fromDate
      const batch    = writeBatch(db)
      const openEntry = priceHistory.find(e => !e.toDate)
      if (openEntry) {
        if (fromDate <= openEntry.fromDate) {
          setPriceErr('تاريخ البداية يجب أن يكون بعد ' + openEntry.fromDate)
          setPriceSaving(false); return
        }
        const prevTo = new Date(fromDate)
        prevTo.setDate(prevTo.getDate() - 1)
        batch.update(doc(db, 'equipment', priceModal.id, 'priceHistory', openEntry.id), {
          toDate: format(prevTo, 'yyyy-MM-dd')
        })
      }
      const newRef = doc(collection(db, 'equipment', priceModal.id, 'priceHistory'))
      batch.set(newRef, { price: newPrice, fromDate, toDate: null, createdAt: serverTimestamp() })
      batch.update(doc(db, 'equipment', priceModal.id), { hourlyRate: newPrice, updatedAt: serverTimestamp() })
      await batch.commit()
      setPriceForm({ price: '', fromDate: today })
      const snap = await getDocs(query(collection(db, 'equipment', priceModal.id, 'priceHistory'), orderBy('fromDate', 'desc')))
      setPriceHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      loadAll()
    } catch (e) { setPriceErr('خطأ: ' + e.message) }
    finally { setPriceSaving(false) }
  }

  async function deletePriceEntry(entryId) {
    if (!confirm('حذف هذا السعر؟')) return
    await deleteDoc(doc(db, 'equipment', priceModal.id, 'priceHistory', entryId))
    const snap = await getDocs(query(collection(db, 'equipment', priceModal.id, 'priceHistory'), orderBy('fromDate', 'desc')))
    setPriceHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  // ── Equipment CRUD ────────────────────────────────────────────
  function openAdd() { setForm(EMPTY); setEditId(null); setModal(true) }
  function openEdit(item) {
    setForm({
      name: item.name, siteId: item.siteId, supplierId: item.supplierId,
      hourlyRate: item.hourlyRate, type: item.type || '',
      startDate: item.startDate || '', notes: item.notes || '',
      clientId: item.clientId || '', clientRate: item.clientRate || '',
    })
    setEditId(item.id); setModal(true)
  }

  async function save() {
    if (!form.name || !form.siteId || !form.supplierId || !form.hourlyRate) return alert('يرجى تعبئة الحقول المطلوبة')
    setSaving(true)
    const site     = sites.find(s => s.id === form.siteId)
    const supplier = suppliers.find(s => s.id === form.supplierId)
    const client   = clients.find(c => c.id === form.clientId)
    const data = {
      ...form, hourlyRate: parseFloat(form.hourlyRate),
      clientRate: parseFloat(form.clientRate) || 0,
      siteName: site?.name || '', supplierName: supplier?.name || '',
      clientName: client?.name || '',
      updatedAt: serverTimestamp(),
    }
    if (editId) {
      await updateDoc(doc(db, 'equipment', editId), data)
    } else {
      const newRef = await addDoc(collection(db, 'equipment'), { ...data, status: 'active', createdAt: serverTimestamp() })
      if (form.hourlyRate) {
        await addDoc(collection(db, 'equipment', newRef.id, 'priceHistory'), {
          price: parseFloat(form.hourlyRate),
          fromDate: form.startDate || today,
          toDate: null, createdAt: serverTimestamp(),
        })
      }
    }
    setModal(false); setSaving(false); loadAll()
  }

  // ── DELETE with cascade ───────────────────────────────────────
  async function confirmDelete(item) {
    setDeleteModal(item)
  }

  async function executeDelete() {
    if (!deleteModal) return
    setDeleting(true)
    try {
      const eqId = deleteModal.id

      // 1. Count logs to show user
      const logsSnap = await getDocs(query(collection(db, 'logs'), where('equipmentId', '==', eqId)))
      const logCount = logsSnap.size

      // 2. Delete all logs in batches (Firestore batch max 500)
      const logDocs = logsSnap.docs
      for (let i = 0; i < logDocs.length; i += 400) {
        const batch = writeBatch(db)
        logDocs.slice(i, i + 400).forEach(d => batch.delete(d.ref))
        await batch.commit()
      }

      // 3. Delete priceHistory subcollection
      const priceSnap = await getDocs(collection(db, 'equipment', eqId, 'priceHistory'))
      if (priceSnap.size > 0) {
        const batch = writeBatch(db)
        priceSnap.docs.forEach(d => batch.delete(d.ref))
        await batch.commit()
      }

      // 4. Delete equipment document
      await deleteDoc(doc(db, 'equipment', eqId))

      setDeleteModal(null)
      alert(`✅ تم حذف المعدة و ${logCount} سجل دوام`)
      loadAll()
    } catch (e) {
      alert('خطأ في الحذف: ' + e.message)
    } finally {
      setDeleting(false)
    }
  }

  // ── Retire + Edit retiredDate ─────────────────────────────────
  async function retireEquipment(item, retireDate) {
    if (!retireDate || !/^\d{4}-\d{2}-\d{2}$/.test(retireDate)) return alert('تاريخ غير صحيح')
    await updateDoc(doc(db, 'equipment', item.id), { status: 'retired', retiredDate: retireDate, updatedAt: serverTimestamp() })
    setRetireModal(null); loadAll()
  }

  async function updateRetiredDate(item, newDate) {
    if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return alert('تاريخ غير صحيح')
    await updateDoc(doc(db, 'equipment', item.id), { retiredDate: newDate, updatedAt: serverTimestamp() })
    setEditRetireModal(null); loadAll()
  }

  async function reactivate(item) {
    if (!confirm(`إعادة تفعيل ${item.name}؟ سيتم مسح تاريخ الإيقاف.`)) return
    await updateDoc(doc(db, 'equipment', item.id), { status: 'active', retiredDate: null, updatedAt: serverTimestamp() })
    loadAll()
  }

  const activeItems  = items.filter(i => i.status !== 'retired')
  const retiredItems = items.filter(i => i.status === 'retired')
  const filtered = (showRetired ? retiredItems : activeItems).filter(i => {
    const q = search.toLowerCase()
    return (!q || i.name.toLowerCase().includes(q) || i.supplierName.toLowerCase().includes(q))
        && (!filterSite || i.siteId === filterSite)
  })

  if (loading) return <div className="spinner" />

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="page-title">🏗️ المعدات</div>
          <div className="page-sub">{activeItems.length} نشطة{retiredItems.length > 0 ? ` · ${retiredItems.length} متوقفة` : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={initAllPrices} disabled={initLoading}>
            {initLoading ? 'جاري...' : '💲 تهيئة الأسعار'}
          </button>
          <button className="btn btn-primary" onClick={openAdd}>+ إضافة معدة</button>
        </div>
      </div>

      {initMsg && (
        <div className={`alert ${initMsg.startsWith('✅') ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 16 }}>
          {initMsg}
        </div>
      )}

      <div className="card">
        <div className="card-header" style={{ gap: 12, flexWrap: 'wrap' }}>
          <input className="form-control" style={{ maxWidth: 200 }} placeholder="🔍 بحث..."
            value={search} onChange={e => setSearch(e.target.value)} />
          <select className="form-control" style={{ maxWidth: 180 }} value={filterSite}
            onChange={e => setFilterSite(e.target.value)}>
            <option value="">كل المواقع</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`btn btn-sm ${!showRetired ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShowRetired(false)}>نشطة ({activeItems.length})</button>
            <button className={`btn btn-sm ${showRetired ? 'btn-primary' : 'btn-secondary'}`}  onClick={() => setShowRetired(true)}>متوقفة ({retiredItems.length})</button>
          </div>
        </div>

        <div className="table-wrap">
          {filtered.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">🏗️</div><div className="empty-text">لا توجد معدات</div></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>اسم المعدة</th><th>النوع</th><th>الموقع</th><th>المورد</th>
                  <th>تاريخ البداية</th><th>سعر/ساعة</th>
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
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: '0.82rem', color: 'var(--danger)', fontWeight: 600 }}>
                            {item.retiredDate || '—'}
                          </span>
                          <button className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                            onClick={() => setEditRetireModal(item)} title="تعديل تاريخ الإيقاف">✏️</button>
                        </div>
                      </td>
                    )}
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {!showRetired ? (
                          <>
                            <button className="btn btn-secondary btn-sm" onClick={() => openEdit(item)} title="تعديل">✏️</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => openPriceModal(item)} title="سجل الأسعار">💲</button>
                            <button className="btn btn-danger btn-sm" onClick={() => setRetireModal(item)} title="إيقاف">⏹️</button>
                          </>
                        ) : (
                          <>
                            <button className="btn btn-secondary btn-sm" onClick={() => openPriceModal(item)} title="سجل الأسعار">💲</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => reactivate(item)} title="إعادة تفعيل">▶️</button>
                            <button className="btn btn-danger btn-sm" onClick={() => confirmDelete(item)} title="حذف نهائي مع السجلات">🗑️</button>
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
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">تاريخ بداية العمل</label>
                  <input type="date" className="form-control" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
                  <div className="info-text">⚠️ لن يحتسب أي تكلفة قبل هذا التاريخ</div>
                </div>
                <div className="form-group">
                  <label className="form-label">سعر الساعة (ريال) *</label>
                  <input type="number" className="form-control" value={form.hourlyRate} onChange={e => setForm(f => ({ ...f, hourlyRate: e.target.value }))} placeholder="250" />
                  {editId && <div className="info-text">💡 لتغيير السعر بتواريخ سريان استخدم زر 💲</div>}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">ملاحظات</label>
                <input className="form-control" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '12px 0' }} />
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-3)', marginBottom: 10 }}>🏭 بيانات العميل (اختياري)</div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">العميل</label>
                  <select className="form-control" value={form.clientId} onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}>
                    <option value="">بدون عميل</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">سعر ساعة العميل (ريال)</label>
                  <input type="number" className="form-control" value={form.clientRate}
                    onChange={e => setForm(f => ({ ...f, clientRate: e.target.value }))} placeholder="0" />
                  {editId && <div className="info-text">💡 لتغيير السعر بتواريخ سريان راجع سجل أسعار العميل</div>}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>إلغاء</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'حفظ...' : 'حفظ'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !deleting && setDeleteModal(null)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <span className="modal-title">🗑️ حذف المعدة نهائياً</span>
              <button className="btn btn-icon btn-secondary" onClick={() => !deleting && setDeleteModal(null)} disabled={deleting}>✕</button>
            </div>
            <div className="modal-body">
              <div className="alert" style={{ background: 'rgba(224,80,80,0.1)', color: 'var(--danger)', border: '1px solid rgba(224,80,80,0.3)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
                ⚠️ تحذير — هذا الإجراء لا يمكن التراجع عنه
              </div>
              <div style={{ fontSize: '0.92rem', lineHeight: 1.8 }}>
                سيتم حذف:
                <ul style={{ margin: '8px 0', paddingRight: 20 }}>
                  <li>المعدة: <strong>{deleteModal.name}</strong></li>
                  <li>كل سجلات الدوام المرتبطة بها</li>
                  <li>سجل الأسعار بتاعها</li>
                </ul>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteModal(null)} disabled={deleting}>إلغاء</button>
              <button className="btn btn-danger" onClick={executeDelete} disabled={deleting}>
                {deleting ? 'جاري الحذف...' : '🗑️ تأكيد الحذف النهائي'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Price History Modal */}
      {priceModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setPriceModal(null)}>
          <div className="modal" style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <span className="modal-title">💲 سجل أسعار — {priceModal.name}</span>
              <button className="btn btn-icon btn-secondary" onClick={() => setPriceModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background: 'var(--accent-dim2)', border: '1px solid rgba(232,160,32,0.2)', borderRadius: 8, padding: 16, marginBottom: 20 }}>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: 12 }}>➕ إضافة سعر جديد</div>
                {priceErr && <div className="alert alert-error" style={{ marginBottom: 10 }}>⚠️ {priceErr}</div>}
                <div className="form-row">
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">السعر الجديد (ريال/ساعة) *</label>
                    <input type="number" className="form-control" value={priceForm.price}
                      onChange={e => setPriceForm(f => ({ ...f, price: e.target.value }))} placeholder="250" />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">تاريخ بداية السريان *</label>
                    <input type="date" className="form-control" value={priceForm.fromDate}
                      onChange={e => setPriceForm(f => ({ ...f, fromDate: e.target.value }))} />
                  </div>
                </div>
                <div className="info-text" style={{ marginTop: 8 }}>⚠️ السجلات قبل هذا التاريخ بالسعر القديم، وبعده بالسعر الجديد</div>
                <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={addPriceEntry} disabled={priceSaving}>
                  {priceSaving ? 'جاري الحفظ...' : '✓ إضافة السعر'}
                </button>
              </div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 10, color: 'var(--text-2)' }}>
                📋 سجل الأسعار ({priceHistory.length} إدخال)
              </div>
              {priceHistory.length === 0 ? (
                <div className="empty-state" style={{ padding: '20px 0' }}>
                  <div className="empty-icon" style={{ fontSize: '1.5rem' }}>💲</div>
                  <div className="empty-text">لا يوجد سجل — أضف أول سعر</div>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-3)', fontWeight: 500 }}>السعر</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-3)', fontWeight: 500 }}>من</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-3)', fontWeight: 500 }}>إلى</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceHistory.map((entry, i) => (
                      <tr key={entry.id} style={{ borderBottom: '1px solid var(--border)', background: i === 0 ? 'var(--accent-dim2)' : 'transparent' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--accent)' }}>
                          {entry.price.toLocaleString('ar-SA')} ر/س
                          {i === 0 && <span className="badge badge-gold" style={{ marginRight: 8, fontSize: '0.68rem' }}>الحالي</span>}
                        </td>
                        <td style={{ padding: '10px 12px' }}>{entry.fromDate}</td>
                        <td style={{ padding: '10px 12px', color: entry.toDate ? 'var(--text-2)' : 'var(--success)' }}>
                          {entry.toDate || 'مستمر ✓'}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <button className="btn btn-danger btn-sm btn-icon" onClick={() => deletePriceEntry(entry.id)}>🗑️</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPriceModal(null)}>إغلاق</button>
            </div>
          </div>
        </div>
      )}

      {/* Retire Modal */}
      {retireModal && (
        <RetireDateModal title="⏹️ إيقاف المعدة" item={retireModal} initialDate={today}
          confirmLabel="تأكيد الإيقاف" confirmClass="btn-danger"
          warning={`سيتم إيقاف ${retireModal.name} ولن تظهر في الإدخال بعد تاريخ الإيقاف`}
          onConfirm={(date) => retireEquipment(retireModal, date)}
          onClose={() => setRetireModal(null)} />
      )}

      {/* Edit RetiredDate Modal */}
      {editRetireModal && (
        <RetireDateModal title="✏️ تعديل تاريخ الإيقاف" item={editRetireModal} initialDate={editRetireModal.retiredDate || today}
          confirmLabel="حفظ التاريخ" confirmClass="btn-primary"
          warning={`تعديل تاريخ آخر يوم عمل للمعدة ${editRetireModal.name}`}
          onConfirm={(date) => updateRetiredDate(editRetireModal, date)}
          onClose={() => setEditRetireModal(null)} />
      )}
    </div>
  )
}

function RetireDateModal({ title, item, initialDate, confirmLabel, confirmClass, warning, onConfirm, onClose }) {
  const [date, setDate] = useState(initialDate)
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="btn btn-icon btn-secondary" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="alert" style={{ background: 'var(--danger-dim)', color: 'var(--danger)', border: '1px solid rgba(224,80,80,0.3)', marginBottom: 16 }}>
            ⚠️ {warning}
          </div>
          <div className="form-group">
            <label className="form-label">تاريخ آخر يوم عمل *</label>
            <input type="date" className="form-control" value={date}
              min={item.startDate || undefined} max={today}
              onChange={e => setDate(e.target.value)} />
            <div className="info-text">لن تظهر سجلات بعد هذا التاريخ في التقارير</div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>إلغاء</button>
          <button className={`btn ${confirmClass}`} onClick={() => onConfirm(date)} disabled={!date}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
