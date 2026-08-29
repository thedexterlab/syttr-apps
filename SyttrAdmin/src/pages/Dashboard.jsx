import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import { getDashboardStats, getPayments, getSupportMessages } from '../api'
import { clearAdminSession } from '../storage'
import { formatDate } from '../utils/date'
import { exportRowsToCsv } from '../utils/csv'

const emptyStats = {
  activeNannies: null,
  liveBookings: null,
  activeUsers: null,
  recentBookings: [],
  cityUtilization: [],
  commissionRevenue: 0,
  commissionRevenueCurrentPeriod: 0,
  commissionRevenuePeriodLabel: '',
  withdrawalCount: 0,
}

const emptyOpsSnapshot = {
  openSupport: 0,
  agedSupport: 0,
  paymentExceptions: 0,
  alerts: [],
}

const toCount = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const toCoordinate = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const getCoordinates = (booking) => {
  if (!booking) return null
  const lat = toCoordinate(booking.latitude ?? booking.lat)
  const lng = toCoordinate(booking.longitude ?? booking.lng ?? booking.lon)

  if (lat !== null && lng !== null) {
    return { lat, lng }
  }

  const locationValue =
    booking.job_location ||
    booking.jobLocation ||
    booking.location ||
    booking.city
  if (typeof locationValue === 'string') {
    const parts = locationValue.split(',').map((part) => part.trim())
    if (parts.length >= 2) {
      const parsedLat = toCoordinate(parts[0])
      const parsedLng = toCoordinate(parts[1])
      if (parsedLat !== null && parsedLng !== null) {
        return { lat: parsedLat, lng: parsedLng }
      }
    }
  }

  return null
}

const buildMapEmbedUrl = ({ lat, lng }, query) => {
  if (lat !== null && lng !== null) {
    return `https://maps.google.com/maps?q=${lat},${lng}&z=14&output=embed`
  }
  if (!query) return ''
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=14&output=embed`
}

const buildMapLink = ({ lat, lng }, query) => {
  if (lat !== null && lng !== null) {
    return `https://maps.google.com/?q=${lat},${lng}`
  }
  if (!query) return ''
  return `https://maps.google.com/?q=${encodeURIComponent(query)}`
}

const buildFullName = (booking) => {
  if (booking?.fullname) return booking.fullname
  if (booking?.full_name) return booking.full_name
  const first = booking?.first_name || booking?.firstName || ''
  const last = booking?.last_name || booking?.lastName || ''
  const combined = `${first} ${last}`.trim()
  return combined || ''
}

const buildParentName = (booking) => {
  const parentName =
    booking?.parent_name ||
    booking?.parent_fullname ||
    booking?.parentName ||
    booking?.parentFullname ||
    booking?.user_name ||
    booking?.user_fullname ||
    booking?.userName ||
    booking?.userFullname ||
    (booking?.kid_name && booking?.name && booking?.name !== booking?.kid_name
      ? booking.name
      : null) ||
    (!booking?.kid_name && booking?.name ? booking.name : null) ||
    booking?.parent?.name ||
    booking?.parent?.fullname ||
    booking?.parent?.full_name ||
    booking?.user?.name ||
    booking?.user?.fullname ||
    booking?.user?.full_name
  if (parentName) return String(parentName).trim()
  if (booking?.user_id !== undefined && booking?.user_id !== null) {
    return `User #${booking.user_id}`
  }
  if (
    booking?.notification_user_id !== undefined &&
    booking?.notification_user_id !== null
  ) {
    return `User #${booking.notification_user_id}`
  }
  return '-'
}

const buildSyttrName = (booking) => {
  const syttrName =
    booking?.syttr_name ||
    booking?.syttrName ||
    booking?.nanny_name ||
    booking?.nanny_fullname ||
    booking?.nannyName ||
    booking?.nannyFullname
  if (syttrName) return syttrName
  const fullName = buildFullName(booking)
  if (fullName) return fullName
  const nannyName =
    booking?.nanny?.fullname ||
    booking?.nanny?.full_name ||
    booking?.nanny?.name
  if (nannyName) return nannyName
  if (booking?.nanny_id !== undefined && booking?.nanny_id !== null) {
    return `Nanny #${booking.nanny_id}`
  }
  if (
    booking?.notification_nanny_id !== undefined &&
    booking?.notification_nanny_id !== null
  ) {
    return `Nanny #${booking.notification_nanny_id}`
  }
  return '-'
}

