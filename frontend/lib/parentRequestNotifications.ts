import AppStorage from "@/lib/storage";
import { apiRequest, BASE_URL, getRuntimeApiKey, sanitizeToken } from "../app/Api";

const API_BASE = String(BASE_URL || "").replace(/\/+$/, "");

const HIDDEN_REQUEST_KEYS = "hidden_parent_request_keys";

export type ParentRequestNotification = {
  id?: number | string;
  title?: string;
  subtitle?: string;
  message?: string;
  time?: string;
  created_at?: string;
  notification_id?: number | string;
  isRead?: boolean;
  is_read?: number | boolean | string;
  type?: string;
  status?: string;
  application_status?: string;
  request_source?: string;
  application_id?: number | string;
  job_id?: number | string;
  nanny_id?: number | string;
  nanny_name?: string;
  kid_names?: string[];
  hours_label?: string;
  pay_label?: string;
  location?: string;
  job?: any;
  nanny?: any;
  application?: any;
  meta?: any;
  raw?: any;
  request_key: string;
  source_ids: string[];
};

const toSet = (value: any): Set<string> => {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.map((id) => String(id || "").trim()).filter(Boolean));
};

const scopedStorageKey = (key: string, userId?: string): string => {
  const normalizedUserId = String(userId || "").trim();
  return normalizedUserId ? `${key}:${normalizedUserId}` : key;
};

const readStoredSet = async (key: string): Promise<Set<string>> => {
  try {
    const raw = await AppStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return toSet(parsed);
  } catch {
    return new Set();
  }
};

const writeStoredSet = async (key: string, ids: Set<string>) => {
  await AppStorage.setItem(key, JSON.stringify(Array.from(ids)));
};

const readScopedStoredSet = async (key: string, userId?: string): Promise<Set<string>> => {
  const scopedKey = scopedStorageKey(key, userId);
  const scoped = await readStoredSet(scopedKey);

  if (!String(userId || "").trim() || scopedKey === key) {
    return scoped;
  }

  const legacy = await readStoredSet(key);
  if (!legacy.size) return scoped;

  const beforeSize = scoped.size;
  legacy.forEach((value) => scoped.add(value));
  if (scoped.size !== beforeSize) {
    await writeStoredSet(scopedKey, scoped);
  }
  return scoped;
};

const addToStoredSet = async (
  key: string,
  values: (string | number)[],
  userId?: string
) => {
  const normalized = values.map((value) => String(value || "").trim()).filter(Boolean);
  if (!normalized.length) return;

  const scopedKey = scopedStorageKey(key, userId);
  const current = await readStoredSet(scopedKey);
  normalized.forEach((value) => current.add(value));
  await writeStoredSet(scopedKey, current);
};

export const isNotificationRead = (
  item?: { isRead?: unknown; is_read?: unknown } | null
): boolean => {
  if (!item) return false;
  if (item.isRead === true) return true;

  const raw = item.is_read;
  if (raw === true || raw === 1 || raw === "1") return true;
  if (typeof raw === "string" && raw.toLowerCase() === "true") return true;
  return false;
};

export const isJobRequestNotification = (item: Partial<ParentRequestNotification>) => {
  const type = String(item.type || "").toLowerCase().trim();
  if ([
    "job_request",
    "job_application",
    "new_job_request",
    "new_application",
    "hire_accepted",
    "hire_rejected",
  ].includes(type)) {
    return true;
  }

  const hay = `${item.title || ""} ${item.subtitle || ""} ${item.message || ""}`
    .toLowerCase()
    .trim();

  return (
    hay.includes("job request") ||
    hay.includes("booking request") ||
    hay.includes("new application") ||
    hay.includes("applied for your job") ||
    hay.includes("request from syttr") ||
    hay.includes("accepted the job request") ||
    hay.includes("declined the job request")
  );
};

export const isParentInitiatedHireRequestNotification = (
  item: Partial<ParentRequestNotification>
) => {
  const requestSource = String(
    item.request_source ||
      item.application?.request_source ||
      item.job?.request_source ||
      item.raw?.data?.request_source ||
      item.raw?.data?.application?.request_source ||
      item.raw?.data?.job?.request_source ||
      ""
  )
    .toLowerCase()
    .trim();

  if (requestSource === "hire_request" || requestSource === "hire-request") {
    return true;
  }

  const status = String(
    item.status ||
      item.application_status ||
      item.application?.status ||
      item.raw?.data?.status ||
      item.raw?.data?.application_status ||
      item.raw?.data?.application?.status ||
      ""
  )
    .toLowerCase()
    .trim();

  return status === "hire_requested" || status === "hire-requested";
};

