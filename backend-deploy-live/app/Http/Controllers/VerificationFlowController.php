<?php

namespace App\Http\Controllers;

use App\Models\SyttrInterview;
use App\Models\User;
use App\Support\NannyVerificationGateResolver;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class VerificationFlowController extends Controller
{
    public function scheduleInterview(Request $request): JsonResponse
    {
        $data = $request->validate([
            'nanny_id' => ['nullable'],
            'user_id' => ['nullable'],
            'interview_date' => ['required', 'date_format:Y-m-d'],
            'interview_time' => ['required', 'string', 'max:16'],
        ]);

        $identifier = trim((string) ($data['nanny_id'] ?? $data['user_id'] ?? ''));
        if ($identifier === '') {
            return response()->json([
                'success' => false,
                'message' => 'Missing nanny_id or user_id.',
            ], 422);
        }

        $user = $this->resolveUser($identifier);
        if (! $user) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid nanny_id/user_id.',
            ], 422);
        }

        if ($user->role !== 'syttr') {
            return response()->json([
                'success' => false,
                'message' => 'Interview scheduling is available for syttr accounts only.',
            ], 422);
        }

        $interviewTime = $this->normalizeTime($data['interview_time']);
        if (! $interviewTime) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid interview_time. Use HH:MM (24-hour) or h:mm AM/PM.',
            ], 422);
        }

        $scheduledAt = Carbon::createFromFormat(
            'Y-m-d H:i:s',
            $data['interview_date'].' '.$interviewTime,
            config('app.timezone')
        );
        if (! $scheduledAt || $scheduledAt->lte(now())) {
            return response()->json([
                'success' => false,
                'message' => 'Interview date/time must be in the future.',
            ], 422);
        }

        $interview = SyttrInterview::query()->updateOrCreate(
            ['user_id' => $user->id],
            [
                'interview_date' => $scheduledAt->toDateString(),
                'interview_time' => $scheduledAt->format('H:i:s'),
                'scheduled_at' => $scheduledAt,
                'status' => 'scheduled',
            ]
        );

        if (! $user->is_blacklisted) {
            $user->profile_status = 'pending';
            $user->profile_status_updated_at = now();
            $user->save();
        }

        return response()->json([
            'success' => true,
            'message' => 'Interview scheduled successfully.',
            'status' => $this->deriveStatus($user),
            'interview' => $this->formatInterview($interview),
            'user_id' => $user->user_id,
            'role' => $user->role,
        ]);
    }

    public function profileStatus(Request $request): JsonResponse
    {
        $data = $request->validate([
            'nanny_id' => ['nullable'],
            'user_id' => ['nullable'],
            'parent_id' => ['nullable'],
        ]);

        $identifier = trim((string) ($data['nanny_id'] ?? $data['user_id'] ?? $data['parent_id'] ?? ''));
        if ($identifier === '') {
            return response()->json([
                'success' => false,
                'message' => 'Missing identifier (nanny_id or user_id).',
            ], 422);
        }

        $user = $this->resolveUser($identifier);
        if (! $user) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid identifier.',
            ], 422);
        }

        $interview = SyttrInterview::query()
            ->where('user_id', $user->id)
            ->first();
        $status = $this->deriveStatus($user);
        $interviewStatus = strtolower(trim((string) ($interview?->status ?? '')));

        return response()->json([
            'success' => true,
            'status' => $status,
            'approval_status' => $status,
            'verification_required' => NannyVerificationGateResolver::requiresVerificationGate(
                (string) $user->role,
                $status,
                $interviewStatus,
                (bool) $user->is_blacklisted
            ),
            'is_verified' => NannyVerificationGateResolver::isVerified($status, null, (bool) $user->is_blacklisted),
            'interview_completed' => $this->isInterviewCompleted($status, $interviewStatus),
            'interview_pending' => ! $this->isInterviewCompleted($status, $interviewStatus),
            'is_blacklisted' => (bool) $user->is_blacklisted,
            'blacklisted_reason' => $user->blacklisted_reason,
            'user_id' => $user->user_id,
            'role' => $user->role,
            'interview' => $interview ? $this->formatInterview($interview) : null,
        ]);
    }

    private function resolveUser(string $identifier): ?User
    {
        $internalUserId = User::resolveInternalIdByIdentifier($identifier);
        if (! $internalUserId) {
            return null;
        }
        return User::query()->find($internalUserId);
    }

    private function normalizeTime(string $input): ?string
    {
        $raw = trim($input);
        if ($raw === '') {
            return null;
        }

        $formats = ['H:i:s', 'H:i', 'h:i A', 'h:iA', 'g:i A', 'g:iA'];
        foreach ($formats as $format) {
            try {
                $parsed = Carbon::createFromFormat($format, $raw, config('app.timezone'));
                if ($parsed) {
                    return $parsed->format('H:i:s');
                }
            } catch (\Throwable) {
                // Try next format.
            }
        }

        return null;
    }

    private function deriveStatus(User $user): string
    {
        if ((bool) $user->is_blacklisted) {
            return 'blacklisted';
        }

        $raw = strtolower(trim((string) ($user->profile_status ?? '')));
        if ($raw !== '') {
            return $raw;
        }

        if ($user->role === 'syttr') {
            return 'pending';
        }

        return 'active';
    }

    private function isInterviewCompleted(string $status, string $interviewStatus): bool
    {
        $normalizedStatus = strtolower(trim($status));
        if (NannyVerificationGateResolver::adminDecision($normalizedStatus, false) === 'approved') {
            return true;
        }

        return in_array(strtolower(trim($interviewStatus)), ['approved', 'completed'], true);
    }

    private function formatInterview(SyttrInterview $interview): array
    {
        return [
            'id' => $interview->id,
            'interview_date' => (string) $interview->interview_date?->format('Y-m-d'),
            'interview_time' => (string) $interview->interview_time?->format('H:i:s'),
            'scheduled_at' => optional($interview->scheduled_at)?->toIso8601String(),
            'status' => (string) $interview->status,
        ];
    }
}
