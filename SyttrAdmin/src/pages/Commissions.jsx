import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import { calculatePlatformFee, getCommissions, getCurrentPlatformFee } from '../api'
import { exportRowsToCsv } from '../utils/csv'

const commissionsFallback = []
const summaryFallback = {
  currency: 'USD',
  withdrawal_count: 0,
  total_commission_revenue: 0,
  total_withdrawal_volume: 0,
  total_payout_volume: 0,
  current_period_label: '',
  current_period_withdrawal_count: 0,
  current_period_commission_revenue: 0,
}

const toNumber = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  const normalized = String(value ?? '')
    .trim()
    .replace(/,/g, '')
    .replace(/[^0-9.-]/g, '')

  if (!normalized) return 0

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

const toDate = (value) => {
  if (!value) return null

  const parsed = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const getResponsePayload = (response) => response?.data?.data ?? response?.data ?? response ?? {}

const getCommissionRows = (response) => {
  const payload = getResponsePayload(response)

  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.commissions)) return payload.commissions
  if (Array.isArray(response?.commissions)) return response.commissions
  if (Array.isArray(response?.data?.commissions)) return response.data.commissions

  return commissionsFallback
}

const getCommissionSummary = (response) => {
  const payload = getResponsePayload(response)

  return (
    payload?.summary ??
    response?.summary ??
    response?.data?.summary ??
    null
  )
}

const buildSummaryFromRows = (rows, baseSummary = {}) => {
  const now = new Date()
  const currentPeriodRows = rows.filter((item) => {
    const date = toDate(item?.updated_at ?? item?.created_at)
    return date && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
  })

  return {
    ...summaryFallback,
    ...baseSummary,
    currency:
      String(baseSummary?.currency || rows.find((item) => item?.currency)?.currency || 'USD').toUpperCase(),
    withdrawal_count: rows.length,
    total_commission_revenue: rows.reduce(
      (sum, item) => sum + toNumber(item?.commission_amount),
      0,
    ),
    total_withdrawal_volume: rows.reduce(
      (sum, item) => sum + toNumber(item?.requested_amount ?? item?.job_amount),
      0,
    ),
    total_payout_volume: rows.reduce(
      (sum, item) => sum + toNumber(item?.payout_amount),
      0,
    ),
    current_period_label:
      baseSummary?.current_period_label ||
      new Intl.DateTimeFormat('en-US', {
        month: 'short',
        year: 'numeric',
      }).format(now),
    current_period_withdrawal_count: currentPeriodRows.length,
    current_period_commission_revenue: currentPeriodRows.reduce(
      (sum, item) => sum + toNumber(item?.commission_amount),
      0,
    ),
  }
}

const normalizeCommissionsResponse = (response) => {
  const rows = getCommissionRows(response)
  const apiSummary = getCommissionSummary(response)
  const rowSummary = rows.length > 0 ? buildSummaryFromRows(rows, apiSummary) : null

  const summary = rowSummary
    ? {
        ...summaryFallback,
        ...(apiSummary || {}),
        currency: String(apiSummary?.currency || rowSummary.currency || 'USD').toUpperCase(),
        withdrawal_count: Math.max(
          toNumber(apiSummary?.withdrawal_count),
          toNumber(rowSummary.withdrawal_count),
        ),
        total_commission_revenue: Math.max(
          toNumber(apiSummary?.total_commission_revenue),
          toNumber(rowSummary.total_commission_revenue),
        ),
        total_withdrawal_volume: Math.max(
          toNumber(apiSummary?.total_withdrawal_volume),
          toNumber(rowSummary.total_withdrawal_volume),
        ),
        total_payout_volume: Math.max(
          toNumber(apiSummary?.total_payout_volume),
          toNumber(rowSummary.total_payout_volume),
        ),
        current_period_label:
          apiSummary?.current_period_label || rowSummary.current_period_label,
        current_period_withdrawal_count: Math.max(
          toNumber(apiSummary?.current_period_withdrawal_count),
          toNumber(rowSummary.current_period_withdrawal_count),
        ),
        current_period_commission_revenue: Math.max(
          toNumber(apiSummary?.current_period_commission_revenue),
          toNumber(rowSummary.current_period_commission_revenue),
        ),
      }
    : { ...summaryFallback, ...(apiSummary || {}) }

  return {
    rows,
    summary,
  }
}