const shouldHidePendingParentInitiatedHireRequest = (
  item: Partial<ParentRequestNotification>
) => {
  if (!isParentInitiatedHireRequestNotification(item)) {
    return false;
  }

  const type = String(item.type || "").toLowerCase().trim();
  if (type === "hire_accepted" || type === "hire_rejected") {
    return false;
  }

  const status = String(
    item.status ||
      item.application_status ||
      item.application?.status ||
      item.raw?.data?.status ||
      item.raw?.data?.application_status ||
      item.raw?.data?.application?.status ||
      ""
  )
    .toLowerCase()
    .trim();

  return status === "" || status === "hire_requested" || status === "hire-requested";
};

const toTimestamp = (item: Partial<ParentRequestNotification>) => {
  const parsed = Date.parse(String(item.created_at || item.time || ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseNumber = (value: any): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const formatHoursLabel = (value: any): string => {
  const parsed = parseNumber(value);
  if (!parsed || parsed <= 0) return "Hours TBD";
  return `${Number.isInteger(parsed) ? parsed : parsed.toFixed(1)} hrs`;
};

const formatPayLabel = (job: any, meta: any): string => {
  const rawRate =
    parseNumber(meta?.hourly_rate) ??
    parseNumber(meta?.rate) ??
    parseNumber(meta?.pay_rate) ??
    parseNumber(job?.hourly_rate) ??
    parseNumber(job?.rate);
  if (rawRate && rawRate > 0) {
    return `$${rawRate.toFixed(2)}/hr`;
  }

  const totalPay =
    parseNumber(meta?.pay) ??
    parseNumber(meta?.price) ??
    parseNumber(job?.price) ??
    parseNumber(job?.pay);
  if (totalPay && totalPay > 0) {
    return `$${totalPay.toFixed(2)}`;
  }

  return "Rate TBD";
};

const normalizeKeyText = (value: any, limit = 120): string =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

const normalizeDayKey = (value: any): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct?.[1]) return direct[1];

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
};

export const dedupeKeyForRequest = (item: Partial<ParentRequestNotification>): string => {
  const jobId = String(
    item.job_id || item.job?.id || item.raw?.data?.job_id || item.raw?.data?.job?.id || ""
  ).trim();
  const nannyId = String(
    item.nanny_id || item.nanny?.id || item.raw?.data?.nanny_id || item.raw?.data?.nanny?.id || ""
  ).trim();
  const nannyName = normalizeKeyText(
    item.nanny_name ||
      item.nanny?.fullname ||
      item.nanny?.name ||
      [item.nanny?.first_name, item.nanny?.last_name].filter(Boolean).join(" ")
  );
  const messageKey = normalizeKeyText(item.message || item.subtitle || item.title || "", 160);
  const dayKey = normalizeDayKey(item.created_at || item.time);

  if (jobId && nannyId) return `job:${jobId}|nanny:${nannyId}`;

  const applicationId = String(
    item.application_id ||
      item.application?.id ||
      item.raw?.data?.application_id ||
      item.raw?.data?.application?.id ||
      item.raw?.application_id ||
      item.raw?.notification?.data?.application_id ||
      ""
  ).trim();
  if (applicationId) return `app:${applicationId}`;

  if (jobId) {
    const signature = [nannyName, messageKey, dayKey].filter(Boolean).join("|");
    if (signature) return `job:${jobId}|sig:${signature}`;
    return `job:${jobId}`;
  }

  const id = String(item.id || "").trim();
  if (id) return `id:${id}`;

  const signature = [nannyName, messageKey, dayKey].filter(Boolean).join("|");
  if (signature) return `sig:${signature}`;

  return `fallback:${normalizeKeyText(item.title || item.subtitle || item.message || "request")}`;
};

const uniqueIds = (values: (string | number | null | undefined)[]) =>
  Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean))
  );

