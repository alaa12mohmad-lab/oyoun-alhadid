import { useEffect, useState, useCallback } from 'react'
import { collection, getDocs, addDoc, query, where, orderBy, deleteDoc, doc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { startOfWeek, endOfWeek, addWeeks, subWeeks, format, eachDayOfInterval, addDays } from 'date-fns'

const DAY_NAMES = ['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة']

const STATUS_OPTS = [
  { value: 'working', label: 'شغالة', color: '#3eb87a', bg: 'rgba(62,184,122,0.12)' },
  { value: 'breakdown', label: 'عطل', color: '#e05050', bg: 'rgba(224,80,80,0.12)' },
  { value: 'maintenance', label: 'صيانة', color: '#e8a020', bg: 'rgba(232,160,32,0.15)' },
  { value: 'idle', label: 'إيقاف', color: '#6b6860', bg: 'rgba(107,104,96,0.12)' },
]

function getWeekDays(weekDate) {
  const start = startOfWeek(weekDate, { weekStartsOn: 6 })
  return eachDayOfInterval({ start, end: addDays(start, 6) })
}

export default function QuickEntryPage() {
  const { userData } = useAuth()
  const isAdmin = userData?.role === 'admin'

  const [weekDate, setWeekDate] = useState(new Date())
  const [sites, setSites] = useState([])
  const [allEquipment, setAllEquipment] = useState([])
  const [selectedSite, setSelectedSite] = useState(isAdmin ? '' : userData?.siteId)
  const [defaultHours, setDefaultHours] = useState(10)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [showSuccess, setShowSuccess] = useState(false)

  // grid[equipmentId][dateStr] = { status, hours, stopReason, existing: id|null }
  const [grid, setGrid] = useState({})
  const [activeCell, setActiveCell] = useState(null) // {eqId, dateStr}

  const days = getWeekDays(weekDate)
  const weekStart = format(days[0], 'yyyy-MM-dd')
  const weekEnd = format(days[6], 'yyyy-MM-dd')

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

    // Load existing logs for this week
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

    // Build grid with defaults
    const newGrid = {}
    equipment.forEach(eq => {
      newGrid[eq.id] = {}
      days.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd')
        const existing = existingLogs[eq.id]?.[dateStr]
        newGrid[eq.id][dateStr] = existing
          ? { status: existing.status || 'working', hours: existing.hours, stopReason: existing.stopReason || '', existingId: existing.id, saved: true }
          : { status: 'working', hours: defaultHours, stopReason: '', existingId: null, saved: false }
      })
    })
    setGrid(newGrid)
  }

  function getFilteredEquipment() {
    if (!selectedSite) return allEquipment
    return allEquipment.filter(e => e.siteId === selectedSite)
  }

  function updateCell(eqId, dateStr, field, value) {
    setGrid(g => ({
      ...g,
      [eqId]: {
        ...g[eqId],
        [dateStr]: { ...g[eqId][dateStr], [field]: value, saved: false }
      }
    }))
  }

  function applyDefaultToAll() {
    const equipment = getFilteredEquipment()
    setGrid(g => {
      const newG = { ...g }
      equipment.forEach(eq => {
        days.forEach(day => {
          const dateStr = format(day, 'yyyy-MM-dd')
          if (newG[eq.id]?.[dateStr]?.status === 'working') {
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
    const eqMap = {}
    allEquipment.forEach(e => eqMap[e.id] = e)
    const siteMap = {}
    sites.forEach(s => siteMap[s.id] = s)

    let count = 0
    const batch = writeBatch(db)

    for (const eq of equipment) {
      for (const day of days) {
        const dateStr = format(day, 'yyyy-MM-dd')
        const cell = grid[eq.id]?.[dateStr]
        if (!cell || cell.saved) continue

        const eqData = eqMap[eq.id]
        const siteId = eqData?.siteId || ''
        const site = siteMap[siteId]
        const hours = cell.status === 'working' ? (parseFloat(cell.hours) || 0) : 0

        const logData = {
          equipmentId: eq.id,
          equipmentName: eqData?.name || '',
          siteId,
          siteName: site?.name || eqData?.siteName || '',
          supplierId: eqData?.supplierId || '',
          supplierName: eqData?.supplierName || '',
          hourlyRate: eqData?.hourlyRate || 0,
          hours,
          status: cell.status,
          stopReason: cell.status !== 'working' ? (cell.stopReason || '') : '',
          date: dateStr,
          notes: '',
          supervisorId: userData.uid,
          supervisorName: userData.name || userData.email,
          updatedAt: serverTimestamp(),
        }

        if (cell.existingId) {
          // Update existing
          batch.update(doc(db, 'logs', cell.existingId), logData)
        } else {
          // Create new
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
  const siteObj = sites.find(s => s.id === selectedSite)

  // Count unsaved cells
  let unsavedCount = 0
  equipment.forEach(eq => {
    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd')
      if (grid[eq.id]?.[dateStr] && !grid[eq.id][dateStr].saved) unsavedCount++
    })
  })

  if (loading) return <div className="spinner" />

  return (
    <div className="page" style={{ paddingBottom: 60 }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="page-title">⚡ إدخال سريع أسبوعي</div>
          <div className="page-sub">{equipment.length} معدة · {days.length} أيام</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {unsavedCount > 0 && (
            <span className="badge badge-gold">{unsavedCount} خلية غير محفوظة</span>
          )}
          <button className="btn btn-primary" onClick={saveAll} disabled={saving || unsavedCount === 0}
            style={{ padding: '9px 24px' }}>
            {saving ? 'جاري الحفظ...' : `💾 حفظ الكل (${unsavedCount})`}
          </button>
        </div>
      </div>

      {showSuccess && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          ✅ تم حفظ {savedCount} سجل بنجاح
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {/* Week navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setWeekDate(d => subWeeks(d, 1))}>→</button>
          <div style={{
            background: 'var(--steel-3)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', padding: '6px 14px', fontSize: '0.85rem', fontWeight: 500
          }}>
            {format(days[0], 'dd/MM')} — {format(days[6], 'dd/MM/yyyy')}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setWeekDate(d => addWeeks(d, 1))}>←</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setWeekDate(new Date())}>الأسبوع الحالي</button>
        </div>

        {/* Site filter (admin) */}
        {isAdmin && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="form-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>الموقع:</label>
            <select className="form-control" style={{ minWidth: 160 }} value={selectedSite}
              onChange={e => { setSelectedSite(e.target.value) }}>
              <option value="">كل المواقع</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {/* Default hours */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className="form-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>ساعات افتراضية:</label>
          <input type="number" className="form-control" style={{ width: 80 }}
            value={defaultHours} min={1} max={24} step={0.5}
            onChange={e => setDefaultHours(parseFloat(e.target.value) || 10)} />
          <button className="btn btn-secondary btn-sm" onClick={applyDefaultToAll}>تطبيق على الكل</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        {STATUS_OPTS.map(s => (
          <div key={s.value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-2)' }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: s.color }} />
            {s.label}
          </div>
        ))}
        <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginRight: 'auto' }}>
          💡 اضغط على أي خلية لتغيير الحالة
        </div>
      </div>

      {/* Grid */}
      {equipment.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🏗️</div><div className="empty-text">لا توجد معدات{selectedSite ? ' في هذا الموقع' : ''}</div></div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 700 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 160, position: 'sticky', right: 0, background: 'var(--steel-2)', zIndex: 2 }}>
                  المعدة
                </th>
                {days.map((day, i) => (
                  <th key={i} style={{
                    ...thStyle,
                    background: format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') ? 'var(--accent-dim)' : 'var(--steel-2)',
                    color: format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') ? 'var(--accent)' : 'var(--text-3)',
                  }}>
                    <div>{DAY_NAMES[i]}</div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 400 }}>{format(day, 'dd/MM')}</div>
                  </th>
                ))}
                <th style={{ ...thStyle, background: 'var(--steel-2)' }}>إجمالي الأسبوع</th>
              </tr>
            </thead>
            <tbody>
              {equipment.map(eq => {
                const weekTotal = days.reduce((s, day) => {
                  const cell = grid[eq.id]?.[format(day, 'yyyy-MM-dd')]
                  return s + (cell?.status === 'working' ? (parseFloat(cell?.hours) || 0) : 0)
                }, 0)
                const weekCost = weekTotal * (eq.hourlyRate || 0)

                return (
                  <tr key={eq.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    {/* Equipment name */}
                    <td style={{
                      padding: '8px 12px', fontWeight: 600, fontSize: '0.85rem',
                      position: 'sticky', right: 0, background: 'var(--steel-2)', zIndex: 1,
                      borderLeft: '1px solid var(--border)',
                    }}>
                      <div>{eq.name}</div>
                      {isAdmin && <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', fontWeight: 400 }}>{eq.siteName}</div>}
                    </td>

                    {/* Day cells */}
                    {days.map((day, i) => {
                      const dateStr = format(day, 'yyyy-MM-dd')
                      const cell = grid[eq.id]?.[dateStr] || { status: 'working', hours: defaultHours, stopReason: '' }
                      const st = STATUS_OPTS.find(s => s.value === cell.status) || STATUS_OPTS[0]
                      const isActive = activeCell?.eqId === eq.id && activeCell?.dateStr === dateStr

                      return (
                        <td key={i} style={{ padding: 4, verticalAlign: 'top', minWidth: 90 }}>
                          <div
                            onClick={() => setActiveCell(isActive ? null : { eqId: eq.id, dateStr })}
                            style={{
                              borderRadius: 6, padding: '6px 8px', cursor: 'pointer',
                              background: cell.saved ? 'rgba(62,184,122,0.06)' : st.bg,
                              border: `1px solid ${isActive ? 'var(--accent)' : cell.saved ? 'rgba(62,184,122,0.2)' : 'var(--border)'}`,
                              transition: 'all 0.15s', minHeight: 52,
                            }}>
                            {cell.status === 'working' ? (
                              <input
                                type="number"
                                value={cell.hours}
                                min={0} max={24} step={0.5}
                                onClick={e => e.stopPropagation()}
                                onChange={e => updateCell(eq.id, dateStr, 'hours', parseFloat(e.target.value) || 0)}
                                style={{
                                  width: '100%', background: 'transparent', border: 'none',
                                  color: st.color, fontWeight: 700, fontSize: '1rem',
                                  fontFamily: 'var(--font)', textAlign: 'center', outline: 'none',
                                }}
                              />
                            ) : (
                              <div style={{ color: st.color, fontWeight: 600, fontSize: '0.78rem', textAlign: 'center', paddingTop: 4 }}>
                                {st.label}
                              </div>
                            )}
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', textAlign: 'center' }}>
                              {cell.status === 'working' ? 'س' : cell.stopReason ? cell.stopReason.substring(0, 8) + '...' : 'اضغط للتفاصيل'}
                            </div>
                          </div>

                          {/* Expanded cell controls */}
                          {isActive && (
                            <div style={{
                              position: 'absolute', zIndex: 100,
                              background: 'var(--steel-2)', border: '1px solid var(--accent)',
                              borderRadius: 10, padding: 14, width: 200,
                              boxShadow: 'var(--shadow)',
                            }}>
                              <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: 10 }}>
                                {eq.name} — {format(day, 'dd/MM')}
                              </div>
                              {/* Status buttons */}
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                                {STATUS_OPTS.map(s => (
                                  <button key={s.value} onClick={() => updateCell(eq.id, dateStr, 'status', s.value)}
                                    style={{
                                      padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                                      fontFamily: 'var(--font)', fontSize: '0.75rem', border: '1px solid',
                                      background: cell.status === s.value ? s.color : 'transparent',
                                      color: cell.status === s.value ? '#fff' : s.color,
                                      borderColor: s.color,
                                    }}>
                                    {s.label}
                                  </button>
                                ))}
                              </div>
                              {cell.status === 'working' ? (
                                <div>
                                  <label style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>الساعات</label>
                                  <input type="number" className="form-control"
                                    value={cell.hours} min={0} max={24} step={0.5}
                                    onChange={e => updateCell(eq.id, dateStr, 'hours', parseFloat(e.target.value) || 0)} />
                                </div>
                              ) : (
                                <div>
                                  <label style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>السبب</label>
                                  <input className="form-control"
                                    value={cell.stopReason}
                                    placeholder={cell.status === 'breakdown' ? 'وصف العطل' : 'نوع الصيانة'}
                                    onChange={e => updateCell(eq.id, dateStr, 'stopReason', e.target.value)} />
                                </div>
                              )}
                              <button className="btn btn-secondary btn-sm" style={{ marginTop: 8, width: '100%' }}
                                onClick={() => setActiveCell(null)}>
                                ✓ تم
                              </button>
                            </div>
                          )}
                        </td>
                      )
                    })}

                    {/* Weekly total */}
                    <td style={{ padding: '8px 12px', textAlign: 'center', borderRight: '1px solid var(--border)' }}>
                      <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.95rem' }}>{weekTotal} س</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                        {weekCost.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر
                      </div>
                    </td>
                  </tr>
                )
              })}

              {/* Total row */}
              <tr style={{ background: 'var(--accent-dim2)', borderTop: '2px solid var(--accent)' }}>
                <td style={{
                  padding: '10px 12px', fontWeight: 700, fontSize: '0.85rem',
                  position: 'sticky', right: 0, background: 'var(--accent-dim2)',
                }}>
                  إجمالي اليوم
                </td>
                {days.map((day, i) => {
                  const dateStr = format(day, 'yyyy-MM-dd')
                  const dayTotal = equipment.reduce((s, eq) => {
                    const cell = grid[eq.id]?.[dateStr]
                    return s + (cell?.status === 'working' ? (parseFloat(cell?.hours) || 0) : 0)
                  }, 0)
                  return (
                    <td key={i} style={{ padding: '10px 6px', textAlign: 'center' }}>
                      <div style={{ color: 'var(--accent)', fontWeight: 700 }}>{dayTotal} س</div>
                    </td>
                  )
                })}
                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '1rem' }}>
                    {equipment.reduce((s, eq) => s + days.reduce((ds, day) => {
                      const cell = grid[eq.id]?.[format(day, 'yyyy-MM-dd')]
                      return ds + (cell?.status === 'working' ? (parseFloat(cell?.hours) || 0) : 0)
                    }, 0), 0)} س
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Sticky save button */}
      {unsavedCount > 0 && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          zIndex: 200, display: 'flex', alignItems: 'center', gap: 12,
          background: 'var(--steel-2)', border: '1px solid var(--accent)',
          borderRadius: 40, padding: '10px 24px', boxShadow: 'var(--shadow)',
        }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-2)' }}>{unsavedCount} تغيير غير محفوظ</span>
          <button className="btn btn-primary" onClick={saveAll} disabled={saving}>
            {saving ? 'جاري الحفظ...' : '💾 حفظ الكل'}
          </button>
        </div>
      )}
    </div>
  )
}

const thStyle = {
  padding: '10px 8px', textAlign: 'center',
  fontSize: '0.78rem', fontWeight: 600,
  color: 'var(--text-3)', borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
}
