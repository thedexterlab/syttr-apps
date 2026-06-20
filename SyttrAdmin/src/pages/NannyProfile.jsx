import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import {
  API_BASE_URL,
  getAllNannies,
  getTazOrderPdf,
  getTazOrderStatuses,
  getTazStatus,
  updateNannyProfileStatus,
} from '../api'
import { formatDate } from '../utils/date'

const toText = (value, fallback = '-') => {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

const buildName = (nanny) => {
  if (nanny?.name) return nanny.name
  if (nanny?.fullname) return nanny.fullname
  if (nanny?.full_name) return nanny.full_name
  const first = nanny?.first_name || nanny?.firstName || ''
  const last = nanny?.last_name || nanny?.lastName || ''
  const combined = `${first} ${last}`.trim()
  return combined || '-'
}

const buildStatus = (nanny) => {
  if (typeof nanny?.status === 'string' && nanny.status.trim()) return nanny.status
  const isActive = nanny?.is_active ?? nanny?.isActive ?? nanny?.active
  if (isActive === true || isActive === 1 || isActive === '1') return 'Active'
  if (isActive === false || isActive === 0 || isActive === '0') return 'On hold'
  return 'Pending'
}

const normalizeProfileStatus = (value) => {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return 'Pending'
  if (text.includes('blacklist') || text.includes('reject')) return 'Blacklisted'
  if (text.includes('pending_verification') || text.includes('pending verification')) {
    return 'Pending Verification'
  }
  if (text.includes('approve') || text.includes('accept') || text.includes('active')) {
    return 'Approved'
  }
  if (text.includes('pending') || text.includes('hold')) return 'Pending'
  return 'Pending'
}

const getProfileStatusValue = (nanny) =>
  nanny?.profile_status ?? nanny?.profileStatus ?? nanny?.status ?? null

const buildCity = (nanny) =>
  toText(nanny?.city ?? nanny?.location ?? nanny?.address?.city ?? nanny?.address?.location, '-')

const getProfileImageValue = (nanny) =>
  nanny?.profile_image_url ||
  nanny?.profileImageUrl ||
  nanny?.profile_image ||
  nanny?.profileImage ||
  nanny?.profile_picture ||
  nanny?.profilePicture ||
  nanny?.avatar ||
  nanny?.image ||
  ''

const getResumeValue = (nanny) =>
  nanny?.resume_url || nanny?.resumeUrl || nanny?.resume || ''

const getCertificateValue = (nanny) =>
  nanny?.certificate_url || nanny?.certificateUrl || nanny?.certificate || ''

const normalizeOrderGuid = (value) => {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).trim()
  return text ? text : null
}

const isGuidLike = (value) => {
  if (!value) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value).trim(),
  )
}

