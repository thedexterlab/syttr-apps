import { useMemo, useState } from 'react'
import brandLogo from '../../assets/app-logo.png'
import dashboardIcon from '../../assets/icons/home_filled.svg'
import nanniesIcon from '../../assets/icons/profile.svg'
import usersIcon from '../../assets/icons/profile_add.svg'
import paymentIcon from '../../assets/icons/card.svg'
import jobsIcon from '../../assets/icons/brifecase_cross.svg'
import interviewsIcon from '../../assets/icons/calendar_filled.svg'
import commissionIcon from '../../assets/icons/dollar_circle.svg'
import clipboardIcon from '../../assets/icons/clipboard-text.svg'
import contactIcon from '../../assets/icons/message.svg'
import logoutIcon from '../../assets/icons/logout.svg'
import ratingsIcon from '../../assets/icons/star.svg'
import { clearAdminSession, readStoredAdminUser } from '../storage'

const navLinks = (onLogout, currentPath) => [
  { label: 'Dashboard', icon: dashboardIcon, path: '/dashboard', active: currentPath === '/' || currentPath === '/dashboard' },
  { label: 'Syttr Management', icon: nanniesIcon, path: '/nannies' },
  { label: 'Parents Management', icon: usersIcon, path: '/users' },
  { label: 'Interviews Scheduled', icon: interviewsIcon, path: '/interviews' },
    { label: 'Jobs Management', icon: jobsIcon, path: '/jobs' },
  { label: 'Subscription Plans', icon: paymentIcon, path: '/subscriptions' },
  { label: 'Commission Management', icon: commissionIcon, path: '/commissions' },
  { label: 'Ratings Management', icon: ratingsIcon, path: '/ratings' },
  { label: 'Audit Logs', icon: clipboardIcon, path: '/audit-logs' },
  { label: 'Support Center', icon: contactIcon, path: '/support' },
  // { label: 'Disputes Management', icon: disputesIcon, path: '/disputes' },
  // { label: 'Settings', icon: settingsIcon, path: '/settings' },
  { label: 'Logout', icon: logoutIcon, tone: 'logout', action: onLogout },
].map((link) => ({
  ...link,
  active: link.active || (link.path ? currentPath.startsWith(link.path) : false),
}))

function Sidebar({ user }) {
  const currentPath = window.location.pathname.toLowerCase()
  const [logoutState, setLogoutState] = useState({ type: null, message: '', loading: false })
  const [isOpen, setIsOpen] = useState(false)
  const displayUser = useMemo(
    () =>
      user && (user.name || user.email)
        ? user
        : readStoredAdminUser() || { name: 'Ariana Khan', email: 'ariana.khan@syttr.com' },
    [user],
  )
  const initials = useMemo(() => {
    if (!displayUser.name) return 'SY'
    return displayUser.name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase()
  }, [displayUser.name])

  const handleLogout = () => {
    if (logoutState.loading) return
    setLogoutState({ type: 'success', message: 'Redirecting to login...', loading: true })
    clearAdminSession()
    document.body.classList.add('page-fade')
    setTimeout(() => {
      window.location.href = '/login'
    }, 350)
  }

  const toggleSidebar = () => {
    setIsOpen((prev) => !prev)
  }

  const closeSidebar = () => {
    setIsOpen(false)
  }

  return (
    <>
      <button type="button" className="sidebar-toggle" onClick={toggleSidebar}>
        {isOpen ? 'Close menu' : 'Open menu'}
      </button>
      {isOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={closeSidebar}
          aria-label="Close sidebar"
        />
      ) : null}
      <aside className={`sidebar${isOpen ? ' is-open' : ''}`}>
      <div className="brand-row">
        <img src={brandLogo} alt="SYTTR logo" className="sidebar-logo" />
        <div>
          <p className="brand-title">SYTTR Admin</p>
          <p className="brand-subtitle">Ops Console</p>
        </div>
      </div>

      <button type="button" className="user-block user-button" onClick={() => (window.location.href = '/profile')}>
        <div className="avatar user-avatar">{initials}</div>
        <div className="user-info">
          <p className="user-name">{displayUser.name}</p>
          <p className="user-email">{displayUser.email}</p>
        </div>
      </button>

      <nav className="nav">
        {navLinks(handleLogout, currentPath).map((link) => {
          const content = (
            <>
              <div className="nav-left">
                <img src={link.icon} alt="" aria-hidden="true" />
                <span>{link.label}</span>
              </div>
              {link.badge ? <span className="nav-badge">{link.badge}</span> : null}
            </>
          )

          if (link.action) {
            return (
              <button
                key={link.label}
                type="button"
                onClick={link.action}
                disabled={logoutState.loading}
                className={`nav-item${link.active ? ' active' : ''}${
                  link.tone === 'logout' ? ' logout' : ''
                }`}
              >
                {content}
              </button>
            )
          }

          return (
              <a
                key={link.label}
                href={link.path || '#'}
                className={`nav-item${link.active ? ' active' : ''}${
                  link.tone === 'logout' ? ' logout' : ''
                }`}
              >
                {content}
              </a>
            )
          })}
      </nav>

      {logoutState.message ? (
        <div className={`status ${logoutState.type === 'error' ? 'error' : 'success'}`}>
          {logoutState.message}
        </div>
      ) : null}

      
    </aside>
    </>
  )
}

export default Sidebar
