import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import { getInterviews } from '../api'

const toText = (value, fallback = '-') => {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

const buildName = (value) => {
  if (!value) return '-'
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    if (value.name) return value.name
    const first = value.first_name ?? value.firstName ?? value.firstname ?? ''
    const last = value.last_name ?? value.lastName ?? value.lastname ?? ''
    const combined = `${first} ${last}`.trim()
    return combined || '-'
  }
  return String(value)
}

const buildNameOrNull = (value) => {
  const name = buildName(value)
  return name && name !== '-' ? name : null
}

const parseDate = (value) => {
  if (!value) return { date: '-', time: '-' }
  const dateValue = new Date(value)
  if (Number.isNaN(dateValue.getTime())) return { date: toText(value), time: '-' }
  const date = dateValue.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const time = dateValue.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
  return { date, time }
}

const formatTime12Hour = (value) => {
  if (value === null || value === undefined || value === '') return '-'
  const text = String(value).trim()
  if (!text) return '-'
  const parsedDate = new Date(text)
  if (!Number.isNaN(parsedDate.getTime())) {
    return parsedDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match) return text
  const hour24 = Number(match[1])
  const minute = match[2]
  if (!Number.isFinite(hour24) || hour24 < 0 || hour24 > 23) return text
  const period = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 || 12
  return `${hour12}:${minute} ${period}`
}

const normalizeInterview = (interview, index) => {
  const rawId =
    interview?.interview_id ??
    interview?.interviewId ??
    interview?.id ??
    interview?.schedule_id ??
    interview?.scheduleId
  const nannyId = interview?.nanny_id ?? interview?.nannyId ?? interview?.id ?? null
  const id = rawId ? `IN-${rawId}` : `IN-${index + 1}`
  const dateValue =
    interview?.interview_date ??
    interview?.interviewDate ??
    interview?.scheduled_date ??
    interview?.date
  const timeValue =
    interview?.interview_time ??
    interview?.interviewTime ??
    interview?.scheduled_time ??
    interview?.time
  const scheduledAt =
    interview?.scheduled_at ??
    interview?.scheduledAt ??
    interview?.created_at ??
    interview?.createdAt
  const date = dateValue ? parseDate(dateValue).date : parseDate(scheduledAt).date
  const time = timeValue ? formatTime12Hour(timeValue) : parseDate(scheduledAt).time
  const applicantName =
    buildNameOrNull(interview?.nanny ?? interview?.caregiver ?? interview?.nanny_name) ||
    buildNameOrNull(interview?.fullname) ||
    buildNameOrNull({
      first_name: interview?.first_name,
      last_name: interview?.last_name,
    }) ||
    '-'
  const city = toText(interview?.city, '')
  const country = toText(interview?.country, '')
  const applicantAddress = [city, country].filter(Boolean).join(', ') || '-'
  const gender = toText(interview?.gender, '-')
  const status = toText(interview?.status ?? interview?.interview_status, 'Pending')
  return {
    id,
    routeId: nannyId !== null && nannyId !== undefined ? String(nannyId) : id,
    date,
    time,
    applicantName,
    applicantAddress,
    gender,
    status,
    email: toText(interview?.email, '-'),
    phone: toText(interview?.phone, '-'),
  }
}

const getStatusTone = (status) => {
  const value = String(status || '').toLowerCase()
  if (value.includes('confirm')) return 'positive'
  if (value.includes('resched')) return 'warning'
  return 'info'
}

function InterviewsScheduled() {
  const [interviews, setInterviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const filteredInterviews = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const pendingOnly = interviews.filter(
      (interview) => String(interview.status || '').toLowerCase() === 'pending',
    )
    if (!query) return pendingOnly
    return pendingOnly.filter((interview) => {
      const haystack = [
        interview.id,
        interview.applicantName,
        interview.applicantAddress,
        interview.gender,
        interview.date,
        interview.time,
        interview.status,
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())
      return haystack.some((value) => value.includes(query))
    })
  }, [interviews, searchTerm])

  const handleRowClick = (interview) => {
    if (!interview) return
    try {
      localStorage.setItem('syttr_selected_interview', JSON.stringify(interview))
    } catch {
      // ignore storage errors
    }
    const targetId = interview.routeId || interview.id || ''
    window.location.href = `/interviews/${encodeURIComponent(targetId)}`
  }

  const handleRowKeyDown = (event, interview) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleRowClick(interview)
    }
  }

  useEffect(() => {
    let isMounted = true

    const loadInterviews = async () => {
      setLoading(true)
      setError('')
      try {
        const response = await getInterviews()
        const payload = response?.data ?? response ?? []
        const list = Array.isArray(payload)
          ? payload
          : payload?.data ?? payload?.items ?? payload?.interviews ?? []
        if (!isMounted) return
        const normalized = Array.isArray(list)
          ? list.map((item, index) => normalizeInterview(item, index))
          : []
        setInterviews(normalized)
      } catch {
        if (!isMounted) return
        setError('Unable to load interviews.')
        setInterviews([])
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadInterviews()

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
            <p className="eyebrow">Hiring pipeline</p>
            <h1>Interviews scheduled</h1>
            <p className="lead">
              Review upcoming interviews between parents and caregivers.
            </p>
          </div>

          <div className="header-actions">
            <div className="search">
              <input
                type="search"
                placeholder="Search interviews by name or ID"
                aria-label="Search interviews"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <button className="pill-btn">Schedule interview</button>
            <button className="pill-btn ghost">Export</button>
          </div>
        </header>

        <section className="panel table-card">
          <div className="panel-header">
            <div>
              <p className="panel-label">Upcoming</p>
              <p className="panel-title">Interview queue</p>
            </div>
            <div className="chip info">Next 7 days</div>
          </div>
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Applicant Name</th>
                  <th>Applicant Address</th>
                  <th>Gender</th>
                  <th>Interview Date</th>
                  <th>Interview Time</th>
                  <th>Application Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="6">Loading interviews...</td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan="6">{error}</td>
                  </tr>
                ) : filteredInterviews.length ? (
                  filteredInterviews.map((interview) => (
                    <tr
                      key={interview.id}
                      className="clickable-row"
                      onClick={() => handleRowClick(interview)}
                      onKeyDown={(event) => handleRowKeyDown(event, interview)}
                      tabIndex={0}
                      role="button"
                    >
                      <td data-label="Applicant Name">{interview.applicantName}</td>
                      <td data-label="Applicant Address">{interview.applicantAddress}</td>
                      <td data-label="Gender">{interview.gender}</td>
                      <td data-label="Interview Date">{interview.date}</td>
                      <td data-label="Interview Time">{interview.time}</td>
                      <td data-label="Application Status">
                        <span className={`chip ${getStatusTone(interview.status)}`}>
                          {interview.status}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : searchTerm.trim() ? (
                  <tr>
                    <td colSpan="6">No matching interviews found.</td>
                  </tr>
                ) : (
                  <tr>
                    <td colSpan="6">No interviews found.</td>
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

export default InterviewsScheduled
