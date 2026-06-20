import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import { getPayments } from '../api'
import { exportRowsToCsv } from '../utils/csv'

function Payments() {
  const [payments, setPayments] = useState([])
  const [status, setStatus] = useState('loading')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadPayments = async () => {
      setStatus('loading')
      try {
        const response = await getPayments()
        const payload = response?.data ?? response ?? []
        const list = Array.isArray(payload) ? payload : payload?.payments ?? []
        if (isMounted) {
          setPayments(list)
          setStatus('ready')
        }
      } catch {
        if (isMounted) setStatus('error')
      }
    }

    loadPayments()

    return () => {
      isMounted = false
    }
  }, [])

  const filteredPayments = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return payments
    return payments.filter((payment) =>
      [
        payment.reference,
        payment.user_name,
        payment.user_email,
        payment.user_id,
        payment.category,
        payment.description,
        payment.status,
        payment.source,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    )
  }, [payments, query])

  const totalsLabel = useMemo(() => {
    const volume = filteredPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    return `$${volume.toFixed(2)} tracked`
  }, [filteredPayments])

  const payoutPayments = useMemo(
    () =>
      filteredPayments.filter((payment) => {
        const haystack = [
          payment.category,
          payment.type,
          payment.source,
          payment.description,
          payment.reference,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        return (
          haystack.includes('payout') ||
          haystack.includes('withdraw') ||
          haystack.includes('wallet')
        )
      }),
    [filteredPayments],
  )

  const formatMoney = (amount, currency) => {
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

  const handleExport = () => {
    if (!filteredPayments.length) return
    exportRowsToCsv(
      'transactions-export.csv',
      ['Reference', 'User', 'Role', 'Category', 'Amount', 'Direction', 'Status', 'Date'],
      filteredPayments.map((payment) => [
        payment.reference || payment.id,
        payment.user_name || '-',
        payment.user_role || '-',
        payment.category || '-',
        formatMoney(payment.amount, payment.currency),
        payment.direction || '-',
        payment.status || '-',
        formatDate(payment.created_at),
      ]),
    )
  }

  const handleExportPayouts = () => {
    if (!payoutPayments.length) return
    exportRowsToCsv(
      'payouts-export.csv',
      [
        'Reference',
        'User',
        'Role',
        'Category',
        'Type',
        'Amount',
        'Currency',
        'Direction',
        'Status',
        'Description',
        'Date',
      ],
      payoutPayments.map((payment) => [
        payment.reference || payment.id,
        payment.user_name || '-',
        payment.user_role || '-',
        payment.category || '-',
        payment.type || '-',
        Number(payment.amount || 0).toFixed(2),
        payment.currency || 'USD',
        payment.direction || '-',
        payment.status || '-',
        payment.description || '-',
        formatDate(payment.created_at),
      ]),
    )
  }

  return (
    <div className="dashboard-shell">
      <Sidebar />

      <div className="dash-content">
        <header className="dash-header">
          <div>
            <p className="eyebrow">Finance</p>
            <h1>Payment management</h1>
            <p className="lead">
              Review all monetary transactions across subscriptions, Stripe charges, and wallet activity.
            </p>
          </div>

          <div className="header-actions">
            <div className="search">
              <input
                type="search"
                placeholder="Search transactions by user, ID, or category"
                aria-label="Search transactions"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <button className="pill-btn ghost" type="button" onClick={handleExport}>
              Export
            </button>
            <button className="pill-btn ghost" type="button" onClick={handleExportPayouts} disabled={!payoutPayments.length}>
              Export payouts
            </button>
          </div>
        </header>

        <section className="panel table-card">
          <div className="panel-header">
            <div>
              <p className="panel-label">Transactions</p>
              <p className="panel-title">Platform money flow</p>
            </div>
            <div className="chip info">{totalsLabel}</div>
          </div>
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>User</th>
                  <th>Category</th>
                  <th>Amount</th>
                  <th>Direction</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.map((payment) => (
                  <tr key={payment.id}>
                    <td data-label="Reference">
                      <strong>{payment.reference || payment.id}</strong>
                      <div className="muted">{payment.description || '-'}</div>
                    </td>
                    <td data-label="User">
                      <strong>{payment.user_name || '-'}</strong>
                      <div className="muted">
                        {[payment.user_role, payment.user_id].filter(Boolean).join(' • ') || payment.user_email || '-'}
                      </div>
                    </td>
                    <td data-label="Category">{payment.category || '-'}</td>
                    <td data-label="Amount">{formatMoney(payment.amount, payment.currency)}</td>
                    <td data-label="Direction">{payment.direction || '-'}</td>
                    <td data-label="Status">
                      <span
                        className={`chip ${
                          String(payment.status || '').toLowerCase().includes('complete') ||
                          String(payment.status || '').toLowerCase().includes('paid') ||
                          String(payment.status || '').toLowerCase().includes('succeed')
                            ? 'positive'
                            : String(payment.status || '').toLowerCase().includes('fail') ||
                                String(payment.status || '').toLowerCase().includes('hold')
                              ? 'alert'
                              : 'warning'
                        }`}
                      >
                        {payment.status || '-'}
                      </span>
                    </td>
                    <td data-label="Date">{formatDate(payment.created_at)}</td>
                  </tr>
                ))}
                {status === 'loading' ? (
                  <tr>
                    <td colSpan={7}>Loading transactions...</td>
                  </tr>
                ) : null}
                {status === 'error' ? (
                  <tr>
                    <td colSpan={7}>Unable to load transactions.</td>
                  </tr>
                ) : null}
                {status === 'ready' && filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No transactions matched this search.</td>
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

export default Payments
