import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import { getJobsWithDetails } from '../api'
import { exportRowsToCsv } from '../utils/csv'
import { formatDate } from '../utils/date'

const _toText = (value, fallback = '-') => {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

const normalizeJobStatus = (value) => {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text) return null
  const compact = text.toLowerCase().replace(/[\s._-]+/g, '')
  if (compact === 'quickappcompleted') return 'Pending'
  return text
}

const buildFullName = (item) => {
  if (item?.fullname) return item.fullname
  if (item?.full_name) return item.full_name
  const first = item?.first_name || item?.firstName || ''
  const last = item?.last_name || item?.lastName || ''
  const combined = `${first} ${last}`.trim()
  return combined || ''
}

const buildParentName = (job) => {
  const parentName =
    job?.parent_name ||
    job?.parent_fullname ||
    job?.parentName ||
    job?.parentFullname ||
    job?.user_name ||
    job?.user_fullname ||
    job?.userName ||
    job?.userFullname ||
    (job?.kid_name && job?.name && job?.name !== job?.kid_name ? job.name : null) ||
    (!job?.kid_name && job?.name ? job.name : null) ||
    job?.parent?.name ||
    job?.parent?.fullname ||
    job?.parent?.full_name ||
    job?.user?.name ||
    job?.user?.fullname ||
    job?.user?.full_name
  if (parentName) return String(parentName).trim()
  return '-'
}

const buildSyttrName = (job) => {
  const syttrName =
    job?.syttr_name ||
    job?.syttrName ||
    job?.nanny_name ||
    job?.nanny_fullname ||
    job?.nannyName ||
    job?.nannyFullname
  if (syttrName) return syttrName
  const fullName = buildFullName(job)
  if (fullName) return fullName
  const nannyName =
    job?.nanny?.fullname || job?.nanny?.full_name || job?.nanny?.name
  if (nannyName) return nannyName
  return '-'
}

const getChildNameValue = (job) => {
  const childName =
    job?.child_name ||
    job?.childName ||
    job?.kid_name ||
    job?.kidName ||
    job?.kid_full_name ||
    job?.kid_fullname ||
    job?.kidFullname
  if (!childName) return ''
  return String(childName).trim()
}

const buildChildName = (job) => {
  const childNames = job?.childNames || job?.child_names
  if (Array.isArray(childNames) && childNames.length) {
    return childNames.join(', ')
  }
  if (typeof childNames === 'string' && childNames.trim()) {
    return childNames
  }
  const childName = getChildNameValue(job)
  if (childName) return childName
  return '-'
}

const groupJobsByNotification = (jobs) => {
  const groups = new Map()
  jobs.forEach((job, index) => {
    const groupKey =
      job?.notification_id ??
      job?.notificationId ??
      job?.job_id ??
      job?.jobId ??
      job?.id ??
      `row-${index}`
    const key = String(groupKey)
    if (!groups.has(key)) {
      groups.set(key, { ...job, childNames: [], _childIds: new Set() })
    }
    const entry = groups.get(key)
    const childName = getChildNameValue(job)
    const kidId = job?.kid_id ?? job?.kidId
    if (kidId !== null && kidId !== undefined) {
      const id = String(kidId)
      if (!entry._childIds.has(id)) {
        entry._childIds.add(id)
        if (childName) entry.childNames.push(childName)
      }
    } else if (childName && !entry.childNames.includes(childName)) {
      entry.childNames.push(childName)
    }
  })
  return Array.from(groups.values()).map((entry) => {
    const normalized = { ...entry }
    delete normalized._childIds
    return normalized
  })
}

const getJobStatus = (job) => {
  const rawStatus =
    job?.status ||
    job?.job_status ||
    job?.notification_status ||
    job?.application_status
  const normalized = normalizeJobStatus(rawStatus)
  return normalized ?? '-'
}

const getStatusTone = (status) => {
  const value = String(status || '').toLowerCase()
  if (value.includes('active') || value.includes('accepted') || value.includes('completed')) {
    return 'positive'
  }
  return 'warning'
}

const getJobStartDate = (job) =>
  formatDate(
    job?.start_date ??
      job?.job_start_date ??
      job?.notification_created_at ??
      job?.created_at ??
      job?.createdAt,
  )

const getJobEndDate = (job) =>
  formatDate(job?.end_date ?? job?.job_end_date ?? job?.updated_at ?? job?.updatedAt)

