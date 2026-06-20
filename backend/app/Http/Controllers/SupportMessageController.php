<?php

namespace App\Http\Controllers;

use App\Models\SupportMessage;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class SupportMessageController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $this->resolveUser($request, [
            $request->query('user_id'),
            $request->query('nanny_id'),
            $request->query('email'),
            $request->bearerToken(),
        ]);

        $email = trim((string) $request->query('email', ''));
        $normalizedEmail = $email !== '' ? Str::lower($email) : '';

        $query = SupportMessage::query()->latest('created_at')->latest('id');

        if ($user?->user_id) {
            $query->where(function ($builder) use ($user) {
                $builder
                    ->where('user_id', $user->user_id)
                    ->orWhereRaw('LOWER(sender_email) = ?', [Str::lower((string) $user->email)]);
            });
        } elseif ($normalizedEmail !== '') {
            $query->whereRaw('LOWER(sender_email) = ?', [$normalizedEmail]);
        } else {
            return response()->json([
                'success' => true,
                'data' => [],
            ]);
        }

        $items = $query
            ->limit((int) min(max((int) $request->query('limit', 50), 1), 100))
            ->get()
            ->map(fn (SupportMessage $message): array => [
                'id' => $message->id,
                'reference' => 'SM-'.str_pad((string) $message->id, 4, '0', STR_PAD_LEFT),
                'category' => $message->category,
                'status' => $message->status,
                'subject' => $message->subject ?: 'Support request',
                'message' => $message->message,
                'sender_name' => $message->sender_name,
                'sender_email' => $message->sender_email,
                'created_at' => optional($message->created_at)->toISOString(),
                'updated_at' => optional($message->updated_at)->toISOString(),
                'resolved_at' => optional($message->resolved_at)->toISOString(),
            ])
            ->values();

        return response()->json([
            'success' => true,
            'data' => $items,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['nullable'],
            'nanny_id' => ['nullable'],
            'account_type' => ['nullable', 'string', 'max:32'],
            'name' => ['nullable', 'string', 'max:255'],
            'sender_name' => ['nullable', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255'],
            'sender_email' => ['nullable', 'email', 'max:255'],
            'category' => ['required', 'string', 'max:64'],
            'subject' => ['nullable', 'string', 'max:255'],
            'message' => ['required', 'string', 'max:10000'],
        ]);

        $user = $this->resolveUser($request, [
            $data['user_id'] ?? null,
            $data['nanny_id'] ?? null,
            $request->bearerToken(),
            $data['email'] ?? null,
            $data['sender_email'] ?? null,
        ]);

        $senderEmail = trim((string) ($data['email'] ?? $data['sender_email'] ?? ''));
        $senderName = trim((string) ($data['sender_name'] ?? $data['name'] ?? ''));
        $accountType = $this->normalizeAccountType(
            $data['account_type'] ?? ($user?->role ?: null)
        );

        $message = SupportMessage::query()->create([
            'user_id' => $user?->user_id,
            'account_type' => $accountType,
            'source' => 'app_contact_form',
            'category' => $this->normalizeCategory($data['category'] ?? null),
            'status' => 'new',
            'sender_name' => $senderName !== '' ? $senderName : ($user?->name ?: null),
            'sender_email' => $senderEmail !== '' ? Str::lower($senderEmail) : ($user?->email ?: null),
            'subject' => trim((string) ($data['subject'] ?? '')) ?: null,
            'message' => trim((string) ($data['message'] ?? '')),
            'meta' => [
                'submitted_from' => 'mobile_app',
                'ip' => $request->ip(),
                'user_agent' => $request->userAgent(),
            ],
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Support request submitted successfully.',
            'data' => [
                'id' => $message->id,
                'reference' => 'SM-'.str_pad((string) $message->id, 4, '0', STR_PAD_LEFT),
                'status' => $message->status,
                'created_at' => optional($message->created_at)->toISOString(),
            ],
        ], 201);
    }

    private function resolveUser(Request $request, array $candidates): ?User
    {
        foreach ($candidates as $candidate) {
            if ($candidate === null || $candidate === '') {
                continue;
            }

            $publicUserId = User::resolvePublicUserIdByIdentifier($candidate);
            if ($publicUserId) {
                return User::query()->where('user_id', $publicUserId)->first();
            }

            $normalizedToken = User::normalizeApiToken($candidate);
            if ($normalizedToken !== '') {
                $byToken = User::query()->where('api_token', $normalizedToken)->first();
                if ($byToken) {
                    return $byToken;
                }
            }

            $raw = trim((string) $candidate, " \t\n\r\0\x0B\"'");
            if ($raw !== '' && filter_var($raw, FILTER_VALIDATE_EMAIL)) {
                $byEmail = User::query()
                    ->whereRaw('LOWER(email) = ?', [Str::lower($raw)])
                    ->first();
                if ($byEmail) {
                    return $byEmail;
                }
            }
        }

        $bearer = User::normalizeApiToken($request->bearerToken());
        if ($bearer === '') {
            return null;
        }

        return User::query()->where('api_token', $bearer)->first();
    }

    private function normalizeCategory(?string $value): string
    {
        $raw = Str::of((string) ($value ?? ''))
            ->trim()
            ->lower()
            ->replace('-', '_')
            ->replace(' ', '_')
            ->value();

        return match ($raw) {
            'ticket', 'user_ticket' => 'ticket',
            'chat', 'chat_escalation' => 'chat',
            'status', 'issue_status' => 'status',
            default => 'contact',
        };
    }

    private function normalizeAccountType(?string $value): ?string
    {
        $raw = Str::lower(trim((string) ($value ?? '')));
        if ($raw === '') {
            return null;
        }

        return match ($raw) {
            'syttr', 'nanny', 'sitter' => 'nanny',
            'parent', 'client', 'user' => 'parent',
            default => $raw,
        };
    }
}
