const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function getOrdinal(day: number) {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  const last = day % 10;
  if (last === 1) return "st";
  if (last === 2) return "nd";
  if (last === 3) return "rd";
  return "th";
}

export function formatDateToMDY(raw?: any): string {
  if (raw === null || raw === undefined) return "";

  const value = String(raw).trim();
  if (!value) return "";

  const isoMatch = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  const mdyMatch = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);

  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;

  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else if (mdyMatch) {
    month = Number(mdyMatch[1]);
    day = Number(mdyMatch[2]);
    const rawYear = mdyMatch[3];
    year = Number(rawYear.length === 2 ? `20${rawYear}` : rawYear);
  }

  let date: Date | null = null;
  if (
    year &&
    month &&
    day &&
    Number.isFinite(year) &&
    Number.isFinite(month) &&
    Number.isFinite(day)
  ) {
    date = new Date(year, month - 1, day);
  } else {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed;
    }
  }

  if (!date) return value;

  const monthName = MONTHS[date.getMonth()];
  const dayNum = date.getDate();
  const ordinal = getOrdinal(dayNum);
  const yyyy = date.getFullYear();

  return `${monthName} ${dayNum}${ordinal}, ${yyyy}`;
}


export default function RouteShim() {
  return null as any;
}

