<?php

namespace App\Support;

use App\Models\SubscriptionPlanSetting;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Schema;

class SubscriptionPlanCatalog
{
    public static function active(): Collection
    {
        $plans = static::plans(true);

        return $plans->isNotEmpty() ? $plans : collect([static::fallback()]);
    }

    public static function all(): Collection
    {
        $plans = static::plans(false);

        return $plans->isNotEmpty() ? $plans : collect([static::fallback()]);
    }

    public static function resolve(mixed $identifier = null, bool $activeOnly = true): array
    {
        $plan = static::findModel($identifier, $activeOnly);

        return $plan ? static::serialize($plan) : static::fallback();
    }

    public static function serialize(SubscriptionPlanSetting $plan): array
    {
        $intervalCount = max(1, (int) ($plan->interval_count ?? 1));
        $intervalUnit = static::normalizeIntervalUnit($plan->interval_unit ?? null);
        $renewalMode = static::normalizeRenewalMode($plan->renewal_mode ?? null);

        return [
            'id' => (int) $plan->id,
            'slug' => trim((string) $plan->slug),
            'name' => trim((string) $plan->name) !== '' ? trim((string) $plan->name) : 'Premium Family',
            'description' => trim((string) ($plan->description ?? '')) ?: null,
            'amount' => round((float) ($plan->amount ?? 0), 2),
            'currency' => strtoupper(trim((string) ($plan->currency ?? 'USD'))) ?: 'USD',
            'interval_unit' => $intervalUnit,
            'interval_count' => $intervalCount,
            'billing_label' => static::billingLabel($intervalCount, $intervalUnit),
            'trial_days' => max(0, (int) ($plan->trial_days ?? 0)),
            'renewal_mode' => $renewalMode,
            'renewal_label' => static::renewalLabel($renewalMode),
            'cancellation_notice_days' => max(0, (int) ($plan->cancellation_notice_days ?? 30)),
            'stripe_price_id' => trim((string) ($plan->stripe_price_id ?? '')) ?: null,
            'features' => static::normalizeFeatures($plan->features),
            'is_active' => (bool) $plan->is_active,
            'is_default' => (bool) $plan->is_default,
            'sort_order' => (int) ($plan->sort_order ?? 0),
            'meta' => is_array($plan->meta) ? $plan->meta : [],
        ];
    }

    public static function fallback(): array
    {
        return [
            'id' => null,
            'slug' => 'premium-family',
            'name' => 'Premium Family',
            'description' => 'Unlimited posts, priority matches, and concierge support.',
            'amount' => 19.99,
            'currency' => 'USD',
            'interval_unit' => 'month',
            'interval_count' => 1,
            'billing_label' => 'Every month',
            'trial_days' => 0,
            'renewal_mode' => 'auto',
            'renewal_label' => 'Auto renew',
            'cancellation_notice_days' => 30,
            'stripe_price_id' => null,
            'features' => [
                'Unlimited job posts & edits',
                'Priority Syttr matching',
                'Concierge chat support',
            ],
            'is_active' => true,
            'is_default' => true,
            'sort_order' => 0,
            'meta' => [],
        ];
    }

    public static function addInterval(Carbon $base, int $count, string $unit): Carbon
    {
        $step = max(1, $count);

        return match (static::normalizeIntervalUnit($unit)) {
            'day' => $base->copy()->addDays($step),
            'week' => $base->copy()->addWeeks($step),
            'year' => $base->copy()->addYears($step),
            default => $base->copy()->addMonths($step),
        };
    }

    public static function billingLabel(int $count, string $unit): string
    {
        $intervalCount = max(1, $count);
        $intervalUnit = static::normalizeIntervalUnit($unit);

        if ($intervalCount === 1) {
            return match ($intervalUnit) {
                'day' => 'Daily',
                'week' => 'Weekly',
                'year' => 'Yearly',
                default => 'Every month',
            };
        }

        return 'Every '.$intervalCount.' '.$intervalUnit.'s';
    }

    public static function renewalLabel(string $mode): string
    {
        return match (static::normalizeRenewalMode($mode)) {
            'manual' => 'Manual renew',
            'fixed_term' => 'Fixed term',
            default => 'Auto renew',
        };
    }

    public static function normalizeFeatures(mixed $value): array
    {
        if (is_array($value)) {
            return array_values(array_filter(array_map(
                static fn (mixed $item): string => trim((string) $item),
                $value
            )));
        }

        if (is_string($value)) {
            $decoded = json_decode($value, true);
            if (is_array($decoded)) {
                return static::normalizeFeatures($decoded);
            }

            return array_values(array_filter(array_map(
                static fn (string $line): string => trim($line),
                preg_split('/\r\n|\r|\n/', $value) ?: []
            )));
        }

        return [];
    }

    private static function plans(bool $activeOnly): Collection
    {
        if (! static::hasTable()) {
            return collect();
        }

        $query = SubscriptionPlanSetting::query()
            ->orderByDesc('is_default')
            ->orderBy('sort_order')
            ->orderBy('id');

        if ($activeOnly) {
            $query->where('is_active', true);
        }

        return $query->get()->map(static fn (SubscriptionPlanSetting $plan): array => static::serialize($plan));
    }

    private static function findModel(mixed $identifier, bool $activeOnly): ?SubscriptionPlanSetting
    {
        if (! static::hasTable()) {
            return null;
        }

        $query = SubscriptionPlanSetting::query();
        if ($activeOnly) {
            $query->where('is_active', true);
        }

        $raw = trim((string) ($identifier ?? ''));
        if ($raw === '') {
            return (clone $query)->where('is_default', true)->first()
                ?? $query->orderByDesc('is_default')->orderBy('sort_order')->orderBy('id')->first();
        }

        $bySlugOrName = (clone $query)
            ->where(function ($builder) use ($raw): void {
                $builder
                    ->where('slug', $raw)
                    ->orWhereRaw('LOWER(name) = ?', [strtolower($raw)]);
            })
            ->first();
        if ($bySlugOrName) {
            return $bySlugOrName;
        }

        if (ctype_digit($raw)) {
            return (clone $query)->whereKey((int) $raw)->first();
        }

        return (clone $query)->where('is_default', true)->first()
            ?? $query->orderByDesc('is_default')->orderBy('sort_order')->orderBy('id')->first();
    }

    private static function normalizeIntervalUnit(mixed $value): string
    {
        return match (strtolower(trim((string) ($value ?? 'month')))) {
            'day', 'daily' => 'day',
            'week', 'weekly' => 'week',
            'year', 'yearly', 'annual' => 'year',
            default => 'month',
        };
    }

    private static function normalizeRenewalMode(mixed $value): string
    {
        return match (strtolower(trim((string) ($value ?? 'auto')))) {
            'manual', 'manual_renew', 'manual-renew' => 'manual',
            'fixed', 'fixed_term', 'fixed-term' => 'fixed_term',
            default => 'auto',
        };
    }

    private static function hasTable(): bool
    {
        try {
            return Schema::hasTable('subscription_plan_settings');
        } catch (\Throwable) {
            return false;
        }
    }
}