const getJobHours = (job) => {
  const value =
    job?.job_hours ??
    job?.hours ??
    job?.total_hours ??
    job?.duration_hours ??
    job?.totalHours
  if (value === null || value === undefined || value === '') return '-'
  return `${value}h`
}

const getJobLocation = (job) => {
  const location =
    job?.job_location ||
    job?.jobLocation ||
    job?.location ||
    job?.address ||
    job?.full_address ||
    job?.fullAddress
  if (location) return String(location)
  const fallbackParts = [job?.city, job?.state, job?.province, job?.country]
    .filter((part) => part !== null && part !== undefined && String(part).trim())
    .map((part) => String(part).trim())
  if (fallbackParts.length) return fallbackParts.join(', ')
  return '-'
}

const getJobPrice = (job) => {
  const value =
    job?.price ??
    job?.job_price ??
    job?.amount ??
    job?.job_amount ??
    job?.total_amount
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
}

const parseAmount = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

const parseJobDate = (job) => {
  const raw =
    job?.start_date ??
    job?.job_start_date ??
    job?.notification_created_at ??
    job?.created_at ??
    job?.createdAt ??
    null
  if (!raw) return null
  const parsed = new Date(String(raw).replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

const formatDateKey = (date) => date.toISOString().slice(0, 10)

const getStartOfWeek = (date) => {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1) - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

const buildChartBuckets = (jobs, granularity) => {
  const now = new Date()
  const buckets = []
  const totals = new Map()

  if (granularity === 'week') {
    const start = getStartOfWeek(now)
    for (let i = 0; i < 7; i += 1) {
      const date = new Date(start)
      date.setDate(start.getDate() + i)
      const key = formatDateKey(date)
      buckets.push({ key, label: date.toLocaleDateString('en-US', { weekday: 'short' }) })
    }
  } else if (granularity === 'month') {
    const year = now.getFullYear()
    const month = now.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day)
      const key = formatDateKey(date)
      buckets.push({ key, label: String(day) })
    }
  } else if (granularity === 'year') {
    const year = now.getFullYear()
    for (let month = 0; month < 12; month += 1) {
      const date = new Date(year, month, 1)
      const key = `${year}-${String(month + 1).padStart(2, '0')}`
      const label = date.toLocaleDateString('en-US', { month: 'short' })
      buckets.push({ key, label })
    }
  } else {
    const key = formatDateKey(now)
    buckets.push({ key, label: key })
  }

  jobs.forEach((job) => {
    const date = parseJobDate(job.raw || job)
    if (!date) return
    let key = formatDateKey(date)
    if (granularity === 'year') {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    }
    if (!buckets.find((bucket) => bucket.key === key)) return
    const current = totals.get(key) || 0
    totals.set(key, current + parseAmount(job.price))
  })

  return buckets.map((bucket) => ({
    ...bucket,
    total: totals.get(bucket.key) || 0,
  }))
}

const normalizeJob = (job, index) => ({
  key:
    job?.job_id ??
    job?.id ??
    job?.notification_job_id ??
    job?.jobId ??
    `job-${index + 1}`,
  routeId:
    job?.notification_id ??
    job?.notificationId ??
    job?.job_id ??
    job?.jobId ??
    job?.id ??
    `job-${index + 1}`,
  parentName: buildParentName(job),
  syttrName: buildSyttrName(job),
  childName: buildChildName(job),
  status: getJobStatus(job),
  startDate: getJobStartDate(job),
  endDate: getJobEndDate(job),
  hours: getJobHours(job),
  location: getJobLocation(job),
  price: getJobPrice(job),
  raw: job,
})

