import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import {
  createSubscriptionPlan,
  getSubscriptionManagement,
  updateSubscriptionPlan,
} from '../api'
import { exportRowsToCsv } from '../utils/csv'

const emptyPayload = {
  summary: {
    total_earnings: 0,
    recurring_revenue: 0,
    average_cost: 0,
    active_subscriptions: 0,
    successful_transactions: 0,
    total_transactions: 0,
    currency: 'USD',
  },
  plans: [],
  active_subscribers: [],
  transactions: [],
}

const blankPlanForm = {
  name: '',
  slug: '',
  description: '',
  amount: '19.99',
  currency: 'USD',
  interval_unit: 'month',
  interval_count: '1',
  trial_days: '0',
  renewal_mode: 'auto',
  cancellation_notice_days: '30',
  stripe_price_id: '',
  features: '',
  is_active: true,
  is_default: false,
  sort_order: '0',
}

const intervalOptions = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
]

const renewalOptions = [
  { value: 'auto', label: 'Auto renew' },
  { value: 'manual', label: 'Manual renew' },
  { value: 'fixed_term', label: 'Fixed term' },
]

const normalizeManagement = (data) => ({
  summary: {
    ...emptyPayload.summary,
    ...(data?.summary ?? {}),
  },
  plans: Array.isArray(data?.plans) ? data.plans : [],
  active_subscribers: Array.isArray(data?.active_subscribers) ? data.active_subscribers : [],
  transactions: Array.isArray(data?.transactions) ? data.transactions : [],
})

const toPlanForm = (plan = null) => ({
  ...blankPlanForm,
  name: plan?.name ?? '',
  slug: plan?.slug ?? '',
  description: plan?.description ?? '',
  amount: plan?.amount === 0 || plan?.amount ? String(plan.amount) : blankPlanForm.amount,
  currency: plan?.currency ?? blankPlanForm.currency,
  interval_unit: plan?.interval_unit ?? blankPlanForm.interval_unit,
  interval_count: String(plan?.interval_count ?? blankPlanForm.interval_count),
  trial_days: String(plan?.trial_days ?? blankPlanForm.trial_days),
  renewal_mode: plan?.renewal_mode ?? blankPlanForm.renewal_mode,
  cancellation_notice_days: String(
    plan?.cancellation_notice_days ?? blankPlanForm.cancellation_notice_days,
  ),
  stripe_price_id: plan?.stripe_price_id ?? '',
  features: Array.isArray(plan?.features) ? plan.features.join('\n') : '',
  is_active: plan?.is_active ?? blankPlanForm.is_active,
  is_default: plan?.is_default ?? blankPlanForm.is_default,
  sort_order: String(plan?.sort_order ?? blankPlanForm.sort_order),
})

const pickEditablePlan = (plans, preferredId = null) => {
  const editablePlans = plans.filter((plan) => Boolean(plan?.id))
  if (!editablePlans.length) return null

  if (preferredId !== null && preferredId !== undefined) {
    const preferred = editablePlans.find((plan) => plan.id === preferredId)
    if (preferred) return preferred
  }

  return editablePlans.find((plan) => plan.is_default) ?? editablePlans[0]
}

const formatMoney = (amount, currency = 'USD') => {
  const numeric = Number(amount || 0)
  const code = String(currency || 'USD').toUpperCase()

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(numeric) ? numeric : 0)
}

