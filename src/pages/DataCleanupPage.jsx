import { useEffect, useState } from 'react'
import { collection, getDocs, query, where, writeBatch, doc } from 'firebase/firestore'
import { db } from '../firebase'

export default function DataCleanupPage() {
  const [scanning, setScanning]   = useState(false)
  const [deleting, setDeleting]   = useState(false)
  const [results, setResults]     = useState(null) // { orphanGroups: [], totalCount: 0 }
  const [deleted, setDeleted]     = useState(false)

  async function scan() {
    setScanning(true); setResults(null); setDeleted(false)
    try {
      // 1. Get all equipment IDs
      const eqSnap  = await getDocs(collection(db, 'equipment'))
      const validIds = new Set(eqSnap.docs.map(d => d.id))

      // 2. Get all logs
      const logsSnap = await getDocs(collection(db, 'logs'))
      const allLogs  = logsSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }))

      // 3. Find orphan logs (equipment not in valid IDs)
      const orphanLogs = allLogs.filter(l => !validIds.has(l.equipmentId))

      // 4. Group by equipmentId + equipmentName
      const groups = {}
      orphanLogs.forEach(log => {
        const key = log.equipmentId
        if (!groups[key]) {
          groups[key] = {
            equipmentId:   key,
            equipmentName: log.equipmentName || '(بدون اسم)',
            supplierName:  log.supplierName  || '—',
            siteName:      log.siteName      || '—',
            logs: [],
            dateMin: log.date,
            dateMax: log.date,
          }
        }
        groups[key].logs.push(log)
        if (log.date < groups[key].dateMin) groups[key].dateMin = log.date
        if (log.date > groups[key].dateMax) groups[key].dateMax = log.date
      })

      setResults({
        orphanGroups: Object.values(groups).sort((a,b) => a.equipmentName.localeCompare(b.equipmentName)),
        totalCount: orphanLogs.length,
        allOrphanLogs: orphanLogs,
      })
    } catch(e) { alert('خطأ: ' + e.message) }
    finally { setScanning(false) }
  }

  async function deleteAll() {
    if (!results || results.totalCount === 0) return
    if (!confirm(`هل تريد حذف ${results.totalCount} سجل يتيم نهائياً؟ لا يمكن التراجع.`)) return

    setDeleting(true)
    try {
      const logs = results.allOrphanLogs
      // Delete in batches of 400
      for (let i = 0; i < logs.length; i += 400) {
        const batch = writeBatch(db)
        logs.slice(i, i + 400).forEach(l => batch.delete(l.ref))
        await batch.commit()
      }
      setDeleted(true)
      setResults(prev => ({ ...prev, orphanGroups: [], totalCount: 0, allOrphanLogs: [] }))
    } catch(e) { alert('خطأ في الحذف: ' + e.message) }
    finally { setDeleting(false) }
  }

  async function deleteGroup(group) {
    if (!confirm(`حذف ${group.logs.length} سجل للمعدة "${group.equipmentName}"؟`)) return
    setDeleting(true)
    try {
      for (let i = 0; i < group.logs.length; i += 400) {
        const batch = writeBatch(db)
        group.logs.slice(i, i + 400).forEach(l => batch.delete(l.ref))
        await batch.commit()
      }
      setResults(prev => ({
        ...prev,
        orphanGroups: prev.orphanGroups.filter(g => g.equipmentId !== group.equipmentId),
        totalCount: prev.totalCount - group.logs.length,
        allOrphanLogs: prev.allOrphanLogs.filter(l => l.equipmentId !== group.equipmentId),
      }))
    } catch(e) { alert('خطأ: ' + e.message) }
    finally { setDeleting(false) }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">🧹 تنظيف البيانات</div>
          <div className="page-sub">حذف السجلات اليتيمة (معدات غير موجودة في النظام)</div>
        </div>
      </div>

      {/* Explanation */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body">
          <div style={{ fontSize: '0.88rem', color: 'var(--text-2)', lineHeight: 1.8 }}>
            <strong>ما هي السجلات اليتيمة؟</strong> هي سجلات دوام موجودة في قاعدة البيانات لمعدات تم حذفها من النظام.
            هذه السجلات تظهر في التقارير بدون معلومات كاملة وتسبب أرقاماً غير صحيحة.
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
            <button className="btn btn-primary" onClick={scan} disabled={scanning || deleting}>
              {scanning ? '⏳ جاري الفحص...' : '🔍 فحص البيانات'}
            </button>
            {results && results.totalCount > 0 && !deleted && (
              <button className="btn btn-danger" onClick={deleteAll} disabled={deleting}>
                {deleting ? 'جاري الحذف...' : `🗑️ حذف كل السجلات اليتيمة (${results.totalCount})`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      {deleted && (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--success)' }}>تم التنظيف بنجاح</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-3)', marginTop: 8 }}>كل السجلات اليتيمة تم حذفها</div>
            <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={scan}>فحص مرة أخرى</button>
          </div>
        </div>
      )}

      {results && !deleted && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">نتائج الفحص</span>
            {results.totalCount === 0
              ? <span className="badge badge-green">✅ لا توجد سجلات يتيمة</span>
              : <span className="badge badge-red">{results.totalCount} سجل يتيم</span>
            }
          </div>
          <div className="card-body">
            {results.totalCount === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">✅</div>
                <div className="empty-text">البيانات نظيفة — لا توجد سجلات يتيمة</div>
              </div>
            ) : (
              <>
                <div style={{ background: 'rgba(224,80,80,0.06)', border: '1px solid rgba(224,80,80,0.2)', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: '0.85rem', color: 'var(--danger)' }}>
                  ⚠️ وُجد {results.orphanGroups.length} معدة محذوفة لها {results.totalCount} سجل دوام لسه موجودة في قاعدة البيانات
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>اسم المعدة المحذوفة</th>
                        <th>المورد</th>
                        <th>الموقع</th>
                        <th>عدد السجلات</th>
                        <th>من تاريخ</th>
                        <th>إلى تاريخ</th>
                        <th>إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.orphanGroups.map(group => (
                        <tr key={group.equipmentId}>
                          <td style={{ fontWeight: 600, color: 'var(--danger)' }}>
                            {group.equipmentName}
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', fontWeight: 400 }}>
                              ID: {group.equipmentId.substring(0,12)}...
                            </div>
                          </td>
                          <td>{group.supplierName}</td>
                          <td>{group.siteName}</td>
                          <td>
                            <span className="badge badge-red">{group.logs.length} سجل</span>
                          </td>
                          <td style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>{group.dateMin}</td>
                          <td style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>{group.dateMax}</td>
                          <td>
                            <button className="btn btn-danger btn-sm" onClick={() => deleteGroup(group)} disabled={deleting}>
                              🗑️ حذف
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