const getChildNameValue = (booking) => {
  const childName =
    booking?.child_name ||
    booking?.childName ||
    booking?.kid_name ||
    booking?.kidName ||
    booking?.kid_full_name ||
    booking?.kid_fullname ||
    booking?.kidFullname ||
    booking?.name
  if (!childName) return ''
  return String(childName).trim()
}

const buildChildName = (booking) => {
  const childNames = booking?.childNames || booking?.child_names
  if (Array.isArray(childNames) && childNames.length) {
    return childNames.join(', ')
  }
  if (typeof childNames === 'string' && childNames.trim()) {
    return childNames
  }
  const childName = getChildNameValue(booking)
  if (childName) return childName
  if (booking?.kid_id !== undefined && booking?.kid_id !== null) {
    return `Child #${booking.kid_id}`
  }
  return '-'
}

const groupBookingsByNotification = (bookings) => {
  const groups = new Map()
  bookings.forEach((booking, index) => {
    const groupKey =
      booking?.notification_id ??
      booking?.notificationId ??
      booking?.id ??
      booking?.job_id ??
      `row-${index}`
    const key = String(groupKey)
    if (!groups.has(key)) {
      groups.set(key, { ...booking, childNames: [] })
    }
    const entry = groups.get(key)
    const childName = getChildNameValue(booking)
    if (childName && !entry.childNames.includes(childName)) {
      entry.childNames.push(childName)
    }
  })
  return Array.from(groups.values())
}

const getBookingStartDate = (booking) =>
  formatDate(
    booking?.start_date ??
      booking?.job_start_date ??
      booking?.created_at ??
      booking?.createdAt,
  )

const getBookingEndDate = (booking) =>
  formatDate(
    booking?.end_date ?? booking?.job_end_date ?? booking?.updated_at ?? booking?.updatedAt,
  )

const getBookingHours = (booking) => {
  const value =
    booking?.job_hours ??
    booking?.hours ??
    booking?.total_hours ??
    booking?.duration_hours ??
    booking?.totalHours ??
    booking?.experience
  if (value === null || value === undefined || value === '') return '-'
  return `${value}h`
}

const getLocationText = (booking) => {
  if (!booking) return '-'
  const location =
    booking.location ||
    booking.address ||
    booking.full_address ||
    booking.fullAddress ||
    booking.job_location ||
    booking.jobLocation
  if (location) return String(location)
  const fallbackParts = [
    booking.city,
    booking.state,
    booking.province,
    booking.country,
  ]
    .filter((part) => part !== null && part !== undefined && String(part).trim())
    .map((part) => String(part).trim())
  if (fallbackParts.length) return fallbackParts.join(', ')
  return '-'
}

const toNumberValue = (value) => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const cleaned = String(value).replace(/[^0-9.-]/g, '')
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

const getBookingEarning = (booking) =>
  toNumberValue(
    booking?.earning ??
      booking?.earnings ??
      booking?.total_earning ??
      booking?.total_earnings ??
      booking?.total_amount ??
      booking?.amount ??
      booking?.payment_amount ??
      booking?.price ??
      booking?.rate ??
      booking?.total ??
      booking?.total_cost ??
      booking?.job_total ??
      booking?.job_amount,
  )