const parseTimestamp = (value) => {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

const getOrderGuidFromEntry = (entry) => {
  const candidates = [
    entry?.resource_guid,
    entry?.resourceGuid,
    entry?.order_guid,
    entry?.orderGuid,
    entry?.taz_order_guid,
    entry?.tazOrderGuid,
    entry?.taz_order_id,
    entry?.tazOrderId,
    entry?.order_id,
    entry?.orderId,
  ]
    .map(normalizeOrderGuid)
    .filter(Boolean)

  const guid = candidates.find((value) => isGuidLike(value))
  return guid || candidates[0] || null
}

const resolveNannyUserId = (target) =>
  target?.user_id ??
  target?.userId ??
  target?.raw?.user_id ??
  target?.raw?.userId ??
  target?.raw?.id ??
  target?.id ??
  target?.nanny_id ??
  target?.nannyId ??
  null

const getLatestTazOrder = (payload, userId) => {
  if (userId === null || userId === undefined || userId === '') return null
  const list = Array.isArray(payload) ? payload : payload?.data ?? payload?.items ?? []
  const entries = Array.isArray(list) ? list : []
  const targetId = String(userId)
  let latest = null

  entries.forEach((entry, index) => {
    const entryUserId = entry?.user_id ?? entry?.userId ?? entry?.user?.id ?? entry?.user?.user_id
    if (entryUserId === null || entryUserId === undefined || entryUserId === '') return
    if (String(entryUserId) !== targetId) return
    const createdAt = parseTimestamp(entry?.created_at ?? entry?.createdAt)

    if (!latest) {
      latest = { entry, createdAt, index }
      return
    }
    if (createdAt !== null && (latest.createdAt === null || createdAt > latest.createdAt)) {
      latest = { entry, createdAt, index }
      return
    }
    if (createdAt === null && latest.createdAt === null && index > latest.index) {
      latest = { entry, createdAt, index }
    }
  })

  if (!latest) return null
  const orderGuid = getOrderGuidFromEntry(latest.entry)
  return orderGuid ? { orderGuid } : null
}

const buildFileUrls = (value) => {
  if (!value || typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return [trimmed]
  }
  const normalized = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
  const candidates = [
    `${API_BASE_URL}/${normalized}`,
    `${API_BASE_URL}/storage/${normalized}`,
    `${API_BASE_URL}/public/${normalized}`,
    `${API_BASE_URL}/public/storage/${normalized}`,
    `${API_BASE_URL}/storage/app/public/${normalized}`,
  ]
  return Array.from(new Set(candidates))
}

const getRouteId = () => {
  if (typeof window === 'undefined') return ''
  const parts = window.location.pathname.split('/').filter(Boolean)
  const index = parts.findIndex((part) => part.toLowerCase() === 'nannies')
  if (index === -1) return ''
  return decodeURIComponent(parts[index + 1] || '')
}

const matchesRouteId = (nanny, routeId) => {
  if (!nanny || !routeId) return false
  const directId = nanny?.routeId ?? nanny?.id
  if (directId !== undefined && directId !== null && String(directId) === routeId) {
    return true
  }
  const rawId = nanny?.id ?? nanny?.nanny_id ?? nanny?.nannyId
  if (rawId !== null && rawId !== undefined && String(rawId) === routeId) return true
  const formattedId = `N-${rawId ?? ''}`.toLowerCase()
  if (formattedId === routeId.toLowerCase()) return true
  return false
}

function NannyProfile() {
  const [nanny, setNanny] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [imageIndex, setImageIndex] = useState(0)
  const [profileDecision, setProfileDecision] = useState('Pending')
  const [statusNote, setStatusNote] = useState({ type: '', message: '' })
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [reportNote, setReportNote] = useState({ type: '', message: '' })
  const [reportLoading, setReportLoading] = useState(false)
  const routeId = useMemo(getRouteId, [])

  useEffect(() => {
    let isMounted = true

    const loadProfile = async () => {
      setLoading(true)
      setError('')

      const stored = (() => {
        try {
          return JSON.parse(localStorage.getItem('syttr_selected_nanny') || 'null')
        } catch {
          return null
        }
      })()
      const storedRouteId = localStorage.getItem('syttr_selected_nanny_id')

      if (
        stored &&
        (routeId === '' ||
          (storedRouteId && storedRouteId === routeId) ||
          matchesRouteId(stored, routeId))
      ) {
        if (!isMounted) return
        setNanny(stored)
        const storedUserId = resolveNannyUserId(stored)
        if (storedUserId !== null && storedUserId !== undefined && storedUserId !== '') {
          void (async () => {
            try {
              const orders = await getTazOrderStatuses()
              const latestOrder = getLatestTazOrder(orders, storedUserId)
              if (!isMounted || !latestOrder?.orderGuid) return
              setNanny((current) =>
                current ? { ...current, tazOrderGuid: latestOrder.orderGuid } : current,
              )
            } catch {
              try {
                await getTazStatus(storedUserId)
              } catch {
                // ignore status errors
              }
            }
          })()
        }
        setLoading(false)
        return
      }

      try {
        const response = await getAllNannies()
        const payload = response?.data ?? response ?? []
        const list = Array.isArray(payload)
          ? payload
          : payload?.data ?? payload?.nannies ?? payload?.items ?? []
        const matched = Array.isArray(list)
          ? list.find((item) => matchesRouteId(item, routeId))
          : null
        if (!isMounted) return
        if (matched) {
          setNanny(matched)
          const userId = resolveNannyUserId(matched)
          if (userId !== null && userId !== undefined && userId !== '') {
            try {
              const orders = await getTazOrderStatuses()
              const latestOrder = getLatestTazOrder(orders, userId)
              if (latestOrder?.orderGuid) {
                setNanny((current) =>
                  current ? { ...current, tazOrderGuid: latestOrder.orderGuid } : current,
                )
              }
            } catch {
              try {
                await getTazStatus(userId)
              } catch {
                // ignore status errors
              }
            }
          }
        } else {
          setError('Nanny profile not found.')
        }
      } catch {
        if (!isMounted) return
        setError('Unable to load nanny profile.')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadProfile()

    return () => {
      isMounted = false
    }
  }, [routeId])

  useEffect(() => {
    if (!nanny) return
    const rawStatus = getProfileStatusValue(nanny) ?? buildStatus(nanny)
    setProfileDecision(normalizeProfileStatus(rawStatus))
  }, [nanny])

  const profileDetails = useMemo(() => {
    if (!nanny) return []
    const resumeUrl = buildFileUrls(getResumeValue(nanny))[0] || ''
    const certificateUrl = buildFileUrls(getCertificateValue(nanny))[0] || ''
    const imageUrl = buildFileUrls(getProfileImageValue(nanny))[imageIndex] || ''
    return [
      { label: 'Name', value: buildName(nanny) },
      { label: 'Email', value: toText(nanny?.email ?? nanny?.email_address ?? nanny?.emailAddress) },
      { label: 'Phone', value: toText(nanny?.phone ?? nanny?.phone_number ?? nanny?.phoneNumber) },
      { label: 'Status', value: profileDecision },
      {
        label: 'Rating',
        value: toText(nanny?.rating ?? nanny?.avg_rating ?? nanny?.average_rating),
      },
      {
        label: 'Latest rating',
        value:
          nanny?.latest_rating_display ??
          (nanny?.latest_rating !== null && nanny?.latest_rating !== undefined
            ? `${nanny.latest_rating}/5`
            : '-'),
      },
      {
        label: 'Latest review',
        value: toText(nanny?.latest_review),
      },
      {
        label: 'Latest rated at',
        value: formatDate(nanny?.latest_rated_at),
      },
      {
        label: 'Joined',
        value: formatDate(
          nanny?.created_at ??
            nanny?.createdAt ??
            nanny?.registered_at ??
            nanny?.registeredAt ??
            nanny?.joined_at ??
            nanny?.joinedAt,
        ),
      },
      {
        label: 'Updated',
        value: formatDate(nanny?.updated_at ?? nanny?.updatedAt),
      },
      { label: 'City', value: buildCity(nanny) },
      { label: 'Country', value: toText(nanny?.country) },
      { label: 'Gender', value: toText(nanny?.gender) },
      { label: 'Age', value: toText(nanny?.age) },
      { label: 'Date of birth', value: formatDate(nanny?.date_of_birth ?? nanny?.dob) },
      {
        label: 'Experience',
        value: toText(nanny?.experience ?? nanny?.years_experience ?? nanny?.yearsExperience),
      },
      { label: 'Bio', value: toText(nanny?.bio) },
      {
        label: 'Resume',
        value: resumeUrl ? 'View file' : '-',
        href: resumeUrl || null,
      },
      {
        label: 'Certificate',
        value: certificateUrl ? 'View file' : '-',
        href: certificateUrl || null,
      },
      {
        label: 'Profile image',
        value: imageUrl ? 'View image' : toText(getProfileImageValue(nanny)),
        href: imageUrl || null,
      },
      
    ]
  }, [nanny, imageIndex, profileDecision])

  const profileImageValue = nanny ? getProfileImageValue(nanny) : ''
  const profileImageSources = useMemo(
    () => buildFileUrls(profileImageValue),
    [profileImageValue],
  )

  useEffect(() => {
    setImageIndex(0)
  }, [profileImageValue])

  const profileImageUrl = profileImageSources[imageIndex] || ''

  const handleViewReport = async () => {
    setReportNote({ type: '', message: '' })
    const userId = resolveNannyUserId(nanny)
    const orderGuid = nanny?.tazOrderGuid ?? getOrderGuidFromEntry(nanny)
    if (!userId || !orderGuid) {
      setReportNote({ type: 'error', message: 'Background check report unavailable.' })
      return
    }

    setReportLoading(true)
    try {
      const blob = await getTazOrderPdf({ userId, orderGuid })
      const url = window.URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (error) {
      setReportNote({
        type: 'error',
        message: error?.message || 'Unable to fetch background check report.',
      })
    } finally {
      setReportLoading(false)
    }
  }

  const handleDownloadReport = async () => {
    setReportNote({ type: '', message: '' })
    const userId = resolveNannyUserId(nanny)
    const orderGuid = nanny?.tazOrderGuid ?? getOrderGuidFromEntry(nanny)
    if (!userId || !orderGuid) {
      setReportNote({ type: 'error', message: 'Background check report unavailable.' })
      return
    }

    setReportLoading(true)
    try {
      const blob = await getTazOrderPdf({ userId, orderGuid })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `background-check-${userId}-${orderGuid}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (error) {
      setReportNote({
        type: 'error',
        message: error?.message || 'Unable to fetch background check report.',
      })
    } finally {
      setReportLoading(false)
    }
  }

  const handleStatusChange = async (event) => {
    const next = event.target.value
    setProfileDecision(next)
    setStatusNote({ type: '', message: '' })

    if (next === 'Pending') return

    const nannyId = nanny?.id ?? nanny?.nanny_id ?? nanny?.nannyId ?? null
    if (!nannyId) {
      setStatusNote({ type: 'error', message: 'Unable to update profile status.' })
      return
    }

    const apiStatus =
      next === 'Blacklisted'
        ? 'rejected'
        : next === 'Pending Verification'
        ? 'pending_verification'
        : 'approved'
    setUpdatingStatus(true)
    try {
      await updateNannyProfileStatus({ nannyId, status: apiStatus })
      setStatusNote({
        type: 'success',
        message:
          apiStatus === 'pending_verification'
            ? 'Moved to pending verification. User will be sent to Get Verified.'
            : 'Profile status updated.',
      })
      setNanny((current) =>
        current
          ? { ...current, profile_status: apiStatus, status: apiStatus }
          : current,
      )
    } catch (error) {
      setStatusNote({
        type: 'error',
        message: error?.message || 'Unable to update profile status.',
      })
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
            <p className="eyebrow">Profile</p>
            <h1>Nanny details</h1>
            <p className="lead">Review the full profile, status, and documents.</p>
          </div>
          <div className="header-actions">
            <button className="pill-btn ghost" type="button" onClick={() => (window.location.href = '/nannies')}>
              Back to list
            </button>
          </div>
        </header>

        <section className="panel profile-panel">
          {loading ? (
            <p className="panel-label">Loading profile...</p>
          ) : error ? (
            <p className="status error">{error}</p>
          ) : (
            <div className="profile-grid">
              <div className="profile-detail-list">
                {profileDetails.map((detail) => (
                  <div key={detail.label} className="profile-detail-row">
                    <span className="profile-detail-label">{detail.label}</span>
                    {detail.href ? (
                      <a
                        className="profile-detail-link"
                        href={detail.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {detail.value}
                      </a>
                    ) : (
                      <span className="profile-detail-value">{detail.value}</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="profile-side">
                {profileImageUrl ? (
                  <img
                    className="profile-image"
                    src={profileImageUrl}
                    alt="Nanny profile"
                    onError={() => {
                      setImageIndex((current) => {
                        const next = current + 1
                        return next < profileImageSources.length ? next : current
                      })
                    }}
                  />
                ) : (
                  <div className="profile-image placeholder">No image</div>
                )}
                <div className="profile-side-card">
                  <p className="panel-label">Status</p>
                  <select
                    className="filter-select"
                    value={profileDecision}
                    onChange={handleStatusChange}
                    disabled={updatingStatus}
                    aria-label="Update profile status"
                  >
                    <option value="Pending">Pending</option>
                    <option value="Pending Verification">Pending Verification</option>
                    <option value="Approved">Approved</option>
                    <option value="Blacklisted">Blacklisted</option>
                  </select>
                  {statusNote.message ? (
                    <div
                      className={`status ${statusNote.type === 'error' ? 'error' : 'success'}`}
                    >
                      {statusNote.message}
                    </div>
                  ) : null}
                  <p className="panel-label">Background check</p>
                  {nanny?.tazOrderGuid || getOrderGuidFromEntry(nanny) ? (
                    <>
                      <button
                        className="pill-btn"
                        type="button"
                        onClick={handleViewReport}
                        disabled={reportLoading}
                      >
                        {reportLoading ? 'Opening report...' : 'View report'}
                      </button>
                      <button
                        className="pill-btn ghost"
                        type="button"
                        onClick={handleDownloadReport}
                        disabled={reportLoading}
                      >
                        {reportLoading ? 'Preparing PDF...' : 'Download PDF'}
                      </button>
                    </>
                  ) : (
                    <p className="profile-side-value">No report available</p>
                  )}
                  {reportNote.message ? (
                    <div
                      className={`status ${reportNote.type === 'error' ? 'error' : 'success'}`}
                    >
                      {reportNote.message}
                    </div>
                  ) : null}
                  <p className="panel-label">Location</p>
                  <p className="profile-side-value">
                    {buildCity(nanny)}, {toText(nanny?.country)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default NannyProfile
