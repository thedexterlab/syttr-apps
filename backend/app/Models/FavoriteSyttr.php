<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class FavoriteSyttr extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'syttr_user_id',
    ];
}

