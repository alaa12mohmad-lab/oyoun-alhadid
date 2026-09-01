import { useAuth } from '../../hooks/useAuth'

const adminNav = [
  { section: 'الرئيسية', items: [
    { id: 'dashboard',      label: 'لوحة التحكم',        icon: '📊' },
    { id: 'quickentry',     label: 'إدخال سريع أسبوعي',  icon: '⚡' },
    { id: 'log',            label: 'تسجيل يومي',          icon: '⏱️' },
  ]},
  { section: 'التقارير', items: [
    { id: 'reports',        label: 'التقارير الأسبوعية',  icon: '📋' },
    { id: 'managerreport',  label: 'تقرير المدير',         icon: '📨' },
    { id: 'supplierreport', label: 'تقرير المورد',         icon: '🏢' },
    { id: 'pdf',            label: 'تقرير PDF مخصص',      icon: '📄' },
  ]},
  { section: 'الإدارة', items: [
    { id: 'equipment',      label: 'المعدات',              icon: '🏗️' },
    { id: 'sites',          label: 'المواقع',              icon: '📍' },
    { id: 'suppliers',      label: 'الموردون',             icon: '🏢' },
    { id: 'users',          label: 'المستخدمون',           icon: '👥' },
  ]},
]

const supervisorNav = [
  { section: 'الرئيسية', items: [
    { id: 'dashboard',  label: 'موقعي',                icon: '📊' },
    { id: 'quickentry', label: 'إدخال سريع أسبوعي',  icon: '⚡' },
    { id: 'log',        label: 'تسجيل يومي',          icon: '⏱️' },
    { id: 'history',    label: 'التقارير الأسبوعية',  icon: '📋' },
    { id: 'pdf',        label: 'تقرير PDF',            icon: '📄' },
  ]},
]

const viewerNav = [
  { section: 'التقارير', items: [
    { id: 'reports', label: 'التقارير الأسبوعية', icon: '📋' },
    { id: 'pdf',     label: 'تقرير PDF',           icon: '📄' },
  ]},
]

export default function Sidebar({ activePage, setActivePage }) {
  const { userData, logout } = useAuth()
  if (!userData) return null

  const role = userData.role
  const nav  = role === 'admin' ? adminNav : role === 'supervisor' ? supervisorNav : viewerNav

  const roleBadge = role === 'admin'
    ? { label: 'مدير النظام', cls: 'badge-gold' }
    : role === 'supervisor'
    ? { label: 'مشرف موقع',  cls: 'badge-blue' }
    : { label: 'مشاهد',       cls: 'badge-gray' }

  const initials = (userData.name || userData.email || 'U').charAt(0).toUpperCase()

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '1.4rem' }}>⚙️</span>
          <div>
            <div className="brand-name">عيون الحديد</div>
            <div className="brand-sub">متابعة المعدات</div>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {nav.map(section => (
          <div key={section.section}>
            <div className="nav-section-label">{section.section}</div>
            {section.items.map(item => (
              <button key={item.id}
                className={`nav-item ${activePage === item.id ? 'active' : ''}`}
                onClick={() => setActivePage(item.id)}>
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-user">
        <div className="user-info">
          <div className="user-avatar">{initials}</div>
          <div>
            <div className="user-name">{userData.name || userData.email?.split('@')[0]}</div>
            <span className={`badge ${roleBadge.cls}`} style={{ fontSize: '0.68rem', padding: '1px 7px' }}>
              {roleBadge.label}
            </span>
            {userData.siteName && (
              <div className="user-role" style={{ marginTop: 2 }}>📍 {userData.siteName}</div>
            )}
          </div>
          <button className="logout-btn" onClick={logout} title="خروج">🚪</button>
        </div>
      </div>
    </aside>
  )
}