function Commissions() {
  const [platformFeeType, setPlatformFeeType] = useState('percentage')
  const [platformFeeValue, setPlatformFeeValue] = useState('')
  const [feeLoading, setFeeLoading] = useState(false)
  const [currentFee, setCurrentFee] = useState({ type: '', value: '' })
  const [currentFeeStatus, setCurrentFeeStatus] = useState('loading')
  const [commissions, setCommissions] = useState(commissionsFallback)
  const [commissionsStatus, setCommissionsStatus] = useState('loading')
  const [summary, setSummary] = useState(summaryFallback)
  const [search, setSearch] = useState('')

  const currentFeeLabel = useMemo(() => {
    if (currentFeeStatus === 'loading') return 'Loading commission...'
    if (currentFeeStatus === 'error') return 'Commission unavailable'
    const typeLabel = currentFee.type === 'percentage' ? 'Percentage' : 'Flat fee'
    const valueLabel =
      currentFee.type === 'percentage' ? `${currentFee.value}%` : `$${currentFee.value}`
    return `Current commission: ${valueLabel} (${typeLabel})`
  }, [currentFee, currentFeeStatus])

  const formatMoney = (value, currency = 'USD') => {
    const numeric = Number(value || 0)
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: String(currency || 'USD').toUpperCase(),
      maximumFractionDigits: 2,
    }).format(Number.isFinite(numeric) ? numeric : 0)
  }

  const filteredCommissions = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase()
    if (!normalizedQuery) return commissions
    return commissions.filter((item) =>
      [
        item.id,
        item.nanny_fullname,
        item.nanny_name,
        item.commission_percent,
        item.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    )
  }, [commissions, search])

  useEffect(() => {
    let isMounted = true

    const loadCurrentFee = async () => {
      setCurrentFeeStatus('loading')
      try {
        const response = await getCurrentPlatformFee()
        const payload = response?.data ?? response ?? null
        const type =
          payload?.type ??
          payload?.fee_type ??
          payload?.platform_fee_type ??
          payload?.current?.type ??
          ''
        const value =
          payload?.value ??
          payload?.fee_value ??
          payload?.platform_fee_value ??
          payload?.current?.value ??
          ''
        if (isMounted) {
          setCurrentFee({ type, value })
          setCurrentFeeStatus(type && value !== '' ? 'ready' : 'error')
        }
      } catch {
        if (isMounted) setCurrentFeeStatus('error')
      }
    }

    const loadCommissions = async () => {
      setCommissionsStatus('loading')
      try {
        const response = await getCommissions()
        const { rows, summary: nextSummary } = normalizeCommissionsResponse(response)
        if (isMounted) {
          setCommissions(rows)
          setSummary(nextSummary)
          setCommissionsStatus('ready')
        }
      } catch {
        if (isMounted) {
          setCommissionsStatus('error')
          setSummary(summaryFallback)
        }
      }
    }

    void Promise.all([loadCurrentFee(), loadCommissions()])

    return () => {
      isMounted = false
    }
  }, [])

  const handlePlatformFeeCalculate = async () => {
    const numericValue = Number(platformFeeValue)
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return
    }

    setFeeLoading(true)
    try {
      await calculatePlatformFee({
        type: platformFeeType,
        value: numericValue,
      })
      const [currentResponse, commissionsResponse] = await Promise.all([
        getCurrentPlatformFee(),
        getCommissions(),
      ])
      const feePayload = currentResponse?.data ?? currentResponse ?? null
      const type =
        feePayload?.type ??
        feePayload?.fee_type ??
        feePayload?.platform_fee_type ??
        feePayload?.current?.type ??
        ''
      const value =
        feePayload?.value ??
        feePayload?.fee_value ??
        feePayload?.platform_fee_value ??
        feePayload?.current?.value ??
        ''
      setCurrentFee({ type, value })
      setCurrentFeeStatus(type && value !== '' ? 'ready' : 'error')

      const { rows, summary: nextSummary } = normalizeCommissionsResponse(commissionsResponse)
      setCommissions(rows)
      setSummary(nextSummary)
      setPlatformFeeValue('')
    } catch {
      // ignore errors for now; backend handles commission rules
    } finally {
      setFeeLoading(false)
    }
  }

  const formatDateTime = (value) => {
    if (!value) return '-'
    const parsed = new Date(String(value).replace(' ', 'T'))
    if (Number.isNaN(parsed.getTime())) return String(value)
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
    }).format(parsed)
  }

  const handleExport = () => {
    if (!filteredCommissions.length) return
    exportRowsToCsv(
      'commissions-export.csv',
      ['ID', 'Nanny Name', 'Requested', 'Commission Rate', 'Commission Amount', 'Updated At'],
      filteredCommissions.map((item) => [
        item.id,
        item.nanny_fullname || item.nanny_name || '-',
        item.requested_amount ?? item.job_amount ?? '-',
        item.commission_percent ?? '-',
        item.commission_amount ?? '-',
        formatDateTime(item.updated_at),
      ]),
    )
  }

  return (
    <div className="dashboard-shell">
      <Sidebar />

      <div className="dash-content">
        <header className="dash-header commissions-header">
          <div>
            <p className="eyebrow">Finance</p>
            <h1>Commission management</h1>
            <p className="lead">
              Review real withdrawal commission revenue, update the platform rate, and inspect payout deductions.
            </p>
          </div>
          <div className="header-actions commission-actions">
            <div className="commission-controls">
              <div className="search">
                <input
                  type="search"
                  placeholder="Search commissions by ID or caregiver"
                  aria-label="Search commissions"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <button className="pill-btn ghost" type="button" onClick={handleExport} disabled={!filteredCommissions.length}>
                Export
              </button>
            </div>
            <div className="meta-card commission-meta">
              <p className="meta-title">Platform commission</p>
              <p className="meta-body">{currentFeeLabel}</p>
            </div>
          </div>
        </header>

        <section className="stat-grid">
          <article className="stat-card">
            <div className="stat-top">
              <p className="stat-label">Commission revenue</p>
              <span className="dot positive" />
            </div>
            <p className="stat-value">{formatMoney(summary.total_commission_revenue, summary.currency)}</p>
            <p className="stat-detail">{summary.withdrawal_count} tracked withdrawal deductions</p>
          </article>
          <article className="stat-card">
            <div className="stat-top">
              <p className="stat-label">{summary.current_period_label || 'Current period'}</p>
              <span className="dot info" />
            </div>
            <p className="stat-value">{formatMoney(summary.current_period_commission_revenue, summary.currency)}</p>
            <p className="stat-detail">{summary.current_period_withdrawal_count} withdrawals this period</p>
          </article>
          <article className="stat-card">
            <div className="stat-top">
              <p className="stat-label">Requested withdrawals</p>
              <span className="dot warning" />
            </div>
            <p className="stat-value">{formatMoney(summary.total_withdrawal_volume, summary.currency)}</p>
            <p className="stat-detail">Gross amount requested by nannies</p>
          </article>
          <article className="stat-card">
            <div className="stat-top">
              <p className="stat-label">Net payouts</p>
              <span className="dot alert" />
            </div>
            <p className="stat-value">{formatMoney(summary.total_payout_volume, summary.currency)}</p>
            <p className="stat-detail">Amount sent after commission deduction</p>
          </article>
        </section>

        <section className="panel table-card">
          <div className="panel-header">
            <div>
              <p className="panel-label">Commissions</p>
              <p className="panel-title">Withdrawal commission ledger</p>
            </div>
            <div className="panel-actions">
              <div className="search">
                <select
                  className="filter-select"
                  aria-label="Platform fee type"
                  value={platformFeeType}
                  onChange={(event) => setPlatformFeeType(event.target.value)}
                >
                  <option value="percentage">Percentage</option>
                  <option value="flat">Flat fee</option>
                </select>
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Value"
                  aria-label="Platform fee value"
                  value={platformFeeValue}
                  onChange={(event) => setPlatformFeeValue(event.target.value)}
                />
              </div>
              <button className="pill-btn small" onClick={handlePlatformFeeCalculate} disabled={feeLoading}>
                {feeLoading ? 'Setting...' : 'Set commission'}
              </button>
              <div className="chip info">
                {summary.current_period_label || 'Current period'} • {summary.current_period_withdrawal_count} withdrawals
              </div>
            </div>
          </div>
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>id</th>
                  <th>Nanny Name</th>
                  <th>Requested</th>
                  <th>Commission Rate</th>
                  <th>Commission Amount</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredCommissions.map((item) => (
                  <tr key={item.id}>
                    <td data-label="id">{item.id}</td>
                    <td data-label="Nanny Name">{item.nanny_fullname || item.nanny_name || '-'}</td>
                    <td data-label="requested_amount">{item.requested_amount ?? item.job_amount}</td>
                    <td data-label="commission_percent">{item.commission_percent}</td>
                    <td data-label="commission_amount">{item.commission_amount}</td>
                    <td data-label="updated_at">{formatDateTime(item.updated_at)}</td>
                  </tr>
                ))}
                {commissionsStatus === 'loading' ? (
                  <tr>
                    <td colSpan={6}>Loading commissions...</td>
                  </tr>
                ) : null}
                {commissionsStatus === 'error' ? (
                  <tr>
                    <td colSpan={6}>Unable to load commissions.</td>
                  </tr>
                ) : null}
                {commissionsStatus === 'ready' && !filteredCommissions.length ? (
                  <tr>
                    <td colSpan={6}>No withdrawal commission revenue has been recorded yet.</td>
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

export default Commissions
