import { useEffect, useState } from 'react'
import { collection, getDocs, orderBy, query, doc, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { format } from 'date-fns'
import { printInvoiceInWindow } from '../utils/printInvoice'



export default function InvoiceArchivePage() {
  const [invoices, setInvoices]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const snap = await getDocs(query(collection(db, 'invoices'), orderBy('createdAt', 'desc')))
    setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLoading(false)
  }

  async function remove(id) {
    if (!confirm('حذف هذه الفاتورة من الأرشيف نهائياً؟')) return
    await deleteDoc(doc(db, 'invoices', id))
    load()
  }

  function printInv(inv, mode) {
    printInvoiceInWindow(inv, mode)
  }

  const filtered = invoices.filter(inv => {
    const q = search.toLowerCase()
    return !q || inv.invoiceNo?.toLowerCase().includes(q) || inv.supplierName?.toLowerCase().includes(q)
  })

  if (loading) return <div className="spinner" />

  return (
    <>
      <div className="page">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div className="page-title">🗄️ أرشيف الفواتير</div>
            <div className="page-sub">{invoices.length} فاتورة محفوظة</div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <input className="form-control" style={{ maxWidth: 280 }}
              placeholder="🔍 بحث برقم الفاتورة أو المورد..."
              value={search} onChange={e => setSearch(e.target.value)} />
            <span className="badge badge-gray">{filtered.length}</span>
          </div>
          <div className="table-wrap">
            {filtered.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">🗄️</div><div className="empty-text">لا توجد فواتير مؤرشفة</div></div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>رقم الفاتورة</th><th>المورد</th><th>الفترة</th>
                    <th>الساعات</th><th>المبلغ</th><th>تاريخ الاعتماد</th><th>معتمد بواسطة</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(inv => {
                    const approvedAt = inv.approvedAt?.seconds ? new Date(inv.approvedAt.seconds * 1000) : inv.approvedAt ? new Date(inv.approvedAt) : null
                    return (
                      <tr key={inv.id}>
                        <td style={{ fontWeight: 700, color: 'var(--accent)', fontSize: '0.85rem' }}>{inv.invoiceNo}</td>
                        <td style={{ fontWeight: 600 }}>{inv.supplierName}</td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>{inv.dateFrom} — {inv.dateTo}</td>
                        <td>{inv.grandHours} س</td>
                        <td style={{ color: 'var(--accent)', fontWeight: 700 }}>{inv.grandCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>{approvedAt ? format(approvedAt, 'dd/MM/yyyy HH:mm') : '—'}</td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>{inv.approvedBy || '—'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => printInv(inv, 'supplier')} title="نسخة المورد">📋</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => printInv(inv, 'accounting')} title="نسخة المحاسبة">💰</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => printInv(inv, 'both')} title="النسختين">🖨️</button>
                            <button className="btn btn-danger btn-sm" onClick={() => remove(inv.id)}>🗑️</button>
                          </div>
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


    </>
  )
}
