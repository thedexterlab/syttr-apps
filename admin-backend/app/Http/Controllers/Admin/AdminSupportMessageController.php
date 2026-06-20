<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AppData\AppUser;
use App\Models\AppData\SupportMessage;
use App\Support\AppDataHelper;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

class AdminSupportMessageController extends Controller
{
    public function index(): JsonResponse
    {
        if (! AppDataHelper::hasTable('support_messages')) {
            return response()->json([
                'data' => [],
                'summary' => [
                    'open_inbox' => 0,
                    'closed_inbox' => 0,
                    'total' => 0,
                ],
            ]);
        }

        $users = AppDataHelper::hasTable('users')
            ? AppUser::query()->get(['id', 'user_id', 'name', 'email', 'role'])->values()
            : collect();
        $userIndex = $this->buildUserIndex($users);

        $items = SupportMessage::query()
            ->latest('created_at')
            ->latest('id')
            ->limit(250)
            ->get()
            ->map(fn (SupportMessage $item): array => $this->transform($item, $userIndex))
            ->values();

        return response()->json([
            'data' => $items->all(),
            'summary' => [
                'open_inbox' => $items->filter(fn (array $item) => strtolower((string) ($item['status'] ?? '')) !== 'closed')->count(),
                'closed_inbox' => $items->filter(fn (array $item) => strtolower((string) ($item['status'] ?? '')) === 'closed')->count(),
                'total' => $items->count(),
            ],
        ]);
    }

    private function transform(SupportMessage $item, Collection $userIndex): array
    {
        $user = $this->resolveUser($userIndex, $item->user_id);
        $status = trim((string) ($item->status ?? 'new')) ?: 'new';
        $senderName = trim((string) ($item->sender_name ?? '')) ?: trim((string) ($user?->name ?? ''));
        $senderEmail = trim((string) ($item->sender_email ?? '')) ?: trim((string) ($user?->email ?? ''));
        $createdAt = $this->toIsoString($item->created_at);

        return [
            'id' => $item->id,
            'reference' => 'SM-'.str_pad((string) $item->id, 4, '0', STR_PAD_LEFT),
            'sender' => $senderName !== '' ? $senderName : 'Unknown sender',
            'sender_email' => $senderEmail,
            'user_id' => $user?->user_id ?: $this->normalizeLookupKey($item->user_id),
            'account_type' => trim((string) ($item->account_type ?? $user?->role ?? '')) ?: null,
            'channel' => 'In-app contact form',
            'category' => trim((string) ($item->category ?? 'contact')) ?: 'contact',
            'subject' => trim((string) ($item->subject ?? '')) ?: 'Support request',
            'message' => trim((string) ($item->message ?? '')),
            'status' => ucfirst(str_replace('_', ' ', strtolower($status))),
            'status_key' => strtolower($status),
            'received_at' => $createdAt,
            'received_label' => $this->toDisplayDate($createdAt),
            'sla' => $this->buildSlaLabel($item->created_at, $status),
            'source' => trim((string) ($item->source ?? 'app_contact_form')),
            'created_at' => $createdAt,
            'updated_at' => $this->toIsoString($item->updated_at),
        ];
    }

    private function buildUserIndex(Collection $users): Collection
    {
        $index = collect();

        foreach ($users as $user) {
            $publicKey = $this->normalizeLookupKey($user->user_id ?? null);
            $internalKey = $this->normalizeLookupKey($user->id ?? null);

            if ($publicKey !== '') {
                $index->put($publicKey, $user);
            }
            if ($internalKey !== '') {
                $index->put($internalKey, $user);
            }
        }

        return $index;
    }

    private function resolveUser(Collection $userIndex, mixed $identifier): ?AppUser
    {
        $key = $this->normalizeLookupKey($identifier);
        if ($key === '') {
            return null;
        }

        $user = $userIndex->get($key);

        return $user instanceof AppUser ? $user : null;
    }

    private function normalizeLookupKey(mixed $value): string
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return '';
        }

        return ctype_digit($raw) ? $raw : strtoupper($raw);
    }

    private function toIsoString(mixed $value): ?string
    {
        if ($value instanceof Carbon) {
            return $value->toISOString();
        }

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

    private function toDisplayDate(?string $value): string
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return '-';
        }

        try {
            return Carbon::parse($raw)->format('M d, Y g:i A');
        } catch (\Throwable) {
            return $raw;
        }
    }

    private function buildSlaLabel(mixed $createdAt, string $status): string
    {
        $normalizedStatus = strtolower(trim($status));
        if ($normalizedStatus === 'closed') {
            return 'Resolved';
        }

        try {
            $minutes = (int) max(0, round(Carbon::parse($createdAt)->diffInMinutes(now(), true)));
        } catch (\Throwable) {
            return '-';
        }

        if ($minutes < 60) {
            return $minutes.'m';
        }

        $hours = floor($minutes / 60);
        if ($hours < 24) {
            return $hours.'h';
        }

        return floor($hours / 24).'d';
    }
}
