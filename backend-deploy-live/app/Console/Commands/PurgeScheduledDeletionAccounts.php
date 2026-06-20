<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

class PurgeScheduledDeletionAccounts extends Command
{
    protected $signature = 'accounts:purge-scheduled-deletions';

    protected $description = 'Permanently delete accounts whose 7-day deletion grace period has expired';

    public function handle(): int
    {
        $deleted = User::purgeExpiredScheduledDeletionAccounts();
        $this->info("Purged {$deleted} scheduled account deletion(s).");

        return self::SUCCESS;
    }
}
