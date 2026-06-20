import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import { getAuditLogs } from '../api'

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All changes' },
  { value: 'commission', label: 'Commission' },
  { value: 'blacklist', label: 'Blacklist' },
  { value: 'verification', label: 'Verification' },
  { value: 'payout', label: 'Payouts' },
  { value: 'refund', label: 'Refunds' },
]

function AuditLogs() {
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState('loading')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')

  useEffect(() => {
    let isMounted = true

    const loadAuditLogs = async () => {
      setStatus('loading')
      try {
        const response = await getAuditLogs()
        const payload = response?.data ?? response ?? []
        const list = Array.isArray(payload) ? payload : payload?.logs ?? []
        if (isMounted) {
          setLogs(list)
          setStatus('ready')
        }
      } catch {
        if (isMounted) setStatus('error')
      }
    }

    loadAuditLogs()

    return () => {
      isMounted = false
    }
  }, [])

  const filteredLogs = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return logs.filter((item) => {
      const categoryMatch = category === 'all' || String(item.category || '').toLowerCase() === category
      if (!categoryMatch) return false
      if (!needle) return true

      return [
        item.summary,
        item.action,
        item.category,
        item.target_label,
        item.target_type,
        item.target_id,
        item.admin?.name,
        item.admin?.email,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    })
  }, [category, logs, query])

  const formatDate = (value) => {
    if (!value) return '-'
    const parsed = new Date(String(value).replace(' ', 'T'))
    if (Number.isNaN(parsed.getTime())) return String(value)
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed)
  }

  const formatSnapshot = (value) => {
    if (!value || typeof value !== 'object' || !Object.keys(value).length) return '-'
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${Array.isArray(item) ? item.join(', ') : String(item ?? '-')}`)
      .join(' | ')
  }

  return (
    <div className="dashboard-shell">
      <Sidebar />

      <div className="dash-content">
        <header className="dash-header">
          <div>
            <p className="eyebrow">Compliance</p>
            <h1>Audit logs</h1>
            <p className="lead">
              Track which admin changed commission, blacklist, verification, payouts, and refunds.
            </p>
          </div>

          <div className="header-actions">
            <div className="search">
              <input
                type="search"
                placeholder="Search by admin, user, or action"
                aria-label="Search audit logs"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="filters">
              <select
                className="filter-select"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                aria-label="Filter audit category"
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </header>

        <section className="panel table-card">
          <div className="panel-header">
            <div>
              <p className="panel-label">Admin activity</p>
              <p className="panel-title">{filteredLogs.length} log entries</p>
            </div>
            <div className="chip info">Latest 250 admin entries + payout/refund events</div>
          </div>
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Admin</th>
                  <th>Category</th>
                  <th>Target</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((item) => (
                  <tr key={item.id}>
                    <td data-label="When">{formatDate(item.created_at)}</td>
                    <td data-label="Admin">
                      <strong>{item.admin?.name || 'System'}</strong>
                      <div className="muted">{item.admin?.email || item.source || '-'}</div>
                    </td>
                    <td data-label="Category">
                      <span className="chip info">{item.category || '-'}</span>
                    </td>
                    <td data-label="Target">
                      <strong>{item.target_label || '-'}</strong>
                      <div className="muted">
                        {[item.target_type, item.target_id].filter(Boolean).join(' • ') || '-'}
                      </div>
                    </td>
                    <td data-label="Change">
                      <strong>{item.summary || item.action || '-'}</strong>
                      <div className="muted">Before: {formatSnapshot(item.before)}</div>
                      <div className="muted">After: {formatSnapshot(item.after)}</div>
                    </td>
                  </tr>
                ))}
                {status === 'loading' ? (
                  <tr>
                    <td colSpan={5}>Loading audit logs...</td>
                  </tr>
                ) : null}
                {status === 'error' ? (
                  <tr>
                    <td colSpan={5}>Unable to load audit logs.</td>
                  </tr>
                ) : null}
                {status === 'ready' && filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No audit entries matched this filter.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

export default AuditLogs
