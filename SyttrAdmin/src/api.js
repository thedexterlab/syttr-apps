import { ADMIN_SESSION_STORAGE_KEY, clearAdminSession } from './storage'

const trimUrl = (value) => String(value || '').trim().replace(/\/+$/, '')
const DEFAULT_LIVE_ADMIN_API_BASE_URL = 'https://syttr-admin.zyronexlab.com'
const DEFAULT_LIVE_ASSET_BASE_URL = 'https://admin-syttr.zyronexlab.com'
const DEFAULT_ADMIN_API_PORT =
  String(import.meta.env.VITE_ADMIN_API_PORT || '8001').trim() || '8001'
const isLoopbackOrPrivateHost = (value) => {
  const host = String(value || '').trim().toLowerCase()
  if (!host) return false

  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host === '0.0.0.0'
  ) {
    return true
  }

  return (
    /^10(?:\.\d{1,3}){3}$/.test(host) ||
    /^192\.168(?:\.\d{1,3}){2}$/.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}$/.test(host)
  )
}

const normalizeAdminApiHost = (value) => {
  const host = String(value || '').trim()
  if (!host) return host

  if (host === 'localhost' || host === '::1' || host === '[::1]' || host === '0.0.0.0') {
    return '127.0.0.1'
  }

  return host
}

const getDefaultAdminApiBaseUrl = () => {
  if (typeof window !== 'undefined') {
    const host = normalizeAdminApiHost(window.location.hostname)
    if (host && !isLoopbackOrPrivateHost(host)) {
      return trimUrl(window.location.origin)
    }

    const protocol = window.location.protocol === 'https:' ? 'https' : 'http'
    if (host) {
      return `${protocol}://${host}:${DEFAULT_ADMIN_API_PORT}`
    }
  }

  return DEFAULT_LIVE_ADMIN_API_BASE_URL
}

const ADMIN_API_BASE_URL =
  trimUrl(import.meta.env.VITE_ADMIN_API_BASE_URL) ||
  getDefaultAdminApiBaseUrl() ||
  DEFAULT_LIVE_ADMIN_API_BASE_URL
export const API_BASE_URL =
  trimUrl(import.meta.env.VITE_ADMIN_ASSET_BASE_URL) ||
  DEFAULT_LIVE_ASSET_BASE_URL ||
  ADMIN_API_BASE_URL

const ADMIN_API_KEY = String(import.meta.env.VITE_ADMIN_API_KEY || '').trim()
const ADMIN_API_KEY_HEADER =
  String(import.meta.env.VITE_ADMIN_API_KEY_HEADER || 'X-ADMIN-API-KEY').trim() ||
  'X-ADMIN-API-KEY'

export const API_HEADERS = {
  json: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
}

export const API_ENDPOINTS = {
  login: `${ADMIN_API_BASE_URL}/api/admin/login`,
  dashboardStats: `${ADMIN_API_BASE_URL}/api/admin/dashboard-stats`,
  nannies: `${ADMIN_API_BASE_URL}/api/admin/nannies`,
  users: `${ADMIN_API_BASE_URL}/api/admin/users`,
  jobs: `${ADMIN_API_BASE_URL}/api/admin/jobs`,
  jobsWithDetails: `${ADMIN_API_BASE_URL}/api/admin/jobs`,
  jobsCountByUser: `${ADMIN_API_BASE_URL}/api/admin/jobscount`,
  tazOrderStatuses: `${ADMIN_API_BASE_URL}/api/admin/taz/order-statuses`,
  tazStatus: (userId) =>
    `${ADMIN_API_BASE_URL}/api/admin/taz/status/${encodeURIComponent(userId)}`,
  interviews: `${ADMIN_API_BASE_URL}/api/admin/interviews`,
  interviewsByNanny: (nannyId) =>
    `${ADMIN_API_BASE_URL}/api/admin/interviews/nanny/${encodeURIComponent(nannyId)}`,
  updateNannyProfileStatus: `${ADMIN_API_BASE_URL}/api/admin/nanny/profile-status`,
  updateParentProfileStatus: `${ADMIN_API_BASE_URL}/api/admin/parents/profile-status`,
  subscriptionStatus: `${ADMIN_API_BASE_URL}/api/admin/subscription/status`,
  subscriptionsEarnings: `${ADMIN_API_BASE_URL}/api/admin/subscriptions/earnings`,
  subscriptionsManagement: `${ADMIN_API_BASE_URL}/api/admin/subscriptions/management`,
  subscriptionPlans: `${ADMIN_API_BASE_URL}/api/admin/subscriptions/plans`,
  subscriptionPlan: (planId) =>
    `${ADMIN_API_BASE_URL}/api/admin/subscriptions/plans/${encodeURIComponent(planId)}`,
  platformFeeCalculate: `${ADMIN_API_BASE_URL}/api/admin/platform-fee/calculate`,
  platformFeeCurrent: `${ADMIN_API_BASE_URL}/api/admin/platform-fee/current`,
  commissions: `${ADMIN_API_BASE_URL}/api/admin/commission`,
  payments: `${ADMIN_API_BASE_URL}/api/admin/payments`,
  supportMessages: `${ADMIN_API_BASE_URL}/api/admin/support/messages`,
  auditLogs: `${ADMIN_API_BASE_URL}/api/admin/audit-logs`,
}