const normalizeIncomingNotification = (payload: any): ParentRequestNotification | null => {
  if (!payload) return null;

  const root = payload.notification || payload;
  const data = root?.data || root;
  const nestedData =
    data?.data && typeof data.data === "object" && !Array.isArray(data.data)
      ? data.data
      : null;

  const body = data?.message || data?.body || root?.message || root?.body || "";
  const createdAt = data?.created_at || root?.created_at || data?.time;
  const readValue = data?.is_read ?? root?.is_read;

  const job = data?.job || nestedData?.job || root?.job || null;
  const nanny = data?.nanny || nestedData?.nanny || root?.nanny || null;
  const application =
    data?.application || nestedData?.application || root?.application || null;
  const meta = data?.meta || nestedData?.meta || root?.meta || null;

  const resolvedId =
    data?.id ||
    root?.id ||
    data?.notification_id ||
    root?.notification_id ||
    data?.application_id ||
    root?.application_id ||
    data?.job_application_id ||
    root?.job_application_id ||
    application?.id;

  const kids = Array.isArray(job?.kids)
    ? job.kids
    : Array.isArray(nestedData?.kids)
      ? nestedData.kids
      : [];
  const resolvedSourceIds = uniqueIds([
    ...(Array.isArray(data?.source_ids) ? data.source_ids : []),
    ...(Array.isArray(root?.source_ids) ? root.source_ids : []),
    resolvedId,
  ]);
  const kidNames = kids
    .map((kid: any) => String(kid?.name || kid?.kid_name || "").trim())
    .filter(Boolean);

  const item: ParentRequestNotification = {
    id: resolvedId,
    title: data?.title || data?.subject || root?.title || root?.subject || "Job Request",
    subtitle: data?.subtitle || body,
    message: body,
    time: createdAt,
    created_at: createdAt,
    is_read: readValue,
    isRead: isNotificationRead({
      isRead: data?.isRead ?? root?.isRead,
      is_read: readValue,
    }),
    type: data?.type || root?.type,
    status: data?.status || data?.application_status || root?.status,
    request_source:
      data?.request_source ||
      application?.request_source ||
      job?.request_source ||
      nestedData?.request_source,
    application_status:
      data?.application_status ||
      application?.status ||
      nestedData?.application_status,
    application_id:
      data?.application_id ||
      root?.application_id ||
      data?.job_application_id ||
      root?.job_application_id ||
      application?.id ||
      nestedData?.application_id,
    job_id:
      data?.job_id ||
      root?.job_id ||
      job?.id ||
      nestedData?.job_id,
    nanny_id:
      data?.nanny_id ||
      root?.nanny_id ||
      nanny?.id ||
      nestedData?.nanny_id,
    nanny_name:
      nanny?.fullname ||
      nanny?.name ||
      [nanny?.first_name, nanny?.last_name].filter(Boolean).join(" ").trim() ||
      undefined,
    kid_names: kidNames,
    hours_label: formatHoursLabel(meta?.hours ?? job?.hours ?? data?.hours ?? root?.hours),
    pay_label: formatPayLabel(job || {}, meta || {}),
    location: job?.location || "",
    job,
    nanny,
    application,
    meta,
    raw: payload,
    request_key: "",
    source_ids: resolvedSourceIds,
  };

  item.request_key = dedupeKeyForRequest(item);
  return item;
};

const shouldHydrateRequestDetails = (item: ParentRequestNotification): boolean => {
  const hasJobObject = !!item?.job && typeof item.job === "object";
  const missingHours = !item.hours_label || item.hours_label === "Hours TBD";
  const missingPay = !item.pay_label || item.pay_label === "Rate TBD";
  const missingKids = !Array.isArray(item.kid_names) || item.kid_names.length === 0;
  const missingLocation = !String(item.location || "").trim();
  const missingNanny = !String(item.nanny_name || "").trim();
  return !hasJobObject || missingHours || missingPay || missingKids || missingLocation || missingNanny;
};

