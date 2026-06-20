import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import {
  API_BASE_URL,
  getAllUsers,
  getTazOrderPdf,
  getTazOrderStatuses,
  getTazStatus,
  updateParentProfileStatus,
} from '../api'
import { formatDate } from '../utils/date'

const toText = (value, fallback = '-') => {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

const normalizeStatusLabel = (value) => {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text) return null
  const lower = text.toLowerCase()
  const compact = lower.replace(/[\s._-]+/g, '')
  const normalized = compact === 'quickappcompleted' ? 'pending' : lower
  if (normalized === 'pending') return 'Unverified'
  if (normalized === 'expired') return 'Expire'
  return text
}

const parseTimestamp = (value) => {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

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
  const statusValue = normalizeStatusLabel(latest.entry?.status)
  const orderGuid = getOrderGuidFromEntry(latest.entry)
  if (!statusValue && !orderGuid) return null
  return { status: statusValue, orderGuid }
}

const _getLatestTazStatus = (payload, userId) => {
  const latest = getLatestTazOrder(payload, userId)
  return latest ? latest.status : null
}

const isEmptyValue = (value) => {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase()
    if (!trimmed || trimmed === '-' || trimmed === 'null' || trimmed === 'undefined') {
      return true
    }
  }
  return false
}

const renderInlineValue = (value) => {
  if (isEmptyValue(value)) {
    return <span className="value-null">Null</span>
  }
  return String(value)
}

const buildName = (user) => {
  if (user?.name) return user.name
  if (user?.fullname) return user.fullname
  if (user?.full_name) return user.full_name
  const first = user?.first_name || user?.firstName || user?.firstname || ''
  const last = user?.last_name || user?.lastName || user?.lastname || ''
  const combined = `${first} ${last}`.trim()
  return combined || '-'
}

const _buildStatus = (user) => {
  const direct = normalizeStatusLabel(user?.status)
  if (direct) return direct
  const isActive = user?.is_active ?? user?.isActive ?? user?.active
  if (isActive === true || isActive === 1 || isActive === '1') return 'Active'
  if (isActive === false || isActive === 0 || isActive === '0') return 'On hold'
  return 'Unverified'
}

const normalizeProfileStatus = (value) => {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return 'Unverified'
  if (text.includes('blacklist') || text.includes('reject')) return 'Blacklisted'
  if (text.includes('unverified') || text.includes('pending') || text.includes('expire')) {
    return 'Unverified'
  }
  if (text.includes('verified') || text.includes('approve') || text.includes('active')) {
    return 'Verified'
  }
  return 'Unverified'
}

const getLocationValue = (user) => {
  const address = user?.address
  if (typeof address === 'string' && !isEmptyValue(address)) return address
  return (
    user?.city ??
    user?.city_area ??
    user?.location ??
    user?.address?.city ??
    user?.address?.location ??
    null
  )
}

const getLocationParts = (value) => {
  if (isEmptyValue(value)) {
    return { city: '-', country: '-' }
  }

  const text = String(value).trim()
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length >= 2) {
    return {
      city: parts.slice(0, -1).join(', ') || '-',
      country: parts[parts.length - 1] || '-',
    }
  }

  return {
    city: text || '-',
    country: '-',
  }
}

const buildCountry = (user) => {
  if (!isEmptyValue(user?.country)) return String(user.country).trim()
  return getLocationParts(getLocationValue(user)).country
}

const buildCity = (user) => {
  const explicitCity = !isEmptyValue(user?.city) ? String(user.city).trim() : null
  const derivedCountry = buildCountry(user)
  const location = getLocationParts(getLocationValue(user))

  if (explicitCity) {
    const suffix = derivedCountry !== '-' ? `, ${derivedCountry}` : ''
    if (suffix && explicitCity.endsWith(suffix)) {
      return explicitCity.slice(0, -suffix.length) || '-'
    }
    return explicitCity
  }

  return location.city
}

const buildLocationLabel = (user) =>
  [buildCity(user), buildCountry(user)].filter((value) => !isEmptyValue(value)).join(', ') || '-'