const formatCurrency = (value) => {
  if (value === null || value === undefined) return '-'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

const hoursSince = (value) => {
  if (!value) return null
  const parsed = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return null
  return Math.max(0, (Date.now() - parsed.getTime()) / (1000 * 60 * 60))
}

const CITY_UTILIZATION_LIMIT = 4

const isCoordinateString = (value) => {
  if (typeof value !== 'string') return false
  const parts = value.split(',').map((part) => part.trim())
  if (parts.length < 2) return false
  const lat = toCoordinate(parts[0])
  const lng = toCoordinate(parts[1])
  return lat !== null && lng !== null
}

const getCityLabel = (booking) => {
  const candidates = [
    booking?.city,
    booking?.city_area,
    booking?.job_city,
    booking?.jobCity,
    booking?.location_city,
    booking?.locationCity,
    booking?.parent_city,
    booking?.parentCity,
  ]
  for (const candidate of candidates) {
    if (candidate && !isCoordinateString(String(candidate))) {
      return String(candidate)
    }
  }
  const location =
    booking?.job_location ||
    booking?.jobLocation ||
    booking?.location ||
    booking?.address ||
    booking?.full_address ||
    booking?.fullAddress
  if (location && !isCoordinateString(String(location))) {
    return String(location)
  }
  return null
}

const buildCityUtilizationFromBookings = (bookings) => {
  if (!Array.isArray(bookings) || !bookings.length) return []
  const counts = new Map()
  bookings.forEach((booking) => {
    const label = getCityLabel(booking)
    if (!label) return
    counts.set(label, (counts.get(label) || 0) + 1)
  })
  const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0)
  if (!total) return []
  return Array.from(counts.entries()).map(([label, count]) => ({
    label,
    value: Math.round((count / total) * 100),
  }))
}

const normalizeCityUtilization = (raw, bookings) => {
  let entries = []
  let hasPercentHint = false

  if (Array.isArray(raw)) {
    entries = raw
      .map((item) => {
        if (Array.isArray(item)) {
          const [label, value] = item
          const numeric = toNumberValue(value)
          return label && numeric !== null ? { label: String(label), value: numeric } : null
        }
        if (item && typeof item === 'object') {
          const label =
            item.label || item.city || item.name || item.area || item.location
          const value =
            item.value ??
            item.count ??
            item.total ??
            item.percentage ??
            item.percent ??
            item.perc ??
            item.bookings ??
            item.jobs
          if (item.percentage !== undefined || item.percent !== undefined || item.perc !== undefined) {
            hasPercentHint = true
          }
          if (typeof value === 'string' && value.includes('%')) {
            hasPercentHint = true
          }
          const numeric = toNumberValue(value)
          return label && numeric !== null ? { label: String(label), value: numeric } : null
        }
        return null
      })
      .filter(Boolean)
  } else if (raw && typeof raw === 'object') {
    entries = Object.entries(raw)
      .map(([label, value]) => {
        const numeric = toNumberValue(value)
        return numeric !== null ? { label: String(label), value: numeric } : null
      })
      .filter(Boolean)
  }

  if (!entries.length) {
    entries = buildCityUtilizationFromBookings(bookings)
  } else if (!hasPercentHint) {
    const total = entries.reduce((sum, entry) => sum + entry.value, 0)
    if (total > 0) {
      entries = entries.map((entry) => ({
        label: entry.label,
        value: Math.round((entry.value / total) * 100),
      }))
    }
  }

  return entries
    .map((entry) => ({
      label: entry.label,
      value: Math.max(0, Math.min(100, entry.value)),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, CITY_UTILIZATION_LIMIT)
}

const normalizeSupportMessages = (response) => ({
  messages: Array.isArray(response?.data) ? response.data : [],
  summary: {
    open_inbox: Number(response?.summary?.open_inbox || 0),
    closed_inbox: Number(response?.summary?.closed_inbox || 0),
    total: Number(response?.summary?.total || 0),
  },
})

const normalizePayments = (response) => {
  const payload = response?.data ?? response ?? []
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.payments)) return payload.payments
  return []
}

const isClosedSupportMessage = (message) => {
  const status = String(message?.status_key || message?.status || '').toLowerCase()
  return status === 'closed' || status === 'resolved'
}

