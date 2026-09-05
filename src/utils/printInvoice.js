import { format } from 'date-fns'

const INV_CSS = `
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  body { background: white; color: #1a1f2e; direction: rtl; font-family: 'IBM Plex Sans Arabic', Tahoma, Arial, sans-serif; margin: 0; padding: 24px 32px; }
  .inv-h { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1a1f2e; padding-bottom: 14px; margin-bottom: 16px; }
  .inv-logo { font-size: 20px; font-weight: 800; }
  .inv-title { font-size: 28px; font-weight: 900; color: #e8a020; }
  .inv-no { font-size: 12px; color: #888; }
  .inv-stamp { display: inline-block; border: 3px solid #3eb87a; border-radius: 8px; padding: 4px 14px; color: #3eb87a; font-size: 13px; font-weight: 800; transform: rotate(-5deg); margin-top: 8px; }
  .inv-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 14px; }
  .inv-p-label { font-size: 10px; color: #999; margin-bottom: 3px; }
  .inv-p-name { font-size: 15px; font-weight: 700; }
  .inv-p-sub { font-size: 11px; color: #555; }
  .inv-period { background: #f5f5f5; padding: 5px 14px; border-radius: 20px; font-size: 11px; font-weight: 600; display: inline-block; margin-bottom: 14px; }
  .inv-divider { border: none; border-top: 2px solid #e8a020; margin: 10px 0 14px; }
  .inv-section { font-size: 12px; font-weight: 700; border-right: 3px solid #e8a020; padding-right: 8px; margin: 14px 0 8px; }
  .inv-table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .inv-table th { background: #1a1f2e; color: white; padding: 7px 10px; text-align: right; }
  .inv-table td { padding: 6px 10px; border-bottom: 1px solid #eee; }
  .inv-table tr:nth-child(even) td { background: #fafafa; }
  .inv-total-row td { font-weight: 700; background: #f0f0f0; border-top: 2px solid #1a1f2e; }
  .ts-header { display: flex; justify-content: space-between; background: #f8f8f8; padding: 7px 12px; border-radius: 6px 6px 0 0; border: 1px solid #ddd; }
  .ts-name { font-size: 13px; font-weight: 700; }
  .ts-sub { font-size: 10px; color: #777; }
  .ts-total { font-size: 12px; font-weight: 700; color: #e8a020; }
  .ts-table { width: 100%; border-collapse: collapse; font-size: 10px; border: 1px solid #ddd; border-top: none; margin-bottom: 12px; }
  .ts-table th { background: #eee; padding: 5px 8px; text-align: right; border-bottom: 1px solid #ddd; }
  .ts-table td { padding: 4px 8px; border-bottom: 1px solid #f0f0f0; }
  .ts-total-row td { font-weight: 700; background: #f5f5f5; border-top: 1px solid #ddd; }
  .grand-box { margin-top: 18px; border: 2px solid #1a1f2e; border-radius: 8px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; }
  .grand-label { font-size: 14px; font-weight: 700; }
  .grand-hours { font-size: 11px; color: #888; }
  .grand-amount { font-size: 22px; font-weight: 900; color: #e8a020; }
  .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 28px; }
  .sig-box { border-top: 1px solid #333; padding-top: 8px; text-align: center; font-size: 11px; color: #555; height: 60px; }
  .inv-footer { margin-top: 18px; border-top: 1px solid #eee; padding-top: 8px; font-size: 9px; color: #aaa; display: flex; justify-content: space-between; }
  .version-label { text-align: center; font-size: 12px; font-weight: 700; color: #999; margin-bottom: 12px; letter-spacing: 0.08em; }
  .page-break { page-break-before: always; }
`

