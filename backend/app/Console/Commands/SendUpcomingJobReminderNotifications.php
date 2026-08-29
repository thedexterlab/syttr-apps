<?php

namespace App\Console\Commands;

use App\Http\Controllers\NotificationController;
use App\Models\ParentJob;
use App\Models\ParentJobApplication;
use App\Models\UserNotification;
use Carbon\Carbon;
use Illuminate\Console\Command;

class SendUpcomingJobReminderNotifications extends Command
{
    protected $signature = 'jobs:send-upcoming-reminders';

    protected $description = 'Send parent reminders one day before accepted jobs.';

    public function handle(): int
    {
        $acceptedStatuses = ['accepted', 'accept', 'approved', 'confirmed', 'confirm'];

        $jobs = ParentJob::query()
            ->whereNotIn('status', ['canceled', 'cancelled', 'completed'])
            ->where(function ($query) use ($acceptedStatuses) {
                $query
                    ->whereIn('status', $acceptedStatuses)
                    ->orWhereHas('applications', fn ($appQuery) => $appQuery->whereIn('status', $acceptedStatuses));
            })
            ->with([
                'applications' => fn ($query) => $query
                    ->whereIn('status', $acceptedStatuses)
                    ->orderByDesc('id'),
            ])
            ->get();

        $sent = 0;
        foreach ($jobs as $job) {
            $timezone = $this->jobTimezone($job);
            $tomorrow = Carbon::now($timezone)->addDay()->toDateString();
            if (optional($job->start_date)->format('Y-m-d') !== $tomorrow) {
                continue;
            }

            $notificationKey = 'job:'.$job->id.':reminder:'.$tomorrow;
            $alreadySent = UserNotification::query()
                ->where('recipient_user_id', $job->user_id)
                ->where('type', 'upcoming_job_reminder')
                ->where('data->notification_key', $notificationKey)
                ->exists();

            if ($alreadySent) {
                continue;
            }

            /** @var ParentJobApplication|null $acceptedApplication */
            $acceptedApplication = $job->applications->first();

            NotificationController::createForUser(
                $job->user_id,
                'upcoming_job_reminder',
                'Upcoming Nanny Appointment',
                'Reminder: You have a nanny appointment scheduled for tomorrow.',
                [
                    'notification_key' => $notificationKey,
                    'job_id' => $job->id,
                    'start_date' => optional($job->start_date)->format('Y-m-d'),
                    'start_time' => (string) $job->start_time,
                    'timezone' => $timezone,
                    'location' => $job->location,
                    'nanny_id' => $acceptedApplication?->nanny_id,
                    'reminder_for_date' => $tomorrow,
                ],
                $acceptedApplication?->nanny_id
            );

            $sent++;
        }

        $this->info('Upcoming parent reminders sent: '.$sent);

        return self::SUCCESS;
    }

    private function jobTimezone(ParentJob $job): string
    {
        return $job->localTimezone();
    }
}
