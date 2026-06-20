export const ADMIN_SESSION_STORAGE_KEY = 'syttr_admin_session'
export const ADMIN_TOKEN_STORAGE_KEY = 'syttr_admin_token'
export const ADMIN_USER_STORAGE_KEY = 'syttr_admin_user'

export const clearAdminSession = () => {
  if (typeof window === 'undefined') return
  localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
  localStorage.removeItem(ADMIN_USER_STORAGE_KEY)
  localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
}

export const readStoredAdminUser = () => {
  if (typeof window === 'undefined') return null

  try {
    const storedUser = localStorage.getItem(ADMIN_USER_STORAGE_KEY)
    if (storedUser) {
      const parsed = JSON.parse(storedUser)
      if (parsed?.name || parsed?.email) {
        return {
          name: parsed?.name || '',
          email: parsed?.email || '',
        }
      }
    }

    const storedSession = localStorage.getItem(ADMIN_SESSION_STORAGE_KEY)
    if (storedSession) {
      const parsed = JSON.parse(storedSession)
      if (parsed?.admin?.name || parsed?.admin?.email) {
        return {
          name: parsed.admin.name || parsed.admin.email || '',
          email: parsed.admin.email || '',
        }
      }
    }
  } catch {
    return null
  }

  return null
}