function invoiceBodyHtml(inv, showPrice) {
  const eqList     = inv.eqList    || []
  const reportType = inv.reportType || 'both'
  const approvedAt = inv.approvedAt
    ? (inv.approvedAt.seconds ? new Date(inv.approvedAt.seconds * 1000) : new Date(inv.approvedAt))
    : null

  const summaryRows = eqList.map((eq, i) => `
    <tr>
      <td>${i+1}</td>
      <td style="font-weight:700">${eq.name}</td>
      <td>${eq.type || '—'}</td>
      <td>${eq.siteName || '—'}</td>
      <td style="font-weight:700">${eq.totalHours}</td>
      ${showPrice ? `<td>${eq.hourlyRate}</td><td style="font-weight:700;color:#e8a020">${(eq.totalCost||0).toLocaleString('ar-SA', {maximumFractionDigits:0})}</td>` : ''}
    </tr>
  `).join('')

  const timesheets = eqList.map(eq => {
    const logRows = (eq.logs || []).map((log, i) => `
      <tr>
        <td>${i+1}</td>
        <td>
          ${log.date}
          ${log.isLastWorkingDay ? '<div style="color:#e05050;font-weight:700;font-size:9px">🔴 آخر يوم عمل</div>' : ''}
        </td>
        <td>${log.status==='working'?'شغالة':log.status==='breakdown'?'عطل':log.status==='maintenance'?'صيانة':'راحة'}</td>
        <td>${log.hours > 0 ? log.hours : '—'}</td>
        ${showPrice ? `<td>${log.effectiveRate > 0 ? log.effectiveRate : '—'}</td><td style="font-weight:600">${log.cost > 0 ? (log.cost).toLocaleString('ar-SA',{maximumFractionDigits:0}) : '—'}</td>` : ''}
        <td>${log.notes || '—'}</td>
      </tr>
    `).join('')

    return `
      <div class="inv-section">تايم شيت — ${eq.name}</div>
      <div class="ts-header">
        <div><div class="ts-name">${eq.name}</div><div class="ts-sub">${eq.type} · ${eq.siteName}</div></div>
        <div class="ts-total">${eq.totalHours} ساعة${showPrice ? ` · ${(eq.totalCost||0).toLocaleString('ar-SA',{maximumFractionDigits:0})} ريال` : ''}</div>
      </div>
      <table class="ts-table">
        <thead><tr>
          <th>#</th><th>التاريخ</th><th>الحالة</th><th>ساعات العمل</th>
          ${showPrice ? '<th>سعر/ساعة</th><th>التكلفة (ريال)</th>' : ''}
          <th>ملاحظات</th>
        </tr></thead>
        <tbody>
          ${logRows}
          <tr class="ts-total-row">
            <td colspan="3">إجمالي ${eq.name}</td>
            <td>${eq.totalHours} ساعة</td>
            ${showPrice ? `<td></td><td style="color:#e8a020">${(eq.totalCost||0).toLocaleString('ar-SA',{maximumFractionDigits:0})}</td>` : ''}
            <td></td>
          </tr>
        </tbody>
      </table>
    `
  }).join('')

  return `
    <div class="inv-h">
      <div>
        <div class="inv-logo">⚙️ عيون الحديد</div>
        <div style="font-size:11px;color:#888">نظام متابعة المعدات</div>
        ${approvedAt ? '<div class="inv-stamp">✓ معتمدة</div>' : ''}
      </div>
      <div style="text-align:left">
        <div class="inv-title">مسودة</div>
        <div class="inv-no">رقم: ${inv.invoiceNo}</div>
        <div class="inv-no">تاريخ الإصدار: ${format(new Date(), 'dd/MM/yyyy')}</div>
        ${approvedAt ? `<div class="inv-no">تاريخ الاعتماد: ${format(approvedAt, 'dd/MM/yyyy')}</div>` : ''}
      </div>
    </div>

    <div class="inv-parties">
      <div>
        <div class="inv-p-label">مقدم من</div>
        <div class="inv-p-name">شركة عيون الحديد</div>
      </div>
      <div>
        <div class="inv-p-label">مقدم إلى</div>
        <div class="inv-p-name">${inv.supplierName}</div>
        ${inv.supplierContact ? `<div class="inv-p-sub">${inv.supplierContact}</div>` : ''}
      </div>
    </div>

    <div class="inv-period">📅 الفترة: ${inv.dateFrom} — ${inv.dateTo}</div>
    <hr class="inv-divider" />

    ${(reportType === 'summary' || reportType === 'both') ? `
      <div class="inv-section">ملخص المعدات</div>
      <table class="inv-table">
        <thead><tr>
          <th>#</th><th>المعدة</th><th>النوع</th><th>الموقع</th><th>ساعات العمل</th>
          ${showPrice ? '<th>سعر/ساعة (ريال)</th><th>الإجمالي (ريال)</th>' : ''}
        </tr></thead>
        <tbody>
          ${summaryRows}
          <tr class="inv-total-row">
            <td colspan="4">الإجمالي</td>
            <td>${inv.grandHours}</td>
            ${showPrice ? `<td></td><td style="color:#e8a020">${(inv.grandCost||0).toLocaleString('ar-SA',{maximumFractionDigits:0})}</td>` : ''}
          </tr>
        </tbody>
      </table>
    ` : ''}

    ${(reportType === 'timesheet' || reportType === 'both') ? timesheets : ''}

    ${showPrice ? `
      <div class="grand-box">
        <div>
          <div class="grand-label">إجمالي المستحقات</div>
          <div class="grand-hours">${inv.grandHours} ساعة عمل إجمالية</div>
        </div>
        <div class="grand-amount">${(inv.grandCost||0).toLocaleString('ar-SA',{maximumFractionDigits:0})} ريال</div>
      </div>
    ` : ''}

    <div class="sigs">
      <div class="sig-box">توقيع المورد / ${inv.supplierName}</div>
      <div class="sig-box">توقيع المستلم / عيون الحديد</div>
    </div>

    <div class="inv-footer">
      <span>⚙️ عيون الحديد — ${inv.invoiceNo}</span>
      <span>معتمد بواسطة: ${inv.approvedBy || ''}${approvedAt ? ` | ${format(approvedAt, 'dd/MM/yyyy HH:mm')}` : ''}</span>
    </div>
  `
}

export function printInvoiceInWindow(inv, mode) {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) { alert('يرجى السماح بالنوافذ المنبثقة'); return }

  let body = ''
  if (mode === 'supplier' || mode === 'both') {
    body += mode === 'both' ? `<div class="version-label">— نسخة المورد (بدون أسعار) —</div>` : ''
    body += invoiceBodyHtml(inv, false)
  }
  if (mode === 'accounting' || mode === 'both') {
    body += mode === 'both' ? `<div class="page-break version-label">— نسخة المحاسبة (بالأسعار) —</div>` : ''
    body += invoiceBodyHtml(inv, true)
  }

  w.document.write(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>فاتورة — ${inv.invoiceNo}</title>
  <style>${INV_CSS}</style>
</head>
<body>
  ${body}
  <script>
    window.onload = function() {
      window.print();
      window.onafterprint = function() { window.close(); };
    };
  </script>
</body>
</html>`)
  w.document.close()
}
