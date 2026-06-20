<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AdminAuditLog;
use App\Models\AppData\WalletTransaction;
use App\Support\AppDataHelper;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class AdminAuditLogController extends Controller
{
    public function index(): JsonResponse
    {
        $logs = AdminAuditLog::query()
            ->with('admin:id,name,email')
            ->latest()
            ->limit(250)
            ->get()
            ->map(fn (AdminAuditLog $log): array => [
                'id' => 'audit-'.$log->id,
                'source' => 'admin',
                'created_at' => optional($log->created_at)->toISOString(),
                'category' => $log->category,
                'action' => $log->action,
                'target_type' => $log->target_type,
                'target_id' => $log->target_id,
                'target_label' => $log->target_label,
                'admin' => [
                    'id' => $log->admin?->id,
                    'name' => $log->admin?->name ?: 'Unknown admin',
                    'email' => $log->admin?->email,
                ],
                'before' => $log->before,
                'after' => $log->after,
                'meta' => $log->meta,
                'summary' => $this->summaryForAdminLog($log),
            ]);

        $systemEvents = collect()
            ->concat($this->walletRefundEvents())
            ->concat($this->walletPayoutEvents())
            ->sortByDesc(fn (array $item) => strtotime((string) ($item['created_at'] ?? '')) ?: 0)
            ->values();

        return response()->json([
            'data' => $logs->concat($systemEvents)
                ->sortByDesc(fn (array $item) => strtotime((string) ($item['created_at'] ?? '')) ?: 0)
                ->values()
                ->all(),
        ]);
    }

    private function walletRefundEvents()
    {
        if (! AppDataHelper::hasTable('wallet_transactions')) {
            return collect();
        }

        return WalletTransaction::query()
            ->where(function ($query) {
                $query->where('type', 'like', '%refund%')
                    ->orWhere('description', 'like', '%refund%');
            })
            ->latest()
            ->limit(100)
            ->get()
            ->map(fn (WalletTransaction $transaction): array => [
                'id' => 'refund-'.$transaction->id,
                'source' => 'system',
                'created_at' => optional($transaction->created_at)->toISOString(),
                'category' => 'refund',
                'action' => 'recorded',
                'target_type' => 'wallet_transaction',
                'target_id' => (string) $transaction->id,
                'target_label' => 'Refund #'.$transaction->id,
                'admin' => null,
                'before' => null,
                'after' => [
                    'status' => $transaction->status,
                    'amount' => round((float) ($transaction->amount ?? 0), 2),
                    'currency' => strtoupper(trim((string) ($transaction->currency ?? 'USD'))) ?: 'USD',
                ],
                'meta' => is_array($transaction->meta) ? $transaction->meta : [],
                'summary' => 'Refund recorded in payment ledger.',
            ]);
    }

    private function walletPayoutEvents()
    {
        if (! AppDataHelper::hasTable('wallet_transactions')) {
            return collect();
        }

        return DB::connection('app_data')
            ->table('wallet_transactions')
            ->where(function ($query) {
                $query->where('type', 'job_payout')
                    ->orWhere('type', 'wallet_withdrawal')
                    ->orWhere('description', 'like', '%payout%')
                    ->orWhere('description', 'like', '%withdraw%');
            })
            ->orderByDesc('created_at')
            ->limit(100)
            ->get()
            ->map(fn (object $transaction): array => [
                'id' => 'payout-'.$transaction->id,
                'source' => 'system',
                'created_at' => $this->toIsoString($transaction->created_at ?? null),
                'category' => 'payout',
                'action' => 'recorded',
                'target_type' => 'wallet_transaction',
                'target_id' => (string) $transaction->id,
                'target_label' => 'Payout #'.$transaction->id,
                'admin' => null,
                'before' => null,
                'after' => [
                    'status' => $transaction->status ?? null,
                    'amount' => round((float) ($transaction->amount ?? 0), 2),
                    'currency' => strtoupper(trim((string) ($transaction->currency ?? 'USD'))) ?: 'USD',
                    'type' => $transaction->type ?? null,
                ],
                'meta' => $this->jsonArray($transaction->meta ?? null),
                'summary' => 'Payout activity recorded from wallet flow.',
            ]);
    }

    private function summaryForAdminLog(AdminAuditLog $log): string
    {
        $adminName = $log->admin?->name ?: 'Unknown admin';
        $label = $log->target_label ?: $log->target_type ?: 'record';

        return $adminName.' '.$log->action.' '.$label.'.';
    }

    private function toIsoString(mixed $value): ?string
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return null;
        }

        try {
            return Carbon::parse($raw)->toISOString();
        } catch (\Throwable) {
            return $raw;
        }
    }

    private function jsonArray(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if (is_string($value)) {
            $decoded = json_decode($value, true);

            return is_array($decoded) ? $decoded : [];
        }

        return [];
    }
}
