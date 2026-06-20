<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\GhlContactManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GhlContactController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $user = $this->resolveAuthenticatedUser($request);
        if (! $user) {
            return response()->json([
                'success' => false,
                'message' => 'Authentication required.',
            ], 401);
        }

        $data = $this->validatedPayload($request, false);
        $result = GhlContactManager::syncContactForUser($user, $data);
        if (! ($result['success'] ?? false)) {
            return response()->json([
                'success' => false,
                'message' => (string) ($result['message'] ?? 'Unable to sync the GHL contact.'),
            ], (int) ($result['status'] ?? 500));
        }

        $created = (bool) ($result['created'] ?? false);

        return response()->json([
            'success' => true,
            'message' => $created ? 'GHL contact created.' : 'GHL contact synced.',
            'contact_id' => $result['contact_id'] ?? null,
            'contact' => $result['contact'] ?? null,
        ], $created ? 201 : 200);
    }

    public function update(Request $request): JsonResponse
    {
        $user = $this->resolveAuthenticatedUser($request);
        if (! $user) {
            return response()->json([
                'success' => false,
                'message' => 'Authentication required.',
            ], 401);
        }

        $data = $this->validatedPayload($request, true);
        $result = GhlContactManager::updateContactForUser($user, $data);
        if (! ($result['success'] ?? false)) {
            return response()->json([
                'success' => false,
                'message' => (string) ($result['message'] ?? 'Unable to update the GHL contact.'),
            ], (int) ($result['status'] ?? 500));
        }

        return response()->json([
            'success' => true,
            'message' => 'GHL contact updated.',
            'contact_id' => $result['contact_id'] ?? null,
            'contact' => $result['contact'] ?? null,
        ]);
    }

    public function destroy(Request $request): JsonResponse
    {
        $user = $this->resolveAuthenticatedUser($request);
        if (! $user) {
            return response()->json([
                'success' => false,
                'message' => 'Authentication required.',
            ], 401);
        }

        $result = GhlContactManager::deleteContactForUser($user);
        if (! ($result['success'] ?? false)) {
            return response()->json([
                'success' => false,
                'message' => (string) ($result['message'] ?? 'Unable to delete the GHL contact.'),
            ], (int) ($result['status'] ?? 500));
        }

        return response()->json([
            'success' => true,
            'message' => 'GHL contact deleted.',
            'contact_id' => $result['contact_id'] ?? null,
        ]);
    }

    private function resolveAuthenticatedUser(Request $request): ?User
    {
        $bearer = trim((string) $request->bearerToken());
        if ($bearer === '') {
            return null;
        }

        return User::query()->where('api_token', $bearer)->first();
    }

    private function validatedPayload(Request $request, bool $partial): array
    {
        $prefix = $partial ? 'sometimes' : 'nullable';

        return $request->validate([
            'first_name' => [$prefix, 'nullable', 'string', 'max:255'],
            'last_name' => [$prefix, 'nullable', 'string', 'max:255'],
            'name' => [$prefix, 'nullable', 'string', 'max:255'],
            'email' => [$prefix, 'nullable', 'email', 'max:255'],
            'phone' => [$prefix, 'nullable', 'string', 'max:30'],
            'city' => [$prefix, 'nullable', 'string', 'max:255'],
            'address' => [$prefix, 'nullable', 'string', 'max:255'],
            'country' => [$prefix, 'nullable', 'string', 'max:255'],
        ]);
    }
}
