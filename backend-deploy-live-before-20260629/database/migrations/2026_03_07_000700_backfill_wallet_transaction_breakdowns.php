<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('wallet_transactions')) {
            return;
        }

        $hasStripeTransactions = Schema::hasTable('stripe_transactions');

        DB::table('wallet_transactions')
            ->whereIn('type', ['job_charge', 'job_payout'])
            ->orderBy('id')
            ->chunkById(100, function ($transactions) use ($hasStripeTransactions) {
                foreach ($transactions as $transaction) {
                    $meta = $this->decodeMeta($transaction->meta ?? null);
                    $stripeMeta = $hasStripeTransactions
                        ? $this->resolveStripeBreakdown($transaction)
                        : [];

                    $grossAmount = $this->amountValue(
                        $stripeMeta['gross_amount'] ?? $meta['gross_amount'] ?? $transaction->amount ?? 0
                    );
                    $stripeFeeAmount = $this->amountValue(
                        $stripeMeta['stripe_fee_amount'] ?? $meta['stripe_fee_amount'] ?? 0
                    );
                    $stripeTaxAmount = $this->amountValue(
                        $stripeMeta['stripe_tax_amount'] ?? $meta['stripe_tax_amount'] ?? 0
                    );
                    $processingFeeAmount = $this->amountValue(
                        $stripeMeta['stripe_processing_fee_amount']
                            ?? $meta['stripe_processing_fee_amount']
                            ?? max(0, $stripeFeeAmount - $stripeTaxAmount)
                    );
                    $netAmount = $this->amountValue(
                        $stripeMeta['net_amount']
                            ?? $meta['net_amount']
                            ?? ($transaction->type === 'job_payout'
                                ? max(0, $grossAmount - $stripeFeeAmount)
                                : $grossAmount)
                    );

                    $updatedMeta = array_merge($meta, [
                        'gross_amount' => $grossAmount,
                        'stripe_fee_amount' => $stripeFeeAmount,
                        'stripe_tax_amount' => $stripeTaxAmount,
                        'stripe_processing_fee_amount' => $processingFeeAmount,
                        'net_amount' => $netAmount,
                        'wallet_breakdown_backfilled' => true,
                    ]);

                    $description = $transaction->description;
                    if (
                        $transaction->type === 'job_payout' &&
                        (! is_string($description) || stripos($description, 'net earnings') === false)
                    ) {
                        $description = 'Net earnings from completed job #'.$transaction->job_id;
                    }

                    $amount = $transaction->type === 'job_payout' ? $netAmount : $grossAmount;

                    DB::table('wallet_transactions')
                        ->where('id', $transaction->id)
                        ->update([
                            'amount' => $amount,
                            'description' => $description,
                            'meta' => json_encode($updatedMeta),
                            'updated_at' => now(),
                        ]);
                }
            });
    }

    public function down(): void
    {
        // Historical repair only.
    }

    private function decodeMeta(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if (! is_string($value) || trim($value) === '') {
            return [];
        }

        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function resolveStripeBreakdown(object $transaction): array
    {
        $query = DB::table('stripe_transactions')
            ->where('category', 'job')
            ->orderByDesc('id');

        if (! empty($transaction->stripe_payment_intent_id)) {
            $query->where('stripe_payment_intent_id', $transaction->stripe_payment_intent_id);
        } else {
            if (! empty($transaction->job_id)) {
                $query->where('job_id', $transaction->job_id);
            }
            if (! empty($transaction->application_id)) {
                $query->where('application_id', $transaction->application_id);
            }
        }

        $stripeTransaction = $query->first();
        if (! $stripeTransaction) {
            return [];
        }

        $meta = $this->decodeMeta($stripeTransaction->meta ?? null);

        return [
            'gross_amount' => $meta['gross_amount'] ?? null,
            'stripe_fee_amount' => $meta['stripe_fee_amount'] ?? null,
            'stripe_tax_amount' => $meta['stripe_tax_amount'] ?? null,
            'stripe_processing_fee_amount' => $meta['stripe_processing_fee_amount'] ?? null,
            'net_amount' => $meta['net_amount'] ?? null,
        ];
    }

    private function amountValue(mixed $value): float
    {
        return round((float) $value, 2);
    }
};
