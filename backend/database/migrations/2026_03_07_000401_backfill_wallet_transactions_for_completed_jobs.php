<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (
            ! Schema::hasTable('wallet_transactions') ||
            ! Schema::hasTable('parent_jobs') ||
            ! Schema::hasTable('parent_job_applications')
        ) {
            return;
        }

        $now = Carbon::now();
        $acceptedStatuses = ['accepted', 'accept', 'approved', 'confirmed', 'confirm', 'completed', 'complete'];

        DB::table('parent_jobs')
            ->whereIn('status', ['completed', 'complete', 'done'])
            ->orderBy('id')
            ->chunkById(100, function ($jobs) use ($acceptedStatuses, $now) {
                foreach ($jobs as $job) {
                    $application = DB::table('parent_job_applications')
                        ->where('job_id', $job->id)
                        ->whereIn('status', $acceptedStatuses)
                        ->orderByDesc('id')
                        ->first();
                    if (! $application || ! filled($application->nanny_id ?? null)) {
                        continue;
                    }

                    $price = $job->price !== null ? (float) $job->price : 0.0;
                    $hours = $job->hours !== null ? (float) $job->hours : 0.0;
                    $hourlyRate = $job->hourly_rate !== null ? (float) $job->hourly_rate : 0.0;
                    $amount = $price > 0 ? $price : round($hours * $hourlyRate, 2);
                    if ($amount <= 0) {
                        continue;
                    }

                    $meta = json_encode([
                        'job_status' => (string) ($job->status ?: 'completed'),
                        'request_source' => (string) ($application->request_source ?? ''),
                        'hours' => $job->hours !== null ? (float) $job->hours : null,
                        'hourly_rate' => $job->hourly_rate !== null ? (float) $job->hourly_rate : null,
                        'price' => $job->price !== null ? (float) $job->price : $amount,
                        'backfilled' => true,
                    ]);

                    $parentExists = DB::table('wallet_transactions')
                        ->where('user_id', $job->user_id)
                        ->where('job_id', $job->id)
                        ->where('application_id', $application->id)
                        ->where('type', 'job_charge')
                        ->where('direction', 'debit')
                        ->exists();
                    if (! $parentExists) {
                        DB::table('wallet_transactions')->insert([
                            'user_id' => $job->user_id,
                            'counterparty_user_id' => $application->nanny_id,
                            'job_id' => $job->id,
                            'application_id' => $application->id,
                            'subscription_purchase_id' => null,
                            'type' => 'job_charge',
                            'category' => 'job',
                            'direction' => 'debit',
                            'amount' => round($amount, 2),
                            'currency' => 'usd',
                            'status' => 'completed',
                            'description' => 'Completed job #'.$job->id.' payment',
                            'stripe_payment_intent_id' => null,
                            'meta' => $meta,
                            'created_at' => $job->updated_at ?: $job->created_at ?: $now,
                            'updated_at' => $job->updated_at ?: $job->created_at ?: $now,
                        ]);
                    }

                    $nannyExists = DB::table('wallet_transactions')
                        ->where('user_id', $application->nanny_id)
                        ->where('job_id', $job->id)
                        ->where('application_id', $application->id)
                        ->where('type', 'job_payout')
                        ->where('direction', 'credit')
                        ->exists();
                    if (! $nannyExists) {
                        DB::table('wallet_transactions')->insert([
                            'user_id' => $application->nanny_id,
                            'counterparty_user_id' => $job->user_id,
                            'job_id' => $job->id,
                            'application_id' => $application->id,
                            'subscription_purchase_id' => null,
                            'type' => 'job_payout',
                            'category' => 'job',
                            'direction' => 'credit',
                            'amount' => round($amount, 2),
                            'currency' => 'usd',
                            'status' => 'completed',
                            'description' => 'Earnings from completed job #'.$job->id,
                            'stripe_payment_intent_id' => null,
                            'meta' => $meta,
                            'created_at' => $job->updated_at ?: $job->created_at ?: $now,
                            'updated_at' => $job->updated_at ?: $job->created_at ?: $now,
                        ]);
                    }
                }
            });
    }

    public function down(): void
    {
        if (! Schema::hasTable('wallet_transactions')) {
            return;
        }

        DB::table('wallet_transactions')
            ->where(function ($query) {
                $query
                    ->where('type', 'job_charge')
                    ->orWhere('type', 'job_payout');
            })
            ->whereJsonContains('meta->backfilled', true)
            ->delete();
    }
};