const normalizeKidInfo = (entry) => {
  if (!entry) return null
  const hasKidFields =
    entry?.kid_id ||
    entry?.kidId ||
    entry?.kid_name ||
    entry?.kidName ||
    entry?.kid_age ||
    entry?.kidAge
  const id = hasKidFields ? entry?.kid_id ?? entry?.kidId ?? null : entry?.id ?? null
  const name = hasKidFields ? entry?.kid_name ?? entry?.kidName ?? '' : entry?.name ?? ''
  if (!id && !name) return null
  return {
    id,
    name: name || '-',
    age: toText(hasKidFields ? entry?.kid_age ?? entry?.kidAge : entry?.age, '-'),
    gender: toText(hasKidFields ? entry?.kid_gender ?? entry?.kidGender : entry?.gender, '-'),
    allergies: toText(entry?.allergies, '-'),
    medicalConditions: toText(entry?.medical_conditions ?? entry?.medicalConditions, '-'),
    notes: toText(entry?.notes, '-'),
  }
}

const collectKidsInfo = (entries) => {
  const kids = new Map()
  entries.forEach((entry) => {
    const kid = normalizeKidInfo(entry)
    if (!kid) return
    const key =
      kid.id !== null && kid.id !== undefined
        ? String(kid.id)
        : `${kid.name}-${kid.age}-${kid.gender}`
    if (!kids.has(key)) {
      kids.set(key, kid)
    }
  })
  return Array.from(kids.values())
}

const getProfileImageValue = (user) =>
  user?.profile_image_url ||
  user?.profileImageUrl ||
  user?.user_image_url ||
  user?.userImageUrl ||
  user?.profile_image ||
  user?.profileImage ||
  user?.user_image ||
  user?.userImage ||
  user?.avatar ||
  user?.image ||
  ''

const buildFileUrls = (value) => {
  const values = Array.isArray(value) ? value : [value]
  const candidates = []

  values.forEach((entry) => {
    if (!entry || typeof entry !== 'string') return
    const trimmed = entry.trim()
    if (!trimmed) return
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      candidates.push(trimmed)
      return
    }
    const normalized = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
    candidates.push(
      `${API_BASE_URL}/${normalized}`,
      `${API_BASE_URL}/storage/${normalized}`,
      `${API_BASE_URL}/public/${normalized}`,
      `${API_BASE_URL}/public/storage/${normalized}`,
      `${API_BASE_URL}/storage/app/public/${normalized}`,
    )
  })

  return Array.from(new Set(candidates))
}

const getRouteId = () => {
  if (typeof window === 'undefined') return ''
  const parts = window.location.pathname.split('/').filter(Boolean)
  const index = parts.findIndex((part) => part.toLowerCase() === 'users')
  if (index === -1) return ''
  return decodeURIComponent(parts[index + 1] || '')
}

const matchesRouteId = (user, routeId) => {
  if (!user || !routeId) return false
  const directId = user?.routeId ?? user?.id ?? user?.user_id
  if (directId !== undefined && directId !== null && String(directId) === routeId) {
    return true
  }
  const rawId = user?.id ?? user?.user_id ?? user?.userId
  if (rawId !== null && rawId !== undefined && String(rawId) === routeId) return true
  const formattedId = `P-${rawId ?? ''}`.toLowerCase()
  if (formattedId === routeId.toLowerCase()) return true
  return false
}