export const API_PAYLOADS = {
  login: ({ email, password, remember }) => ({
    email,
    password,
    remember,
  }),
}

const normalizeToken = (value) => {
  if (!value) return null
  const token = String(value).trim()
  if (!token) return null
  const lowered = token.toLowerCase()
  if (lowered === 'null' || lowered === 'undefined') return null
  return token
}

export const getAuthToken = () => {
  if (typeof window === 'undefined') return null
  const session = localStorage.getItem(ADMIN_SESSION_STORAGE_KEY)
  if (!session) return null
  try {
    const parsed = JSON.parse(session)
    return normalizeToken(parsed?.token)
  } catch {
    return null
  }
}

const handleUnauthorizedSession = () => {
  if (typeof window === 'undefined') return
  clearAdminSession()
  if (window.location.pathname.toLowerCase() !== '/login') {
    window.location.replace('/login')
  }
}

const buildHeaders = ({ token, headers, includeAuth = true } = {}) => {
  const mergedHeaders = { ...API_HEADERS.json, ...(headers || {}) }
  if (ADMIN_API_KEY) {
    mergedHeaders[ADMIN_API_KEY_HEADER] = ADMIN_API_KEY
  }

  const authToken = token === undefined ? getAuthToken() : token
  if (includeAuth && authToken) {
    mergedHeaders.Authorization = `Bearer ${authToken}`
  }

  return mergedHeaders
}

const requestJson = async (
  url,
  { method = 'GET', payload, token, headers, includeAuth = true } = {},
) => {
  const options = {
    method,
    headers: buildHeaders({ token, headers, includeAuth }),
  }

  if (payload !== undefined) {
    options.body = JSON.stringify(payload)
  }

  const response = await fetch(url, options)
  const data = await response.json().catch(() => null)

  if (response.status === 401 && includeAuth) {
    handleUnauthorizedSession()
  }

  if (!response.ok || data?.status === false) {
    const message = data?.message || `Request failed (${response.status})`
    const error = new Error(message)
    error.status = response.status
    error.data = data
    throw error
  }

  return data
}

const requestBlob = async (url, { method = 'GET', headers, token } = {}) => {
  const options = {
    method,
    headers: buildHeaders({
      token,
      headers: {
        Accept: 'application/pdf',
        ...(headers || {}),
      },
    }),
  }

  const response = await fetch(url, options)

  if (!response.ok) {
    if (response.status === 401 && token !== null) {
      handleUnauthorizedSession()
    }
    let message = `Request failed (${response.status})`
    try {
      const data = await response.json()
      message = data?.message || message
    } catch {
      // ignore parse errors
    }
    const err = new Error(message)
    err.status = response.status
    throw err
  }

  return response.blob()
}

