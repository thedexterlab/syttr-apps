import './App.css'
import { getAuthToken } from './api'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Nannies from './pages/Nannies'
import Users from './pages/Users'
import NannyProfile from './pages/NannyProfile'
import UserProfile from './pages/UserProfile'
import Jobs from './pages/Jobs'
import JobProfile from './pages/JobProfile'
import InterviewsScheduled from './pages/InterviewsScheduled'
import Payments from './pages/Payments'
import AuditLogs from './pages/AuditLogs'
import Commissions from './pages/Commissions'
import Subscriptions from './pages/Subscriptions'
import Ratings from './pages/Ratings'
import Settings from './pages/Settings'
import Disputes from './pages/Disputes'
import Profile from './pages/Profile'
import InterviewDetails from './pages/InterviewDetails'
import SupportCenter from './pages/SupportCenter'
import { clearAdminSession } from './storage'

function App() {
  const path = window.location.pathname.toLowerCase()
  const legacyAdminPath = path === '/admin' || path.startsWith('/admin/')
  const showLogin = path === '/login'
  const isAuthenticated = Boolean(getAuthToken())

  if (!isAuthenticated) {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/')
    }
    if (typeof window !== 'undefined') {
      clearAdminSession()
    }
    return <Login />
  }

  if (legacyAdminPath && typeof window !== 'undefined') {
    window.history.replaceState(null, '', '/dashboard')
  }

  if (showLogin && typeof window !== 'undefined') {
    window.history.replaceState(null, '', '/dashboard')
  }

  if (showLogin) {
    return <Login />
  }

  if (path.startsWith('/nannies/')) {
    return <NannyProfile />
  }

  if (path.startsWith('/nannies')) {
    return <Nannies />
  }

  if (path.startsWith('/users/')) {
    return <UserProfile />
  }

  if (path.startsWith('/users')) {
    return <Users />
  }

  if (path.startsWith('/jobs/')) {
    return <JobProfile />
  }

  if (path.startsWith('/jobs')) {
    return <Jobs />
  }

  if (path.startsWith('/interviews')) {
    if (path.startsWith('/interviews/')) {
      return <InterviewDetails />
    }
    return <InterviewsScheduled />
  }

  if (path.startsWith('/payments')) {
    return <Payments />
  }

  if (path.startsWith('/audit-logs')) {
    return <AuditLogs />
  }

  if (path.startsWith('/subscriptions')) {
    return <Subscriptions />
  }

  if (path.startsWith('/commissions')) {
    return <Commissions />
  }

  if (path.startsWith('/ratings')) {
    return <Ratings />
  }

  if (path.startsWith('/disputes')) {
    return <Disputes />
  }

  if (path.startsWith('/support')) {
    return <SupportCenter />
  }

  if (path.startsWith('/profile')) {
    return <Profile />
  }

  if (path.startsWith('/settings')) {
    return <Settings />
  }

  return <Dashboard />
}

export default App
