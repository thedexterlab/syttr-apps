<?php

use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (! Schema::hasTable('users') || ! Schema::hasColumn('users', 'user_id')) {
            return;
        }

        Schema::disableForeignKeyConstraints();
        try {
            DB::transaction(function (): void {
                $users = User::query()
                    ->whereNotNull('user_id')
                    ->get()
                    ->filter(fn (User $user) => ctype_digit((string) $user->user_id));

                foreach ($users as $user) {
                    $oldPublicId = (string) $user->user_id;
                    $newPublicId = User::generatePublicUserId();

                    if (Schema::hasTable('parent_profiles')) {
                        DB::table('parent_profiles')
                            ->where('user_id', $oldPublicId)
                            ->update(['user_id' => $newPublicId]);
                    }

                    if (Schema::hasTable('parent_kids')) {
                        DB::table('parent_kids')
                            ->where('parent_profile_id', $oldPublicId)
                            ->update(['parent_profile_id' => $newPublicId]);
                    }

                    $user->user_id = $newPublicId;
                    $user->save();
                }
            });
        } finally {
            Schema::enableForeignKeyConstraints();
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // One-way data normalization for public IDs.
    }
};
