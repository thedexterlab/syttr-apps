import { useEffect, useMemo, useState } from 'react'
import { getSupportMessages } from '../api'
import Sidebar from '../components/Sidebar'
import { exportRowsToCsv } from '../utils/csv'

const emptyInboxSummary = {
  open_inbox: 0,
  closed_inbox: 0,
  total: 0,
}

const truncate = (value, limit = 96) => {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text
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
    normalized.includes('critical') ||
    normalized.includes('high') ||
    normalized.includes('escalated') ||
    normalized.includes('urgent') ||
    normalized.includes('open') ||
    normalized.includes('new')
  ) {
    return 'alert'
  }
  if (
    normalized.includes('resolved') ||
    normalized.includes('closed') ||
    normalized.includes('done')
  ) {
    return 'positive'
  }
  if (
    normalized.includes('waiting') ||
    normalized.includes('investigating') ||
    normalized.includes('pending') ||
    normalized.includes('monitoring')
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

const isUrgentMessage = (item) => {
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
    haystack.includes('chargeback') ||
    haystack.includes('fraud') ||
    haystack.includes('complaint') ||
    haystack.includes('no-show') ||
    haystack.includes('safety')
  )
}

function SupportCenter() {
  const [query, setQuery] = useState('')
  const [inboxMessages, setInboxMessages] = useState([])
  const [inboxSummary, setInboxSummary] = useState(emptyInboxSummary)
  const [loadingInbox, setLoadingInbox] = useState(true)
  const [inboxError, setInboxError] = useState('')
  const [selectedInboxReference, setSelectedInboxReference] = useState('')

  const loadInbox = async (options = {}) => {
    const { activeRef } = options
    setLoadingInbox(true)
    setInboxError('')
    try {
      const response = await getSupportMessages()
      if (activeRef && !activeRef.current) return
      setInboxMessages(Array.isArray(response?.data) ? response.data : [])
      setInboxSummary({
        ...emptyInboxSummary,
        ...(response?.summary || {}),
      })
    } catch (error) {
      if (activeRef && !activeRef.current) return
      setInboxMessages([])
      setInboxSummary(emptyInboxSummary)
      setInboxError(error?.message || 'Unable to load support inbox.')
    } finally {
      if (!activeRef || activeRef.current) {
        setLoadingInbox(false)
      }
    }
  }

  useEffect(() => {
    const activeRef = { current: true }
    void loadInbox({ activeRef })
    return () => {
      activeRef.current = false
    }
  }, [])

  const normalizedQuery = query.trim().toLowerCase()

  const filteredInbox = useMemo(() => {
    if (!normalizedQuery) return inboxMessages

    return inboxMessages.filter((item) =>
      [
        item.reference,
        item.sender,
        item.sender_email,
        item.channel,
        item.category,
        item.subject,
        item.message,
        item.status,
        item.user_id,
        item.account_type,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    )
  }, [inboxMessages, normalizedQuery])

  useEffect(() => {
    if (!filteredInbox.length) {
      if (selectedInboxReference) setSelectedInboxReference('')
      return
    }

    const hasCurrent = filteredInbox.some((item) => item.reference === selectedInboxReference)
    if (!hasCurrent) {
      setSelectedInboxReference(filteredInbox[0].reference)
    }
  }, [filteredInbox, selectedInboxReference])

  const selectedInboxItem =
    filteredInbox.find((item) => item.reference === selectedInboxReference) || filteredInbox[0] || null

  const categoryBreakdown = useMemo(() => {
    const buckets = new Map()
    filteredInbox.forEach((item) => {
      const key = String(item?.category || 'contact').trim() || 'contact'
      buckets.set(key, (buckets.get(key) || 0) + 1)
    })
    return Array.from(buckets.entries()).sort((a, b) => b[1] - a[1])
  }, [filteredInbox])

  const attentionQueue = useMemo(
    () =>
      filteredInbox
        .filter((item) => {
          const status = String(item?.status_key || item?.status || '').toLowerCase()
          const ageHours = hoursSince(item?.received_at || item?.created_at)
          return status !== 'closed' && (isUrgentMessage(item) || (ageHours !== null && ageHours >= 24))
        })
        .sort((a, b) => {
          const aAge = hoursSince(a?.received_at || a?.created_at) || 0
          const bAge = hoursSince(b?.received_at || b?.created_at) || 0
          return bAge - aAge
        })
        .slice(0, 12),
    [filteredInbox],
  )

  const summary = useMemo(
    () => [
      {
        label: 'Open inbox',
        value:
          inboxSummary.open_inbox ??
          inboxMessages.filter((item) => String(item.status_key || '').toLowerCase() !== 'closed').length,
        detail: 'Messages awaiting handling',
        tone: 'info',
      },
      {
        label: 'Urgent cases',
        value: inboxMessages.filter((item) => isUrgentMessage(item)).length,
        detail: 'Payment, safety, fraud, or complaint signals',
        tone: 'alert',
      },
      {
        label: 'Aged 24h+',
        value: inboxMessages.filter((item) => {
          const age = hoursSince(item.received_at || item.created_at)
          return age !== null && age >= 24 && String(item.status_key || '').toLowerCase() !== 'closed'
        }).length,
        detail: 'Open items beyond one day',
        tone: 'warning',
      },
      {
        label: 'Closed',
        value: inboxSummary.closed_inbox ?? 0,
        detail: 'Requests marked resolved',
        tone: 'positive',
      },
    ],
    [inboxMessages, inboxSummary],
  )

  const handleExport = () => {
    if (!filteredInbox.length) return
    exportRowsToCsv(
      'support-inbox-export.csv',
      ['Reference', 'Sender', 'Email', 'Category', 'Subject', 'Status', 'Received'],
      filteredInbox.map((item) => [
        item.reference || '-',
        item.sender || '-',
        item.sender_email || '-',
        item.category || '-',
        item.subject || '-',
        item.status || '-',
        item.received_label || formatDate(item.received_at || item.created_at),
      ]),
    )
  }

  return (
    <div className="dashboard-shell">
      <Sidebar />

      <div className="dash-content">
        <header className="dash-header">
          <div>
            <p className="eyebrow">Support operations</p>
            <h1>Support / Contact Center</h1>
            <p className="lead">
              Review live in-app support submissions and triage the queue from real inbox data.
            </p>
          </div>

          <div className="header-actions">
            <div className="search">
              <input
                type="search"
                placeholder="Search messages, users, categories"
                aria-label="Search support data"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <button className="pill-btn" onClick={() => void loadInbox()}>
              Refresh inbox
            </button>
            <button className="pill-btn ghost" onClick={handleExport} disabled={!filteredInbox.length}>
              Export snapshot
            </button>
          </div>
        </header>

        <section className="stat-grid">
          {summary.map((item) => (
            <article key={item.label} className="stat-card">
              <div className="stat-top">
                <p className="stat-label">{item.label}</p>
                <span className={`dot ${item.tone}`} />
              </div>
              <p className="stat-value">{item.value}</p>
              <p className="stat-detail">{item.detail}</p>
              <div className={`stat-badge ${item.tone}`}>Live inbox</div>
            </article>
          ))}
        </section>

        <section className="grid-2 support-grid">
          <div className="panel table-card">
            <div className="panel-header">
              <div>
                <p className="panel-label">Inbox</p>
                <p className="panel-title">Support submissions</p>
              </div>
              <div className="chip info">
                {loadingInbox ? 'Loading...' : `${filteredInbox.length} items`}
              </div>
            </div>
            {inboxError ? <p className="lead">{inboxError}</p> : null}
            <div className="table-wrap">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Sender</th>
                    <th>Category</th>
                    <th>Subject</th>
                    <th>Received</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {!loadingInbox && !filteredInbox.length ? (
                    <tr>
                      <td colSpan="6">No support submissions found.</td>
                    </tr>
                  ) : null}
                  {filteredInbox.map((item) => (
                    <tr
                      key={item.reference}
                      className={item.reference === selectedInboxItem?.reference ? 'support-row selected' : 'support-row'}
                      onClick={() => setSelectedInboxReference(item.reference)}
                    >
                      <td data-label="ID">{item.reference}</td>
                      <td data-label="Sender">
                        <div>{item.sender}</div>
                        <small>{item.sender_email || item.user_id || '-'}</small>
                      </td>
                      <td data-label="Category">
                        <span className={`chip ${getTone(item.category)}`}>{item.category || '-'}</span>
                      </td>
                      <td data-label="Subject">
                        <div>{item.subject}</div>
                        <small>{truncate(item.message)}</small>
                      </td>
                      <td data-label="Received">{item.received_label || formatDate(item.received_at)}</td>
                      <td data-label="Status">
                        <span className={`chip ${getTone(item.status)}`}>{item.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-label">Selected message</p>
                <p className="panel-title">{selectedInboxItem?.subject || 'No message selected'}</p>
              </div>
              {selectedInboxItem ? (
                <span className={`chip ${getTone(selectedInboxItem.status)}`}>{selectedInboxItem.status}</span>
              ) : (
                <span className="chip neutral">Inbox idle</span>
              )}
            </div>

            {selectedInboxItem ? (
              <>
                <div className="support-meta-grid">
                  <div>
                    <p className="panel-label">Reference</p>
                    <p className="support-meta-value">{selectedInboxItem.reference}</p>
                  </div>
                  <div>
                    <p className="panel-label">Sender</p>
                    <p className="support-meta-value">{selectedInboxItem.sender}</p>
                  </div>
                  <div>
                    <p className="panel-label">Email</p>
                    <p className="support-meta-value">{selectedInboxItem.sender_email || '-'}</p>
                  </div>
                  <div>
                    <p className="panel-label">Account type</p>
                    <p className="support-meta-value">{selectedInboxItem.account_type || '-'}</p>
                  </div>
                  <div>
                    <p className="panel-label">Category</p>
                    <p className="support-meta-value">{selectedInboxItem.category || '-'}</p>
                  </div>
                  <div>
                    <p className="panel-label">Received</p>
                    <p className="support-meta-value">
                      {selectedInboxItem.received_label || formatDate(selectedInboxItem.received_at)}
                    </p>
                  </div>
                </div>
                <div className="support-message-body">
                  <p className="panel-label">Full message</p>
                  <p>{selectedInboxItem.message || 'No message provided.'}</p>
                </div>
              </>
            ) : (
              <p className="lead">Pick a support request from the inbox to review its details.</p>
            )}
          </div>
        </section>

        <section className="grid-2 support-grid">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-label">Attention queue</p>
                <p className="panel-title">Urgent or stale messages</p>
              </div>
              <div className="chip alert">{attentionQueue.length} flagged</div>
            </div>
            <div className="support-list">
              {attentionQueue.length ? (
                attentionQueue.map((item) => (
                  <article key={item.reference} className="support-list-card">
                    <div className="support-list-top">
                      <div>
                        <p className="support-list-id">{item.reference}</p>
                        <h3>{item.subject}</h3>
                      </div>
                      <span className={`chip ${getTone(item.status)}`}>{item.status}</span>
                    </div>
                    <div className="support-meta-grid">
                      <div>
                        <p className="panel-label">Sender</p>
                        <p className="support-meta-value">{item.sender}</p>
                      </div>
                      <div>
                        <p className="panel-label">Category</p>
                        <p className="support-meta-value">{item.category || '-'}</p>
                      </div>
                      <div>
                        <p className="panel-label">Age</p>
                        <p className="support-meta-value">
                          {item.sla || formatDate(item.received_at || item.created_at)}
                        </p>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <p className="lead">No urgent or stale support messages matched the current filter.</p>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-label">Category breakdown</p>
                <p className="panel-title">Current queue mix</p>
              </div>
              <div className="chip info">{categoryBreakdown.length} categories</div>
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
                      <span className={`chip ${getTone(label)}`}>Active</span>
                    </div>
                    <div className="support-meta-grid">
                      <div>
                        <p className="panel-label">Open share</p>
                        <p className="support-meta-value">
                          {Math.round((count / Math.max(filteredInbox.length || 1, 1)) * 100)}%
                        </p>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <p className="lead">No category data available.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

export default SupportCenter
