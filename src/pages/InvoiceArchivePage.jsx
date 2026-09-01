import { useEffect, useState } from 'react'
import { collection, getDocs, orderBy, query, doc, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { format } from 'date-fns'

export default function InvoiceArchivePage() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [printInvoice, setPrintInvoice] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    const snap = await getDocs(query(collection(db, 'invoices'), orderBy('createdAt', 'desc')))
    setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLoading(false)
  }

  async function remove(id) {
    if (!confirm('حذف هذه الفاتورة من الأرشيف؟')) return
    await deleteDoc(doc(db, 'invoices', id))
    load()
  }

  function printThis(inv) {
    setPrintInvoice(inv)
    setTimeout(() => window.print(), 500)
  }

  const filtered = invoices.filter(inv => {
    const q = search.toLowerCase()
    return !q || inv.invoiceNo?.toLowerCase().includes(q) || inv.supplierName?.toLowerCase().includes(q)
  })

  const STATUS_COLOR = {
    approved: { label: 'معتمدة', cls: 'badge-green' },
    draft:    { label: 'مسودة',   cls: 'badge-gray'  },
  }

  if (loading) return <div className="spinner" />

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body { background: white !important; color: #1a1f2e !important; direction: rtl; font-family: 'IBM Plex Sans Arabic', sans-serif; margin: 0; }
          .print-inv { padding: 24px 32px; }
          .inv-h { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1a1f2e; padding-bottom: 14px; margin-bottom: 16px; }
          .inv-logo { font-size: 20px; font-weight: 800; }
          .inv-title { font-size: 28px; font-weight: 900; color: #e8a020; }
          .inv-no { font-size: 12px; color: #888; }
          .inv-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 14px; }
          .inv-p-label { font-size: 10px; color: #999; margin-bottom: 3px; }
          .inv-p-name { font-size: 15px; font-weight: 700; }
          .inv-p-sub { font-size: 11px; color: #555; }
          .inv-period { background: #f5f5f5; padding: 5px 14px; border-radius: 20px; font-size: 11px; font-weight: 600; display: inline-block; margin-bottom: 14px; }
          .inv-section { font-size: 12px; font-weight: 700; border-right: 3px solid #e8a020; padding-right: 8px; margin: 14px 0 8px; }
          .inv-table { width: 100%; border-collapse: collapse; font-size: 11px; }
          .inv-table th { background: #1a1f2e; color: white; padding: 7px 10px; text-align: right; }
          .inv-table td { padding: 6px 10px; border-bottom: 1px solid #eee; }
          .inv-table tr:nth-child(even) td { background: #fafafa; }
          .inv-table .total-row td { font-weight: 700; background: #f0f0f0; border-top: 2px solid #1a1f2e; }
          .ts-h { display: flex; justify-content: space-between; background: #f8f8f8; padding: 7px 12px; border-radius: 6px 6px 0 0; border: 1px solid #ddd; }
          .ts-name { font-size: 13px; font-weight: 700; }
          .ts-sub { font-size: 10px; color: #777; }
          .ts-tot { font-size: 12px; font-weight: 700; color: #e8a020; }
          .ts-table { width: 100%; border-collapse: collapse; font-size: 10px; border: 1px solid #ddd; border-top: none; margin-bottom: 12px; }
          .ts-table th { background: #eee; padding: 5px 8px; text-align: right; border-bottom: 1px solid #ddd; }
          .ts-table td { padding: 4px 8px; border-bottom: 1px solid #f0f0f0; }
          .ts-table .trow td { font-weight: 700; background: #f5f5f5; border-top: 1px solid #ddd; }
          .grand-box { margin-top: 18px; border: 2px solid #1a1f2e; border-radius: 8px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; }
          .grand-lbl { font-size: 14px; font-weight: 700; }
          .grand-amt { font-size: 22px; font-weight: 900; color: #e8a020; }
          .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 28px; }
          .sig { border-top: 1px solid #333; padding-top: 8px; text-align: center; font-size: 11px; color: #555; }
          .inv-stamp { display: inline-block; border: 3px solid #3eb87a; border-radius: 8px; padding: 6px 16px; color: #3eb87a; font-size: 14px; font-weight: 800; transform: rotate(-5deg); margin-top: 10px; }
          .inv-footer { margin-top: 18px; border-top: 1px solid #eee; padding-top: 8px; font-size: 9px; color: #aaa; display: flex; justify-content: space-between; }
          .page-break { page-break-before: always; }
          .version-title { text-align: center; font-size: 12px; font-weight: 700; color: #999; margin-bottom: 10px; letter-spacing: 0.1em; }
        }
        @media screen { .print-only { display: none; } }
      `}</style>

      <div className="page no-print">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="page-title">🗄️ أرشيف الفواتير</div>
            <div className="page-sub">{invoices.length} فاتورة محفوظة</div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <input className="form-control" style={{ maxWidth: 260 }} placeholder="🔍 بحث برقم الفاتورة أو المورد..."
              value={search} onChange={e => setSearch(e.target.value)} />
            <span className="badge badge-gray">{filtered.length} فاتورة</span>
          </div>
          <div className="table-wrap">
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🗄️</div>
                <div className="empty-text">لا توجد فواتير مؤرشفة</div>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>رقم الفاتورة</th>
                    <th>المورد</th>
                    <th>الفترة</th>
                    <th>الساعات</th>
                    <th>المبلغ</th>
                    <th>تاريخ الاعتماد</th>
                    <th>معتمد بواسطة</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(inv => (
                    <tr key={inv.id}>
                      <td style={{ fontWeight: 700, color: 'var(--accent)', fontSize: '0.85rem' }}>{inv.invoiceNo}</td>
                      <td style={{ fontWeight: 600 }}>{inv.supplierName}</td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>{inv.dateFrom} — {inv.dateTo}</td>
                      <td>{inv.grandHours} س</td>
                      <td style={{ color: 'var(--accent)', fontWeight: 700 }}>
                        {inv.grandCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر
                      </td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>
                        {inv.approvedAt ? format(new Date(inv.approvedAt.seconds ? inv.approvedAt.seconds * 1000 : inv.approvedAt), 'dd/MM/yyyy HH:mm') : '—'}
                      </td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>{inv.approvedBy || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-primary btn-sm" onClick={() => printThis(inv)}>🖨️ طباعة</button>
                          <button className="btn btn-danger btn-sm" onClick={() => remove(inv.id)}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Print area for archived invoice */}
      {printInvoice && (
        <InvoicePrint inv={printInvoice} onDone={() => setPrintInvoice(null)} />
      )}
    </>
  )
}

// ── Reusable print component ──────────────────────────────────────
export function InvoicePrint({ inv, onDone }) {
  const eqList    = inv.eqList    || []
  const showPrice = true // archive always has both versions

  return (
    <>
      {/* Version 1: للمورد */}
      <div className="print-inv print-only">
        <div className="version-title">— نسخة المورد (بدون أسعار) —</div>
        <InvoiceBody inv={inv} eqList={eqList} showPrice={false} />
      </div>

      {/* Version 2: للمحاسبة */}
      <div className="print-inv print-only page-break">
        <div className="version-title">— نسخة المحاسبة (بالأسعار) —</div>
        <InvoiceBody inv={inv} eqList={eqList} showPrice={true} />
      </div>
    </>
  )
}

function InvoiceBody({ inv, eqList, showPrice }) {
  const reportType = inv.reportType || 'both'
  return (
    <>
      <div className="inv-h">
        <div>
          <div className="inv-logo">⚙️ عيون الحديد</div>
          <div style={{ fontSize: 11, color: '#888' }}>نظام متابعة المعدات</div>
          <div className="inv-stamp">✓ معتمدة</div>
        </div>
        <div style={{ textAlign: 'left' }}>
          <div className="inv-title">فاتورة</div>
          <div className="inv-no">رقم: {inv.invoiceNo}</div>
          <div className="inv-no">تاريخ الاعتماد: {inv.approvedAt ? format(new Date(inv.approvedAt.seconds ? inv.approvedAt.seconds * 1000 : inv.approvedAt), 'dd/MM/yyyy') : '—'}</div>
        </div>
      </div>

      <div className="inv-parties">
        <div>
          <div className="inv-p-label">مقدم من</div>
          <div className="inv-p-name">شركة عيون الحديد</div>
        </div>
        <div>
          <div className="inv-p-label">مقدم إلى</div>
          <div className="inv-p-name">{inv.supplierName}</div>
          {inv.supplierContact && <div className="inv-p-sub">{inv.supplierContact}</div>}
        </div>
      </div>

      <div className="inv-period">📅 الفترة: {inv.dateFrom} — {inv.dateTo}</div>

      {/* Summary */}
      {(reportType === 'summary' || reportType === 'both') && (
        <>
          <div className="inv-section">ملخص المعدات</div>
          <table className="inv-table">
            <thead>
              <tr>
                <th>#</th><th>المعدة</th><th>النوع</th><th>الموقع</th><th>ساعات العمل</th>
                {showPrice && <><th>سعر/ساعة (ريال)</th><th>الإجمالي (ريال)</th></>}
              </tr>
            </thead>
            <tbody>
              {eqList.map((eq, i) => (
                <tr key={i}>
                  <td>{i+1}</td>
                  <td style={{ fontWeight: 700 }}>{eq.name}</td>
                  <td>{eq.type}</td>
                  <td>{eq.siteName}</td>
                  <td style={{ fontWeight: 700 }}>{eq.totalHours}</td>
                  {showPrice && (
                    <><td>{eq.hourlyRate}</td>
                    <td style={{ fontWeight: 700, color: '#e8a020' }}>{eq.totalCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td></>
                  )}
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={4}>الإجمالي</td>
                <td>{inv.grandHours}</td>
                {showPrice && <><td></td><td style={{ color: '#e8a020' }}>{inv.grandCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td></>}
              </tr>
            </tbody>
          </table>
        </>
      )}

      {/* Timesheets */}
      {(reportType === 'timesheet' || reportType === 'both') && eqList.map((eq, idx) => (
        <div key={idx}>
          <div className="inv-section">تايم شيت — {eq.name}</div>
          <div className="ts-h">
            <div><div className="ts-name">{eq.name}</div><div className="ts-sub">{eq.type} · {eq.siteName}</div></div>
            <div className="ts-tot">{eq.totalHours} ساعة{showPrice ? ` · ${eq.totalCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ريال` : ''}</div>
          </div>
          <table className="ts-table">
            <thead>
              <tr>
                <th>#</th><th>التاريخ</th><th>الحالة</th><th>ساعات العمل</th>
                {showPrice && <><th>سعر/ساعة</th><th>التكلفة (ريال)</th></>}
                <th>ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {(eq.logs || []).map((log, i) => (
                <tr key={i}>
                  <td>{i+1}</td>
                  <td>{log.date}</td>
                  <td>{log.status==='working'?'شغالة':log.status==='breakdown'?'عطل':log.status==='maintenance'?'صيانة':'راحة'}</td>
                  <td>{log.hours > 0 ? log.hours : '—'}</td>
                  {showPrice && (
                    <><td>{log.effectiveRate > 0 ? log.effectiveRate : '—'}</td>
                    <td style={{ fontWeight: 600 }}>{log.cost > 0 ? log.cost.toLocaleString('ar-SA', { maximumFractionDigits: 0 }) : '—'}</td></>
                  )}
                  <td>{log.notes || '—'}</td>
                </tr>
              ))}
              <tr className="trow">
                <td colSpan={3}>إجمالي {eq.name}</td>
                <td>{eq.totalHours} ساعة</td>
                {showPrice && <><td></td><td style={{ color: '#e8a020' }}>{eq.totalCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })}</td></>}
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      {showPrice && (
        <div className="grand-box">
          <div>
            <div className="grand-lbl">إجمالي المستحقات</div>
            <div style={{ fontSize: 11, color: '#888' }}>{inv.grandHours} ساعة عمل إجمالية</div>
          </div>
          <div className="grand-amt">{inv.grandCost?.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ريال</div>
        </div>
      )}

      <div className="sigs">
        <div className="sig"><div style={{ height: 40 }}></div>توقيع المورد / {inv.supplierName}</div>
        <div className="sig"><div style={{ height: 40 }}></div>توقيع المستلم / عيون الحديد</div>
      </div>

      <div className="inv-footer">
        <span>⚙️ عيون الحديد — {inv.invoiceNo}</span>
        <span>معتمد بواسطة: {inv.approvedBy} | {inv.approvedAt ? format(new Date(inv.approvedAt.seconds ? inv.approvedAt.seconds * 1000 : inv.approvedAt), 'dd/MM/yyyy HH:mm') : '—'}</span>
      </div>
    </>
  )
}
