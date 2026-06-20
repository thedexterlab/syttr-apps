<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

class User extends Authenticatable
{
    use HasFactory, Notifiable;

    protected $table = 'admin_users';

    protected $fillable = [
        'name',
        'email',
        'password',
        'api_token',
        'token_expires_at',
        'last_login_at',
        'is_active',
    ];

    protected $hidden = [
        'password',
        'remember_token',
        'api_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'token_expires_at' => 'datetime',
            'last_login_at' => 'datetime',
            'is_active' => 'boolean',
        ];
    }

    public function issueToken(bool $remember = true): string
    {
        $plainTextToken = Str::random(80);
        $ttlDays = max(1, (int) config('admin.token_ttl_days', 30));
        $expiresAt = $remember ? now()->addDays($ttlDays) : now()->addDay();

        $this->forceFill([
            'api_token' => hash('sha256', $plainTextToken),
            'token_expires_at' => $expiresAt,
            'last_login_at' => now(),
        ])->save();

        return $plainTextToken;
    }

    public function tokenIsValid(?string $plainTextToken): bool
    {
        if (! $this->is_active || ! $plainTextToken || ! $this->api_token) {
            return false;
        }

        if (! hash_equals((string) $this->api_token, hash('sha256', $plainTextToken))) {
            return false;
        }

        return ! ($this->token_expires_at instanceof Carbon) || $this->token_expires_at->isFuture();
    }
}