function UserProfile() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [imageIndex, setImageIndex] = useState(0)
  const [profileDecision, setProfileDecision] = useState('Unverified')
  const [statusNote, setStatusNote] = useState({ type: '', message: '' })
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [reportNote, setReportNote] = useState({ type: '', message: '' })
  const [reportLoading, setReportLoading] = useState(false)
  const routeId = useMemo(getRouteId, [])

  useEffect(() => {
    let isMounted = true

    const hydrateStatus = async (target) => {
      const userId =
        target?.rawId ??
        target?.id ??
        target?.user_id ??
        target?.userId ??
        target?.raw?.id ??
        target?.raw?.user_id ??
        target?.raw?.userId
      if (userId === null || userId === undefined || userId === '') return
      try {
        const orders = await getTazOrderStatuses()
        const latestOrder = getLatestTazOrder(orders, userId)
        if (!isMounted || !latestOrder) return
        setUser((current) => {
          if (!current) return current
          const next = { ...current }
          if (latestOrder.status) {
            next.status = latestOrder.status
          }
          if (latestOrder.orderGuid) {
            next.tazOrderGuid = latestOrder.orderGuid
          }
          if (current.raw && typeof current.raw === 'object' && latestOrder.status) {
            next.raw = { ...current.raw, status: latestOrder.status }
          }
          return next
        })
      } catch {
        try {
          const tazStatus = await getTazStatus(userId)
          if (!isMounted || !tazStatus) return
          setUser((current) => {
            if (!current) return current
            const next = { ...current, status: tazStatus }
            if (current.raw && typeof current.raw === 'object') {
              next.raw = { ...current.raw, status: tazStatus }
            }
            return next
          })
        } catch {
          // ignore status errors
        }
      }
    }

    const loadProfile = async () => {
      setLoading(true)
      setError('')

      const stored = (() => {
        try {
          return JSON.parse(localStorage.getItem('syttr_selected_user') || 'null')
        } catch {
          return null
        }
      })()
      const storedRouteId = localStorage.getItem('syttr_selected_user_id')

      if (
        stored &&
        (routeId === '' ||
          (storedRouteId && storedRouteId === routeId) ||
          matchesRouteId(stored, routeId))
      ) {
        if (!isMounted) return
        const storedEntries = []
        if (Array.isArray(stored?.kidsInfo)) {
          storedEntries.push(...stored.kidsInfo)
        }
        const storedSource = stored?.raw ?? stored
        if (storedSource) {
          storedEntries.push(storedSource)
        }
        const storedKids = collectKidsInfo(storedEntries)
        const storedValue = storedKids.length
          ? { ...stored, kidsInfo: storedKids }
          : stored
        setUser(storedValue)
        void hydrateStatus(storedValue)
        setLoading(false)
        return
      }

      try {
        const response = await getAllUsers()
        const payload = response?.data ?? response ?? []
        const list = Array.isArray(payload)
          ? payload
          : payload?.data ?? payload?.users ?? payload?.items ?? []
        const matchedItems = Array.isArray(list)
          ? list.filter((item) => matchesRouteId(item, routeId))
          : []
        const matched = matchedItems[0] ?? null
        if (!isMounted) return
        if (matched) {
          const kidsInfo = collectKidsInfo(matchedItems)
          const nextUser = kidsInfo.length ? { ...matched, kidsInfo } : matched
          setUser(nextUser)
          void hydrateStatus(nextUser)
        } else {
          setError('Parent profile not found.')
        }
      } catch {
        if (!isMounted) return
        setError('Unable to load parent profile.')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadProfile()

    return () => {
      isMounted = false
    }
  }, [routeId])

  const userSource = user?.raw ?? user
  useEffect(() => {
    if (!userSource) return
    setProfileDecision(normalizeProfileStatus(userSource?.status))
  }, [userSource])
  const profileImageValue = userSource ? getProfileImageValue(userSource) : ''
  const rawProfileImageValue =
    userSource?.profile_image ??
    userSource?.profileImage ??
    userSource?.user_image ??
    userSource?.userImage ??
    ''
  const profileImageSources = useMemo(
    () => buildFileUrls([profileImageValue, rawProfileImageValue]),
    [profileImageValue, rawProfileImageValue],
  )

  useEffect(() => {
    setImageIndex(0)
  }, [profileImageValue])

  const profileImageUrl = profileImageSources[imageIndex] || ''
  const kidsInfo = useMemo(() => {
    if (!user) return []
    const entries = []
    if (Array.isArray(user?.kidsInfo)) {
      entries.push(...user.kidsInfo)
    }
    if (userSource) {
      entries.push(userSource)
    }
    return collectKidsInfo(entries)
  }, [user, userSource])

  const kidsCountValue =
    kidsInfo.length ||
    toText(userSource?.number_of_kids ?? userSource?.kids ?? userSource?.kids_count, '-')

  const profileDetails = useMemo(() => {
    if (!userSource) return []
    const imageUrl = buildFileUrls(getProfileImageValue(userSource))[imageIndex] || ''
    return [
      { label: 'Name', value: buildName(userSource) },
      {
        label: 'Email',
        value: toText(userSource?.email ?? userSource?.email_address ?? userSource?.emailAddress),
      },
      {
        label: 'Phone',
        value: toText(userSource?.number ?? userSource?.phone ?? userSource?.phone_number),
      },
      { label: 'Status', value: profileDecision },
      {
        label: 'Joined',
        value: formatDate(
          userSource?.created_at ??
            userSource?.createdAt ??
            userSource?.registered_at ??
            userSource?.registeredAt ??
            userSource?.joined_at ??
            userSource?.joinedAt,
        ),
      },
      {
        label: 'Updated',
        value: formatDate(userSource?.updated_at ?? userSource?.updatedAt),
      },
      { label: 'City', value: buildCity(userSource) },
      { label: 'Country', value: buildCountry(userSource) },
      { label: 'Gender', value: toText(userSource?.gender) },
      {
        label: 'Number of kids',
        value: toText(kidsCountValue),
      },
      { label: 'About', value: toText(userSource?.about_me ?? userSource?.aboutMe) },
      {
        label: 'Profile image',
        value: imageUrl ? 'View image' : toText(getProfileImageValue(userSource)),
        href: imageUrl || null,
      },
    ]
  }, [imageIndex, kidsCountValue, profileDecision, userSource])

  const handleStatusChange = async (event) => {
    const next = event.target.value
    setProfileDecision(next)
    setStatusNote({ type: '', message: '' })

    const userId =
      userSource?.rawId ??
      userSource?.id ??
      userSource?.user_id ??
      userSource?.userId ??
      userSource?.raw?.id ??
      userSource?.raw?.user_id ??
      userSource?.raw?.userId
    if (!userId) {
      setStatusNote({ type: 'error', message: 'Unable to update profile status.' })
      return
    }

    setUpdatingStatus(true)
    try {
      await updateParentProfileStatus({ userId, status: next })
      setStatusNote({ type: 'success', message: 'Profile status updated.' })
      setUser((current) =>
        current
          ? { ...current, status: next, raw: { ...(current.raw || {}), status: next } }
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

  const handleViewReport = async () => {
    setReportNote({ type: '', message: '' })
    const userId =
      userSource?.rawId ??
      userSource?.id ??
      userSource?.user_id ??
      userSource?.userId ??
      userSource?.raw?.id ??
      userSource?.raw?.user_id ??
      userSource?.raw?.userId
    const orderGuid = user?.tazOrderGuid ?? null
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
    const userId =
      userSource?.rawId ??
      userSource?.id ??
      userSource?.user_id ??
      userSource?.userId ??
      userSource?.raw?.id ??
      userSource?.raw?.user_id ??
      userSource?.raw?.userId
    const orderGuid = user?.tazOrderGuid ?? null
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

  return (
    <div className="dashboard-shell">
      <Sidebar />

      <div className="dash-content">
        <header className="dash-header">
          <div>
            <p className="eyebrow">Profile</p>
            <h1>Parent details</h1>
            <p className="lead">Review the full profile, status, and contact details.</p>
          </div>
          <div className="header-actions">
            <button className="pill-btn ghost" type="button" onClick={() => (window.location.href = '/users')}>
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
                      <span
                        className={`profile-detail-value${
                          isEmptyValue(detail.value) ? ' value-null' : ''
                        }`}
                      >
                        {isEmptyValue(detail.value) ? 'Null' : detail.value}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="profile-side">
                {profileImageUrl ? (
                  <img
                    className="profile-image"
                    src={profileImageUrl}
                    alt="Parent profile"
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
                    aria-label="Update parent profile status"
                    disabled={updatingStatus}
                  >
                    <option value="Verified">Verified</option>
                    <option value="Unverified">Unverified</option>
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
                  {user?.tazOrderGuid ? (
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
                  <p className="panel-label">Kids</p>
                  <p className="profile-side-value">
                    {renderInlineValue(kidsCountValue)}
                  </p>
                  <p className="panel-label">Location</p>
                  <p className="profile-side-value">{renderInlineValue(buildLocationLabel(userSource))}</p>
                </div>
              </div>
            </div>
          )}
          {!loading && !error && kidsInfo.length ? (
            <div className="kids-section">
              <p className="panel-label">Kids</p>
              <div className="kids-grid">
                {kidsInfo.map((kid) => (
                  <div key={kid.id ?? kid.name} className="kids-card">
                    <p className="kids-name">{renderInlineValue(kid.name)}</p>
                    <div className="kids-meta">
                      <span>Age: {renderInlineValue(kid.age)}</span>
                      <span>Gender: {renderInlineValue(kid.gender)}</span>
                    </div>
                    <div className="kids-meta">
                      <span>Allergies: {renderInlineValue(kid.allergies)}</span>
                      <span>Medical: {renderInlineValue(kid.medicalConditions)}</span>
                    </div>
                    <p className="kids-notes">
                      Notes: {renderInlineValue(kid.notes)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

export default UserProfile
