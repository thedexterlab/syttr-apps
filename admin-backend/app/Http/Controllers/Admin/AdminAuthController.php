<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AdminAuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            'remember' => ['nullable', 'boolean'],
        ]);

        $admin = User::query()
            ->where('email', $data['email'])
            ->where('is_active', true)
            ->first();

        if (! $admin || ! Hash::check($data['password'], $admin->password)) {
            return response()->json([
                'message' => 'Invalid credentials.',
            ], 401);
        }

        $token = $admin->issueToken((bool) ($data['remember'] ?? true));

        return response()->json([
            'message' => 'Login successful.',
            'token' => $token,
            'admin' => [
                'id' => $admin->id,
                'name' => $admin->name,
                'email' => $admin->email,
            ],
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        /** @var User|null $admin */
        $admin = $request->attributes->get('admin_user');
        if ($admin) {
            $admin->forceFill([
                'api_token' => null,
                'token_expires_at' => null,
            ])->save();
        }

        return response()->json([
            'message' => 'Logged out.',
        ]);
    }
}