const enrichFromJobDetails = (
  item: ParentRequestNotification,
  root: any
): ParentRequestNotification => {
  const fetchedJob = root?.job || null;
  const fetchedApplications = Array.isArray(root?.applications)
    ? root.applications
    : Array.isArray(fetchedJob?.applications)
      ? fetchedJob.applications
      : [];
  const fetchedNannies = Array.isArray(root?.nannies) ? root.nannies : [];

  const applicationId = String(item.application_id || "").trim();
  const nannyId = String(item.nanny_id || "").trim();
  const matchedApplication =
    fetchedApplications.find(
      (entry: any) => String(entry?.id ?? entry?.application_id ?? "") === applicationId
    ) ||
    fetchedApplications.find((entry: any) => String(entry?.nanny_id ?? "") === nannyId) ||
    item.application ||
    null;

  const matchedNanny =
    fetchedNannies.find(
      (entry: any) =>
        String(entry?.id ?? entry?.nanny_id ?? "") ===
        String(nannyId || matchedApplication?.nanny_id || "")
    ) ||
    matchedApplication?.nanny ||
    item.nanny ||
    null;

  const nextJob = fetchedJob || item.job || {};
  const nextMeta = item.meta || {};
  const kids = Array.isArray(nextJob?.kids) ? nextJob.kids : [];
  const kidNames = kids
    .map((kid: any) => String(kid?.name || kid?.kid_name || "").trim())
    .filter(Boolean);

  return {
    ...item,
    job: nextJob,
    application: matchedApplication,
    nanny: matchedNanny,
    nanny_name:
      item.nanny_name ||
      matchedNanny?.fullname ||
      matchedNanny?.name ||
      [matchedNanny?.first_name, matchedNanny?.last_name].filter(Boolean).join(" ").trim() ||
      undefined,
    kid_names: item.kid_names?.length ? item.kid_names : kidNames,
    hours_label:
      item.hours_label && item.hours_label !== "Hours TBD"
        ? item.hours_label
        : formatHoursLabel(nextMeta?.hours ?? nextJob?.hours),
    pay_label:
      item.pay_label && item.pay_label !== "Rate TBD"
        ? item.pay_label
        : formatPayLabel(nextJob, nextMeta),
    location: item.location || nextJob?.location || "",
  };
};

const hydrateParentRequestDetails = async (
  list: ParentRequestNotification[],
  context: { token: string; userId: string; apiKey: string }
): Promise<ParentRequestNotification[]> => {
  const pending = list.filter((item) => shouldHydrateRequestDetails(item));
  if (!pending.length) return list;

  const uniqueJobIds = Array.from(
    new Set(
      pending
        .map((item) => String(item.job_id || item.job?.id || "").trim())
        .filter(Boolean)
    )
  );
  if (!uniqueJobIds.length) return list;

  const detailMap = new Map<string, any>();
  await Promise.all(
    uniqueJobIds.map(async (jobId) => {
      try {
        const json = await apiRequest<any>("job/get-details", {
          method: "POST",
          headers: {
            ...(context.token ? { Authorization: `Bearer ${context.token}` } : {}),
            ...(context.apiKey ? { "x-api-key": context.apiKey } : {}),
          },
          body: JSON.stringify({
            job_id: Number.isFinite(Number(jobId)) ? Number(jobId) : jobId,
            ...(context.userId ? { user_id: context.userId } : {}),
          }),
        });
        const root = json?.data || json;
        if (root) detailMap.set(jobId, root);
      } catch {
        // keep original item fallback
      }
    })
  );

  if (!detailMap.size) return list;

  return list.map((item) => {
    const jobId = String(item.job_id || item.job?.id || "").trim();
    const root = detailMap.get(jobId);
    return root ? enrichFromJobDetails(item, root) : item;
  });
};

const dedupeRequests = (
  requests: ParentRequestNotification[]
): ParentRequestNotification[] => {
  const byKey = new Map<string, ParentRequestNotification>();

  requests.forEach((item) => {
    const key = item.request_key || dedupeKeyForRequest(item);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        ...item,
        request_key: key,
        source_ids: uniqueIds([item.id, ...item.source_ids]),
      });
      return;
    }

    const keepLatest = toTimestamp(item) >= toTimestamp(existing);
    const latest = keepLatest ? item : existing;
    const readMerged = isNotificationRead(item) || isNotificationRead(existing);

    byKey.set(key, {
      ...latest,
      request_key: key,
      source_ids: uniqueIds([
        latest.id,
        ...existing.source_ids,
        ...item.source_ids,
      ]),
      ...(readMerged ? { is_read: 1, isRead: true } : {}),
    });
  });

  return Array.from(byKey.values()).sort(
    (a, b) => toTimestamp(b) - toTimestamp(a)
  );
};

const getAuthContext = async () => {
  const [tokenRaw, userId, storedApiKey] = await Promise.all([
    AppStorage.getItem("token"),
    AppStorage.getItem("user_id"),
    AppStorage.getItem("api_key"),
  ]);

  return {
    token: sanitizeToken(tokenRaw || ""),
    userId: String(userId || "").trim(),
    apiKey: storedApiKey || getRuntimeApiKey() || "",
  };
};

