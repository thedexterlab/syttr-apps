<?php

namespace App\Console\Commands;

use App\Http\Controllers\NotificationController;
use App\Http\Controllers\ParentJobController;
use App\Models\PaymentMethod;
use App\Models\ParentJob;
use App\Models\ParentJobApplication;
use App\Models\StripeTransaction;
use App\Models\UserNotification;
use App\Models\WalletTransaction;
use App\Support\StripeCustomerManager;
use App\Support\StripeTransactionRecorder;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class SendActiveJobCompletionReminders extends Command
{
    protected $signature = 'jobs:send-active-completion-reminders';

    protected $description = 'Send job completion reminders around booking end time and auto-charge late completion penalties.';

    private const FIXED_REMINDER_SLOTS = [
        ['offset_minutes' => -30, 'slot' => 'before_30m'],
        ['offset_minutes' => -5, 'slot' => 'before_5m'],
        ['offset_minutes' => 5, 'slot' => 'after_5m'],
    ];

    private const NANNY_START_REMINDER_OFFSET_MINUTES = -60;

    private const REPEATING_OVERDUE_REMINDER_MINUTES = 30;

    private const AUTO_CHARGE_OFFSET_MINUTES = 120;

    public function handle(): int
    {
        $timezone = config('app.timezone');
        $acceptedStatuses = ['accepted', 'accept', 'approved', 'confirmed', 'confirm'];
        $now = Carbon::now($timezone);

        $jobs = ParentJob::query()
            ->whereNotIn('status', ['canceled', 'cancelled', 'completed'])
            ->where(function ($query) use ($acceptedStatuses) {
                $query
                    ->whereIn('status', $acceptedStatuses)
                    ->orWhereHas('applications', fn ($appQuery) => $appQuery->whereIn('status', $acceptedStatuses));
            })
            ->with([
                'applications' => fn ($query) => $query
                    ->whereIn('status', $acceptedStatuses)
                    ->orderByDesc('id'),
            ])
            ->get();

        $sent = 0;
        foreach ($jobs as $job) {
            $startAt = $this->buildJobStartAt($job, $timezone);
            $endAt = $this->buildJobEndAt($job, $timezone, $startAt);
            if (! $startAt || ! $endAt) {
                continue;
            }

            /** @var ParentJobApplication|null $acceptedApplication */
            $acceptedApplication = $job->applications->first();
            if (! $acceptedApplication || ! $acceptedApplication->nanny_id) {
                continue;
            }

            if ($this->isDueAtMinute($now, $startAt)) {
                if ($this->sendJobStartedNotificationPair($job, $acceptedApplication, $startAt)) {
                    $sent += 2;
                }
            }

            $nannyStartReminderAt = $startAt->copy()->addMinutes(self::NANNY_START_REMINDER_OFFSET_MINUTES);
            if ($this->isDueAtMinute($now, $nannyStartReminderAt)) {
                if ($this->sendNannyStartReminder($job, $acceptedApplication, $startAt)) {
                    $sent++;
                }
            }

            foreach (self::FIXED_REMINDER_SLOTS as $slotConfig) {
                $triggerAt = $endAt->copy()->addMinutes($slotConfig['offset_minutes']);
                if (! $this->isDueAtMinute($now, $triggerAt)) {
                    continue;
                }

                if ($this->sendReminderPair($job, $acceptedApplication, $endAt, $slotConfig['slot'])) {
                    $sent += 2;
                }
            }

            $overdueSlot = $this->resolveOverdueReminderSlot($now, $endAt);
            if ($overdueSlot !== null) {
                if ($this->sendReminderPair($job, $acceptedApplication, $endAt, $overdueSlot)) {
                    $sent += 2;
                }
            }

            $autoChargeAt = $endAt->copy()->addMinutes(self::AUTO_CHARGE_OFFSET_MINUTES);
            if ($now->greaterThanOrEqualTo($autoChargeAt)) {
                if ($this->chargeLateCompletionPenalty($job, $acceptedApplication, $endAt)) {
                    $sent++;
                }

                if ($this->autoCompleteOverdueJob($job)) {
                    $sent++;
                }
            }
        }

        $this->info('Active job completion notifications/charges processed: '.$sent);
        return self::SUCCESS;
    }

    private function buildJobStartAt(ParentJob $job, string $timezone): ?Carbon
    {
        $date = optional($job->start_date)->format('Y-m-d');
        $time = trim((string) ($job->start_time ?? ''));
        if (! $date || $time === '') {
            return null;
        }

        $raw = $date.' '.$time;
        $formats = ['Y-m-d H:i:s', 'Y-m-d H:i', 'Y-m-d h:i A', 'Y-m-d g:i A', 'Y-m-d h:iA', 'Y-m-d g:iA'];
        foreach ($formats as $format) {
            try {
                $parsed = Carbon::createFromFormat($format, $raw, $timezone);
                if ($parsed) {
                    return $parsed;
                }
            } catch (\Throwable) {
                // Try next format.
            }
        }

        try {
            return Carbon::parse($raw, $timezone);
        } catch (\Throwable) {
            return null;
        }
    }

    private function buildJobEndAt(ParentJob $job, string $timezone, ?Carbon $startAt = null): ?Carbon
    {
        $date = optional($job->end_date ?: $job->start_date)?->format('Y-m-d');
        $time = trim((string) ($job->end_time ?? ''));
        if ($date && $time !== '') {
            $raw = $date.' '.$time;
            $formats = ['Y-m-d H:i:s', 'Y-m-d H:i', 'Y-m-d h:i A', 'Y-m-d g:i A', 'Y-m-d h:iA', 'Y-m-d g:iA'];
            foreach ($formats as $format) {
                try {
                    $parsed = Carbon::createFromFormat($format, $raw, $timezone);
                    if ($parsed) {
                        return $parsed;
                    }
                } catch (\Throwable) {
                }
            }

            try {
                return Carbon::parse($raw, $timezone);
            } catch (\Throwable) {
            }
        }

        $hours = (float) ($job->hours ?? 0);
        if ($startAt && $hours > 0) {
            return $startAt->copy()->addMinutes((int) round($hours * 60));
        }

        return null;
    }

    private function isDueAtMinute(Carbon $now, Carbon $target): bool
    {
        return $now->format('Y-m-d H:i') === $target->format('Y-m-d H:i');
    }

    private function resolveOverdueReminderSlot(Carbon $now, Carbon $scheduledEndAt): ?string
    {
        $firstOverdueReminderAt = $scheduledEndAt->copy()->addMinutes(self::REPEATING_OVERDUE_REMINDER_MINUTES);
        if ($now->lt($firstOverdueReminderAt)) {
            return null;
        }

        $minutesOverdue = $scheduledEndAt->diffInMinutes($now, false);
        if ($minutesOverdue < self::REPEATING_OVERDUE_REMINDER_MINUTES) {
            return null;
        }

        if ($minutesOverdue >= self::AUTO_CHARGE_OFFSET_MINUTES) {
            return null;
        }

        if ($minutesOverdue % self::REPEATING_OVERDUE_REMINDER_MINUTES !== 0) {
            return null;
        }

        return 'after_'.(int) $minutesOverdue.'m';
    }

    private function sendReminderPair(
        ParentJob $job,
        ParentJobApplication $application,
        Carbon $scheduledEndAt,
        string $slot
    ): bool {
        $parentKey = 'job:'.$job->id.':completion-reminder:parent:'.$slot;
        $nannyKey = 'job:'.$job->id.':completion-reminder:nanny:'.$slot;

        $parentSent = $this->notificationExists($job->user_id, 'job_complete_reminder_parent', $parentKey);
        $nannySent = $this->notificationExists($application->nanny_id, 'job_complete_reminder_nanny', $nannyKey);

        if (! $parentSent) {
            NotificationController::createForUser(
                $job->user_id,
                'job_complete_reminder_parent',
                'Complete Job',
                $this->parentReminderMessage($slot),
                [
                    'notification_key' => $parentKey,
                    'job_id' => $job->id,
                    'application_id' => $application->id,
                    'nanny_id' => $application->nanny_id,
                    'scheduled_end_at' => $scheduledEndAt->toISOString(),
                    'reminder_slot' => $slot,
                ],
                $application->nanny_id
            );
        }

        if (! $nannySent) {
            NotificationController::createForUser(
                $application->nanny_id,
                'job_complete_reminder_nanny',
                'Job Completion Reminder',
                $this->nannyReminderMessage($slot),
                [
                    'notification_key' => $nannyKey,
                    'job_id' => $job->id,
                    'application_id' => $application->id,
                    'parent_user_id' => $job->user_id,
                    'scheduled_end_at' => $scheduledEndAt->toISOString(),
                    'reminder_slot' => $slot,
                ],
                $job->user_id
            );
        }

        return ! $parentSent || ! $nannySent;
    }

    private function notificationExists(string $recipientUserId, string $type, string $notificationKey): bool
    {
        return UserNotification::query()
            ->where('recipient_user_id', strtoupper(trim($recipientUserId)))
            ->where('type', $type)
            ->where('data->notification_key', $notificationKey)
            ->exists();
    }

    private function sendJobStartedNotificationPair(
        ParentJob $job,
        ParentJobApplication $application,
        Carbon $scheduledStartAt
    ): bool {
        $parentKey = 'job:'.$job->id.':started:parent';
        $nannyKey = 'job:'.$job->id.':started:nanny';

        $parentSent = $this->notificationExists($job->user_id, 'job_started_parent', $parentKey);
        $nannySent = $this->notificationExists($application->nanny_id, 'job_started_nanny', $nannyKey);

        if (! $parentSent) {
            NotificationController::createForUser(
                $job->user_id,
                'job_started_parent',
                'Job Started',
                'Your job has started.',
                [
                    'notification_key' => $parentKey,
                    'job_id' => $job->id,
                    'application_id' => $application->id,
                    'nanny_id' => $application->nanny_id,
                    'scheduled_start_at' => $scheduledStartAt->toISOString(),
                ],
                $application->nanny_id
            );
        }

        if (! $nannySent) {
            NotificationController::createForUser(
                $application->nanny_id,
                'job_started_nanny',
                'Job Started',
                'Your job has started.',
                [
                    'notification_key' => $nannyKey,
                    'job_id' => $job->id,
                    'application_id' => $application->id,
                    'parent_user_id' => $job->user_id,
                    'scheduled_start_at' => $scheduledStartAt->toISOString(),
                ],
                $job->user_id
            );
        }

        return ! $parentSent || ! $nannySent;
    }

    private function sendNannyStartReminder(
        ParentJob $job,
        ParentJobApplication $application,
        Carbon $scheduledStartAt
    ): bool {
        $nannyKey = 'job:'.$job->id.':starts-in-one-hour:nanny';
        $nannySent = $this->notificationExists($application->nanny_id, 'job_starts_in_one_hour_nanny', $nannyKey);

        if ($nannySent) {
            return false;
        }

        NotificationController::createForUser(
            $application->nanny_id,
            'job_starts_in_one_hour_nanny',
            'Job Starts Soon',
            'Your job starts in one hour.',
            [
                'notification_key' => $nannyKey,
                'job_id' => $job->id,
                'application_id' => $application->id,
                'parent_user_id' => $job->user_id,
                'scheduled_start_at' => $scheduledStartAt->toISOString(),
                'reminder_slot' => 'before_start_60m',
            ],
            $job->user_id
        );

        return true;
    }

    private function parentReminderMessage(string $slot): string
    {
        if (preg_match('/^after_(\d+)m$/', $slot, $matches) === 1) {
            $minutes = (int) $matches[1];
            return 'Your booking ended '.$this->formatMinutesForMessage($minutes).' ago and no confirmation was received. Please click complete job in order for your syttr to get paid and to avoid any late fees.';
        }

        return match ($slot) {
            'before_30m' => 'Your booking ends in 30 minutes. Please complete the job on time. If you need more time, request extra hours before the scheduled end time.',
            'before_5m' => 'Your job is still active. Tap Complete Job to avoid delay fees',
            default => 'Please complete the job on time. If you need more time, request extra hours before the scheduled end time.',
        };
    }

    private function nannyReminderMessage(string $slot): string
    {
        return 'Job still incomplete. Please remind the parent to complete the booking. Payment will be released once the job is completed.';
    }

    private function formatMinutesForMessage(int $minutes): string
    {
        $hours = intdiv($minutes, 60);
        $remainingMinutes = $minutes % 60;

        if ($hours > 0 && $remainingMinutes > 0) {
            return $hours.' hour'.($hours === 1 ? '' : 's').' '.$remainingMinutes.' minute'.($remainingMinutes === 1 ? '' : 's');
        }

        if ($hours > 0) {
            return $hours.' hour'.($hours === 1 ? '' : 's');
        }

        return $minutes.' minute'.($minutes === 1 ? '' : 's');
    }

    private function autoCompleteOverdueJob(ParentJob $job): bool
    {
        $currentStatus = strtolower(trim((string) ($job->status ?? '')));
        if ($currentStatus === 'completed') {
            return false;
        }

        try {
            $controller = app(ParentJobController::class);
            $request = Request::create('/internal/job/update-status', 'POST', [
                'job_id' => $job->id,
                'user_id' => $job->user_id,
                'status' => 'completed',
            ]);

            $response = $controller->updateStatus($request);
            $payload = method_exists($response, 'getData') ? $response->getData(true) : null;
            $success = $response->getStatusCode() >= 200
                && $response->getStatusCode() < 300
                && (bool) ($payload['success'] ?? false);

            if (! $success) {
                Log::warning('job_completion_reminder.auto_complete_failed', [
                    'job_id' => $job->id,
                    'user_id' => $job->user_id,
                    'status_code' => $response->getStatusCode(),
                    'payload' => $payload,
                ]);
            }

            return $success;
        } catch (\Throwable $e) {
            Log::error('job_completion_reminder.auto_complete_exception', [
                'job_id' => $job->id,
                'user_id' => $job->user_id,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    private function chargeLateCompletionPenalty(
        ParentJob $job,
        ParentJobApplication $application,
        Carbon $scheduledEndAt
    ): bool {
        $chargeKey = 'job:'.$job->id.':late-completion-penalty';
        if ($this->notificationExists($job->user_id, 'late_completion_penalty_charged', $chargeKey)) {
            return false;
        }

        if (StripeTransaction::query()
            ->where('source', 'parent_job.late_completion_penalty')
            ->where('job_id', $job->id)
            ->whereIn('status', ['succeeded', 'processing', 'requires_capture'])
            ->exists()) {
            return false;
        }

        $hourlyRate = $this->resolveHourlyRate($job);
        $penaltyHours = self::AUTO_CHARGE_OFFSET_MINUTES / 60;
        $amount = round($hourlyRate * $penaltyHours, 2);
        if ($amount <= 0) {
            return false;
        }

        $paymentMethod = PaymentMethod::query()
            ->where('user_id', $job->user_id)
            ->orderByDesc('is_default')
            ->orderByDesc('id')
            ->first();
        if (! $paymentMethod || ! filled($paymentMethod->stripe_payment_method_id)) {
            StripeTransactionRecorder::record([
                'user_id' => $job->user_id,
                'counterparty_user_id' => $application->nanny_id,
                'job_id' => $job->id,
                'application_id' => $application->id,
                'source' => 'parent_job.late_completion_penalty',
                'category' => 'job',
                'type' => 'payment_intent',
                'status' => 'missing_payment_method',
                'amount' => $amount,
                'currency' => 'usd',
                'description' => 'Late completion penalty for job #'.$job->id,
                'error_message' => 'No saved payment method found for late completion penalty.',
                'meta' => [
                    'penalty_hours' => $penaltyHours,
                    'scheduled_end_at' => $scheduledEndAt->toISOString(),
                ],
            ]);

            return false;
        }

        $user = $job->user()->first();
        if (! $user) {
            return false;
        }

        $paymentMethodSetup = StripeCustomerManager::ensureReusablePaymentMethodForUser(
            $user,
            (string) $paymentMethod->stripe_payment_method_id,
            (bool) $paymentMethod->is_default
        );
        if (! ($paymentMethodSetup['success'] ?? false)) {
            return false;
        }

        $stripeSecret = trim((string) config('services.stripe.secret', ''));
        if ($stripeSecret === '') {
            return false;
        }

        $stripeCustomerId = trim((string) ($paymentMethodSetup['customer_id'] ?? $user->stripe_customer_id ?? ''));
        $amountInCents = max(1, (int) round($amount * 100));

        try {
            $response = Http::withOptions([
                    'verify' => (bool) config('services.stripe.verify_ssl', true),
                ])
                ->withBasicAuth($stripeSecret, '')
                ->connectTimeout(5)
                ->timeout(20)
                ->asForm()
                ->post('https://api.stripe.com/v1/payment_intents', [
                    'amount' => $amountInCents,
                    'currency' => 'usd',
                    'confirm' => 'true',
                    'off_session' => 'true',
                    'payment_method' => (string) $paymentMethod->stripe_payment_method_id,
                    'customer' => $stripeCustomerId,
                    'payment_method_types[0]' => 'card',
                    'description' => 'Late completion penalty for job #'.$job->id,
                    'metadata[job_id]' => (string) $job->id,
                    'metadata[parent_user_id]' => (string) $job->user_id,
                    'metadata[application_id]' => (string) $application->id,
                    'metadata[penalty_type]' => 'late_completion',
                ]);

            $payload = $response->json() ?: [];
            $intentStatus = strtolower(trim((string) ($payload['status'] ?? '')));

            StripeTransactionRecorder::record([
                'user_id' => $job->user_id,
                'counterparty_user_id' => $application->nanny_id,
                'payment_method_id' => $paymentMethod->id,
                'job_id' => $job->id,
                'application_id' => $application->id,
                'source' => 'parent_job.late_completion_penalty',
                'category' => 'job',
                'type' => 'payment_intent',
                'status' => $response->successful() ? ($intentStatus !== '' ? $intentStatus : 'succeeded') : 'failed',
                'amount' => $amount,
                'currency' => 'usd',
                'stripe_payment_intent_id' => (string) ($payload['id'] ?? ''),
                'stripe_payment_method_id' => (string) $paymentMethod->stripe_payment_method_id,
                'description' => 'Late completion penalty for job #'.$job->id,
                'response_payload' => $payload,
                'error_message' => $response->successful() ? null : (string) ($payload['error']['message'] ?? 'Stripe payment failed.'),
                'meta' => [
                    'penalty_hours' => $penaltyHours,
                    'hourly_rate' => $hourlyRate,
                    'scheduled_end_at' => $scheduledEndAt->toISOString(),
                    'penalty_beneficiary' => 'Syttr LLC',
                ],
            ]);

            if (! $response->successful() || ! in_array($intentStatus, ['succeeded', 'processing', 'requires_capture'], true)) {
                return false;
            }

            if (Schema::hasTable('wallet_transactions')) {
                WalletTransaction::query()->updateOrCreate(
                    [
                        'user_id' => $job->user_id,
                        'job_id' => $job->id,
                        'application_id' => $application->id,
                        'type' => 'late_completion_penalty',
                        'direction' => 'debit',
                    ],
                    [
                        'counterparty_user_id' => null,
                        'category' => 'job',
                        'amount' => $amount,
                        'currency' => 'usd',
                        'status' => 'completed',
                        'description' => 'Late completion penalty for job #'.$job->id,
                        'stripe_payment_intent_id' => (string) ($payload['id'] ?? ''),
                        'meta' => [
                            'penalty_hours' => $penaltyHours,
                            'hourly_rate' => $hourlyRate,
                            'scheduled_end_at' => $scheduledEndAt->toISOString(),
                            'penalty_beneficiary' => 'Syttr LLC',
                            'nanny_original_payout_unchanged' => true,
                        ],
                    ]
                );
            }

            NotificationController::createForUser(
                $job->user_id,
                'late_completion_penalty_charged',
                'Late Completion Charge Applied',
                'Your card on file was automatically charged due to delayed confirmation that your previous job ended.',
                [
                    'notification_key' => $chargeKey,
                    'job_id' => $job->id,
                    'application_id' => $application->id,
                    'amount' => $amount,
                    'penalty_hours' => $penaltyHours,
                    'scheduled_end_at' => $scheduledEndAt->toISOString(),
                ],
                $application->nanny_id
            );

            return true;
        } catch (\Throwable $e) {
            Log::error('job_completion_reminder.late_penalty_failed', [
                'job_id' => $job->id,
                'application_id' => $application->id,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    private function resolveHourlyRate(ParentJob $job): float
    {
        $hourlyRate = (float) ($job->hourly_rate ?? 0);
        if ($hourlyRate > 0) {
            return round($hourlyRate, 2);
        }

        $price = (float) ($job->price ?? 0);
        $hours = (float) ($job->hours ?? 0);
        if ($price > 0 && $hours > 0) {
            return round($price / $hours, 2);
        }

        return 0.0;
    }

}
