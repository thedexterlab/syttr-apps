import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import {
  getAuditLogs,
  getCurrentPlatformFee,
  getSubscriptionManagement,
  getSubscriptionStatus,
  getSupportMessages,
} from '../api'
import { readStoredAdminUser } from '../storage'

const settingsLinks = [
  {
    slug: 'general',
    label: 'General',
    description: 'Workspace and session snapshot',
    path: '/settings',
  },
  {
    slug: 'team',
    label: 'Team & roles',
    description: 'Active admins derived from audit activity',
    path: '/settings/team',
  },
  {
    slug: 'security',
    label: 'Security',
    description: 'Compliance and high-risk audit activity',
    path: '/settings/security',
  },
  {
    slug: 'notifications',
    label: 'Notifications',
    description: 'Operational alerts from the live support queue',
    path: '/settings/notifications',
  },
  {
    slug: 'billing',
    label: 'Billing',
    description: 'Subscription, commission, and revenue overview',
    path: '/settings/billing',
  },
]

const emptyManagement = {
  summary: {
    total_earnings: 0,
    recurring_revenue: 0,
    average_cost: 0,
    active_subscriptions: 0,
    successful_transactions: 0,
    total_transactions: 0,
    currency: 'USD',
  },
  plans: [],
  active_subscribers: [],
  transactions: [],
}

const emptySupportSummary = {
  open_inbox: 0,
  closed_inbox: 0,
  total: 0,
}

const normalizeManagement = (data) => ({
  summary: {
    ...emptyManagement.summary,
    ...(data?.summary ?? {}),
  },
  plans: Array.isArray(data?.plans) ? data.plans : [],
  active_subscribers: Array.isArray(data?.active_subscribers) ? data.active_subscribers : [],
  transactions: Array.isArray(data?.transactions) ? data.transactions : [],
})

const normalizeSubscriptionStatus = (value) => {
  const text = String(value || '').trim()
  if (!text) return 'Unknown'
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const formatMoney = (amount, currency = 'USD') => {
  const numeric = Number(amount || 0)
  const code = String(currency || 'USD').toUpperCase()
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(numeric) ? numeric : 0)
}