const fetchNotificationRows = async (): Promise<{ rows: any[]; userId: string }> => {
  const { token, userId, apiKey } = await getAuthContext();
  if (!userId) return { rows: [], userId: "" };

  const json = await apiRequest<any>(`job-requests?user_id=${encodeURIComponent(userId)}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
  });

  if (Array.isArray(json)) return { rows: json, userId };
  if (Array.isArray(json?.data)) return { rows: json.data, userId };
  return { rows: [], userId };
};

const markNotificationIdsAsReadInDatabase = async (ids: string[]) => {
  const normalizedIds = uniqueIds(ids);
  if (!normalizedIds.length) return;

  const { token, userId, apiKey } = await getAuthContext();
  if (!userId) return;

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(apiKey ? { "x-api-key": apiKey } : {}),
  };
  const body = JSON.stringify({ user_id: userId });

  await Promise.allSettled(
    normalizedIds.map((id) =>
      apiRequest(`notification/mark-read/${encodeURIComponent(id)}`, {
        method: "POST",
        headers,
        body,
      })
    )
  );
};

export const fetchParentRequestNotifications = async (): Promise<ParentRequestNotification[]> => {
  const { rows, userId } = await fetchNotificationRows();
  const auth = await getAuthContext();

  const normalized = rows
    .map((row) => normalizeIncomingNotification(row))
    .filter(Boolean) as ParentRequestNotification[];

  const requestsOnly = dedupeRequests(normalized.filter(isJobRequestNotification));
  const filteredRequests = requestsOnly.filter(
    (item) => !shouldHidePendingParentInitiatedHireRequest(item)
  );
  const hydrated = await hydrateParentRequestDetails(filteredRequests, auth);
  const hiddenKeys = await readScopedStoredSet(HIDDEN_REQUEST_KEYS, userId);

  return hydrated
    .filter((item) => !shouldHidePendingParentInitiatedHireRequest(item))
    .filter((item) => !hiddenKeys.has(item.request_key));
};

export const fetchAllParentRequestNotifications = async (): Promise<ParentRequestNotification[]> => {
  const { rows, userId } = await fetchNotificationRows();
  const auth = await getAuthContext();

  const normalized = rows
    .map((row) => normalizeIncomingNotification(row))
    .filter(Boolean) as ParentRequestNotification[];

  const requestsOnly = dedupeRequests(normalized.filter(isJobRequestNotification));
  const hydrated = await hydrateParentRequestDetails(requestsOnly, auth);
  const hiddenKeys = await readScopedStoredSet(HIDDEN_REQUEST_KEYS, userId);

  return hydrated.filter((item) => !hiddenKeys.has(item.request_key));
};

export const fetchUnreadParentRequestCount = async (): Promise<number> => {
  const rows = await fetchParentRequestNotifications();
  return rows.filter((item) => !isNotificationRead(item)).length;
};

const resolveTargetIds = (
  target:
    | ParentRequestNotification
    | Partial<ParentRequestNotification>
    | string
    | number
): string[] => {
  if (typeof target === "string" || typeof target === "number") {
    return uniqueIds([target]);
  }

  return uniqueIds([target.id, ...(Array.isArray(target.source_ids) ? target.source_ids : [])]);
};

export const markParentRequestAsRead = async (
  target:
    | ParentRequestNotification
    | Partial<ParentRequestNotification>
    | string
    | number
) => {
  const ids = resolveTargetIds(target);
  if (!ids.length) return;

  await markNotificationIdsAsReadInDatabase(ids);
};

export const deleteParentRequestNotification = async (
  target: ParentRequestNotification | Partial<ParentRequestNotification>
) => {
  const ids = resolveTargetIds(target);
  const applicationId = String(target.application_id || target.application?.id || "").trim();
  const requestKey = String(target.request_key || "").trim();
  const { token, userId, apiKey } = await getAuthContext();

  if (!ids.length && !applicationId) {
    if (requestKey) {
      await addToStoredSet(HIDDEN_REQUEST_KEYS, [requestKey], userId);
    }
    return;
  }

  const deletedIds: string[] = [];
  const targetId = applicationId || ids[0] || "";

  try {
    const json = await apiRequest<any>(`job-requests/${encodeURIComponent(targetId)}`, {
      method: "DELETE",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: userId ? JSON.stringify({ user_id: userId }) : undefined,
    });
    if (json?.success !== false) {
      deletedIds.push(targetId);
      ids.forEach((id) => deletedIds.push(id));
    }
  } catch {
    // keep failure handling below
  }

  if (!deletedIds.length) {
    throw new Error("Unable to delete job request right now.");
  }

  if (requestKey) {
    await addToStoredSet(HIDDEN_REQUEST_KEYS, [requestKey], userId);
  }
};
