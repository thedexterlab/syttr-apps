import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import {
  API_BASE_URL,
  getAllUsers,
  getJobsCountByUser,
  getTazOrderPdf,
  getTazOrderStatuses,
} from '../api'
import { exportRowsToCsv } from '../utils/csv'
import { formatDate } from '../utils/date'

const formatId = (value, prefix, index) => {
  if (value === null || value === undefined || value === '') {
    return `${prefix}-${index + 1}`
  }
  if (typeof value === 'number') return `${prefix}-${value}`
  return String(value)
}

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
  if (compact === 'quickappcompleted') return 'Pending'
  if (lower === 'pending') return 'Unverified'
  if (lower === 'expired') return 'Expired'
  return text
}

const toNumberValue = (value) => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const cleaned = String(value).replace(/[^0-9.-]/g, '')
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

const buildInitials = (value) => {
  const input = String(value || '').trim()
  if (!input) return 'NA'
  const parts = input.split(' ').filter(Boolean)
  const initials = parts.slice(0, 2).map((part) => part[0].toUpperCase())
  return initials.join('') || 'NA'
}

const Avatar = ({ name }) => (
  <div className="table-avatar placeholder" aria-label={name || 'Avatar'}>
    {buildInitials(name)}
  </div>
)

const buildImageCandidates = (...values) => {
  const urls = []

  values.forEach((value) => {
    if (!value || typeof value !== 'string') return
    const trimmed = value.trim()
    if (!trimmed) return

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      urls.push(trimmed)
      return
    }

    const normalized = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
    urls.push(
      `${API_BASE_URL}/${normalized}`,
      `${API_BASE_URL}/storage/${normalized}`,
      `${API_BASE_URL}/public/${normalized}`,
      `${API_BASE_URL}/public/storage/${normalized}`,
      `${API_BASE_URL}/storage/app/public/${normalized}`,
    )
  })

  return Array.from(new Set(urls))
}

const buildName = (user) => {
  if (user?.name) return user.name
  if (user?.full_name) return user.full_name
  const first = user?.first_name || user?.firstName || user?.firstname || ''
  const last = user?.last_name || user?.lastName || user?.lastname || ''
  const combined = `${first} ${last}`.trim()
  return combined || '-'
}

const buildStatus = (user) => {
  const direct = normalizeStatusLabel(user?.status)
  if (direct) return direct
  const isActive = user?.is_active ?? user?.isActive ?? user?.active
  if (isActive === true || isActive === 1 || isActive === '1') return 'Active'
  if (isActive === false || isActive === 0 || isActive === '0') return 'On hold'
  return 'Unverified'
}

const buildCity = (user) =>
  toText(
    user?.city ??
      user?.city_area ??
      user?.location ??
      user?.address?.city ??
      user?.address?.location,
    '-',
  )

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

const buildJobsCountMap = (payload) => {
  const list = Array.isArray(payload)
    ? payload
    : payload?.jobs_count_by_user ?? payload?.data ?? payload?.items ?? []
  const entries = Array.isArray(list) ? list : []
  const map = new Map()
  entries.forEach((entry) => {
    const userId = entry?.user_id ?? entry?.userId ?? entry?.id
    if (userId === null || userId === undefined || userId === '') return
    const countValue = entry?.total_jobs ?? entry?.totalJobs ?? entry?.jobs ?? entry?.count
    const count = toNumberValue(countValue)
    if (count === null) return
    map.set(String(userId), count)
  })
  return map
}

const buildTazStatusMap = (payload) => {
  const list = Array.isArray(payload) ? payload : payload?.data ?? payload?.items ?? []
  const entries = Array.isArray(list) ? list : []
  const map = new Map()
  entries.forEach((entry, index) => {
    const userId = entry?.user_id ?? entry?.userId ?? entry?.user?.id ?? entry?.user?.user_id
    if (userId === null || userId === undefined || userId === '') return
    const statusValue = normalizeStatusLabel(entry?.status)
    const orderGuid = getOrderGuidFromEntry(entry)
    if (!statusValue) return
    const createdAt = parseTimestamp(entry?.created_at ?? entry?.createdAt)
    const key = String(userId)
    const current = map.get(key)
    if (!current) {
      map.set(key, { status: statusValue, orderGuid, createdAt, index })
      return
    }
    if (createdAt !== null && (current.createdAt === null || createdAt > current.createdAt)) {
      map.set(key, { status: statusValue, orderGuid, createdAt, index })
      return
    }
    if (createdAt === null && current.createdAt === null && index > current.index) {
      map.set(key, { status: statusValue, orderGuid, createdAt, index })
      return
    }
    if (!current.orderGuid && orderGuid) {
      map.set(key, { ...current, orderGuid })
    }
  })
  const statusMap = new Map()
  map.forEach((value, key) => {
    statusMap.set(key, { status: value.status, orderGuid: value.orderGuid || null })
  })
  return statusMap
}

