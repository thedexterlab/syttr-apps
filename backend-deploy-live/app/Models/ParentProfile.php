<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Model;

class ParentProfile extends Model
{
    protected $fillable = [
        'user_id',
        'phone',
        'city',
        'address',
        'gender',
        'children_count',
        'bio',
        'user_image',
    ];

    protected $appends = [
        'user_image_url',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id', 'user_id');
    }

    public function kids(): HasMany
    {
        return $this->hasMany(ParentKid::class, 'parent_profile_id', 'user_id');
    }

    public function getUserImageUrlAttribute(): ?string
    {
        $path = (string) ($this->user_image ?? '');
        if ($path === '') {
            return null;
        }
        if (str_starts_with($path, 'http://') || str_starts_with($path, 'https://')) {
            return $path;
        }

        return url('storage/'.$path);
    }
}
