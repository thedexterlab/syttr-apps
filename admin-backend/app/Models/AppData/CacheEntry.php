<?php

namespace App\Models\AppData;

use Illuminate\Database\Eloquent\Model;

class CacheEntry extends Model
{
    protected $connection = 'app_data';

    protected $table = 'cache';

    public $timestamps = false;

    protected $primaryKey = 'key';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];
}