const normalizeKidInfo = (user) => {
  const kidId = user?.kid_id ?? user?.kidId ?? null
  const kidName = user?.kid_name ?? user?.kidName ?? ''
  if (!kidId && !kidName) return null
  return {
    id: kidId,
    name: kidName || '-',
    age: toText(user?.kid_age ?? user?.kidAge, '-'),
    gender: toText(user?.kid_gender ?? user?.kidGender, '-'),
    allergies: toText(user?.allergies, '-'),
    medicalConditions: toText(user?.medical_conditions ?? user?.medicalConditions, '-'),
    notes: toText(user?.notes, '-'),
  }
}

const groupUsersById = (users) => {
  const groups = new Map()
  users.forEach((user, index) => {
    const groupKey = user?.user_id ?? user?.id ?? user?.userId ?? `row-${index}`
    const key = String(groupKey)
    if (!groups.has(key)) {
      groups.set(key, { user, kids: new Map() })
    }
    const entry = groups.get(key)
    const kidInfo = normalizeKidInfo(user)
    if (kidInfo) {
      const kidKey =
        kidInfo.id !== null && kidInfo.id !== undefined
          ? String(kidInfo.id)
          : `${kidInfo.name}-${kidInfo.age}-${kidInfo.gender}`
      if (!entry.kids.has(kidKey)) {
        entry.kids.set(kidKey, kidInfo)
      }
    }
  })
  return Array.from(groups.values()).map((entry) => ({
    user: entry.user,
    kidsCount: entry.kids.size,
    kidsInfo: Array.from(entry.kids.values()),
  }))
}

const normalizeUser = (user, index, kidsCountFromEntries, kidsInfoFromEntries) => {
  const status = buildStatus(user)
  const rawId = user?.id ?? user?.user_id ?? user?.userId
  const formattedId = formatId(rawId, 'P', index)
  const routeId = rawId ?? formattedId
  const profileImageUrl =
    user?.profile_image_url ??
    user?.profileImageUrl ??
    user?.user_image_url ??
    user?.userImageUrl ??
    ''
  const profileImage =
    user?.profile_image ?? user?.profileImage ?? user?.user_image ?? user?.userImage ?? ''
  const profileImageSources = buildImageCandidates(profileImageUrl, profileImage)
  const kidsCountFromField = toNumberValue(
    user?.number_of_kids ?? user?.kids ?? user?.kids_count,
  )
  const resolvedKidsCount =
    kidsCountFromEntries && kidsCountFromEntries > 0
      ? kidsCountFromEntries
      : kidsCountFromField ?? 0
  const kidsNames = Array.isArray(kidsInfoFromEntries)
    ? kidsInfoFromEntries
        .map((kid) => kid.name)
        .filter((name) => name && name !== '-')
        .join(', ')
    : ''
  return {
    id: formattedId,
    routeId: String(routeId),
    rawId: rawId ?? null,
    name: buildName(user),
    email: toText(user?.email ?? user?.email_address ?? user?.emailAddress, '-'),
    city: buildCity(user),
    joined: formatDate(
      user?.created_at ??
        user?.createdAt ??
        user?.registered_at ??
        user?.registeredAt ??
        user?.joined_at ??
        user?.joinedAt,
    ),
    bookings: toText(
      user?.bookings ?? user?.total_bookings ?? user?.booking_count ?? user?.total_jobs,
      '-',
    ),
    status,
    gender: toText(user?.gender, '-'),
    kidsCount: resolvedKidsCount,
    kids: toText(resolvedKidsCount, '-'),
    kidsNames,
    profileImageUrl,
    profileImage,
    profileImageSrc: profileImageSources[0] || '',
    kidsInfo: Array.isArray(kidsInfoFromEntries) ? kidsInfoFromEntries : [],
    tazOrderGuid: normalizeOrderGuid(user?.tazOrderGuid ?? user?.taz_order_guid),
    raw: user,
  }
}

const getStatusTone = (status) =>
  (() => {
    const value = String(status || '').toLowerCase()
    if (
      value.includes('active') ||
      value.includes('approved') ||
      value.includes('verified')
    ) {
      return 'positive'
    }
    if (value.includes('blacklist') || value.includes('reject')) {
      return 'alert'
    }
    return 'warning'
  })()

