import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import Sidebar from './components/shared/Sidebar'
import LoginPage from './pages/LoginPage'
import AdminDashboard from './pages/AdminDashboard'
import EquipmentPage from './pages/EquipmentPage'
import SitesPage from './pages/SitesPage'
import SuppliersPage from './pages/SuppliersPage'
import UsersPage from './pages/UsersPage'
import ReportsPage from './pages/ReportsPage'
import LogPage from './pages/LogPage'
import SupervisorDashboard from './pages/SupervisorDashboard'
import PdfReportPage from './pages/PdfReportPage'
import QuickEntryPage from './pages/QuickEntryPage'
import ManagerReportPage from './pages/ManagerReportPage'
import SupplierReportPage from './pages/SupplierReportPage'

function LoadingScreen() {
  return (
    <div className="loading-page">
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: 16 }}>⚙️</div>
        <div className="spinner" />
        <div style={{ color: 'var(--text-3)', fontSize: '0.85rem', marginTop: 8 }}>جاري التحميل...</div>
      </div>
    </div>
  )
}

export default function App() {
  const { user, userData, loading } = useAuth()
  const [activePage, setActivePage] = useState('dashboard')

  if (loading) return <LoadingScreen />
  if (!user || !userData) return <LoginPage />

  const role = userData.role

  function renderPage() {
    if (role === 'admin') {
      switch (activePage) {
        case 'dashboard':       return <AdminDashboard setActivePage={setActivePage} />
        case 'quickentry':      return <QuickEntryPage />
        case 'log':             return <LogPage />
        case 'reports':         return <ReportsPage />
        case 'managerreport':   return <ManagerReportPage />
        case 'supplierreport':  return <SupplierReportPage />
        case 'pdf':             return <PdfReportPage />
        case 'equipment':       return <EquipmentPage />
        case 'sites':           return <SitesPage />
        case 'suppliers':       return <SuppliersPage />
        case 'users':           return <UsersPage />
        default:                return <AdminDashboard setActivePage={setActivePage} />
      }
    }
    if (role === 'supervisor') {
      switch (activePage) {
        case 'dashboard':       return <SupervisorDashboard setActivePage={setActivePage} />
        case 'quickentry':      return <QuickEntryPage />
        case 'log':             return <LogPage />
        case 'history':         return <ReportsPage />
        case 'pdf':             return <PdfReportPage />
        default:                return <SupervisorDashboard setActivePage={setActivePage} />
      }
    }
    switch (activePage) {
      case 'pdf':   return <PdfReportPage />
      default:      return <ReportsPage />
    }
  }

  return (
    <div className="app-layout">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />
      <main className="main-content">{renderPage()}</main>
    </div>
  )
}
