<?php

namespace App\Http\Controllers;

use App\Models\SyttrAvailability;
use App\Models\SyttrProfile;
use App\Models\User;
use Illuminate\Http\Request;

class SyttrAvailabilityController extends Controller
{
    public function index(Request $request)
    {
        $syttrProfileId = $request->query('syttr_profile_id');
        if (! $syttrProfileId && $request->query('nanny_id')) {
            $resolvedUserId = User::resolvePublicUserIdByIdentifier($request->query('nanny_id'));
            $syttrProfileId = $resolvedUserId
                ? SyttrProfile::query()->where('user_id', $resolvedUserId)->value('id')
                : null;
        }
        $query = SyttrAvailability::query();
        if ($syttrProfileId) {
            $query->where('syttr_profile_id', $syttrProfileId);
        }
        return $query->orderBy('date')->orderBy('day')->orderBy('time')->get();
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'syttr_profile_id' => ['nullable', 'exists:syttr_profiles,id'],
            'nanny_id' => ['nullable'],
            'mode' => ['nullable', 'in:weekly,calendar'],
            'availability' => ['nullable', 'array'],
            'availability.*.day' => ['nullable', 'string'],
            'availability.*.date' => ['nullable', 'date'],
            'availability.*.time_slots' => ['required_with:availability', 'array'],
            'availability.*.time_slots.*.period' => ['nullable', 'string'],
            'availability.*.time_slots.*.time' => ['nullable', 'string'],
            'availability.*.time_slots.*.start_time' => ['nullable', 'string'],
            'availability.*.time_slots.*.end_time' => ['nullable', 'string'],
        ]);

        $profileId = (int) ($data['syttr_profile_id'] ?? 0);
        if (! $profileId && ! empty($data['nanny_id'])) {
            $resolvedUserId = User::resolvePublicUserIdByIdentifier($data['nanny_id']);
            $profileId = $resolvedUserId
                ? (int) SyttrProfile::query()->where('user_id', $resolvedUserId)->value('id')
                : 0;
        }
        if (! $profileId) {
            return response()->json([
                'message' => 'The selected syttr_profile_id is invalid.',
                'errors' => [
                    'syttr_profile_id' => ['The selected syttr_profile_id is invalid.'],
                ],
            ], 422);
        }
        $mode = $data['mode'] ?? 'weekly';
        $availability = $data['availability'] ?? [];

        SyttrAvailability::where('syttr_profile_id', $profileId)->delete();

        $created = [];
        foreach ($availability as $entry) {
            $timeSlots = $entry['time_slots'] ?? [];
            foreach ($timeSlots as $slot) {
                $startTime = trim((string) ($slot['start_time'] ?? $slot['time'] ?? ''));
                $endTime = trim((string) ($slot['end_time'] ?? ''));
                if ($startTime === '') {
                    continue;
                }
                $created[] = SyttrAvailability::create([
                    'syttr_profile_id' => $profileId,
                    'mode' => $mode,
                    'day' => $entry['day'] ?? null,
                    'date' => $entry['date'] ?? null,
                    'period' => $slot['period'] ?? null,
                    'time' => $slot['time'] ?? $startTime,
                    'start_time' => $startTime,
                    'end_time' => $endTime !== '' ? $endTime : null,
                ]);
            }
        }

        return response()->json(['availability' => $created], 201);
    }

    public function show(SyttrAvailability $syttrAvailability)
    {
        return $syttrAvailability;
    }

    public function update(Request $request, SyttrAvailability $syttrAvailability)
    {
        $data = $request->validate([
            'mode' => ['sometimes', 'in:weekly,calendar'],
            'day' => ['sometimes', 'nullable', 'string', 'max:40'],
            'date' => ['sometimes', 'nullable', 'date'],
            'period' => ['sometimes', 'nullable', 'string', 'max:20'],
            'time' => ['sometimes', 'string', 'max:20'],
            'start_time' => ['sometimes', 'nullable', 'string', 'max:20'],
            'end_time' => ['sometimes', 'nullable', 'string', 'max:20'],
        ]);
        $syttrAvailability->update($data);
        return $syttrAvailability->refresh();
    }

    public function destroy(SyttrAvailability $syttrAvailability)
    {
        $syttrAvailability->delete();
        return response()->json(['message' => 'Syttr availability deleted']);
    }
}
