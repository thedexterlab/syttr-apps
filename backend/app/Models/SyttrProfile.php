<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;

class SyttrProfile extends Model
{
    protected $fillable = [
        'user_id',
        'phone',
        'city',
        'address',
        'country',
        'gender',
        'date_of_birth',
        'experience_years',
        'hourly_rate',
        'bio',
        'user_image',
        'certificate',
    ];

    protected $appends = [
        'user_image_url',
        'certificate_url',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function availabilities(): HasMany
    {
        return $this->hasMany(SyttrAvailability::class);
    }

    public function getUserImageUrlAttribute(): ?string
    {
        return $this->normalizePublicAssetUrl((string) ($this->user_image ?? ''));
    }

    public function getCertificateUrlAttribute(): ?string
    {
        return $this->normalizePublicAssetUrl((string) ($this->certificate ?? ''));
    }

    private function normalizePublicAssetUrl(string $path): ?string
    {
        $normalized = trim($path);
        if ($normalized === '') {
            return null;
        }
        if (str_starts_with($normalized, 'http://') || str_starts_with($normalized, 'https://')) {
            return $normalized;
        }

        $clean = ltrim($normalized, '/');
        $diskPath = $clean;
        if (str_starts_with($clean, 'storage/')) {
            $diskPath = ltrim(substr($clean, 8), '/');
            if ($diskPath === '' || ! Storage::disk('public')->exists($diskPath)) {
                return null;
            }
            return url($clean);
        }
        if (str_starts_with($clean, 'public/')) {
            $diskPath = ltrim(substr($clean, 6), '/');
            if ($diskPath === '' || ! Storage::disk('public')->exists($diskPath)) {
                return null;
            }
            return url('storage/'.$diskPath);
        }

        if (! Storage::disk('public')->exists($clean)) {
            return null;
        }

        return url('storage/'.$clean);
    }
}
