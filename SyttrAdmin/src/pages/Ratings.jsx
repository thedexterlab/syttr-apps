import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import { getAllNannies } from '../api'
import { exportRowsToCsv } from '../utils/csv'

const toNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const formatRating = (value) => {
  if (value === null || value === undefined || value === '') return '-'
  const numeric = toNumber(value)
  return numeric.toFixed(1)
}

const toText = (value, fallback = '-') => {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function Ratings() {
  const [ratings, setRatings] = useState([])
  const [status, setStatus] = useState('loading')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadRatings = async () => {
      setStatus('loading')
      try {
        const response = await getAllNannies()
        const payload = response?.data ?? response ?? []
        const list = Array.isArray(payload)
          ? payload
          : payload?.data ?? payload?.nannies ?? payload?.items ?? []

        if (!isMounted) return

        const normalized = Array.isArray(list)
          ? list.map((item) => ({
              caregiver: item?.name || '-',
              avg: formatRating(item?.rating ?? item?.avg_rating ?? item?.average_rating),
              reviews: toNumber(item?.ratings_count ?? item?.review_count ?? item?.total_reviews),
              latestRating: toText(
                item?.latest_rating_display ??
                  (item?.latest_rating !== null && item?.latest_rating !== undefined
                    ? `${item.latest_rating}/5`
                    : ''),
              ),
              latestReview: toText(item?.latest_review),
              ratedAt: item?.latest_rated_at || item?.updated_at || item?.created_at || '-',
              flag:
                toNumber(item?.rating ?? item?.avg_rating ?? item?.average_rating) >= 4.8
                  ? 'High praise'
                  : toNumber(item?.ratings_count ?? item?.review_count ?? item?.total_reviews) === 0
                    ? 'No reviews'
                    : toNumber(item?.rating ?? item?.avg_rating ?? item?.average_rating) < 4
                      ? 'Check feedback'
                      : 'None',
            }))
          : []

        setRatings(normalized)
        setStatus('ready')
      } catch {
        if (isMounted) {
          setRatings([])
          setStatus('error')
        }
      }
    }

    loadRatings()

    return () => {
      isMounted = false
    }
  }, [])

  const filteredRatings = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return ratings
    return ratings.filter((item) =>
      [item.caregiver, item.avg, item.reviews, item.latestRating, item.latestReview, item.ratedAt, item.flag]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    )
  }, [ratings, query])

  const handleExport = () => {
    if (!filteredRatings.length) return
    exportRowsToCsv(
      'ratings-export.csv',
      ['Caregiver', 'Avg Rating', 'Total Reviews', 'Latest Rating', 'Latest Review', 'Rated At', 'Flag'],
      filteredRatings.map((item) => [
        item.caregiver,
        item.avg,
        item.reviews,
        item.latestRating,
        item.latestReview,
        item.ratedAt,
        item.flag,
      ]),
    )
  }

  const handleExportFlagged = () => {
    const flagged = filteredRatings.filter((item) => item.flag && item.flag !== 'None')
    if (!flagged.length) return
    exportRowsToCsv(
      'ratings-flagged-export.csv',
      ['Caregiver', 'Avg Rating', 'Total Reviews', 'Latest Rating', 'Latest Review', 'Rated At', 'Flag'],
      flagged.map((item) => [
        item.caregiver,
        item.avg,
        item.reviews,
        item.latestRating,
        item.latestReview,
        item.ratedAt,
        item.flag,
      ]),
    )
  }

  return (
    <div className="dashboard-shell">
      <Sidebar />

      <div className="dash-content">
        <header className="dash-header">
          <div>
            <p className="eyebrow">Quality</p>
            <h1>Ratings management</h1>
            <p className="lead">Review caregiver ratings, monitor feedback, and spot issues early.</p>
          </div>

          <div className="header-actions">
            <div className="search">
              <input
                type="search"
                placeholder="Search caregivers"
                aria-label="Search ratings"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <button className="pill-btn" type="button" onClick={handleExport} disabled={!filteredRatings.length}>
              Export
            </button>
            <button
              className="pill-btn ghost"
              type="button"
              onClick={handleExportFlagged}
              disabled={!filteredRatings.some((item) => item.flag && item.flag !== 'None')}
            >
              Export flagged
            </button>
          </div>
        </header>

        <section className="panel table-card">
          <div className="panel-header">
            <div>
              <p className="panel-label">Feedback</p>
              <p className="panel-title">Ratings overview</p>
            </div>
            <div className="chip info">{filteredRatings.length} rows</div>
          </div>
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Caregiver</th>
                  <th>Avg rating</th>
                  <th>Total reviews</th>
                  <th>Latest rating</th>
                  <th>Latest review</th>
                  <th>Rated at</th>
                  <th>Flag</th>
                </tr>
              </thead>
              <tbody>
                {filteredRatings.map((item) => (
                  <tr key={item.caregiver}>
                    <td data-label="Caregiver">{item.caregiver}</td>
                    <td data-label="Avg rating">{item.avg}</td>
                    <td data-label="Total reviews">{item.reviews}</td>
                    <td data-label="Latest rating">{item.latestRating}</td>
                    <td data-label="Latest review">{item.latestReview}</td>
                    <td data-label="Rated at">{item.ratedAt}</td>
                    <td data-label="Flag">
                      <span
                        className={`chip ${
                          item.flag === 'High praise'
                            ? 'positive'
                            : item.flag === 'None'
                              ? 'neutral'
                              : item.flag === 'No reviews'
                                ? 'warning'
                                : 'alert'
                        }`}
                      >
                        {item.flag}
                      </span>
                    </td>
                  </tr>
                ))}
                {status === 'loading' ? (
                  <tr>
                    <td colSpan={7}>Loading ratings...</td>
                  </tr>
                ) : null}
                {status === 'error' ? (
                  <tr>
                    <td colSpan={7}>Unable to load ratings.</td>
                  </tr>
                ) : null}
                {status === 'ready' && filteredRatings.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No ratings matched this search.</td>
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

export default Ratings