function Jobs() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [chartFilter, setChartFilter] = useState('week')

  const chartData = useMemo(
    () => buildChartBuckets(jobs, chartFilter),
    [jobs, chartFilter],
  )
  const maxChartTotal = chartData.reduce((max, item) => Math.max(max, item.total), 0) || 1

  const handleExport = () => {
    if (!jobs.length) return
    exportRowsToCsv(
      'jobs-export.csv',
      [
        'Parent Name',
        'Syttr Name',
        'Child Name',
        'Status',
        'Start Date',
        'End Date',
        'Hours',
        'Price',
        'Location',
      ],
      jobs.map((job) => [
        job.parentName,
        job.syttrName,
        job.childName,
        job.status,
        job.startDate,
        job.endDate,
        job.hours,
        job.price,
        job.location,
      ]),
    )
  }

  const handleRowClick = (job) => {
    if (!job) return
    try {
      localStorage.setItem('syttr_selected_job', JSON.stringify(job.raw || job))
      localStorage.setItem('syttr_selected_job_id', job.routeId || job.key)
    } catch {
      // ignore storage errors
    }
    const targetId = job.routeId || job.key
    window.location.href = `/jobs/${encodeURIComponent(targetId)}`
  }

  const handleRowKeyDown = (event, job) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleRowClick(job)
    }
  }

  useEffect(() => {
    let isMounted = true

    const loadJobs = async () => {
      setLoading(true)
      setError('')

      try {
        const response = await getJobsWithDetails()
        const payload = response?.data ?? response ?? []
        const list = Array.isArray(payload?.new_jobs)
          ? payload.new_jobs
          : Array.isArray(payload)
            ? payload
            : payload?.data ?? payload?.jobs ?? payload?.items ?? []

        if (!isMounted) return
        const grouped = Array.isArray(list) ? groupJobsByNotification(list) : []
        const normalized = grouped.map((item, index) => normalizeJob(item, index))
        setJobs(normalized)
      } catch {
        if (!isMounted) return
        setError('Unable to load jobs.')
        setJobs([])
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadJobs()

    return () => {
      isMounted = false
    }
  }, [])

  return (
    <div className="dashboard-shell">
      <Sidebar />

      <div className="dash-content">
        <header className="dash-header">
          <div>
            <p className="eyebrow">Operations</p>
            <h1>Jobs management</h1>
            <p className="lead">Track live, upcoming, and recent bookings in one place.</p>
          </div>

          <div className="header-actions">
            <div className="search">
              <input type="search" placeholder="Search jobs by parent or nanny" aria-label="Search jobs" />
            </div>
            <button className="pill-btn ghost" type="button" onClick={handleExport} disabled={loading || !jobs.length}>
              Export
            </button>
          </div>
        </header>

        <section className="panel chart-card">
          <div className="panel-header">
            <div>
              <p className="panel-label">Revenue</p>
              <p className="panel-title">Job price totals</p>
            </div>
            <div className="filters">
              {['week', 'month', 'year'].map((filter) => (
                <button
                  key={filter}
                  className={`chip${chartFilter === filter ? ' info' : ''}`}
                  type="button"
                  onClick={() => setChartFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
          <div className={`bar-chart ${chartFilter}`}>
            {chartData.length ? (
              chartData.map((item) => (
                <div key={item.key} className="bar-item">
                  <div
                    className="bar"
                    style={{ height: `${(item.total / maxChartTotal) * 100}%` }}
                  >
                    <span className="bar-value">${item.total.toFixed(2)}</span>
                  </div>
                  <span className="bar-label">{item.label}</span>
                </div>
              ))
            ) : (
              <p className="panel-label">No chart data available.</p>
            )}
          </div>
        </section>

        <section className="panel table-card">
          <div className="panel-header">
            <div>
              <p className="panel-label">Bookings</p>
              <p className="panel-title">Jobs</p>
            </div>
            <div className="chip info">Sorted by latest</div>
          </div>
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Parent Name</th>
                  <th>Syttr Name</th>
                  <th>Child Name</th>
                  <th>Status</th>
                  <th>Start date</th>
                  <th>End date</th>
                  <th>Hours</th>
                  <th>Price</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="9">Loading jobs...</td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan="9">{error}</td>
                  </tr>
                ) : jobs.length ? (
                  jobs.map((job) => (
                    <tr
                      key={job.key}
                      className="clickable-row"
                      onClick={() => handleRowClick(job)}
                      onKeyDown={(event) => handleRowKeyDown(event, job)}
                      tabIndex={0}
                      role="button"
                    >
                      <td data-label="Parent Name">{job.parentName}</td>
                      <td data-label="Syttr Name">{job.syttrName}</td>
                      <td data-label="Child Name">{job.childName}</td>
                      <td data-label="Status">
                        <span className={`chip ${getStatusTone(job.status)}`}>
                          {job.status}
                        </span>
                      </td>
                      <td data-label="Start date">{job.startDate}</td>
                      <td data-label="End date">{job.endDate}</td>
                      <td data-label="Hours">{job.hours}</td>
                      <td data-label="Price">{job.price}</td>
                      <td data-label="Location">{job.location}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="9">No jobs found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

export default Jobs
