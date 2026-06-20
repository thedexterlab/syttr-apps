<?php

namespace App\Http\Controllers;

use App\Models\ParentProfile;
use App\Models\User;
use App\Models\ParentKid;
use Illuminate\Http\Request;

class ParentKidController extends Controller
{
    public function byUser(string $userIdentifier)
    {
        $resolvedUserId = User::resolvePublicUserIdByIdentifier($userIdentifier);
        if (! $resolvedUserId) {
            return response()->json([
                'kids' => [],
                'data' => [],
            ]);
        }

        $kids = ParentKid::query()
            ->where('parent_profile_id', $resolvedUserId)
            ->latest()
            ->get();

        return response()->json([
            'kids' => $kids,
            'data' => $kids,
        ]);
    }

    public function index(Request $request)
    {
        $parentProfileId = $request->query('parent_profile_id');
        $query = ParentKid::query();
        if ($parentProfileId) {
            $resolvedParentProfileId = User::resolvePublicUserIdByIdentifier($parentProfileId);
            if (! $resolvedParentProfileId) {
                return collect();
            }
            $query->where('parent_profile_id', $resolvedParentProfileId);
        }
        return $query->latest()->get();
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'parent_profile_id' => ['required'],
            'name' => ['nullable', 'string', 'max:255'],
            'age' => ['nullable', 'integer', 'min:0', 'max:30'],
            'gender' => ['nullable', 'string', 'max:20'],
            'allergies' => ['nullable', 'string', 'max:255'],
            'medical_conditions' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string'],
        ]);

        $resolvedParentProfileId = User::resolvePublicUserIdByIdentifier($data['parent_profile_id'] ?? null);
        if (! $resolvedParentProfileId || ! ParentProfile::query()->where('user_id', $resolvedParentProfileId)->exists()) {
            return response()->json([
                'message' => 'The selected parent_profile_id is invalid.',
                'errors' => [
                    'parent_profile_id' => ['The selected parent_profile_id is invalid.'],
                ],
            ], 422);
        }
        $data['parent_profile_id'] = $resolvedParentProfileId;

        return response()->json(ParentKid::create($data), 201);
    }

    public function show(ParentKid $parentKid)
    {
        return $parentKid;
    }

    public function update(Request $request, ParentKid $parentKid)
    {
        $data = $request->validate([
            'name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'age' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:30'],
            'gender' => ['sometimes', 'nullable', 'string', 'max:20'],
            'allergies' => ['sometimes', 'nullable', 'string', 'max:255'],
            'medical_conditions' => ['sometimes', 'nullable', 'string', 'max:255'],
            'notes' => ['sometimes', 'nullable', 'string'],
        ]);
        $parentKid->update($data);
        return $parentKid->refresh();
    }

    public function destroy(ParentKid $parentKid)
    {
        $parentKid->delete();
        return response()->json(['message' => 'Parent kid deleted']);
    }
}