function Users() {
  const [parents, setParents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [genderFilter, setGenderFilter] = useState('All')
  const [reportLoadingId, setReportLoadingId] = useState(null)

  const statusOptions = useMemo(() => {
    const options = new Set()
    parents.forEach((parent) => {
      if (parent.status && parent.status !== '-') options.add(parent.status)
    })
    return ['All', ...Array.from(options)]
  }, [parents])

  const genderOptions = useMemo(() => {
    const options = new Set()
    parents.forEach((parent) => {
      if (parent.gender && parent.gender !== '-') options.add(parent.gender)
    })
    return ['All', ...Array.from(options)]
  }, [parents])

  const filteredParents = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return parents.filter((parent) => {
      if (statusFilter !== 'All' && parent.status !== statusFilter) {
        return false
      }
      if (genderFilter !== 'All' && parent.gender !== genderFilter) {
        return false
      }
      if (!query) return true
      const haystack = [
        parent.id,
        parent.name,
        parent.email,
        parent.city,
        parent.joined,
        parent.status,
        parent.bookings,
        parent.gender,
        parent.kids,
        parent.kidsNames,
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())
      return haystack.some((value) => value.includes(query))
    })
  }, [parents, genderFilter, searchTerm, statusFilter])

  const handleRowClick = (parent) => {
    if (!parent) return
    try {
      localStorage.setItem('syttr_selected_user', JSON.stringify(parent))
      localStorage.setItem('syttr_selected_user_id', parent.routeId || parent.id)
    } catch {
      // ignore storage errors
    }
    const targetId = parent.routeId || parent.id
    window.location.href = `/users/${encodeURIComponent(targetId)}`
  }

  const handleRowKeyDown = (event, parent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleRowClick(parent)
    }
  }

  const handleViewReport = async (event, parent) => {
    event.stopPropagation()
    setReportLoadingId(parent.id)

    const userId =
      parent?.rawId ??
      parent?.raw?.id ??
      parent?.raw?.user_id ??
      parent?.raw?.userId ??
      null
    const orderGuid = parent?.tazOrderGuid ?? null
    if (!userId || !orderGuid) {
      setReportLoadingId(null)
      return
    }

    try {
      const blob = await getTazOrderPdf({ userId, orderGuid })
      const url = window.URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch {
      // ignore per-row fetch errors in table view
    } finally {
      setReportLoadingId(null)
    }
  }

  const handleExport = () => {
    if (!filteredParents.length) return

    exportRowsToCsv(
      'parents-export.csv',
      [
        'ID',
        'Name',
        'Email',
        'City',
        'Joined',
        'Bookings',
        'Status',
        'Gender',
        'Kids Count',
        'Kids Names',
        'TAZ Order GUID',
      ],
      filteredParents.map((parent) => [
        parent.id,
        parent.name,
        parent.email,
        parent.city,
        parent.joined,
        parent.bookings,
        parent.status,
        parent.gender,
        parent.kidsCount,
        parent.kidsNames || '-',
        parent.tazOrderGuid || '-',
      ]),
    )
  }

  useEffect(() => {
    let isMounted = true

    const hydrateUserMetrics = async (entries) => {
      if (!entries.length) return
      const [jobsResult, tazResult] = await Promise.allSettled([
        getJobsCountByUser(),
        getTazOrderStatuses(),
      ])

      if (!isMounted) return

      const jobsMap =
        jobsResult.status === 'fulfilled'
          ? buildJobsCountMap(jobsResult.value)
          : new Map()
      const statusMap =
        tazResult.status === 'fulfilled'
          ? buildTazStatusMap(tazResult.value)
          : new Map()

      if (!jobsMap.size && !statusMap.size) return

      setParents((current) =>
        current.map((parent) => {
          const rawId =
            parent?.rawId ??
            parent?.raw?.id ??
            parent?.raw?.user_id ??
            parent?.raw?.userId ??
            null
          if (rawId === null || rawId === undefined || rawId === '') return parent
          const key = String(rawId)
          const hasJobs = jobsMap.has(key)
          const hasTaz = statusMap.has(key)
          if (!hasJobs && !hasTaz) return parent

          const next = { ...parent }
          let updated = false
          let statusUpdated = false
          let nextStatus = parent.status

          if (hasJobs) {
            const jobsCount = jobsMap.get(key)
            const nextBookings = toText(jobsCount, parent.bookings)
            if (nextBookings !== parent.bookings) {
              next.bookings = nextBookings
              updated = true
            }
          }

          if (hasTaz) {
            const tazValue = statusMap.get(key)
            const statusValue = tazValue?.status ?? null
            const orderGuid = tazValue?.orderGuid ?? null
            if (statusValue && statusValue !== parent.status) {
              nextStatus = statusValue
              next.status = statusValue
              updated = true
              statusUpdated = true
            }
            if (orderGuid && orderGuid !== parent.tazOrderGuid) {
              next.tazOrderGuid = orderGuid
              updated = true
            }
          }

          if (statusUpdated && parent.raw && typeof parent.raw === 'object') {
            next.raw = { ...parent.raw, status: nextStatus }
          }

          return updated ? next : parent
        }),
      )
    }

    const loadUsers = async () => {
      setLoading(true)
      setError('')

      try {
        const response = await getAllUsers()
        const payload = response?.data ?? response ?? []
        const list = Array.isArray(payload)
          ? payload
          : payload?.data ?? payload?.users ?? payload?.items ?? []

        if (!isMounted) return

        const grouped = Array.isArray(list) ? groupUsersById(list) : []
        const normalized = grouped.map((entry, index) =>
          normalizeUser(entry.user, index, entry.kidsCount, entry.kidsInfo),
        )
        setParents(normalized)
        void hydrateUserMetrics(normalized)
      } catch {
        if (!isMounted) return
        setError('Unable to load users.')
        setParents([])
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadUsers()

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
            <p className="eyebrow">Directory</p>
            <h1>Parents management</h1>
            <p className="lead">
              Review parent profiles, booking volume, and account status from one place.
            </p>
          </div>

          <div className="header-actions">
            <div className="search">
              <input
                type="search"
                placeholder="Search parents by name or email"
                aria-label="Search parents"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <div className="filters">
              <select
                className="filter-select"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label="Filter by status"
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <select
                className="filter-select"
                value={genderFilter}
                onChange={(event) => setGenderFilter(event.target.value)}
                aria-label="Filter by gender"
              >
                {genderOptions.map((gender) => (
                  <option key={gender} value={gender}>
                    {gender}
                  </option>
                ))}
              </select>
            </div>
            <button className="pill-btn">Add parent</button>
            <button className="pill-btn ghost" type="button" onClick={handleExport} disabled={!filteredParents.length}>
              Export
            </button>
          </div>
        </header>

        <section className="panel table-card">
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Profile</th>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>City</th>
                  <th>Joined</th>
                  <th>Bookings</th>
                  <th>Status</th>
                  <th>Report</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="9">Loading users...</td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan="9">{error}</td>
                  </tr>
                ) : filteredParents.length ? (
                  filteredParents.map((parent) => (
                    <tr
                      key={parent.id}
                      className="clickable-row"
                      onClick={() => handleRowClick(parent)}
                      onKeyDown={(event) => handleRowKeyDown(event, parent)}
                      tabIndex={0}
                      role="button"
                    >
                      <td data-label="Profile">
                        {parent.profileImage || parent.profileImageUrl ? (
                          <img
                            className="table-avatar"
                            src={parent.profileImageSrc}
                            alt="User"
                            onError={(event) => {
                              event.currentTarget.onerror = null
                              event.currentTarget.src = '/placeholder.png'
                            }}
                          />
                        ) : (
                          <Avatar name={parent.name} />
                        )}
                      </td>
                      <td data-label="ID">{parent.id}</td>
                      <td data-label="Name">{parent.name}</td>
                      <td data-label="Email">{parent.email}</td>
                      <td data-label="City">{parent.city}</td>
                      <td data-label="Joined">{parent.joined}</td>
                      <td data-label="Bookings">{parent.bookings}</td>
                      <td data-label="Status">
                        <span className={`chip ${getStatusTone(parent.status)}`}>
                          {parent.status}
                        </span>
                      </td>
                      <td data-label="Report">
                        {parent.tazOrderGuid ? (
                          <button
                            type="button"
                            className="pill-btn ghost"
                            onClick={(event) => handleViewReport(event, parent)}
                            disabled={reportLoadingId === parent.id}
                          >
                            {reportLoadingId === parent.id ? 'Opening...' : 'View report'}
                          </button>
                        ) : (
                          '-'
                        )}
                      </td>
                    </tr>
                  ))
                ) : searchTerm.trim() ? (
                  <tr>
                    <td colSpan="9">No matching parents found.</td>
                  </tr>
                ) : (
                  <tr>
                    <td colSpan="9">No users found.</td>
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

export default Users
