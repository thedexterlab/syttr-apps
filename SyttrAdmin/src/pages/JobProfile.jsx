import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import { getJobsWithDetails } from '../api'
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

const toCoordinate = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const getCoordinates = (job) => {
  if (!job) return null
  const lat = toCoordinate(job.latitude ?? job.lat)
  const lng = toCoordinate(job.longitude ?? job.lng ?? job.lon)
  if (lat !== null && lng !== null) {
    return { lat, lng }
  }
  const locationValue =
    job.job_location || job.jobLocation || job.location || job.city
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
  if (job?.user_id !== undefined && job?.user_id !== null) {
    return `User #${job.user_id}`
  }
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
  if (job?.nanny_id !== undefined && job?.nanny_id !== null) {
    return `Nanny #${job.nanny_id}`
  }
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
  if (job?.kid_id !== undefined && job?.kid_id !== null) {
    return `Child #${job.kid_id}`
  }
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

const getJobTime = (value) => {
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
}

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

const getRouteId = () => {
  if (typeof window === 'undefined') return ''
  const parts = window.location.pathname.split('/').filter(Boolean)
  const index = parts.findIndex((part) => part.toLowerCase() === 'jobs')
  if (index === -1) return ''
  return decodeURIComponent(parts[index + 1] || '')
}

const matchesRouteId = (job, routeId) => {
  if (!job || !routeId) return false
  const candidates = [
    job?.notification_id,
    job?.notificationId,
    job?.job_id,
    job?.jobId,
    job?.notification_job_id,
    job?.notificationJobId,
    job?.id,
  ]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value))
  return candidates.includes(routeId)
}

function JobProfile() {
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const routeId = useMemo(getRouteId, [])

  useEffect(() => {
    let isMounted = true

    const loadJob = async () => {
      setLoading(true)
      setError('')

      const stored = (() => {
        try {
          return JSON.parse(localStorage.getItem('syttr_selected_job') || 'null')
        } catch {
          return null
        }
      })()
      const storedRouteId = localStorage.getItem('syttr_selected_job_id')

      if (
        stored &&
        (routeId === '' ||
          (storedRouteId && storedRouteId === routeId) ||
          matchesRouteId(stored, routeId))
      ) {
        if (!isMounted) return
        setJob(stored)
        setLoading(false)
        return
      }

      try {
        const response = await getJobsWithDetails()
        const payload = response?.data ?? response ?? []
        const list = Array.isArray(payload?.new_jobs)
          ? payload.new_jobs
          : Array.isArray(payload)
            ? payload
            : payload?.data ?? payload?.jobs ?? payload?.items ?? []
        const grouped = Array.isArray(list) ? groupJobsByNotification(list) : []
        const matched = grouped.find((item) => matchesRouteId(item, routeId))
        if (!isMounted) return
        if (matched) {
          setJob(matched)
        } else {
          setError('Job not found.')
        }
      } catch {
        if (!isMounted) return
        setError('Unable to load job details.')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadJob()

    return () => {
      isMounted = false
    }
  }, [routeId])

  const locationText = job ? getJobLocation(job) : '-'
  const selectedCoords = job ? getCoordinates(job) : null
  const mapEmbedUrl = buildMapEmbedUrl(
    selectedCoords || { lat: null, lng: null },
    locationText !== '-' ? locationText : '',
  )
  const mapLink = buildMapLink(
    selectedCoords || { lat: null, lng: null },
    locationText !== '-' ? locationText : '',
  )

  const jobDetails = job
    ? [
        {
          label: 'Job ID',
          value:
            job.job_id ??
            job.notification_job_id ??
            job.jobId ??
            job.notificationJobId ??
            '-',
        },
        {
          label: 'Notification ID',
          value: job.notification_id ?? job.notificationId ?? '-',
        },
        { label: 'Parent Name', value: buildParentName(job) },
        { label: 'Syttr Name', value: buildSyttrName(job) },
        { label: 'Child Name', value: buildChildName(job) },
        { label: 'Status', value: getJobStatus(job) },
        { label: 'Start date', value: getJobStartDate(job) },
        { label: 'End date', value: getJobEndDate(job) },
        { label: 'Start time', value: getJobTime(job.start_time ?? job.job_start_time) },
        { label: 'End time', value: getJobTime(job.end_time ?? job.job_end_time) },
        { label: 'Hours', value: getJobHours(job) },
        { label: 'Location', value: locationText },
        {
          label: 'Created',
          value: formatDate(job.notification_created_at ?? job.created_at),
        },
        { label: 'Updated', value: formatDate(job.updated_at) },
      ]
    : []

  return (
    <div className="dashboard-shell">
      <Sidebar />

      <div className="dash-content">
        <header className="dash-header">
          <div>
            <p className="eyebrow">Bookings</p>
            <h1>Job details</h1>
            <p className="lead">Review the full booking detail and location.</p>
          </div>
          <div className="header-actions">
            <button className="pill-btn ghost" type="button" onClick={() => (window.location.href = '/jobs')}>
              Back to list
            </button>
          </div>
        </header>

        <section className="panel job-detail-panel">
          {loading ? (
            <p className="panel-label">Loading job...</p>
          ) : error ? (
            <p className="status error">{error}</p>
          ) : (
            <div className="job-detail-grid">
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
                      title="Job location"
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
          )}
        </section>
      </div>
    </div>
  )
}

export default JobProfile
