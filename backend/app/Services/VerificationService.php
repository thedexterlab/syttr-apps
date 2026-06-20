<?php

namespace App\Services;

use App\Models\SubscriptionPurchase;
use App\Models\User;
use App\Models\UserSubscription;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class VerificationService
{
    public function __construct(
        private readonly FeatureFlagService $featureFlags
    ) {
    }

    public function verificationFreeModeEnabled(): bool
    {
        return $this->featureFlags->enabled('verification_free_mode');
    }

    public function completeFreeVerification(
        User $user,
        array $context = []
    ): array {
        return DB::transaction(function () use ($user, $context): array {
            $now = Carbon::now();
            $endsAt = $now->copy()->addDays(30);

            if ((bool) $user->is_blacklisted) {
                throw new \RuntimeException('Blacklisted users cannot be auto-verified.');
            }

            $user->forceFill([
                'profile_status' => 'completed',
                'profile_status_updated_at' => $now,
            ])->save();

            UserSubscription::query()
                ->where('user_id', (string) $user->user_id)
                ->whereIn('status', ['active', 'paused', 'trialing', 'renewing'])
                ->update([
                    'status' => 'inactive',
                    'ends_at' => $now,
                ]);

            $subscription = UserSubscription::query()->create([
                'user_id' => (string) $user->user_id,
                'plan' => 'Verification Free Access',
                'status' => 'active',
                'amount' => 0,
                'currency' => 'USD',
                'payment_method_id' => null,
                'starts_at' => $now,
                'ends_at' => $endsAt,
                'meta' => [
                    'source' => 'verification_free_mode',
                    'granted_by_feature_flag' => true,
                    'granted_days' => 30,
                    'verification_type' => (string) ($context['verification_type'] ?? ''),
                    'reason' => 'verification_free_mode',
                ],
            ]);

            $purchase = SubscriptionPurchase::query()->create([
                'user_id' => (string) $user->user_id,
                'subscription_id' => $subscription->id,
                'payment_method_id' => null,
                'plan' => 'Verification Free Access',
                'amount' => 0,
                'currency' => 'USD',
                'stripe_payment_intent_id' => null,
                'stripe_payment_status' => 'free_verification',
                'purchased_at' => $now,
                'meta' => [
                    'source' => 'verification_free_mode',
                    'granted_by_feature_flag' => true,
                    'verification_type' => (string) ($context['verification_type'] ?? ''),
                ],
            ]);

            Log::channel('free_verifications')->info('verification_free_mode.applied', [
                'user_id' => (string) $user->user_id,
                'internal_user_id' => $user->id,
                'verification_type' => (string) ($context['verification_type'] ?? ''),
                'subscription_id' => $subscription->id,
                'subscription_purchase_id' => $purchase->id,
                'starts_at' => $now->toIso8601String(),
                'ends_at' => $endsAt->toIso8601String(),
            ]);

            return [
                'user' => $user->fresh() ?? $user,
                'subscription' => $subscription->fresh() ?? $subscription,
                'purchase' => $purchase->fresh() ?? $purchase,
            ];
        });
    }
}