const formatDate = (value) => {
  if (!value) return '-'
  const parsed = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return String(value)

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

const paymentTone = (item) => {
  if (item.is_successful) return 'positive'

  const status = String(item.payment_status || '').toLowerCase()
  if (status.includes('fail') || status.includes('cancel') || status.includes('refund')) {
    return 'alert'
  }

  return 'warning'
}

const formatTrial = (days) => {
  const count = Math.max(0, Number(days || 0))
  if (!count) return 'No trial'
  return `${count} day${count === 1 ? '' : 's'}`
}

const formatNotice = (days) => {
  const count = Math.max(0, Number(days || 0))
  if (!count) return 'No notice'
  return `${count} day${count === 1 ? '' : 's'} notice`
}

function Subscriptions() {
  const [payload, setPayload] = useState(emptyPayload)
  const [status, setStatus] = useState('loading')
  const [planQuery, setPlanQuery] = useState('')
  const [subscriberQuery, setSubscriberQuery] = useState('')
  const [transactionQuery, setTransactionQuery] = useState('')
  const [editorMode, setEditorMode] = useState('create')
  const [selectedPlanId, setSelectedPlanId] = useState(null)
  const [planForm, setPlanForm] = useState(() => ({ ...blankPlanForm }))
  const [saveState, setSaveState] = useState({ type: null, message: '' })
  const [isSaving, setIsSaving] = useState(false)

  const selectedConfiguredPlan = useMemo(
    () => payload.plans.find((plan) => plan?.id === selectedPlanId) ?? null,
    [payload.plans, selectedPlanId],
  )

  const configuredPlanCount = useMemo(
    () => payload.plans.filter((plan) => Boolean(plan?.id)).length,
    [payload.plans],
  )

  const activePlanCount = useMemo(
    () => payload.plans.filter((plan) => Boolean(plan?.id) && plan.is_active).length,
    [payload.plans],
  )

  const scheduledCancellationCount = useMemo(
    () => payload.active_subscribers.filter((subscriber) => subscriber.cancel_effective_at).length,
    [payload.active_subscribers],
  )

  const applyEditorSelection = (plans, preferredId = null) => {
    const nextPlan = pickEditablePlan(plans, preferredId)

    if (!nextPlan) {
      setEditorMode('create')
      setSelectedPlanId(null)
      setPlanForm({ ...blankPlanForm })
      return
    }

    setEditorMode('edit')
    setSelectedPlanId(nextPlan.id)
    setPlanForm(toPlanForm(nextPlan))
  }

  const applyPayload = (data, preferredId = null) => {
    const normalized = normalizeManagement(data)
    setPayload(normalized)
    setStatus('ready')
    applyEditorSelection(normalized.plans, preferredId)
  }

  const reloadManagement = async (preferredId = null) => {
    setStatus('loading')
    try {
      const response = await getSubscriptionManagement()
      applyPayload(response?.data ?? response ?? emptyPayload, preferredId)
    } catch (error) {
      setStatus('error')
      throw error
    }
  }

  useEffect(() => {
    let isMounted = true

    const loadManagement = async () => {
      setStatus('loading')
      try {
        const response = await getSubscriptionManagement()
        const normalized = normalizeManagement(response?.data ?? response ?? emptyPayload)
        if (!isMounted) return
        setPayload(normalized)
        setStatus('ready')
        applyEditorSelection(normalized.plans)
      } catch {
        if (isMounted) setStatus('error')
      }
    }

    loadManagement()

    return () => {
      isMounted = false
    }
  }, [])

  const filteredPlans = useMemo(() => {
    const needle = planQuery.trim().toLowerCase()
    if (!needle) return payload.plans

    return payload.plans.filter((plan) =>
      [
        plan.name,
        plan.slug,
        plan.description,
        plan.billing_label,
        plan.renewal_label,
        plan.source,
        plan.stripe_price_id,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    )
  }, [payload.plans, planQuery])

  const filteredSubscribers = useMemo(() => {
    const needle = subscriberQuery.trim().toLowerCase()
    if (!needle) return payload.active_subscribers

    return payload.active_subscribers.filter((subscriber) =>
      [
        subscriber.user_name,
        subscriber.user_email,
        subscriber.user_id,
        subscriber.plan,
        subscriber.plan_slug,
        subscriber.display_status,
        subscriber.renewal_mode,
        subscriber.renewal_label,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    )
  }, [payload.active_subscribers, subscriberQuery])

  const filteredTransactions = useMemo(() => {
    const needle = transactionQuery.trim().toLowerCase()
    if (!needle) return payload.transactions

    return payload.transactions.filter((item) =>
      [
        item.reference,
        item.plan,
        item.plan_slug,
        item.user_name,
        item.user_email,
        item.user_id,
        item.payment_status,
        item.status,
        item.stripe_payment_intent_id,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    )
  }, [payload.transactions, transactionQuery])

  const startNewPlan = () => {
    setEditorMode('create')
    setSelectedPlanId(null)
    setPlanForm({ ...blankPlanForm })
    setSaveState({ type: null, message: '' })
  }

  const openPlanEditor = (plan) => {
    if (plan?.id) {
      setEditorMode('edit')
      setSelectedPlanId(plan.id)
      setPlanForm(toPlanForm(plan))
      setSaveState({ type: null, message: '' })
      return
    }

    setEditorMode('create')
    setSelectedPlanId(null)
    setPlanForm({
      ...toPlanForm(plan),
      slug: plan?.slug ?? '',
      is_default: false,
    })
    setSaveState({
      type: 'success',
      message: 'Legacy plan copied into a new draft. Save it to start managing it here.',
    })
  }

  const resetPlanForm = () => {
    if (editorMode === 'edit' && selectedConfiguredPlan) {
      setPlanForm(toPlanForm(selectedConfiguredPlan))
    } else {
      setPlanForm({ ...blankPlanForm })
    }
    setSaveState({ type: null, message: '' })
  }

  const updatePlanField = (field, value) => {
    setPlanForm((current) => {
      if (field === 'is_active') {
        return {
          ...current,
          is_active: value,
          is_default: value ? current.is_default : false,
        }
      }

      if (field === 'is_default') {
        return {
          ...current,
          is_default: value,
          is_active: value ? true : current.is_active,
        }
      }

      return {
        ...current,
        [field]: value,
      }
    })

    if (saveState.message) {
      setSaveState({ type: null, message: '' })
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!planForm.name.trim()) {
      setSaveState({ type: 'error', message: 'Plan name is required.' })
      return
    }

    const amount = Number(planForm.amount)
    const intervalCount = Number(planForm.interval_count)
    const trialDays = Number(planForm.trial_days)
    const cancellationNoticeDays = Number(planForm.cancellation_notice_days)
    const sortOrder = Number(planForm.sort_order)

    if (!Number.isFinite(amount) || amount < 0) {
      setSaveState({ type: 'error', message: 'Amount must be a valid number.' })
      return
    }

    if (!Number.isFinite(intervalCount) || intervalCount < 1) {
      setSaveState({ type: 'error', message: 'Billing interval must be at least 1.' })
      return
    }

    const requestPayload = {
      slug: planForm.slug.trim() || null,
      name: planForm.name.trim(),
      description: planForm.description.trim() || null,
      amount,
      currency: planForm.currency.trim().toUpperCase() || 'USD',
      interval_unit: planForm.interval_unit,
      interval_count: Math.max(1, Math.round(intervalCount)),
      trial_days: Math.max(0, Math.round(Number.isFinite(trialDays) ? trialDays : 0)),
      renewal_mode: planForm.renewal_mode,
      cancellation_notice_days: Math.max(
        0,
        Math.round(Number.isFinite(cancellationNoticeDays) ? cancellationNoticeDays : 0),
      ),
      stripe_price_id: planForm.stripe_price_id.trim() || null,
      features: planForm.features
        .split(/\r\n|\r|\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      is_active: Boolean(planForm.is_active),
      is_default: Boolean(planForm.is_default),
      sort_order: Math.max(0, Math.round(Number.isFinite(sortOrder) ? sortOrder : 0)),
    }

    setIsSaving(true)
    setSaveState({ type: null, message: '' })

    try {
      const response =
        editorMode === 'edit' && selectedConfiguredPlan?.id
          ? await updateSubscriptionPlan(selectedConfiguredPlan.id, requestPayload)
          : await createSubscriptionPlan(requestPayload)

      const savedPlan = response?.data ?? null
      await reloadManagement(savedPlan?.id ?? selectedConfiguredPlan?.id ?? null)
      setSaveState({
        type: 'success',
        message:
          response?.message ||
          (editorMode === 'edit'
            ? 'Subscription plan updated successfully.'
            : 'Subscription plan created successfully.'),
      })
    } catch (error) {
      setSaveState({
        type: 'error',
        message: error?.message || 'Unable to save the subscription plan.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const exportTransactions = () => {
    if (!filteredTransactions.length) return

    exportRowsToCsv(
      'subscription-transactions.csv',
      [
        'Reference',
        'Parent',
        'Email',
        'Plan',
        'Plan Slug',
        'Cost',
        'Payment Status',
        'Subscription Status',
        'Purchased At',
        'Starts At',
        'Ends At',
        'Stripe Payment Intent',
      ],
      filteredTransactions.map((item) => [
        item.reference || item.id,
        item.user_name || '-',
        item.user_email || '-',
        item.plan || '-',
        item.plan_slug || '-',
        formatMoney(item.cost, item.currency),
        item.payment_status || '-',
        item.status || '-',
        formatDate(item.purchased_at),
        formatDate(item.starts_at),
        formatDate(item.ends_at),
        item.stripe_payment_intent_id || '-',
      ]),
    )
  }

  const exportPlans = () => {
    if (!filteredPlans.length) return

    exportRowsToCsv(
      'subscription-plans.csv',
      [
        'Plan',
        'Slug',
        'Description',
        'Amount',
        'Currency',
        'Billing',
        'Trial',
        'Renewal',
        'Cancellation Notice',
        'Stripe Price ID',
        'Active Subscribers',
        'Recurring Revenue',
        'Total Earnings',
        'Status',
        'Default',
      ],
      filteredPlans.map((plan) => [
        plan.name || '-',
        plan.slug || '-',
        plan.description || '-',
        plan.amount ?? 0,
        plan.currency || 'USD',
        plan.billing_label || '-',
        formatTrial(plan.trial_days),
        plan.renewal_label || plan.renewal_mode || '-',
        formatNotice(plan.cancellation_notice_days),
        plan.stripe_price_id || '-',
        plan.active_subscriptions ?? 0,
        plan.recurring_revenue ?? 0,
        plan.total_earnings ?? 0,
        plan.is_active ? 'Active' : 'Inactive',
        plan.is_default ? 'Yes' : 'No',
      ]),
    )
  }

  const exportSubscribers = () => {
    if (!filteredSubscribers.length) return

    exportRowsToCsv(
      'subscription-subscribers.csv',
      [
        'Parent',
        'Email',
        'User ID',
        'Plan',
        'Plan Slug',
        'Amount',
        'Currency',
        'Billing',
        'Trial',
        'Renewal',
        'Cancellation Notice',
        'Cancellation Effective',
        'Starts At',
        'Ends At',
        'Display Status',
        'Status',
      ],
      filteredSubscribers.map((subscriber) => [
        subscriber.user_name || '-',
        subscriber.user_email || '-',
        subscriber.user_id || '-',
        subscriber.plan || '-',
        subscriber.plan_slug || '-',
        subscriber.amount ?? 0,
        subscriber.currency || 'USD',
        subscriber.billing_label || '-',
        formatTrial(subscriber.trial_days),
        subscriber.renewal_label || subscriber.renewal_mode || '-',
        formatNotice(subscriber.cancellation_notice_days),
        formatDate(subscriber.cancel_effective_at),
        formatDate(subscriber.starts_at),
        formatDate(subscriber.ends_at),
        subscriber.display_status || '-',
        subscriber.status || '-',
      ]),
    )
  }

  return (
    <div className="dashboard-shell">
      <Sidebar />

      <div className="dash-content">
        <header className="dash-header">
          <div>
            <p className="eyebrow">Finance</p>
            <h1>Subscription plans and revenue</h1>
            <p className="lead">
              Manage plan pricing, trial and renewal rules, cancellation notice windows, live
              subscribers, and subscription revenue in one place.
            </p>
          </div>

          <div className="header-actions subscription-header-actions">
            <button
              className="pill-btn ghost"
              type="button"
              onClick={() => {
                reloadManagement(selectedPlanId).catch(() => {})
              }}
            >
              Refresh
            </button>
            <button className="pill-btn" type="button" onClick={startNewPlan}>
              New plan
            </button>
          </div>
        </header>

        <section className="stat-grid">
          <article className="stat-card">
            <div className="stat-top">
              <p className="stat-label">Total earnings</p>
              <span className="chip positive">{payload.summary.successful_transactions || 0} paid</span>
            </div>
            <p className="stat-value">
              {formatMoney(payload.summary.total_earnings, payload.summary.currency)}
            </p>
            <p className="stat-detail">Revenue captured from successful subscription purchases.</p>
          </article>

          <article className="stat-card">
            <div className="stat-top">
              <p className="stat-label">Recurring revenue</p>
              <span className="chip info">{payload.summary.active_subscriptions || 0} active</span>
            </div>
            <p className="stat-value">
              {formatMoney(payload.summary.recurring_revenue, payload.summary.currency)}
            </p>
            <p className="stat-detail">Current active subscription value based on live subscribers.</p>
          </article>

          <article className="stat-card">
            <div className="stat-top">
              <p className="stat-label">Configured plans</p>
              <span className="chip neutral">{activePlanCount} active</span>
            </div>
            <p className="stat-value">{configuredPlanCount}</p>
            <p className="stat-detail">Plans managed directly from the admin console.</p>
          </article>

          <article className="stat-card">
            <div className="stat-top">
              <p className="stat-label">Cancellation queue</p>
              <span className="chip warning">{scheduledCancellationCount} scheduled</span>
            </div>
            <p className="stat-value small">
              {payload.summary.active_subscriptions || 0} subscribers
            </p>
            <p className="stat-detail">Subscribers with a pending end date stay visible until cancellation lands.</p>
          </article>
        </section>

        <section className="subscription-layout">
          <div className="panel table-card">
            <div className="panel-header">
              <div>
                <p className="panel-label">Plans</p>
                <p className="panel-title">Plan catalog, rules, and performance</p>
              </div>
              <div className="panel-actions">
                <div className="search">
                  <input
                    type="search"
                    placeholder="Search plan, slug, renewal rule, or Stripe price"
                    aria-label="Search subscription plans"
                    value={planQuery}
                    onChange={(event) => setPlanQuery(event.target.value)}
                  />
                </div>
                <button className="pill-btn ghost" type="button" onClick={exportPlans} disabled={!filteredPlans.length}>
                  Export
                </button>
                <div className="chip info">{filteredPlans.length} rows</div>
              </div>
            </div>
            <div className="table-wrap">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Billing</th>
                    <th>Trial & renewal</th>
                    <th>Cancellation notice</th>
                    <th>Performance</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPlans.map((plan) => (
                    <tr key={plan.id ?? `${plan.slug || plan.name}-legacy`}>
                      <td data-label="Plan">
                        <div className="table-copy">
                          <strong>{plan.name}</strong>
                          <span className="muted">{plan.slug || 'No slug'}</span>
                          <div className="summary-pill-row">
                            <span className={`chip ${plan.is_active ? 'positive' : 'neutral'}`}>
                              {plan.is_active ? 'Active' : 'Inactive'}
                            </span>
                            {plan.is_default ? <span className="chip info">Default</span> : null}
                            {plan.source === 'legacy' ? <span className="chip warning">Legacy</span> : null}
                          </div>
                        </div>
                      </td>
                      <td data-label="Billing">
                        <div className="metric-stack">
                          <strong>{formatMoney(plan.amount, plan.currency)}</strong>
                          <span className="muted">{plan.billing_label}</span>
                        </div>
                      </td>
                      <td data-label="Trial & renewal">
                        <div className="metric-stack">
                          <strong>{formatTrial(plan.trial_days)}</strong>
                          <span className="muted">{plan.renewal_label}</span>
                        </div>
                      </td>
                      <td data-label="Cancellation notice">
                        <div className="metric-stack">
                          <strong>{formatNotice(plan.cancellation_notice_days)}</strong>
                          <span className="muted">{plan.stripe_price_id || 'No Stripe price linked'}</span>
                        </div>
                      </td>
                      <td data-label="Performance">
                        <div className="metric-stack">
                          <strong>{formatMoney(plan.recurring_revenue, plan.currency)}</strong>
                          <span className="muted">
                            {plan.active_subscriptions} active • {formatMoney(plan.total_earnings, plan.currency)} earned
                          </span>
                        </div>
                      </td>
                      <td data-label="Action">
                        <button
                          className="pill-btn ghost small inline-action"
                          type="button"
                          onClick={() => openPlanEditor(plan)}
                        >
                          {plan.id ? 'Edit plan' : 'Use as draft'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {status === 'loading' ? (
                    <tr>
                      <td colSpan={6}>Loading plan catalog...</td>
                    </tr>
                  ) : null}
                  {status === 'error' ? (
                    <tr>
                      <td colSpan={6}>Unable to load subscription plans.</td>
                    </tr>
                  ) : null}
                  {status === 'ready' && filteredPlans.length === 0 ? (
                    <tr>
                      <td colSpan={6}>No plans matched this search.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="panel subscription-editor">
            <div className="panel-header">
              <div>
                <p className="panel-label">Plan editor</p>
                <p className="panel-title">
                  {editorMode === 'edit' && selectedConfiguredPlan
                    ? `Editing ${selectedConfiguredPlan.name}`
                    : 'Create a new plan'}
                </p>
              </div>
              <div className="summary-pill-row">
                <span className={`chip ${editorMode === 'edit' ? 'info' : 'positive'}`}>
                  {editorMode === 'edit' ? 'Edit mode' : 'Create mode'}
                </span>
                {selectedConfiguredPlan?.is_default ? <span className="chip warning">Default</span> : null}
              </div>
            </div>

            {saveState.message ? (
              <div className={`status status-inline ${saveState.type === 'error' ? 'error' : 'success'}`}>
                {saveState.message}
              </div>
            ) : null}

            <form className="subscription-form" onSubmit={handleSubmit}>
              <div className="subscription-form-grid">
                <label className="field">
                  <span>Plan name</span>
                  <input
                    type="text"
                    placeholder="Premium Family"
                    value={planForm.name}
                    onChange={(event) => updatePlanField('name', event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Slug</span>
                  <input
                    type="text"
                    placeholder="premium-family"
                    value={planForm.slug}
                    onChange={(event) => updatePlanField('slug', event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Amount</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="19.99"
                    value={planForm.amount}
                    onChange={(event) => updatePlanField('amount', event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Currency</span>
                  <input
                    type="text"
                    maxLength={10}
                    placeholder="USD"
                    value={planForm.currency}
                    onChange={(event) => updatePlanField('currency', event.target.value.toUpperCase())}
                  />
                </label>

                <label className="field">
                  <span>Billing interval</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={planForm.interval_count}
                    onChange={(event) => updatePlanField('interval_count', event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Interval unit</span>
                  <select
                    value={planForm.interval_unit}
                    onChange={(event) => updatePlanField('interval_unit', event.target.value)}
                  >
                    {intervalOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Trial days</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={planForm.trial_days}
                    onChange={(event) => updatePlanField('trial_days', event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Renewal mode</span>
                  <select
                    value={planForm.renewal_mode}
                    onChange={(event) => updatePlanField('renewal_mode', event.target.value)}
                  >
                    {renewalOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Cancellation notice days</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={planForm.cancellation_notice_days}
                    onChange={(event) =>
                      updatePlanField('cancellation_notice_days', event.target.value)
                    }
                  />
                </label>

                <label className="field">
                  <span>Sort order</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={planForm.sort_order}
                    onChange={(event) => updatePlanField('sort_order', event.target.value)}
                  />
                </label>

                <label className="field field-span-2">
                  <span>Description</span>
                  <textarea
                    className="subscription-textarea"
                    placeholder="Tell operators what this plan includes."
                    value={planForm.description}
                    onChange={(event) => updatePlanField('description', event.target.value)}
                  />
                </label>

                <label className="field field-span-2">
                  <span>Features</span>
                  <textarea
                    className="subscription-textarea"
                    placeholder="One feature per line"
                    value={planForm.features}
                    onChange={(event) => updatePlanField('features', event.target.value)}
                  />
                </label>

                <label className="field field-span-2">
                  <span>Stripe price ID</span>
                  <input
                    type="text"
                    placeholder="price_..."
                    value={planForm.stripe_price_id}
                    onChange={(event) => updatePlanField('stripe_price_id', event.target.value)}
                  />
                </label>
              </div>

              <div className="subscription-check-grid">
                <label className="subscription-check-card">
                  <input
                    type="checkbox"
                    checked={planForm.is_active}
                    onChange={(event) => updatePlanField('is_active', event.target.checked)}
                  />
                  <div>
                    <strong>Active plan</strong>
                    <p>Inactive plans stay visible in admin reporting but cannot be the default.</p>
                  </div>
                </label>

                <label className="subscription-check-card">
                  <input
                    type="checkbox"
                    checked={planForm.is_default}
                    onChange={(event) => updatePlanField('is_default', event.target.checked)}
                  />
                  <div>
                    <strong>Default plan</strong>
                    <p>Use this when new subscribers should land on this plan by default.</p>
                  </div>
                </label>
              </div>

              <div className="subscription-editor-actions">
                <button className="pill-btn" type="submit" disabled={isSaving}>
                  {isSaving ? 'Saving...' : editorMode === 'edit' ? 'Update plan' : 'Create plan'}
                </button>
                <button className="pill-btn ghost" type="button" onClick={resetPlanForm} disabled={isSaving}>
                  Reset
                </button>
                <button className="pill-btn ghost" type="button" onClick={startNewPlan} disabled={isSaving}>
                  Clear selection
                </button>
              </div>
            </form>
          </aside>
        </section>

        <section className="panel table-card">
          <div className="panel-header">
            <div>
              <p className="panel-label">Active subscribers</p>
              <p className="panel-title">Live subscriptions, renewal state, and cancellation timing</p>
            </div>
              <div className="panel-actions">
                <div className="search">
                  <input
                  type="search"
                  placeholder="Search subscriber, plan, status, or renewal mode"
                  aria-label="Search active subscribers"
                  value={subscriberQuery}
                  onChange={(event) => setSubscriberQuery(event.target.value)}
                  />
                </div>
                <button
                  className="pill-btn ghost"
                  type="button"
                  onClick={exportSubscribers}
                  disabled={!filteredSubscribers.length}
                >
                  Export
                </button>
                <div className="chip info">{filteredSubscribers.length} active</div>
              </div>
            </div>
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Parent</th>
                  <th>Plan</th>
                  <th>Billing</th>
                  <th>Trial</th>
                  <th>Renewal</th>
                  <th>Cancellation</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubscribers.map((subscriber) => (
                  <tr key={subscriber.id}>
                    <td data-label="Parent">
                      <div className="table-copy">
                        <strong>{subscriber.user_name || '-'}</strong>
                        <span className="muted">{subscriber.user_email || subscriber.user_id || '-'}</span>
                      </div>
                    </td>
                    <td data-label="Plan">
                      <div className="table-copy">
                        <strong>{subscriber.plan || '-'}</strong>
                        <span className="muted">{subscriber.plan_slug || 'No slug'}</span>
                      </div>
                    </td>
                    <td data-label="Billing">
                      <div className="metric-stack">
                        <strong>{formatMoney(subscriber.amount, subscriber.currency)}</strong>
                        <span className="muted">{subscriber.billing_label || '-'}</span>
                      </div>
                    </td>
                    <td data-label="Trial">
                      <div className="metric-stack">
                        <strong>{formatTrial(subscriber.trial_days)}</strong>
                        <span className="muted">
                          {subscriber.starts_at ? `Started ${formatDate(subscriber.starts_at)}` : 'No start date'}
                        </span>
                      </div>
                    </td>
                    <td data-label="Renewal">
                      <div className="metric-stack">
                        <strong>{subscriber.renewal_label || subscriber.renewal_mode || '-'}</strong>
                        <span className="muted">
                          {subscriber.ends_at ? `Ends ${formatDate(subscriber.ends_at)}` : 'No end date'}
                        </span>
                      </div>
                    </td>
                    <td data-label="Cancellation">
                      <div className="metric-stack">
                        <strong>{formatNotice(subscriber.cancellation_notice_days)}</strong>
                        <span className="muted">
                          {subscriber.cancel_effective_at
                            ? `Effective ${formatDate(subscriber.cancel_effective_at)}`
                            : 'No cancellation scheduled'}
                        </span>
                      </div>
                    </td>
                    <td data-label="Status">
                      <div className="metric-stack">
                        <span className={`chip ${subscriber.status_tone || 'neutral'}`}>
                          {subscriber.display_status || subscriber.status || '-'}
                        </span>
                        <span className="muted">{subscriber.status || '-'}</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {status === 'loading' ? (
                  <tr>
                    <td colSpan={7}>Loading active subscribers...</td>
                  </tr>
                ) : null}
                {status === 'error' ? (
                  <tr>
                    <td colSpan={7}>Unable to load active subscribers.</td>
                  </tr>
                ) : null}
                {status === 'ready' && filteredSubscribers.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No active subscribers matched this search.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel table-card">
          <div className="panel-header">
            <div>
              <p className="panel-label">Transactions</p>
              <p className="panel-title">Subscription payments and history</p>
            </div>
            <div className="panel-actions">
              <div className="search">
                <input
                  type="search"
                  placeholder="Search by parent, plan, reference, or payment intent"
                  aria-label="Search subscription transactions"
                  value={transactionQuery}
                  onChange={(event) => setTransactionQuery(event.target.value)}
                />
              </div>
              <button
                className="pill-btn ghost"
                type="button"
                onClick={exportTransactions}
                disabled={!filteredTransactions.length}
              >
                Export
              </button>
              <div className="chip info">{filteredTransactions.length} rows</div>
            </div>
          </div>
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Parent</th>
                  <th>Plan</th>
                  <th>Cost</th>
                  <th>Payment</th>
                  <th>Subscription</th>
                  <th>Purchased</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Reference">
                      <div className="table-copy">
                        <strong>{item.reference || item.id}</strong>
                        <span className="muted">{item.stripe_payment_intent_id || '-'}</span>
                      </div>
                    </td>
                    <td data-label="Parent">
                      <div className="table-copy">
                        <strong>{item.user_name || '-'}</strong>
                        <span className="muted">{item.user_email || item.user_id || '-'}</span>
                      </div>
                    </td>
                    <td data-label="Plan">
                      <div className="table-copy">
                        <strong>{item.plan || '-'}</strong>
                        <span className="muted">
                          {item.starts_at ? `Starts ${formatDate(item.starts_at)}` : 'Start unavailable'}
                        </span>
                      </div>
                    </td>
                    <td data-label="Cost">{formatMoney(item.cost, item.currency)}</td>
                    <td data-label="Payment">
                      <span className={`chip ${paymentTone(item)}`}>{item.payment_status || '-'}</span>
                    </td>
                    <td data-label="Subscription">
                      <div className="table-copy">
                        <strong>{item.status || '-'}</strong>
                        <span className="muted">
                          {item.ends_at ? `Ends ${formatDate(item.ends_at)}` : 'No end date'}
                        </span>
                      </div>
                    </td>
                    <td data-label="Purchased">{formatDate(item.purchased_at)}</td>
                  </tr>
                ))}
                {status === 'loading' ? (
                  <tr>
                    <td colSpan={7}>Loading subscription transactions...</td>
                  </tr>
                ) : null}
                {status === 'error' ? (
                  <tr>
                    <td colSpan={7}>Unable to load subscription transactions.</td>
                  </tr>
                ) : null}
                {status === 'ready' && filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No subscription transactions matched this search.</td>
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

export default Subscriptions
