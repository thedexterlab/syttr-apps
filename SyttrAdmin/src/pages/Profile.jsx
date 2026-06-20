import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import { getAuditLogs } from '../api'
import { ADMIN_SESSION_STORAGE_KEY, readStoredAdminUser } from '../storage'

const formatDate = (value) => {
  if (!value) return '-'
  const parsed = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return String(value)
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

const readStoredSession = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function Profile() {
  const [displayUser] = useState(readStoredAdminUser() || { name: 'Admin user', email: '' })
  const [activity, setActivity] = useState([])
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    let isMounted = true

    const loadActivity = async () => {
      try {
        const response = await getAuditLogs()
        const payload = response?.data ?? response ?? []
        const logs = Array.isArray(payload) ? payload : []
        if (!isMounted) return

        const normalizedEmail = String(displayUser.email || '').trim().toLowerCase()
        const normalizedName = String(displayUser.name || '').trim().toLowerCase()
        const mine = logs.filter((item) => {
          const adminEmail = String(item?.admin?.email || '').trim().toLowerCase()
          const adminName = String(item?.admin?.name || '').trim().toLowerCase()
          if (normalizedEmail && adminEmail === normalizedEmail) return true
          if (normalizedName && adminName === normalizedName) return true
          return false
        })

        setActivity(mine)
        setStatus('ready')
      } catch {
        if (isMounted) {
          setActivity([])
          setStatus('error')
        }
      }
    }

    loadActivity()

    return () => {
      isMounted = false
    }
  }, [displayUser.email, displayUser.name])

  const session = useMemo(() => readStoredSession(), [])

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

  const activitySummary = useMemo(() => {
    const categories = new Map()
    activity.forEach((item) => {
      const key = String(item?.category || 'other').trim() || 'other'
      categories.set(key, (categories.get(key) || 0) + 1)
    })

    return Array.from(categories.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
  }, [activity])

  return (
    <div className="dashboard-shell">
      <Sidebar />

      <div className="dash-content profile-content">
        <header className="dash-header">
          <div>
            <p className="eyebrow">Profile</p>
            <h1>Admin profile</h1>
            <p className="lead">View the current admin session and recent console activity.</p>
          </div>
          <div className="header-actions">
            <button
              className="pill-btn ghost"
              type="button"
              onClick={() => {
                window.location.href = '/dashboard'
              }}
            >
              Back to dashboard
            </button>
          </div>
        </header>

        <section className="stat-grid">
          <article className="stat-card">
            <div className="stat-top">
              <p className="stat-label">Admin name</p>
              <span className="dot positive" />
            </div>
            <p className="stat-value small">{displayUser.name || '-'}</p>
            <p className="stat-detail">Loaded from the current admin session</p>
          </article>
          <article className="stat-card">
            <div className="stat-top">
              <p className="stat-label">Email</p>
              <span className="dot info" />
            </div>
            <p className="stat-value small">{displayUser.email || '-'}</p>
            <p className="stat-detail">Active authenticated console account</p>
          </article>
          <article className="stat-card">
            <div className="stat-top">
              <p className="stat-label">Recent actions</p>
              <span className="dot warning" />
            </div>
            <p className="stat-value">{activity.length}</p>
            <p className="stat-detail">Audit entries linked to this admin</p>
          </article>
          <article className="stat-card">
            <div className="stat-top">
              <p className="stat-label">Session state</p>
              <span className="dot positive" />
            </div>
            <p className="stat-value small">{session?.token ? 'Authenticated' : 'Stored locally'}</p>
            <p className="stat-detail">Workspace: SYTTR Admin</p>
          </article>
        </section>

        <section className="grid-2">
          <section className="panel profile-panel">
            <div className="profile-grid">
              <div className="profile-detail-list">
                <div className="profile-detail-row">
                  <span className="profile-detail-label">Name</span>
                  <span className="profile-detail-value">{displayUser.name || '-'}</span>
                </div>
                <div className="profile-detail-row">
                  <span className="profile-detail-label">Email</span>
                  <span className="profile-detail-value">{displayUser.email || '-'}</span>
                </div>
                <div className="profile-detail-row">
                  <span className="profile-detail-label">Role</span>
                  <span className="profile-detail-value">Administrator</span>
                </div>
                <div className="profile-detail-row">
                  <span className="profile-detail-label">Workspace</span>
                  <span className="profile-detail-value">SYTTR Admin Console</span>
                </div>
                <div className="profile-detail-row">
                  <span className="profile-detail-label">Session token</span>
                  <span className="profile-detail-value">{session?.token ? 'Present' : 'Unavailable'}</span>
                </div>
              </div>
              <div className="profile-side">
                <div className="profile-image placeholder">{initials}</div>
                <div className="profile-side-card">
                  <p className="panel-label">Account status</p>
                  <span className="chip positive">Active</span>
                  <p className="panel-label">Top activity</p>
                  {activitySummary.length ? (
                    activitySummary.map(([label, count]) => (
                      <p key={label} className="profile-side-value">
                        {label}: {count}
                      </p>
                    ))
                  ) : (
                    <p className="profile-side-value">No audit activity yet</p>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="panel table-card">
            <div className="panel-header">
              <div>
                <p className="panel-label">Audit</p>
                <p className="panel-title">Recent activity by this admin</p>
              </div>
              <div className="chip info">{activity.length} entries</div>
            </div>
            <div className="table-wrap">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Category</th>
                    <th>Target</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((item) => (
                    <tr key={item.id}>
                      <td data-label="When">{formatDate(item.created_at)}</td>
                      <td data-label="Category">
                        <span className="chip info">{item.category || '-'}</span>
                      </td>
                      <td data-label="Target">{item.target_label || item.target_type || '-'}</td>
                      <td data-label="Summary">{item.summary || item.action || '-'}</td>
                    </tr>
                  ))}
                  {status === 'loading' ? (
                    <tr>
                      <td colSpan={4}>Loading activity...</td>
                    </tr>
                  ) : null}
                  {status === 'error' ? (
                    <tr>
                      <td colSpan={4}>Unable to load audit activity.</td>
                    </tr>
                  ) : null}
                  {status === 'ready' && !activity.length ? (
                    <tr>
                      <td colSpan={4}>No audit activity linked to this admin yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </div>
  )
}

export default Profile
