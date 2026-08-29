<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (! Schema::hasTable('users') || ! Schema::hasColumn('users', 'referral_code')) {
            return;
        }

        $missingUserIds = DB::table('users')
            ->where(function ($query) {
                $query->whereNull('referral_code')
                    ->orWhere('referral_code', '');
            })
            ->orderBy('id')
            ->pluck('id');

        foreach ($missingUserIds as $id) {
            $code = $this->generateUniqueReferralCode();
            DB::table('users')
                ->where('id', $id)
                ->update(['referral_code' => $code]);
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Intentionally left blank; do not clear referral codes on rollback.
    }

    private function generateUniqueReferralCode(): string
    {
        do {
            $candidate = strtoupper(Str::random(8));
        } while (
            preg_match('/[A-Z]/', $candidate) !== 1 ||
            preg_match('/\d/', $candidate) !== 1 ||
            DB::table('users')->where('referral_code', $candidate)->exists()
        );

        return $candidate;
    }
};
