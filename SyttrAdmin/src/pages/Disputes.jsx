import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import { getPayments, getSupportMessages } from '../api'
import { exportRowsToCsv } from '../utils/csv'

const disputeKeywords = [
  'dispute',
  'chargeback',
  'refund',
  'payment',
  'billing',
  'complaint',
  'fraud',
  'no-show',
  'noshow',
  'schedule',
  'safety',
  'conduct',
  'cancel',
]

const matchesDisputeKeyword = (...values) => {
  const haystack = values
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return disputeKeywords.some((keyword) => haystack.includes(keyword))
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

const getStatusTone = (status) => {
  const value = String(status || '').toLowerCase()
  if (value.includes('resolved') || value.includes('closed') || value.includes('paid')) return 'positive'
  if (
    value.includes('escalated') ||
    value.includes('failed') ||
    value.includes('blocked') ||
    value.includes('dispute')
  ) {
    return 'alert'
  }
  return 'warning'
}

const getPriority = (item) => {
  const haystack = [
    item?.source,
    item?.category,
    item?.issue,
    item?.status,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (
    haystack.includes('chargeback') ||
    haystack.includes('fraud') ||
    haystack.includes('safety') ||
    haystack.includes('failed')
  ) {
    return 'High'
  }
  if (
    haystack.includes('refund') ||
    haystack.includes('payment') ||
    haystack.includes('complaint') ||
    haystack.includes('schedule')
  ) {
    return 'Medium'
  }
  return 'Low'
}

const getPriorityTone = (priority) => {
  const value = String(priority || '').toLowerCase()
  if (value.includes('high')) return 'alert'
  if (value.includes('low')) return 'info'
  return 'warning'
}

function Disputes() {
  const [cases, setCases] = useState([])
  const [status, setStatus] = useState('loading')
  const [query, setQuery] = useState('')

  const loadCases = async (options = {}) => {
    const { showLoading = true } = options
    if (showLoading) {
      setStatus('loading')
    }
    try {
      const [supportResponse, paymentsResponse] = await Promise.allSettled([
        getSupportMessages(),
        getPayments(),
      ])

      const supportMessages =
        supportResponse.status === 'fulfilled' && Array.isArray(supportResponse.value?.data)
          ? supportResponse.value.data
          : []
      const payments =
        paymentsResponse.status === 'fulfilled'
          ? Array.isArray(paymentsResponse.value?.data)
            ? paymentsResponse.value.data
            : Array.isArray(paymentsResponse.value)
              ? paymentsResponse.value
              : []
          : []

      const supportCases = supportMessages
        .filter((item) =>
          matchesDisputeKeyword(item.category, item.subject, item.message, item.status),
        )
        .map((item) => ({
          id: item.reference || `support-${item.id}`,
          opened: item.received_at || item.created_at,
          openedLabel: item.received_label || formatDate(item.received_at || item.created_at),
          source: 'Support',
          requester: item.sender || item.sender_email || '-',
          category: item.category || 'support',
          issue: item.subject || item.message || 'Support issue',
          status: item.status || 'Open',
        }))

      const paymentCases = payments
        .filter((item) =>
          matchesDisputeKeyword(
            item.status,
            item.payment_status,
            item.category,
            item.description,
            item.source,
          ),
        )
        .map((item) => ({
          id: item.reference || item.id,
          opened: item.created_at,
          openedLabel: formatDate(item.created_at),
          source: 'Payments',
          requester: item.user_name || item.user_email || item.user_id || '-',
          category: item.category || item.source || 'payment',
          issue: item.description || item.payment_status || item.status || 'Payment issue',
          status: item.status || item.payment_status || 'Review',
        }))

      const nextCases = [...supportCases, ...paymentCases]
        .map((item) => ({
          ...item,
          priority: getPriority(item),
        }))
        .sort((a, b) => {
          const aTime = new Date(String(a.opened || '').replace(' ', 'T')).getTime() || 0
          const bTime = new Date(String(b.opened || '').replace(' ', 'T')).getTime() || 0
          return bTime - aTime
        })

      setCases(nextCases)
      setStatus('ready')
    } catch {
      setCases([])
      setStatus('error')
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadCases({ showLoading: false })
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [])

  const filteredCases = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return cases
    return cases.filter((item) =>
      [
        item.id,
        item.source,
        item.requester,
        item.category,
        item.issue,
        item.priority,
        item.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    )
  }, [cases, query])

  const handleExport = () => {
    if (!filteredCases.length) return
    exportRowsToCsv(
      'disputes-export.csv',
      ['Case', 'Opened', 'Source', 'Requester', 'Category', 'Issue', 'Priority', 'Status'],
      filteredCases.map((item) => [
        item.id,
        item.openedLabel,
        item.source,
        item.requester,
        item.category,
        item.issue,
        item.priority,
        item.status,
      ]),
    )
  }

  return (
    <div className="dashboard-shell">
      <Sidebar />

      <div className="dash-content">
        <header className="dash-header">
          <div>
            <p className="eyebrow">Trust & safety</p>
            <h1>Dispute management</h1>
            <p className="lead">
              Track dispute-like cases derived from real support submissions and payment events.
            </p>
          </div>

          <div className="header-actions">
            <div className="search">
              <input
                type="search"
                placeholder="Search by case, requester, or issue"
                aria-label="Search disputes"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <button className="pill-btn" onClick={() => void loadCases()}>
              Refresh
            </button>
            <button className="pill-btn ghost" onClick={handleExport} disabled={!filteredCases.length}>
              Export
            </button>
          </div>
        </header>

        <section className="panel table-card">
          <div className="panel-header">
            <div>
              <p className="panel-label">Cases</p>
              <p className="panel-title">Dispute and escalation queue</p>
            </div>
            <div className="chip info">{filteredCases.length} cases</div>
          </div>
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Opened</th>
                  <th>Source</th>
                  <th>Requester</th>
                  <th>Issue</th>
                  <th>Priority</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredCases.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Case">{item.id}</td>
                    <td data-label="Opened">{item.openedLabel}</td>
                    <td data-label="Source">
                      <span className="chip info">{item.source}</span>
                    </td>
                    <td data-label="Requester">
                      <strong>{item.requester}</strong>
                      <div className="muted">{item.category || '-'}</div>
                    </td>
                    <td data-label="Issue">{item.issue}</td>
                    <td data-label="Priority">
                      <span className={`chip ${getPriorityTone(item.priority)}`}>{item.priority}</span>
                    </td>
                    <td data-label="Status">
                      <span className={`chip ${getStatusTone(item.status)}`}>{item.status}</span>
                    </td>
                  </tr>
                ))}
                {status === 'loading' ? (
                  <tr>
                    <td colSpan={7}>Loading dispute cases...</td>
                  </tr>
                ) : null}
                {status === 'error' ? (
                  <tr>
                    <td colSpan={7}>Unable to load dispute cases.</td>
                  </tr>
                ) : null}
                {status === 'ready' && !filteredCases.length ? (
                  <tr>
                    <td colSpan={7}>No dispute-like cases matched the current filters.</td>
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

export default Disputes