const toStatusText = (value) => {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean' || typeof value === 'object') return null
  const text = String(value).trim()
  return text ? text : null
}

const extractStatusValue = (payload) => {
  const direct = toStatusText(payload)
  if (direct) return direct
  if (!payload || typeof payload !== 'object') return null
  const topLevel = toStatusText(payload.status)
  if (topLevel) return topLevel
  const data = payload.data ?? payload.result ?? null
  if (!data) return null
  if (typeof data === 'object') {
    return toStatusText(data.status) || toStatusText(data.taz_status)
  }
  return toStatusText(data)
}

export const loginAdmin = ({ email, password, remember }) =>
  requestJson(API_ENDPOINTS.login, {
    method: 'POST',
    payload: API_PAYLOADS.login({ email, password, remember }),
    includeAuth: false,
  })

export const getDashboardStats = () => requestJson(API_ENDPOINTS.dashboardStats)
export const getAllNannies = () => requestJson(API_ENDPOINTS.nannies)
export const getAllUsers = () => requestJson(API_ENDPOINTS.users)
export const getAllJobs = () => requestJson(API_ENDPOINTS.jobs)
export const getJobsWithDetails = () => requestJson(API_ENDPOINTS.jobsWithDetails)
export const getJobsCountByUser = () => requestJson(API_ENDPOINTS.jobsCountByUser)
export const getTazOrderStatuses = () => requestJson(API_ENDPOINTS.tazOrderStatuses)
export const getInterviews = () => requestJson(API_ENDPOINTS.interviews)
export const getInterviewsByNanny = (nannyId) =>
  requestJson(API_ENDPOINTS.interviewsByNanny(nannyId))
export const updateNannyProfileStatus = ({ nannyId, status }) =>
  requestJson(API_ENDPOINTS.updateNannyProfileStatus, {
    method: 'POST',
    payload: {
      nanny_id: nannyId,
      status,
    },
  })
export const updateParentProfileStatus = ({ userId, status }) =>
  requestJson(API_ENDPOINTS.updateParentProfileStatus, {
    method: 'POST',
    payload: {
      user_id: userId,
      status,
    },
  })
export const getSubscriptionStatus = () => requestJson(API_ENDPOINTS.subscriptionStatus)
export const getSubscriptionEarnings = () => requestJson(API_ENDPOINTS.subscriptionsEarnings)
export const getSubscriptionManagement = () => requestJson(API_ENDPOINTS.subscriptionsManagement)
export const createSubscriptionPlan = (payload) =>
  requestJson(API_ENDPOINTS.subscriptionPlans, {
    method: 'POST',
    payload,
  })
export const updateSubscriptionPlan = (planId, payload) =>
  requestJson(API_ENDPOINTS.subscriptionPlan(planId), {
    method: 'PUT',
    payload,
  })
export const calculatePlatformFee = ({ type, value }) =>
  requestJson(API_ENDPOINTS.platformFeeCalculate, {
    method: 'POST',
    payload: {
      type,
      value,
    },
  })
export const getCurrentPlatformFee = () => requestJson(API_ENDPOINTS.platformFeeCurrent)
export const getCommissions = () => requestJson(API_ENDPOINTS.commissions)
export const getPayments = () => requestJson(API_ENDPOINTS.payments)
export const getSupportMessages = () => requestJson(API_ENDPOINTS.supportMessages)
export const getAuditLogs = () => requestJson(API_ENDPOINTS.auditLogs)
export const getTazStatus = async (userId) => {
  if (userId === null || userId === undefined || userId === '') return null
  const response = await requestJson(API_ENDPOINTS.tazStatus(userId))
  return extractStatusValue(response?.data ?? response)
}

export const getTazOrderPdf = async ({ userId, orderGuid } = {}) => {
  if (!userId || !orderGuid) {
    throw new Error('Missing user or order details.')
  }
  const url = `${ADMIN_API_BASE_URL}/api/admin/taz/users/${encodeURIComponent(
    userId,
  )}/orders/${encodeURIComponent(orderGuid)}/pdf`
  return requestBlob(url)
}
