import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import brandLogo from '../../assets/Logo/logo.png'
import { API_BASE_URL, getInterviewsByNanny, updateNannyProfileStatus } from '../api'

const getStoredInterview = () => {
  try {
    const stored = localStorage.getItem('syttr_selected_interview')
    if (stored) return JSON.parse(stored)
  } catch {
    // ignore malformed storage
  }
  return null
}

const toText = (value, fallback = '-') => {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

const normalizeDecision = (value) => {
  const text = String(value || '').trim().toLowerCase()
  if (text === 'pending_verification' || text === 'pending verification') return 'Pending Verification'
  if (text === 'approved' || text === 'accepted' || text === 'accept') return 'Approved'
  if (text === 'rejected' || text === 'reject') return 'Rejected'
  if (text === 'pending') return 'Pending'
  return 'Pending'
}

const buildApplicantAddress = (payload) => {
  const city = toText(payload?.city, '')
  const country = toText(payload?.country, '')
  return [city, country].filter(Boolean).join(', ') || '-'
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

const normalizeInterview = (payload) => {
  if (!payload) return null
  const idValue = payload?.interview_id ?? payload?.interviewId ?? payload?.id
  const id = idValue ? `IN-${idValue}` : '-'
  const nannyId = payload?.nanny_id ?? payload?.nannyId ?? payload?.id ?? null
  const date = toText(payload?.interview_date, '-')
  const time = formatTime12Hour(payload?.interview_time)
  const status = toText(payload?.status, 'Pending')
  const applicantName =
    toText(payload?.fullname, '') ||
    [payload?.first_name, payload?.last_name].filter(Boolean).join(' ') ||
    '-'
  const imageUrl =
    payload?.nanny_image_url ||
    (payload?.profile_image ? `${API_BASE_URL}/${payload.profile_image}` : null)
  return {
    id,
    nannyId,
    date,
    time,
    status,
    applicantName,
    applicantAddress: buildApplicantAddress(payload),
    gender: toText(payload?.gender, '-'),
    email: toText(payload?.email, '-'),
    phone: toText(payload?.phone, '-'),
    age: toText(payload?.age, '-'),
    dateOfBirth: toText(payload?.date_of_birth, '-'),
    experience: toText(payload?.experience, '-'),
    bio: toText(payload?.bio, '-'),
    resume: toText(payload?.resume, '-'),
    certificate: toText(payload?.certificate, '-'),
    createdAt: toText(payload?.created_at, '-'),
    updatedAt: toText(payload?.updated_at, '-'),
    imageUrl,
  }
}

function InterviewDetails() {
  const stored = useMemo(getStoredInterview, [])
  const [interview, setInterview] = useState(stored)
  const [decision, setDecision] = useState(normalizeDecision(stored?.status))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [statusNote, setStatusNote] = useState('')
  const [updatingStatus, setUpdatingStatus] = useState(false)
  useEffect(() => {
    const path = window.location.pathname || ''
    const parts = path.split('/').filter(Boolean)
    const nannyId = parts.length >= 2 ? parts[parts.length - 1] : ''
    if (!nannyId) return

    let isMounted = true

    const loadDetails = async () => {
      setLoading(true)
      setError('')
      try {
        const response = await getInterviewsByNanny(nannyId)
        const payload = response?.interviews ?? response?.data?.interviews ?? response?.data ?? []
        const list = Array.isArray(payload) ? payload : []
        if (!isMounted) return
        const latest = list.length ? normalizeInterview(list[0]) : null
        setInterview(latest)
        if (latest?.status) {
          setDecision(normalizeDecision(latest.status))
        }
      } catch {
        if (!isMounted) return
        setError('Unable to load interview details.')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadDetails()
    return () => {
      isMounted = false
    }
  }, [])

  const handleDecisionChange = async (event) => {
    const next = event.target.value
    setDecision(next)
    setStatusNote('')

    if (!interview?.nannyId || next === 'Pending') return

    const normalizedStatus = next.toLowerCase()
    const apiStatus =
      normalizedStatus === 'pending verification'
        ? 'pending_verification'
        : normalizedStatus
    if (!['approved', 'rejected', 'pending_verification'].includes(apiStatus)) return

    setUpdatingStatus(true)
    try {
      await updateNannyProfileStatus({
        nannyId: interview.nannyId,
        status: apiStatus,
      })
      setStatusNote(
        apiStatus === 'pending_verification'
          ? 'Moved to pending verification. User will be sent to Get Verified.'
          : 'Profile status updated.'
      )
    } catch (error) {
      setStatusNote(error?.message || 'Unable to update profile status.')
    } finally {
      setUpdatingStatus(false)
    }
  }

  return (
    <div className="dashboard-shell">
      <Sidebar />

      <div className="dash-content">
        <header className="dash-header">
          <div>
            <p className="eyebrow">Interview details</p>
            <h1>Syttr applicant</h1>
            <p className="lead">Review interview info and applicant profile.</p>
          </div>
          <div className="header-actions">
            <button
              className="pill-btn ghost"
              type="button"
              onClick={() => (window.location.href = '/interviews')}
            >
              Back to interviews
            </button>
          </div>
        </header>

        <section className="panel profile-panel">
          {loading ? (
            <p className="panel-label">Loading interview details...</p>
          ) : error ? (
            <p className="panel-label">{error}</p>
          ) : interview ? (
            <div className="profile-grid">
              <div className="profile-content">
                <div className="panel job-detail-list">
                  {[
                    { label: 'Interview ID', value: interview.id },
                    { label: 'Interview Date', value: interview.date },
                    { label: 'Interview Time', value: interview.time },
                    { label: 'Application Status', value: interview.status },
                    { label: 'Created At', value: interview.createdAt },
                    { label: 'Updated At', value: interview.updatedAt },
                  ].map((detail) => (
                    <div key={detail.label} className="job-detail-row">
                      <span className="job-detail-label">{detail.label}</span>
                      <span className="job-detail-value">{detail.value}</span>
                    </div>
                  ))}
                  <div className="job-detail-row">
                    <span className="job-detail-label">Decision</span>
                  <span className="job-detail-value">
                    <select
                      className="filter-select"
                      value={decision}
                      onChange={handleDecisionChange}
                      aria-label="Set interview decision"
                      disabled={updatingStatus}
                    >
                      <option value="Pending">Pending</option>
                      <option value="Pending Verification">Pending Verification</option>
                      <option value="Approved">Approved</option>
                      <option value="Rejected">Rejected</option>
                    </select>
                  </span>
                </div>
                {statusNote ? <div className="status success">{statusNote}</div> : null}
              </div>
                <div className="panel job-detail-list">
                  {[
                    { label: 'Syttr', value: interview.applicantName },
                    { label: 'Applicant Address', value: interview.applicantAddress },
                    { label: 'Gender', value: interview.gender },
                    { label: 'Email', value: interview.email },
                    { label: 'Phone', value: interview.phone },
                    { label: 'Age', value: interview.age },
                    { label: 'Date of Birth', value: interview.dateOfBirth },
                    { label: 'Experience', value: interview.experience },
                    { label: 'Resume', value: interview.resume },
                    { label: 'Certificate', value: interview.certificate },
                  ].map((detail) => (
                    <div key={detail.label} className="job-detail-row">
                      <span className="job-detail-label">{detail.label}</span>
                      <span className="job-detail-value">{detail.value}</span>
                    </div>
                  ))}
                  <div className="job-detail-row">
                    <span className="job-detail-label">Bio</span>
                    <span className="job-detail-value">{interview.bio}</span>
                  </div>
                </div>
              </div>
              <div className="profile-side">
                <div className="profile-side-card">
                  <p className="panel-label">Profile photo</p>
                  <img
                    className="profile-image"
                    src={interview.imageUrl || brandLogo}
                    alt={interview.applicantName}
                    onError={(event) => {
                      event.currentTarget.onerror = null
                      event.currentTarget.src = brandLogo
                    }}
                  />
                </div>
                <div className="profile-side-card">
                  <p className="panel-label">Applicant</p>
                  <p className="profile-side-value">{interview.applicantName}</p>
                  <p className="panel-label">Status</p>
                  <p className="profile-side-value">{interview.status}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="panel-label">No interview selected.</p>
          )}
        </section>
      </div>
    </div>
  )
}

export default InterviewDetails
