<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote')->hourly();

Schedule::command('jobs:send-upcoming-reminders')
    ->hourly()
    ->withoutOverlapping();

Schedule::command('jobs:send-active-completion-reminders')
    ->everyMinute()
    ->withoutOverlapping();

Schedule::command('accounts:purge-scheduled-deletions')
    ->hourly()
    ->withoutOverlapping();
