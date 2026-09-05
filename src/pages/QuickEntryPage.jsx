import { useEffect, useState } from 'react'
import { collection, getDocs, query, where, orderBy, doc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { startOfWeek, endOfWeek, addWeeks, subWeeks, format, eachDayOfInterval, addDays, parseISO, isAfter, isBefore } from 'date-fns'

const DAY_NAMES = ['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة']
const STATUS_OPTS = [
  { value: 'working',     label: 'شغالة', color: '#3eb87a', bg: 'rgba(62,184,122,0.12)'  },
  { value: 'breakdown',   label: 'عطل',   color: '#e05050', bg: 'rgba(224,80,80,0.12)'   },
  { value: 'maintenance', label: 'صيانة', color: '#e8a020', bg: 'rgba(232,160,32,0.15)'  },
  { value: 'idle',        label: 'راحة',  color: '#6b6860', bg: 'rgba(107,104,96,0.12)'  },
]

function getWeekDays(weekDate) {
  const start = startOfWeek(weekDate, { weekStartsOn: 6 })
  return eachDayOfInterval({ start, end: addDays(start, 6) })
}

function isEquipmentActiveOnDate(eq, dateStr) {
  const date = parseISO(dateStr)
  if (eq.startDate && isBefore(date, parseISO(eq.startDate))) return false
  if (eq.status === 'retired' && eq.retiredDate && isAfter(date, parseISO(eq.retiredDate))) return false
  return true
}

export default function QuickEntryPage() {
  const { userData } = useAuth()
  const isAdmin = userData?.role === 'admin'
  const [weekDate, setWeekDate]       = useState(new Date())
  const [sites, setSites]             = useState([])
  const [allEquipment, setAllEquipment] = useState([])
  const [selectedSite, setSelectedSite] = useState(isAdmin ? '' : userData?.siteId)
  const [defaultHours, setDefaultHours] = useState(10)
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [savedCount, setSavedCount]   = useState(0)
  const [showSuccess, setShowSuccess] = useState(false)
  const [grid, setGrid]               = useState({})
  const [activeCell, setActiveCell]   = useState(null)

  const days      = getWeekDays(weekDate)
  const weekStart = format(days[0], 'yyyy-MM-dd')
  const weekEnd   = format(days[6], 'yyyy-MM-dd')

  useEffect(() => { loadMeta() }, [])
  useEffect(() => { if (allEquipment.length > 0) loadWeekData() }, [weekDate, selectedSite, allEquipment])

  async function loadMeta() {
    const [siteSnap, eqSnap] = await Promise.all([
      getDocs(collection(db, 'sites')),
      getDocs(collection(db, 'equipment')),
    ])
    setSites(siteSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setAllEquipment(eqSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLoading(false)
  }

  async function loadWeekData() {
    const equipment = getFilteredEquipment()
    if (equipment.length === 0) { setGrid({}); return }

    const logsSnap = await getDocs(query(
      collection(db, 'logs'),
      where('date', '>=', weekStart),
      where('date', '<=', weekEnd),
      orderBy('date', 'asc')
    ))

    const existingLogs = {}
    logsSnap.docs.forEach(d => {
      const log = { id: d.id, ...d.data() }
      if (!existingLogs[log.equipmentId]) existingLogs[log.equipmentId] = {}
      existingLogs[log.equipmentId][log.date] = log
    })

    const newGrid = {}
    equipment.forEach(eq => {
      newGrid[eq.id] = {}
      days.forEach(day => {
        const dateStr  = format(day, 'yyyy-MM-dd')
        const active   = isEquipmentActiveOnDate(eq, dateStr)
        const existing = existingLogs[eq.id]?.[dateStr]
        newGrid[eq.id][dateStr] = {
          active,
          status:      existing?.status || 'working',
          hours:       existing?.hours ?? (active ? defaultHours : 0),
          clientHours: existing?.clientHours ?? 0,
          stopReason:  existing?.stopReason || '',
          existingId:  existing?.id || null,
          saved:       !!existing,
        }
      })
    })
    setGrid(newGrid)
  }

  function getFilteredEquipment() {
    let list = allEquipment.filter(e => {
      if (selectedSite && e.siteId !== selectedSite) return false
      if (!isAdmin && e.siteId !== userData?.siteId) return false
      return true
    })
    list = list.filter(eq => {
      if (eq.startDate && eq.startDate > weekEnd) return false
      if (eq.status === 'retired' && eq.retiredDate && eq.retiredDate < weekStart) return false
      return true
    })
    return list
  }

  function updateCell(eqId, dateStr, field, value) {
    setGrid(g => ({
      ...g,
      [eqId]: { ...g[eqId], [dateStr]: { ...g[eqId][dateStr], [field]: value, saved: false } }
    }))
  }

  function applyDefaultToAll() {
    setGrid(g => {
      const newG = { ...g }
      getFilteredEquipment().forEach(eq => {
        days.forEach(day => {
          const dateStr = format(day, 'yyyy-MM-dd')
          if (newG[eq.id]?.[dateStr]?.active && newG[eq.id][dateStr].status === 'working') {
            newG[eq.id][dateStr] = { ...newG[eq.id][dateStr], hours: defaultHours, saved: false }
          }
        })
      })
      return newG
    })
  }

  async function saveAll() {
    setSaving(true)
    const equipment = getFilteredEquipment()
    const eqMap = {}, siteMap = {}
    allEquipment.forEach(e => eqMap[e.id] = e)
    sites.forEach(s => siteMap[s.id] = s)

    let count = 0
    const batch = writeBatch(db)

    for (const eq of equipment) {
      for (const day of days) {
        const dateStr = format(day, 'yyyy-MM-dd')
        const cell    = grid[eq.id]?.[dateStr]
        if (!cell || cell.saved || !cell.active) continue

        const eqData = eqMap[eq.id]
        const siteId = eqData?.siteId || ''
        const site   = siteMap[siteId]
        const hours  = cell.status === 'working' ? (parseFloat(cell.hours) || 0) : 0

        // clientHours only for equipment with clientId and status working
        const clientHours = (eqData?.clientId && cell.status === 'working')
          ? (parseFloat(cell.clientHours) || 0)
          : 0

        const logData = {
          equipmentId:   eq.id,
          equipmentName: eqData?.name || '',
          siteId,
          siteName:      site?.name || eqData?.siteName || '',
          supplierId:    eqData?.supplierId || '',
          supplierName:  eqData?.supplierName || '',
          clientId:      eqData?.clientId || '',
          clientName:    eqData?.clientName || '',
          hourlyRate:    eqData?.hourlyRate || 0,
          clientRate:    eqData?.clientRate || 0,
          hours,
          clientHours,
          status:        cell.status,
          stopReason:    cell.status !== 'working' ? (cell.stopReason || '') : '',
          date:          dateStr,
          notes:         '',
          supervisorId:  userData.uid,
          supervisorName: userData.name || userData.email,
          updatedAt:     serverTimestamp(),
        }

        if (cell.existingId) {
          batch.update(doc(db, 'logs', cell.existingId), logData)
        } else {
          batch.set(doc(collection(db, 'logs')), { ...logData, createdAt: serverTimestamp() })
        }
        count++
      }
    }

    await batch.commit()
    setSavedCount(count)
    setSaving(false)
    setShowSuccess(true)
    setTimeout(() => setShowSuccess(false), 4000)
    loadWeekData()
  }

  const equipment = getFilteredEquipment()
  let unsavedCount = 0
  equipment.forEach(eq => {
    days.forEach(day => {
      const cell = grid[eq.id]?.[format(day, 'yyyy-MM-dd')]
      if (cell && !cell.saved && cell.active) unsavedCount++
    })
  })

  if (loading) return <div className="spinner" />

  return (
    <div className="page" style={{ paddingBottom: 80 }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="page-title">⚡ إدخال سريع أسبوعي</div>
          <div className="page-sub">{equipment.length} معدة نشطة هذا الأسبوع</div>
        </div>
        <button className="btn btn-primary" onClick={saveAll} disabled={saving || unsavedCount === 0} style={{ padding: '9px 24px' }}>
          {saving ? 'جاري الحفظ...' : `💾 حفظ الكل (${unsavedCount})`}
        </button>
      </div>

      {showSuccess && <div className="alert alert-success" style={{ marginBottom: 16 }}>✅ تم حفظ {savedCount} سجل</div>}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setWeekDate(d => subWeeks(d, 1))}>→</button>
          <div style={{ background: 'var(--steel-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 14px', fontSize: '0.85rem', fontWeight: 500 }}>
            {format(days[0], 'dd/MM')} — {format(days[6], 'dd/MM/yyyy')}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setWeekDate(d => addWeeks(d, 1))}>←</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setWeekDate(new Date())}>الحالي</button>
        </div>
        {isAdmin && (
          <select className="form-control" style={{ minWidth: 160 }} value={selectedSite}
            onChange={e => setSelectedSite(e.target.value)}>
            <option value="">كل المواقع</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className="form-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>ساعات افتراضية:</label>
          <input type="number" className="form-control" style={{ width: 80 }}
            value={defaultHours} min={1} max={24} step={0.5}
            onChange={e => setDefaultHours(parseFloat(e.target.value) || 10)} />
          <button className="btn btn-secondary btn-sm" onClick={applyDefaultToAll}>تطبيق على الكل</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {STATUS_OPTS.map(s => (
          <div key={s.value} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: 'var(--text-2)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />{s.label}
          </div>
        ))}
        <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', borderRight: '1px solid var(--border)', paddingRight: 12 }}>
          🏭 = عندها عميل (ساعتين منفصلتين) | 🔒 = غير نشطة
        </div>
      </div>

      {equipment.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🏗️</div><div className="empty-text">لا توجد معدات نشطة هذا الأسبوع</div></div>
      ) : (
        <div style={{ overflowX: 'auto', position: 'relative' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 700 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 160, position: 'sticky', right: 0, background: 'var(--steel-2)', zIndex: 2 }}>المعدة</th>
                {days.map((day, i) => (
                  <th key={i} style={{
                    ...thStyle,
                    background: format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') ? 'var(--accent-dim)' : 'var(--steel-2)',
                    color: format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') ? 'var(--accent)' : 'var(--text-3)',
                  }}>
                    <div>{DAY_NAMES[i]}</div>
                    <div style={{ fontSize: '0.7rem', fontWeight: 400 }}>{format(day, 'dd/MM')}</div>
                  </th>
                ))}
                <th style={{ ...thStyle, background: 'var(--steel-2)' }}>المجموع</th>
              </tr>
            </thead>
            <tbody>
              {equipment.map(eq => {
                const hasClient = !!eq.clientId
                const weekTotal = days.reduce((s, day) => {
                  const cell = grid[eq.id]?.[format(day, 'yyyy-MM-dd')]
                  return s + (cell?.active && cell?.status === 'working' ? (parseFloat(cell?.hours) || 0) : 0)
                }, 0)
                const weekCost = weekTotal * (eq.hourlyRate || 0)

                return (
                  <tr key={eq.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600, fontSize: '0.85rem', position: 'sticky', right: 0, background: 'var(--steel-2)', zIndex: 1, borderLeft: '1px solid var(--border)' }}>
                      <div>{eq.name} {hasClient && '🏭'}</div>
                      {isAdmin && <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', fontWeight: 400 }}>{eq.siteName}</div>}
                      {hasClient && <div style={{ fontSize: '0.65rem', color: 'var(--info)' }}>{eq.clientName}</div>}
                    </td>
                    {days.map((day, i) => {
                      const dateStr = format(day, 'yyyy-MM-dd')
                      const cell    = grid[eq.id]?.[dateStr]
                      const isActive = activeCell?.eqId === eq.id && activeCell?.dateStr === dateStr

                      if (!cell || !cell.active) {
                        return (
                          <td key={i} style={{ padding: 4 }}>
                            <div style={{ borderRadius: 6, padding: '6px 8px', minHeight: 52, background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>—</span>
                            </div>
                          </td>
                        )
                      }

                      const st = STATUS_OPTS.find(s => s.value === cell.status) || STATUS_OPTS[0]

                      return (
                        <td key={i} style={{ padding: 4, verticalAlign: 'top', position: 'relative', minWidth: 88 }}>
                          <div onClick={() => setActiveCell(isActive ? null : { eqId: eq.id, dateStr })}
                            style={{
                              borderRadius: 6, padding: '4px 6px', cursor: 'pointer',
                              background: cell.saved ? 'rgba(62,184,122,0.06)' : st.bg,
                              border: `1px solid ${isActive ? 'var(--accent)' : cell.saved ? 'rgba(62,184,122,0.25)' : 'var(--border)'}`,
                              transition: 'all 0.15s', minHeight: hasClient ? 68 : 52,
                            }}>
                            {cell.status === 'working' ? (
                              <>
                                {/* Supplier hours */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontSize: '0.6rem', color: 'var(--text-3)', minWidth: 16 }}>م</span>
                                  <input type="number" value={cell.hours} min={0} max={24} step={0.5}
                                    onClick={e => e.stopPropagation()}
                                    onChange={e => updateCell(eq.id, dateStr, 'hours', parseFloat(e.target.value) || 0)}
                                    style={{ width: '100%', background: 'transparent', border: 'none', color: st.color, fontWeight: 700, fontSize: '0.95rem', fontFamily: 'var(--font)', textAlign: 'center', outline: 'none' }} />
                                </div>
                                {/* Client hours — only if has client */}
                                {hasClient && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderTop: '1px dashed rgba(26,111,160,0.3)', marginTop: 3, paddingTop: 3 }}>
                                    <span style={{ fontSize: '0.6rem', color: 'var(--info)', minWidth: 16 }}>ع</span>
                                    <input type="number" value={cell.clientHours} min={0} max={24} step={0.5}
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => updateCell(eq.id, dateStr, 'clientHours', parseFloat(e.target.value) || 0)}
                                      style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--info)', fontWeight: 700, fontSize: '0.85rem', fontFamily: 'var(--font)', textAlign: 'center', outline: 'none' }} />
                                  </div>
                                )}
                                <div style={{ fontSize: '0.6rem', color: 'var(--text-3)', textAlign: 'center' }}>س</div>
                              </>
                            ) : (
                              <div style={{ color: st.color, fontWeight: 600, fontSize: '0.75rem', textAlign: 'center', paddingTop: 6 }}>{st.label}</div>
                            )}
                          </div>

                          {/* Popup */}
                          {isActive && (
                            <div style={{ position: 'absolute', zIndex: 200, background: 'var(--steel-2)', border: '1px solid var(--accent)', borderRadius: 10, padding: 14, width: 220, boxShadow: 'var(--shadow)', top: 60, right: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: 10 }}>{eq.name} — {format(day, 'dd/MM')}</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                                {STATUS_OPTS.map(s => (
                                  <button key={s.value} onClick={() => updateCell(eq.id, dateStr, 'status', s.value)}
                                    style={{ padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '0.75rem', border: '1px solid', background: cell.status === s.value ? s.color : 'transparent', color: cell.status === s.value ? '#fff' : s.color, borderColor: s.color }}>
                                    {s.label}
                                  </button>
                                ))}
                              </div>
                              {cell.status === 'working' ? (
                                <>
                                  <div style={{ marginBottom: 8 }}>
                                    <label style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>ساعات المورد</label>
                                    <input type="number" className="form-control" value={cell.hours} min={0} max={24} step={0.5}
                                      onChange={e => updateCell(eq.id, dateStr, 'hours', parseFloat(e.target.value) || 0)} />
                                  </div>
                                  {hasClient && (
                                    <div style={{ marginBottom: 8 }}>
                                      <label style={{ fontSize: '0.75rem', color: 'var(--info)' }}>ساعات العميل ({eq.clientName})</label>
                                      <input type="number" className="form-control" value={cell.clientHours} min={0} max={24} step={0.5}
                                        onChange={e => updateCell(eq.id, dateStr, 'clientHours', parseFloat(e.target.value) || 0)} />
                                    </div>
                                  )}
                                </>
                              ) : (
                                <div>
                                  <label style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>السبب</label>
                                  <input className="form-control" value={cell.stopReason}
                                    placeholder={cell.status === 'breakdown' ? 'وصف العطل' : 'نوع الصيانة'}
                                    onChange={e => updateCell(eq.id, dateStr, 'stopReason', e.target.value)} />
                                </div>
                              )}
                              <button className="btn btn-secondary btn-sm" style={{ marginTop: 8, width: '100%' }} onClick={() => setActiveCell(null)}>✓ تم</button>
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td style={{ padding: '8px 12px', textAlign: 'center', borderRight: '1px solid var(--border)' }}>
                      <div style={{ color: 'var(--accent)', fontWeight: 700 }}>{weekTotal} س</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>{weekCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر</div>
                    </td>
                  </tr>
                )
              })}
              {/* Total row */}
              <tr style={{ background: 'var(--accent-dim2)', borderTop: '2px solid var(--accent)' }}>
                <td style={{ padding: '10px 12px', fontWeight: 700, position: 'sticky', right: 0, background: 'var(--accent-dim2)' }}>الإجمالي</td>
                {days.map((day, i) => {
                  const dateStr  = format(day, 'yyyy-MM-dd')
                  const dayTotal = equipment.reduce((s, eq) => {
                    const cell = grid[eq.id]?.[dateStr]
                    return s + (cell?.active && cell?.status === 'working' ? (parseFloat(cell?.hours) || 0) : 0)
                  }, 0)
                  return <td key={i} style={{ padding: '10px 6px', textAlign: 'center', color: 'var(--accent)', fontWeight: 700 }}>{dayTotal} س</td>
                })}
                <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--accent)', fontWeight: 700, fontSize: '1rem' }}>
                  {equipment.reduce((s, eq) => s + days.reduce((ds, day) => {
                    const cell = grid[eq.id]?.[format(day, 'yyyy-MM-dd')]
                    return ds + (cell?.active && cell?.status === 'working' ? (parseFloat(cell?.hours) || 0) : 0)
                  }, 0), 0)} س
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {unsavedCount > 0 && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 200, display: 'flex', alignItems: 'center', gap: 12, background: 'var(--steel-2)', border: '1px solid var(--accent)', borderRadius: 40, padding: '10px 24px', boxShadow: 'var(--shadow)' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-2)' }}>{unsavedCount} تغيير غير محفوظ</span>
          <button className="btn btn-primary" onClick={saveAll} disabled={saving}>{saving ? 'جاري...' : '💾 حفظ الكل'}</button>
        </div>
      )}
    </div>
  )
}

const thStyle = { padding: '10px 8px', textAlign: 'center', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-3)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
