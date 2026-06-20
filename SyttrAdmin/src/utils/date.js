export const formatDate = (value) => {
  if (!value) return '-'
  const input = String(value).trim()
  if (!input) return '-'

  const datePart = input.split('T')[0].split(' ')[0]
  let year = null
  let month = null
  let day = null

  const dashParts = datePart.split('-')
  if (dashParts.length === 3 && dashParts[0].length === 4) {
    ;[year, month, day] = dashParts
  } else {
    const slashParts = datePart.split('/')
    if (slashParts.length === 3) {
      if (slashParts[0].length === 4) {
        ;[year, month, day] = slashParts
      } else if (slashParts[2].length === 4) {
        ;[month, day, year] = slashParts
      }
    }
  }

  let parsed = null
  if (year && month && day) {
    const yearNum = Number(year)
    const monthNum = Number(month)
    const dayNum = Number(day)
    if (
      Number.isFinite(yearNum) &&
      Number.isFinite(monthNum) &&
      Number.isFinite(dayNum)
    ) {
      parsed = new Date(yearNum, monthNum - 1, dayNum)
    }
  }

  if (!parsed || Number.isNaN(parsed.getTime())) {
    parsed = new Date(input)
  }

  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
