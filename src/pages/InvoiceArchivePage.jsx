import { useEffect, useState } from 'react'
import { collection, getDocs, orderBy, query, doc, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { format } from 'date-fns'
import { InvoiceBody } from './SupplierReportPage'

const PRINT_STYLE = `
  @media print {
    body * { visibility: hidden !important; }
    #inv-print-root, #inv-print-root * { visibility: visible !important; }
    #inv-print-root {
      position: fixed !important;
      top: 0; left: 0; right: 0; bottom: 0;
      background: white !important;
      color: #1a1f2e !important;
      direction: rtl;
      font-family: 'IBM Plex Sans Arabic', sans-serif;
      padding: 24px 32px;
      overflow: auto;
      z-index: 9999;
    }
    .inv-h { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1a1f2e; padding-bottom: 14px; margin-bottom: 16px; }
    .inv-logo { font-size: 20px; font-weight: 800; }
    .inv-title-block { text-align: left; }
    .inv-title { font-size: 28px; font-weight: 900; color: #e8a020; }
    .inv-no { font-size: 12px; color: #888; }
    .inv-stamp { display: inline-block; border: 3px solid #3eb87a; border-radius: 8px; padding: 4px 14px; color: #3eb87a; font-size: 13px; font-weight: 800; transform: rotate(-5deg); margin-top: 8px; }
    .inv-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 14px; }
    .inv-p-label { font-size: 10px; color: #999; margin-bottom: 3px; }
    .inv-p-name { font-size: 15px; font-weight: 700; }
    .inv-p-sub { font-size: 11px; color: #555; }
    .inv-period { background: #f5f5f5; padding: 5px 14px; border-radius: 20px; font-size: 11px; font-weight: 600; display: inline-block; margin-bottom: 14px; }
    .inv-divider-gold { border: none; border-top: 2px solid #e8a020; margin: 10px 0 14px; }
    .inv-section { font-size: 12px; font-weight: 700; border-right: 3px solid #e8a020; padding-right: 8px; margin: 14px 0 8px; }
    .inv-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .inv-table th { background: #1a1f2e; color: white; padding: 7px 10px; text-align: right; }
    .inv-table td { padding: 6px 10px; border-bottom: 1px solid #eee; }
    .inv-table tr:nth-child(even) td { background: #fafafa; }
    .inv-total-row td { font-weight: 700 !important; background: #f0f0f0 !important; border-top: 2px solid #1a1f2e !important; }
    .ts-header { display: flex; justify-content: space-between; background: #f8f8f8; padding: 7px 12px; border-radius: 6px 6px 0 0; border: 1px solid #ddd; }
    .ts-eq-name { font-size: 13px; font-weight: 700; }
    .ts-eq-sub { font-size: 10px; color: #777; }
    .ts-total-label { font-size: 12px; font-weight: 700; color: #e8a020; }
    .ts-table { width: 100%; border-collapse: collapse; font-size: 10px; border: 1px solid #ddd; border-top: none; margin-bottom: 12px; }
    .ts-table th { background: #eee; padding: 5px 8px; text-align: right; border-bottom: 1px solid #ddd; }
    .ts-table td { padding: 4px 8px; border-bottom: 1px solid #f0f0f0; }
    .ts-table .ts-total-row td { font-weight: 700 !important; background: #f5f5f5 !important; border-top: 1px solid #ddd !important; }
    .grand-box { margin-top: 18px; border: 2px solid #1a1f2e; border-radius: 8px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; }
    .grand-label { font-size: 14px; font-weight: 700; }
    .grand-hours { font-size: 11px; color: #888; }
    .grand-amount { font-size: 22px; font-weight: 900; color: #e8a020; }
    .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 28px; }
    .sig-box { border-top: 1px solid #333; padding-top: 8px; text-align: center; font-size: 11px; color: #555; }
    .inv-footer-bar { margin-top: 18px; border-top: 1px solid #eee; padding-top: 8px; font-size: 9px; color: #aaa; display: flex; justify-content: space-between; }
    .version-label { text-align: center; font-size: 12px; font-weight: 700; color: #999; margin-bottom: 12px; letter-spacing: 0.08em; }
    .page-break { page-break-before: always; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
`

export default function InvoiceArchivePage() {
  const [invoices, setInvoices]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [printData, setPrintData] = useState(null)

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
    setPrintData({ inv, mode })
    setTimeout(() => window.print(), 300)
  }

  const filtered = invoices.filter(inv => {
    const q = search.toLowerCase()
    return !q || inv.invoiceNo?.toLowerCase().includes(q) || inv.supplierName?.toLowerCase().includes(q)
  })

  if (loading) return <div className="spinner" />

  return (
    <>
      <style>{PRINT_STYLE}</style>

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

      {/* Print root */}
      {printData && (
        <div id="inv-print-root">
          {(printData.mode === 'supplier' || printData.mode === 'both') && (
            <div>
              {printData.mode === 'both' && <div className="version-label">— نسخة المورد (بدون أسعار) —</div>}
              <InvoiceBody inv={printData.inv} showPrice={false} />
            </div>
          )}
          {(printData.mode === 'accounting' || printData.mode === 'both') && (
            <div className={printData.mode === 'both' ? 'page-break' : ''}>
              {printData.mode === 'both' && <div className="version-label">— نسخة المحاسبة (بالأسعار) —</div>}
              <InvoiceBody inv={printData.inv} showPrice={true} />
            </div>
          )}
        </div>
      )}
    </>
  )
}