const formatDate = (value) => {
  if (!value) return '-'
  const parsed = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return String(value)
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

const getTone = (value) => {
  const normalized = String(value || '').toLowerCase()
  if (
    normalized.includes('active') ||
    normalized.includes('paid') ||
    normalized.includes('success') ||
    normalized.includes('resolved')
  ) {
    return 'positive'
  }
  if (
    normalized.includes('failed') ||
    normalized.includes('blocked') ||
    normalized.includes('alert') ||
    normalized.includes('critical')
  ) {
    return 'alert'
  }
  if (
    normalized.includes('pending') ||
    normalized.includes('review') ||
    normalized.includes('warning')
  ) {
    return 'warning'
  }
  return 'info'
}

const hoursSince = (value) => {
  if (!value) return null
  const parsed = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return null
  return Math.max(0, (Date.now() - parsed.getTime()) / (1000 * 60 * 60))
}

const isOperationalAlert = (item) => {
  const haystack = [
    item?.category,
    item?.subject,
    item?.message,
    item?.status,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return (
    haystack.includes('urgent') ||
    haystack.includes('payment') ||
    haystack.includes('refund') ||
    haystack.includes('fraud') ||
    haystack.includes('complaint') ||
    haystack.includes('chargeback') ||
    haystack.includes('safety')
  )
}

function Settings() {
  const [workspaceStatus, setWorkspaceStatus] = useState('loading')
  const [subscriptionStatus, setSubscriptionStatus] = useState('Unknown')
  const [management, setManagement] = useState(emptyManagement)
  const [currentFee, setCurrentFee] = useState({ type: '', value: '' })
  const [supportMessages, setSupportMessages] = useState([])
  const [supportSummary, setSupportSummary] = useState(emptySupportSummary)
  const [auditLogs, setAuditLogs] = useState([])
  const [adminUser, setAdminUser] = useState(readStoredAdminUser() || { name: 'Admin user', email: '' })

  const path = window.location.pathname.toLowerCase()
  const segments = path.split('/').filter(Boolean)
  const settingsIndex = segments.indexOf('settings')
  const slug = settingsIndex >= 0 ? segments[settingsIndex + 1] : null
  const activeSlug = settingsLinks.some((link) => link.slug === slug) ? slug : 'general'

  const loadWorkspaceData = async (options = {}) => {
    const { showLoading = true } = options
    if (showLoading) {
      setWorkspaceStatus('loading')
    }

    const [statusResult, managementResult, feeResult, supportResult, auditResult] =
      await Promise.allSettled([
        getSubscriptionStatus(),
        getSubscriptionManagement(),
        getCurrentPlatformFee(),
        getSupportMessages(),
        getAuditLogs(),
      ])

    if (statusResult.status === 'fulfilled') {
      const response = statusResult.value
      const status =
        response?.status ??
        response?.data?.status ??
        response?.subscription_status ??
        response?.data?.subscription_status ??
        null
      setSubscriptionStatus(normalizeSubscriptionStatus(status))
    } else {
      setSubscriptionStatus('Unavailable')
    }

    if (managementResult.status === 'fulfilled') {
      setManagement(normalizeManagement(managementResult.value?.data ?? managementResult.value ?? emptyManagement))
    } else {
      setManagement(emptyManagement)
    }

    if (feeResult.status === 'fulfilled') {
      const payload = feeResult.value?.data ?? feeResult.value ?? null
      setCurrentFee({
        type: payload?.type ?? payload?.current?.type ?? '',
        value: payload?.value ?? payload?.current?.value ?? '',
      })
    } else {
      setCurrentFee({ type: '', value: '' })
    }

    if (supportResult.status === 'fulfilled') {
      setSupportMessages(Array.isArray(supportResult.value?.data) ? supportResult.value.data : [])
      setSupportSummary({
        ...emptySupportSummary,
        ...(supportResult.value?.summary || {}),
      })
    } else {
      setSupportMessages([])
      setSupportSummary(emptySupportSummary)
    }

    if (auditResult.status === 'fulfilled') {
      const payload = auditResult.value?.data ?? auditResult.value ?? []
      setAuditLogs(Array.isArray(payload) ? payload : [])
    } else {
      setAuditLogs([])
    }

    setAdminUser(readStoredAdminUser() || { name: 'Admin user', email: '' })
    setWorkspaceStatus('ready')
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadWorkspaceData({ showLoading: false })
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [])

  const financeSummary = management.summary || emptyManagement.summary

  const uniqueAdmins = useMemo(() => {
    const index = new Map()
    auditLogs.forEach((item) => {
      const email = String(item?.admin?.email || '').trim()
      const name = String(item?.admin?.name || 'Unknown admin').trim()
      const key = email || name
      if (!key) return
      const current = index.get(key) || {
        name,
        email,
        actionCount: 0,
        lastActive: null,
      }
      current.actionCount += 1
      current.lastActive = current.lastActive || item?.created_at
      if (item?.created_at && new Date(item.created_at) > new Date(current.lastActive || 0)) {
        current.lastActive = item.created_at
      }
      index.set(key, current)
    })

    return Array.from(index.values()).sort((a, b) => b.actionCount - a.actionCount)
  }, [auditLogs])

  const securityEvents = useMemo(
    () =>
      auditLogs
        .filter((item) => {
          const category = String(item?.category || '').toLowerCase()
          return ['verification', 'blacklist', 'refund', 'payout', 'commission'].includes(category)
        })
        .slice(0, 20),
    [auditLogs],
  )

  const alertRows = useMemo(
    () =>
      supportMessages
        .filter((item) => {
          const status = String(item?.status_key || item?.status || '').toLowerCase()
          const ageHours = hoursSince(item?.received_at || item?.created_at)
          return status !== 'closed' && (isOperationalAlert(item) || (ageHours !== null && ageHours >= 24))
        })
        .slice(0, 20),
    [supportMessages],
  )

  const categoryBreakdown = useMemo(() => {
    const buckets = new Map()
    supportMessages.forEach((item) => {
      const key = String(item?.category || 'contact').trim() || 'contact'
      buckets.set(key, (buckets.get(key) || 0) + 1)
    })
    return Array.from(buckets.entries()).sort((a, b) => b[1] - a[1])
  }, [supportMessages])

  const currentFeeLabel = useMemo(() => {
    if (!currentFee.type || currentFee.value === '') return 'Unavailable'
    if (currentFee.type === 'flat') return `${formatMoney(currentFee.value)} per transaction`
    return `${currentFee.value}% platform fee`
  }, [currentFee])

  const renderSection = () => {
    if (activeSlug === 'team') {
      return (
        <>
          <section className="stat-grid">
            <article className="stat-card">
              <div className="stat-top">
                <p className="stat-label">Active admins</p>
                <span className="dot positive" />
              </div>
              <p className="stat-value">{uniqueAdmins.length}</p>
              <p className="stat-detail">Derived from recent audit activity</p>
            </article>
            <article className="stat-card">
              <div className="stat-top">
                <p className="stat-label">Audit entries</p>
                <span className="dot info" />
              </div>
              <p className="stat-value">{auditLogs.length}</p>
              <p className="stat-detail">Latest 250 admin and system events</p>
            </article>
          </section>

          <section className="panel table-card">
            <div className="panel-header">
              <div>
                <p className="panel-label">Admin team</p>
                <p className="panel-title">Observed console operators</p>
              </div>
              <div className="chip info">{uniqueAdmins.length} admins</div>
            </div>
            <div className="table-wrap">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Actions</th>
                    <th>Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {uniqueAdmins.map((member) => (
                    <tr key={member.email || member.name}>
                      <td data-label="Name">{member.name || '-'}</td>
                      <td data-label="Email">{member.email || '-'}</td>
                      <td data-label="Actions">{member.actionCount}</td>
                      <td data-label="Last active">{formatDate(member.lastActive)}</td>
                    </tr>
                  ))}
                  {!uniqueAdmins.length ? (
                    <tr>
                      <td colSpan={4}>No admin activity has been recorded yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )
    }

    if (activeSlug === 'security') {
      return (
        <>
          <section className="stat-grid">
            <article className="stat-card">
              <div className="stat-top">
                <p className="stat-label">Security events</p>
                <span className="dot alert" />
              </div>
              <p className="stat-value">{securityEvents.length}</p>
              <p className="stat-detail">Compliance-relevant audit rows</p>
            </article>
            <article className="stat-card">
              <div className="stat-top">
                <p className="stat-label">Current operator</p>
                <span className="dot info" />
              </div>
              <p className="stat-value small">{adminUser.name || '-'}</p>
              <p className="stat-detail">{adminUser.email || 'Session email unavailable'}</p>
            </article>
          </section>

          <section className="panel table-card">
            <div className="panel-header">
              <div>
                <p className="panel-label">Compliance log</p>
                <p className="panel-title">Recent security-sensitive activity</p>
              </div>
              <div className="chip info">{securityEvents.length} events</div>
            </div>
            <div className="table-wrap">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Category</th>
                    <th>Admin</th>
                    <th>Target</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {securityEvents.map((item) => (
                    <tr key={item.id}>
                      <td data-label="When">{formatDate(item.created_at)}</td>
                      <td data-label="Category">
                        <span className={`chip ${getTone(item.category)}`}>{item.category || '-'}</span>
                      </td>
                      <td data-label="Admin">{item.admin?.name || item.source || 'System'}</td>
                      <td data-label="Target">{item.target_label || item.target_type || '-'}</td>
                      <td data-label="Summary">{item.summary || item.action || '-'}</td>
                    </tr>
                  ))}
                  {!securityEvents.length ? (
                    <tr>
                      <td colSpan={5}>No security or compliance events are available yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )
    }

    if (activeSlug === 'notifications') {
      return (
        <>
          <section className="stat-grid">
            <article className="stat-card">
              <div className="stat-top">
                <p className="stat-label">Operational alerts</p>
                <span className="dot alert" />
              </div>
              <p className="stat-value">{alertRows.length}</p>
              <p className="stat-detail">Urgent or stale support messages</p>
            </article>
            <article className="stat-card">
              <div className="stat-top">
                <p className="stat-label">Open inbox</p>
                <span className="dot warning" />
              </div>
              <p className="stat-value">{supportSummary.open_inbox || 0}</p>
              <p className="stat-detail">Current unresolved support queue</p>
            </article>
          </section>

          <section className="grid-2">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-label">Alert queue</p>
                  <p className="panel-title">Messages needing attention</p>
                </div>
                <span className="chip alert">{alertRows.length} alerts</span>
              </div>
              <div className="support-list">
                {alertRows.length ? (
                  alertRows.map((item) => (
                    <article key={item.reference} className="support-list-card">
                      <div className="support-list-top">
                        <div>
                          <p className="support-list-id">{item.reference}</p>
                          <h3>{item.subject || 'Support request'}</h3>
                        </div>
                        <span className={`chip ${getTone(item.status)}`}>{item.status}</span>
                      </div>
                      <div className="support-meta-grid">
                        <div>
                          <p className="panel-label">Sender</p>
                          <p className="support-meta-value">{item.sender || '-'}</p>
                        </div>
                        <div>
                          <p className="panel-label">Category</p>
                          <p className="support-meta-value">{item.category || '-'}</p>
                        </div>
                        <div>
                          <p className="panel-label">Received</p>
                          <p className="support-meta-value">{formatDate(item.received_at || item.created_at)}</p>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="lead">No support alerts are active right now.</p>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-label">Category mix</p>
                  <p className="panel-title">Support workload breakdown</p>
                </div>
                <span className="chip info">{categoryBreakdown.length} categories</span>
              </div>
              <div className="support-list">
                {categoryBreakdown.length ? (
                  categoryBreakdown.map(([label, count]) => (
                    <article key={label} className="support-list-card">
                      <div className="support-list-top">
                        <div>
                          <p className="support-list-id">{label}</p>
                          <h3>{count} messages</h3>
                        </div>
                        <span className={`chip ${getTone(label)}`}>Live</span>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="lead">No support category data is available.</p>
                )}
              </div>
            </section>
          </section>
        </>
      )
    }

    if (activeSlug === 'billing') {
      return (
        <>
          <section className="stat-grid">
            <article className="stat-card">
              <div className="stat-top">
                <p className="stat-label">Workspace subscription</p>
                <span className={`dot ${getTone(subscriptionStatus)}`} />
              </div>
              <p className="stat-value small">{subscriptionStatus}</p>
              <p className="stat-detail">Admin workspace billing state</p>
            </article>
            <article className="stat-card">
              <div className="stat-top">
                <p className="stat-label">Recurring revenue</p>
                <span className="dot positive" />
              </div>
              <p className="stat-value">{formatMoney(financeSummary.recurring_revenue, financeSummary.currency)}</p>
              <p className="stat-detail">Derived from successful subscription purchases</p>
            </article>
            <article className="stat-card">
              <div className="stat-top">
                <p className="stat-label">Active subscriptions</p>
                <span className="dot info" />
              </div>
              <p className="stat-value">{financeSummary.active_subscriptions}</p>
              <p className="stat-detail">Current subscribed parent accounts</p>
            </article>
            <article className="stat-card">
              <div className="stat-top">
                <p className="stat-label">Platform fee</p>
                <span className="dot warning" />
              </div>
              <p className="stat-value small">{currentFeeLabel}</p>
              <p className="stat-detail">Current commission configuration</p>
            </article>
          </section>

          <section className="grid-2">
            <section className="panel table-card">
              <div className="panel-header">
                <div>
                  <p className="panel-label">Plans</p>
                  <p className="panel-title">Configured subscription plans</p>
                </div>
                <div className="chip info">{management.plans.length} plans</div>
              </div>
              <div className="table-wrap">
                <table className="responsive-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Amount</th>
                      <th>Billing</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {management.plans.map((plan) => (
                      <tr key={plan.id || plan.slug || plan.name}>
                        <td data-label="Name">
                          <strong>{plan.name || '-'}</strong>
                          <div className="muted">{plan.slug || '-'}</div>
                        </td>
                        <td data-label="Amount">{formatMoney(plan.amount, plan.currency || financeSummary.currency)}</td>
                        <td data-label="Billing">{plan.billing_label || '-'}</td>
                        <td data-label="Status">
                          <span className={`chip ${plan.is_active ? 'positive' : 'warning'}`}>
                            {plan.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!management.plans.length ? (
                      <tr>
                        <td colSpan={4}>No subscription plans are configured.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel table-card">
              <div className="panel-header">
                <div>
                  <p className="panel-label">Transactions</p>
                  <p className="panel-title">Latest subscription purchases</p>
                </div>
                <div className="chip info">{management.transactions.length} rows</div>
              </div>
              <div className="table-wrap">
                <table className="responsive-table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>User</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {management.transactions.slice(0, 12).map((item) => (
                      <tr key={item.id}>
                        <td data-label="Reference">{item.reference || item.id}</td>
                        <td data-label="User">
                          <strong>{item.user_name || '-'}</strong>
                          <div className="muted">{item.user_email || '-'}</div>
                        </td>
                        <td data-label="Amount">{formatMoney(item.amount, item.currency || financeSummary.currency)}</td>
                        <td data-label="Status">
                          <span className={`chip ${getTone(item.payment_status || item.status)}`}>
                            {item.payment_status || item.status || '-'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!management.transactions.length ? (
                      <tr>
                        <td colSpan={4}>No subscription purchase history is available.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        </>
      )
    }

    return (
      <>
        <section className="stat-grid">
          <article className="stat-card">
            <div className="stat-top">
              <p className="stat-label">Workspace subscription</p>
              <span className={`dot ${getTone(subscriptionStatus)}`} />
            </div>
            <p className="stat-value small">{subscriptionStatus}</p>
            <p className="stat-detail">Current admin workspace billing state</p>
          </article>
          <article className="stat-card">
            <div className="stat-top">
              <p className="stat-label">Total earnings</p>
              <span className="dot positive" />
            </div>
            <p className="stat-value">{formatMoney(financeSummary.total_earnings, financeSummary.currency)}</p>
            <p className="stat-detail">Successful subscription revenue observed</p>
          </article>
          <article className="stat-card">
            <div className="stat-top">
              <p className="stat-label">Open support inbox</p>
              <span className="dot warning" />
            </div>
            <p className="stat-value">{supportSummary.open_inbox || 0}</p>
            <p className="stat-detail">Support requests waiting on action</p>
          </article>
          <article className="stat-card">
            <div className="stat-top">
              <p className="stat-label">Recent audit activity</p>
              <span className="dot info" />
            </div>
            <p className="stat-value">{auditLogs.length}</p>
            <p className="stat-detail">Latest admin and system events loaded</p>
          </article>
        </section>

        <section className="grid-2">
          <section className="panel settings-card">
            <div className="panel-header">
              <div>
                <p className="panel-label">Workspace</p>
                <p className="panel-title">Current admin session</p>
              </div>
              <span className="chip positive">Read-only</span>
            </div>
            <div className="settings-list">
              <div className="settings-item">
                <div>
                  <p className="settings-item-title">Admin</p>
                  <p className="settings-item-subtitle">{adminUser.name || '-'}</p>
                </div>
              </div>
              <div className="settings-item">
                <div>
                  <p className="settings-item-title">Email</p>
                  <p className="settings-item-subtitle">{adminUser.email || '-'}</p>
                </div>
              </div>
              <div className="settings-item">
                <div>
                  <p className="settings-item-title">Workspace</p>
                  <p className="settings-item-subtitle">SYTTR Admin Console</p>
                </div>
              </div>
              <div className="settings-item">
                <div>
                  <p className="settings-item-title">Platform fee</p>
                  <p className="settings-item-subtitle">{currentFeeLabel}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-label">Operational alerts</p>
                <p className="panel-title">Live inbox pressure points</p>
              </div>
              <span className="chip alert">{alertRows.length} alerts</span>
            </div>
            <div className="support-list">
              {alertRows.length ? (
                alertRows.slice(0, 6).map((item) => (
                  <article key={item.reference} className="support-list-card">
                    <div className="support-list-top">
                      <div>
                        <p className="support-list-id">{item.reference}</p>
                        <h3>{item.subject || 'Support request'}</h3>
                      </div>
                      <span className={`chip ${getTone(item.status)}`}>{item.status}</span>
                    </div>
                    <div className="support-meta-grid">
                      <div>
                        <p className="panel-label">Sender</p>
                        <p className="support-meta-value">{item.sender || '-'}</p>
                      </div>
                      <div>
                        <p className="panel-label">Category</p>
                        <p className="support-meta-value">{item.category || '-'}</p>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <p className="lead">No urgent workspace alerts are active right now.</p>
              )}
            </div>
          </section>
        </section>
      </>
    )
  }

  return (
    <div className="dashboard-shell">
      <Sidebar />

      <div className="dash-content">
        <header className="dash-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1>Settings</h1>
            <p className="lead">
              Review live workspace state from the admin APIs. Unsupported demo-only controls have been removed.
            </p>
          </div>
          <div className="header-actions">
            <div className={`chip ${workspaceStatus === 'ready' ? 'positive' : 'warning'}`}>
              {workspaceStatus === 'ready' ? 'Live data loaded' : 'Loading'}
            </div>
            <button className="pill-btn ghost" onClick={() => void loadWorkspaceData()}>
              Refresh
            </button>
          </div>
        </header>

        <div className="settings-layout">
          <aside className="settings-nav">
            {settingsLinks.map((link) => (
              <a
                key={link.slug}
                href={link.path}
                className={`settings-link${activeSlug === link.slug ? ' active' : ''}`}
              >
                <span className="settings-link-title">{link.label}</span>
                <span className="settings-link-caption">{link.description}</span>
              </a>
            ))}
          </aside>

          <div className="settings-content">{renderSection()}</div>
        </div>
      </div>
    </div>
  )
}

export default Settings
