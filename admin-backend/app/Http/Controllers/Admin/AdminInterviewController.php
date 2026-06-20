<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AppData\AppUser;
use App\Models\AppData\SyttrInterview;
use App\Support\AppDataHelper;
use Illuminate\Http\JsonResponse;

class AdminInterviewController extends Controller
{
    public function index(): JsonResponse
    {
        if (! AppDataHelper::hasTable('syttr_interviews') || ! AppDataHelper::hasTable('users')) {
            return response()->json([
                'data' => [],
            ]);
        }

        $interviews = SyttrInterview::query()
            ->with(['user.syttrProfile'])
            ->latest('scheduled_at')
            ->get()
            ->map(fn (SyttrInterview $interview) => $this->serializeInterview($interview))
            ->values()
            ->all();

        return response()->json([
            'data' => $interviews,
        ]);
    }

    public function byNanny(string $nanny): JsonResponse
    {
        $user = AppUser::resolveByIdentifier($nanny);
        if (! $user || $user->role !== 'syttr') {
            return response()->json([
                'message' => 'Nanny not found.',
            ], 404);
        }

        if (! AppDataHelper::hasTable('syttr_interviews')) {
            return response()->json([
                'interviews' => [],
                'data' => [
                    'interviews' => [],
                ],
            ]);
        }

        $interviews = SyttrInterview::query()
            ->with(['user.syttrProfile'])
            ->where('user_id', $user->id)
            ->latest('scheduled_at')
            ->get()
            ->map(fn (SyttrInterview $interview) => $this->serializeInterview($interview, true))
            ->values()
            ->all();

        return response()->json([
            'interviews' => $interviews,
            'data' => [
                'interviews' => $interviews,
            ],
        ]);
    }

    private function serializeInterview(SyttrInterview $interview, bool $detailed = false): array
    {
        $user = $interview->user;
        $profile = $user?->syttrProfile;
        $status = strtolower(trim((string) ($interview->status ?? 'pending')));

        if ($status === 'scheduled') {
            $status = 'pending';
        }

        $payload = [
            'id' => $interview->id,
            'interview_id' => $interview->id,
            'nanny_id' => $user?->user_id ?: $user?->id,
            'fullname' => $user?->name,
            'first_name' => $user?->name ? strtok((string) $user->name, ' ') : null,
            'last_name' => $user?->name && str_contains((string) $user->name, ' ')
                ? trim((string) str($user->name)->after(' '))
                : null,
            'email' => $user?->email,
            'phone' => $profile?->phone,
            'city' => $profile?->city,
            'country' => $profile?->country,
            'gender' => $profile?->gender,
            'interview_date' => optional($interview->interview_date)->format('Y-m-d'),
            'interview_time' => optional($interview->scheduled_at)->format('H:i:s')
                ?: (string) $interview->interview_time,
            'scheduled_at' => optional($interview->scheduled_at)->toISOString(),
            'status' => $status,
            'created_at' => optional($interview->created_at)->toISOString(),
            'updated_at' => optional($interview->updated_at)->toISOString(),
            'profile_image' => $profile?->user_image,
            'nanny_image_url' => AppDataHelper::assetUrl($profile?->user_image),
        ];

        if (! $detailed) {
            return $payload;
        }

        return [
            ...$payload,
            'date_of_birth' => optional($profile?->date_of_birth)->format('Y-m-d'),
            'age' => AppDataHelper::ageFromDate(optional($profile?->date_of_birth)->format('Y-m-d')),
            'experience' => $profile?->experience_years,
            'bio' => $profile?->bio,
            'resume' => null,
            'certificate' => $profile?->certificate,
        ];
    }
}