const isPaymentException = (payment) => {
  const haystack = [
    payment?.status,
    payment?.payment_status,
    payment?.category,
    payment?.description,
    payment?.source,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return (
    haystack.includes('failed') ||
    haystack.includes('dispute') ||
    haystack.includes('chargeback') ||
    haystack.includes('refund') ||
    haystack.includes('fraud') ||
    haystack.includes('blocked') ||
    haystack.includes('review')
  )
}

function Dashboard() {
  const [dashboardStats, setDashboardStats] = useState(emptyStats)
  const [opsSnapshot, setOpsSnapshot] = useState(emptyOpsSnapshot)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedBooking, setSelectedBooking] = useState(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadStats = async (options = {}) => {
      const { showLoading = true } = options
      if (showLoading) {
        setLoading(true)
        setError('')
      }

      try {
        const [dashboardResult, supportResult, paymentsResult] = await Promise.allSettled([
          getDashboardStats(),
          getSupportMessages(),
          getPayments(),
        ])

        if (dashboardResult.status !== 'fulfilled') {
          throw dashboardResult.reason
        }

        const dashboardResponse = dashboardResult.value
        const payload = dashboardResponse?.data ?? dashboardResponse ?? {}
        const recentBookings = Array.isArray(payload?.recent_bookings)
          ? payload.recent_bookings
          : []

        if (!isMounted) return

        const rawCityUtilization =
          payload?.city_utilization ??
          payload?.cityUtilization ??
          payload?.city_stats ??
          payload?.cityStats ??
          payload?.utilization ??
          payload?.city_utilization_stats ??
          payload?.cityBreakdown ??
          payload?.city_breakdown ??
          payload?.cities
        const cityUtilization = normalizeCityUtilization(
          rawCityUtilization,
          recentBookings,
        )

        const support =
          supportResult.status === 'fulfilled'
            ? normalizeSupportMessages(supportResult.value)
            : normalizeSupportMessages(null)
        const payments =
          paymentsResult.status === 'fulfilled'
            ? normalizePayments(paymentsResult.value)
            : []
        const agedSupportCount = support.messages.filter((message) => {
          if (isClosedSupportMessage(message)) return false
          const age = hoursSince(message?.received_at || message?.created_at)
          return age !== null && age >= 24
        }).length
        const paymentExceptions = payments.filter((payment) => isPaymentException(payment)).length
        const bookingsMissingLocation = recentBookings.filter((booking) => getLocationText(booking) === '-').length

        const nextAlerts = []
        if (support.summary.open_inbox > 0) {
          nextAlerts.push({
            id: 'support-open',
            tone: 'warning',
            text: `${support.summary.open_inbox} support messages are currently open.`,
          })
        }
        if (agedSupportCount > 0) {
          nextAlerts.push({
            id: 'support-aged',
            tone: 'alert',
            text: `${agedSupportCount} support messages have been open for 24h or more.`,
          })
        }
        if (paymentExceptions > 0) {
          nextAlerts.push({
            id: 'payments-exception',
            tone: 'alert',
            text: `${paymentExceptions} payment events need manual review.`,
          })
        }
        if (bookingsMissingLocation > 0) {
          nextAlerts.push({
            id: 'bookings-location',
            tone: 'warning',
            text: `${bookingsMissingLocation} recent bookings are missing a usable location.`,
          })
        }

        if (!nextAlerts.length) {
          nextAlerts.push({
            id: 'ops-clear',
            tone: 'positive',
            text: 'No live operational alerts were detected from current dashboard data.',
          })
        }

        setDashboardStats({
          activeNannies: toCount(payload?.active_nannies),
          liveBookings: toCount(payload?.live_bookings),
          activeUsers: toCount(payload?.active_users),
          recentBookings,
          cityUtilization,
          commissionRevenue: Number(payload?.commission_revenue || 0),
          commissionRevenueCurrentPeriod: Number(payload?.commission_revenue_current_period || 0),
          commissionRevenuePeriodLabel: payload?.commission_revenue_period_label || '',
          withdrawalCount: Number(payload?.withdrawal_count || 0),
        })
        setOpsSnapshot({
          openSupport: support.summary.open_inbox,
          agedSupport: agedSupportCount,
          paymentExceptions,
          alerts: nextAlerts.slice(0, 4),
        })
      } catch (error) {
        if (!isMounted) return
        if (error?.data?.message === 'Unauthenticated.') {
          clearAdminSession()
          window.location.href = '/login'
          return
        }
        setDashboardStats({ ...emptyStats })
        setOpsSnapshot({ ...emptyOpsSnapshot })
        setError('Unable to load dashboard data.')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    const timeoutId = window.setTimeout(() => {
      void loadStats({ showLoading: false })
    }, 0)

    return () => {
      isMounted = false
      window.clearTimeout(timeoutId)
    }
  }, [])

  const displayBookings = useMemo(
    () => groupBookingsByNotification(dashboardStats.recentBookings),
    [dashboardStats.recentBookings],
  )

  const normalizedQuery = query.trim().toLowerCase()

  const filteredBookings = useMemo(() => {
    if (!normalizedQuery) return displayBookings

    return displayBookings.filter((booking) =>
      [
        buildParentName(booking),
        buildSyttrName(booking),
        buildChildName(booking),
        getLocationText(booking),
        booking?.notification_status ?? booking?.status ?? '',
        getBookingStartDate(booking),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    )
  }, [displayBookings, normalizedQuery])

  const cityUtilization = useMemo(
    () =>
      normalizedQuery
        ? buildCityUtilizationFromBookings(filteredBookings)
        : Array.isArray(dashboardStats.cityUtilization)
          ? dashboardStats.cityUtilization
          : [],
    [dashboardStats.cityUtilization, filteredBookings, normalizedQuery],
  )

  const topNannies = useMemo(() => {
    const groups = new Map()
    filteredBookings.forEach((booking) => {
      const key =
        booking?.nanny_id ??
        booking?.notification_nanny_id ??
        booking?.nannyId ??
        booking?.notificationNannyId ??
        buildSyttrName(booking)
      if (!key) return
      const id = String(key)
      if (!groups.has(id)) {
        groups.set(id, {
          key: id,
          name: buildSyttrName(booking),
          appointments: 0,
          earnings: 0,
          hasEarnings: false,
        })
      }
      const entry = groups.get(id)
      entry.appointments += 1
      const earning = getBookingEarning(booking)
      if (earning !== null) {
        entry.earnings += earning
        entry.hasEarnings = true
      }
    })

    return Array.from(groups.values())
      .sort((a, b) => {
        if (b.appointments !== a.appointments) {
          return b.appointments - a.appointments
        }
        if (b.earnings !== a.earnings) {
          return b.earnings - a.earnings
        }
        return a.name.localeCompare(b.name)
      })
      .slice(0, 5)
  }, [filteredBookings])

  const stats = useMemo(
    () => [
      {
        title: 'Active nannies',
        value: dashboardStats.activeNannies ?? '-',
        detail: 'Caregivers currently active',
        badge: 'Live roster',
        tone: 'positive',
      },
      {
        title: 'Live bookings',
        value: dashboardStats.liveBookings ?? '-',
        detail: 'Bookings in progress right now',
        badge: 'Live now',
        tone: 'info',
      },
      {
        title: 'Active users',
        value: dashboardStats.activeUsers ?? '-',
        detail: 'Parents with active accounts',
        badge: 'Current base',
        tone: 'warning',
      },
      {
        title: 'Recent bookings',
        value: dashboardStats.recentBookings.length,
        detail: 'Latest bookings received',
        badge: 'Today',
        tone: 'alert',
      },
      {
        title: 'Commission revenue',
        value: formatCurrency(dashboardStats.commissionRevenue),
        detail: `${formatCurrency(dashboardStats.commissionRevenueCurrentPeriod)} in ${dashboardStats.commissionRevenuePeriodLabel || 'current period'}`,
        badge: `${dashboardStats.withdrawalCount || 0} payouts`,
        tone: 'positive',
      },
    ],
    [dashboardStats],
  )

  const handleExportBookings = () => {
    if (!filteredBookings.length) return
    exportRowsToCsv(
      'dashboard-bookings-export.csv',
      ['Parent', 'Start date', 'Syttr', 'Hours', 'Child', 'Status', 'Location'],
      filteredBookings.map((booking) => [
        buildParentName(booking),
        getBookingStartDate(booking),
        buildSyttrName(booking),
        getBookingHours(booking),
        buildChildName(booking),
        booking?.notification_status ?? booking?.status ?? '-',
        getLocationText(booking),
      ]),
    )
  }

  const selectedCoords = selectedBooking ? getCoordinates(selectedBooking) : null
  const locationText = selectedBooking ? getLocationText(selectedBooking) : '-'
  const mapEmbedUrl = buildMapEmbedUrl(
    selectedCoords || { lat: null, lng: null },
    locationText !== '-' ? locationText : '',
  )
  const mapLink = buildMapLink(
    selectedCoords || { lat: null, lng: null },
    locationText !== '-' ? locationText : '',
  )
  const handleRowKeyDown = (event, booking) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setSelectedBooking(booking)
    }
  }
  const closeModal = () => setSelectedBooking(null)
  const jobDetails = selectedBooking
    ? [
        { label: 'Parent Name', value: buildParentName(selectedBooking) },
        { label: 'Syttr Name', value: buildSyttrName(selectedBooking) },
        { label: 'Child Name', value: buildChildName(selectedBooking) },
        {
          label: 'Status',
          value: selectedBooking.notification_status ?? selectedBooking.status ?? '-',
        },
        { label: 'Start date', value: getBookingStartDate(selectedBooking) },
        { label: 'End date', value: getBookingEndDate(selectedBooking) },
        { label: 'Hours', value: getBookingHours(selectedBooking) },
        { label: 'Location', value: locationText },
        {
          label: 'Created',
          value: formatDate(
            selectedBooking.notification_created_at ??
              selectedBooking.created_at ??
              selectedBooking.createdAt,
          ),
        },
        {
          label: 'Updated',
          value: formatDate(
            selectedBooking.notification_updated_at ??
              selectedBooking.updated_at ??
              selectedBooking.updatedAt,
          ),
        },
      ]
    : []

  return (
    <div className="dashboard-shell">
      <Sidebar />

      <div className="dash-content">
        <header className="dash-header">
          <div>
            <p className="eyebrow">Live snapshot</p>
            <h1>Operations dashboard</h1>
            <p className="lead">
              Track bookings, verifications, payouts, and support in one place.
            </p>
          </div>

          <div className="header-actions">
            <div className="search">
              <input
                type="search"
                placeholder="Search caregivers, families, bookings"
                aria-label="Search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <button className="pill-btn" type="button" onClick={() => { window.location.href = '/jobs' }}>
              Open jobs
            </button>
            <button className="pill-btn ghost" type="button" onClick={() => { window.location.href = '/support-center' }}>
              Open support
            </button>
          </div>
        </header>

        {loading ? (
          <div className="panel table-card">
            <div className="panel-header">
              <div>
                <p className="panel-label">Loading</p>
                <p className="panel-title">Fetching dashboard data...</p>
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="status error">{error}</div>
        ) : (
          <section className="stat-grid">
            {stats.map((item) => (
              <article key={item.title} className="stat-card">
                <div className="stat-top">
                  <p className="stat-label">{item.title}</p>
                  <span className={`dot ${item.tone}`} />
                </div>
                <p className="stat-value">{item.value}</p>
                <p className="stat-detail">{item.detail}</p>
                <div className={`stat-badge ${item.tone}`}>{item.badge}</div>
              </article>
            ))}
          </section>
        )}

        <section className="grid-2">
          <div className="panel chart-card">
            <div className="panel-header">
              <div>
                <p className="panel-label">Top 5 nannies</p>
                <p className="panel-title">Most appointments</p>
              </div>
              <div className="chip ghost">Updated just now</div>
            </div>
            {loading ? (
              <p className="panel-label">Loading top nannies...</p>
            ) : error ? (
              <p className="panel-label">Unable to load top nannies.</p>
            ) : topNannies.length ? (
              <div className="top-list">
                {topNannies.map((item) => (
                  <div key={item.key} className="top-row">
                    <div className="top-row-header">
                      <span className="top-name">{item.name || '-'}</span>
                      <span className="top-appointments">{item.appointments} appointments</span>
                    </div>
                    <div className="top-row-meta">
                      <span>Earned {formatCurrency(item.hasEarnings ? item.earnings : null)}</span>
                    </div>
                    <div className="top-bar">
                      <div
                        className="top-bar-fill"
                        style={{ width: '68%' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="panel-label">No appointment data yet.</p>
            )}
          </div>

          <div className="panel tasks-card">
            <div className="panel-header">
              <div>
                <p className="panel-label">City utilization</p>
                <p className="panel-title">Active coverage</p>
              </div>
            </div>
            <div className="utilization">
              {loading ? (
                <p className="panel-label">Loading city utilization...</p>
              ) : error ? (
                <p className="panel-label">Unable to load city utilization.</p>
              ) : cityUtilization.length ? (
                cityUtilization.map((item) => (
                  <div key={item.label} className="util-row">
                    <span>{item.label}</span>
                    <div className="util-meter">
                      <div
                        className="util-fill"
                        style={{ width: `${item.value}%` }}
                      />
                    </div>
                    <span className="util-value">{item.value}%</span>
                  </div>
                ))
              ) : (
                <p className="panel-label">No city utilization data.</p>
              )}
            </div>
          </div>
        </section>

        <section className="grid-2">
          <div className="panel table-card">
            <div className="panel-header">
              <div>
                <p className="panel-label">Today & tomorrow</p>
                <p className="panel-title">Recent bookings</p>
              </div>
              <button
                className="pill-btn ghost small"
                type="button"
                onClick={handleExportBookings}
                disabled={!filteredBookings.length}
              >
                Export
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Parent Name</th>
                    <th>Start date</th>
                    <th>Syttr Name</th>
                    <th>Hours</th>
                    <th>Child Name</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="5">Loading bookings...</td>
                    </tr>
                  ) : error ? (
                    <tr>
                      <td colSpan="5">Unable to load bookings.</td>
                    </tr>
                  ) : filteredBookings.length ? (
                    filteredBookings.map((booking) => (
                      <tr
                        key={booking.notification_id ?? booking.id}
                        className="clickable-row"
                        onClick={() => setSelectedBooking(booking)}
                        onKeyDown={(event) => handleRowKeyDown(event, booking)}
                        tabIndex={0}
                        role="button"
                      >
                        <td>{buildParentName(booking)}</td>
                        <td>{getBookingStartDate(booking)}</td>
                        <td>{buildSyttrName(booking)}</td>
                        <td>{getBookingHours(booking)}</td>
                        <td>{buildChildName(booking)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5">
                        {normalizedQuery ? 'No bookings matched the current search.' : 'No recent bookings found.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel alerts-card">
            <div className="panel-header">
              <div>
                <p className="panel-label">Monitors</p>
                <p className="panel-title">Ops alerts</p>
              </div>
              <button
                className="pill-btn ghost small"
                type="button"
                onClick={() => {
                  window.location.href = '/support-center'
                }}
              >
                Open support
              </button>
            </div>
            <div className="alert-list">
              {opsSnapshot.alerts.map((alert) => (
                <div key={alert.id} className="alert-row">
                  <span className={`dot ${alert.tone}`} />
                  <p>{alert.text}</p>
                </div>
              ))}
            </div>

            <div className="mini-grid">
              <div className="mini-card">
                <p className="panel-label">Payments</p>
                <p className="panel-title">Exception queue</p>
                <p className="stat-value small">{opsSnapshot.paymentExceptions}</p>
                <p className="stat-detail">Failed, disputed, blocked, or refund-related events</p>
              </div>
              <div className="mini-card">
                <p className="panel-label">Support</p>
                <p className="panel-title">Open queue</p>
                <p className="stat-value small">{opsSnapshot.openSupport}</p>
                <p className="stat-detail">{opsSnapshot.agedSupport} items aged 24h+</p>
              </div>
            </div>
          </div>
        </section>

        {selectedBooking ? (
          <div className="modal-backdrop" onClick={closeModal} role="presentation">
            <div className="modal job-modal" onClick={(event) => event.stopPropagation()}>
              <div className="job-modal-header">
                <div>
                  <p className="eyebrow">Job details</p>
                  <h2 className="job-modal-title">Booking details</h2>
                </div>
                <button className="pill-btn ghost small" type="button" onClick={closeModal}>
                  Close
                </button>
              </div>

              <div className="job-modal-grid">
                <div className="job-detail-list">
                  {jobDetails.map((detail) => (
                    <div key={detail.label} className="job-detail-row">
                      <span className="job-detail-label">{detail.label}</span>
                      <span className="job-detail-value">{detail.value}</span>
                    </div>
                  ))}
                </div>

                <div>
                  {mapEmbedUrl ? (
                    <>
                      <iframe
                        className="map-frame"
                        title="Booking location"
                        src={mapEmbedUrl}
                        loading="lazy"
                      />
                      {mapLink ? (
                        <a className="map-link" href={mapLink} target="_blank" rel="noreferrer">
                          Open in maps
                        </a>
                      ) : null}
                    </>
                  ) : (
                    <div className="map-empty">Location not available</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default Dashboard
