import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import { API_BASE_URL, getAllNannies } from '../api'
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

const buildName = (nanny) => {
  if (nanny?.name) return nanny.name
  if (nanny?.fullname) return nanny.fullname
  const first = nanny?.first_name || nanny?.firstName || ''
  const last = nanny?.last_name || nanny?.lastName || ''
  const combined = `${first} ${last}`.trim()
  return combined || '-'
}

const buildStatus = (nanny) => {
  if (nanny?.status == null) return 'Unverified'
  if (typeof nanny?.status === 'string') {
    const s = nanny.status.trim().toLowerCase()
    if (s === 'pending') return 'Pending'
    if (s === 'approved') return 'Verified'
    if (s) return nanny.status.trim()
  }
}

const buildCity = (nanny) =>
  toText(nanny?.city ?? nanny?.location ?? nanny?.address?.city ?? nanny?.address?.location, '-')

const formatRating = (value) => {
  if (value === null || value === undefined || value === '') return '0.0'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return toText(value, '0.0')
  const rounded = Math.round(numeric * 100) / 100
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded)
}

const normalizeNanny = (nanny, index) => {
  const status = buildStatus(nanny)
  const rawId = nanny?.id ?? nanny?.nanny_id ?? nanny?.nannyId
  const formattedId = formatId(rawId, 'N', index)
  const routeId = rawId ?? formattedId
  const profileImageUrl = nanny?.profile_image_url ?? nanny?.profileImageUrl ?? ''
  const profileImage = nanny?.profile_image ?? nanny?.profileImage ?? ''

  return {
    id: formattedId,
    routeId: String(routeId),
    rawId: rawId ?? null,
    name: buildName(nanny),
    email: toText(nanny?.email ?? nanny?.email_address ?? nanny?.emailAddress, '-'),
    city: buildCity(nanny),
    joined: formatDate(
      nanny?.created_at ??
        nanny?.createdAt ??
        nanny?.registered_at ??
        nanny?.registeredAt ??
        nanny?.joined_at ??
        nanny?.joinedAt,
    ),
    status,
    rating: formatRating(nanny?.rating ?? nanny?.avg_rating ?? nanny?.average_rating),
    shifts: toText(
      nanny?.shifts ??
        nanny?.total_shifts ??
        nanny?.total_jobs ??
        nanny?.bookings ??
        nanny?.total_bookings,
      '-',
    ),
    profileImageUrl,
    profileImage,
    raw: nanny,
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

function Nannies() {
  const [nannies, setNannies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const filteredNannies = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return nannies
    return nannies.filter((nanny) => {
      const haystack = [
        nanny.id,
        nanny.name,
        nanny.email,
        nanny.city,
        nanny.status,
        nanny.rating,
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())
      return haystack.some((value) => value.includes(query))
    })
  }, [nannies, searchTerm])

  const handleRowClick = (nanny) => {
    if (!nanny) return
    try {
      localStorage.setItem('syttr_selected_nanny', JSON.stringify(nanny.raw || nanny))
      localStorage.setItem('syttr_selected_nanny_id', nanny.routeId || nanny.id)
    } catch {
      // ignore storage errors
    }
    const targetId = nanny.routeId || nanny.id
    window.location.href = `/nannies/${encodeURIComponent(targetId)}`
  }

  const handleRowKeyDown = (event, nanny) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleRowClick(nanny)
    }
  }

  const handleExport = () => {
    if (!filteredNannies.length) return

    exportRowsToCsv(
      'syttrs-export.csv',
      ['ID', 'Name', 'Email', 'City', 'Joined', 'Status', 'Rating', 'Shifts'],
      filteredNannies.map((nanny) => [
        nanny.id,
        nanny.name,
        nanny.email,
        nanny.city,
        nanny.joined,
        nanny.status,
        nanny.rating,
        nanny.shifts,
      ]),
    )
  }

  useEffect(() => {
    let isMounted = true

    const loadNannies = async () => {
      setLoading(true)
      setError('')

      try {
        const response = await getAllNannies()
        const payload = response?.data ?? response ?? []
        const list = Array.isArray(payload)
          ? payload
          : payload?.data ?? payload?.nannies ?? payload?.items ?? []

        if (!isMounted) return
        const normalized = Array.isArray(list)
          ? list.map((item, index) => normalizeNanny(item, index))
          : []
        setNannies(normalized)
        const imageUrls = normalized
          .map((nanny) => ({
            id: nanny.id,
            name: nanny.name,
            url:
              nanny.profileImageUrl ||
              (nanny.profileImage ? `${API_BASE_URL}/${nanny.profileImage}` : ''),
          }))
          .filter((entry) => entry.url)
        if (imageUrls.length) {
          console.log('Nanny profile images:', imageUrls)
        }
      } catch {
        if (!isMounted) return
        setError('Unable to load nannies.')
        setNannies([])
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadNannies()

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
            <h1>Nannies profile management</h1>
            <p className="lead">Review verification status, ratings, and activity in one place.</p>
          </div>

          <div className="header-actions">
            <div className="search">
              <input
                type="search"
                placeholder="Search nannies by name or email"
                aria-label="Search nannies"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <button className="pill-btn">Add nanny</button>
            <button className="pill-btn ghost" type="button" onClick={handleExport} disabled={!filteredNannies.length}>
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
                  <th>Status</th>
                  <th>Rating</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="8">Loading nannies...</td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan="8">{error}</td>
                  </tr>
                ) : filteredNannies.length ? (
                  filteredNannies.map((nanny) => (
                    <tr
                      key={nanny.id}
                      className="clickable-row"
                      onClick={() => handleRowClick(nanny)}
                      onKeyDown={(event) => handleRowKeyDown(event, nanny)}
                      tabIndex={0}
                      role="button"
                    >
                      <td data-label="Profile">
                        {nanny.profileImage || nanny.profileImageUrl ? (
                          <img
                            className="table-avatar"
                            src={
                              nanny.profileImageUrl ??
                              `${API_BASE_URL}/${nanny.profileImage}`
                            }
                            alt="Nanny"
                            onError={(event) => {
                              event.currentTarget.onerror = null
                              event.currentTarget.src = '/placeholder.png'
                            }}
                          />
                        ) : (
                          <Avatar name={nanny.name} />
                        )}
                      </td>
                      <td data-label="ID">{nanny.id}</td>
                      <td data-label="Name">{nanny.name}</td>
                      <td data-label="Email">{nanny.email}</td>
                      <td data-label="City">{nanny.city}</td>
                      <td data-label="Joined">{nanny.joined}</td>
                      <td data-label="Status">
                                               <span className={`status-pill ${getStatusTone(nanny.status)}`}>
                          {nanny.status}
                        </span>

                      </td>
                      <td data-label="Rating">{nanny.rating}</td>
                    </tr>
                  ))
                ) : searchTerm.trim() ? (
                  <tr>
                    <td colSpan="8">No matching nannies found.</td>
                  </tr>
                ) : (
                  <tr>
                    <td colSpan="8">No nannies found.</td>
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

export default Nannies
