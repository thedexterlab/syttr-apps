<?php

use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (! Schema::hasTable('parent_profiles') || ! Schema::hasTable('parent_kids')) {
            return;
        }

        $profileRows = DB::table('parent_profiles')->get();
        $profileIdToPublicUserId = [];
        foreach ($profileRows as $row) {
            $publicUserId = User::resolvePublicUserIdByIdentifier($row->user_id ?? null);
            if (! $publicUserId) {
                throw new RuntimeException('Unable to resolve parent_profiles.user_id for profile '.$row->id);
            }
            $profileIdToPublicUserId[(string) $row->id] = $publicUserId;
        }

        Schema::create('parent_profiles_alnum_tmp', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 5)->unique();
            $table->string('phone', 30)->nullable();
            $table->string('city')->nullable();
            $table->string('address')->nullable();
            $table->unsignedTinyInteger('children_count')->default(1);
            $table->text('bio')->nullable();
            $table->timestamps();
        });

        foreach ($profileRows as $row) {
            DB::table('parent_profiles_alnum_tmp')->insert([
                'id' => $row->id,
                'user_id' => $profileIdToPublicUserId[(string) $row->id],
                'phone' => $row->phone,
                'city' => $row->city,
                'address' => $row->address,
                'children_count' => $row->children_count,
                'bio' => $row->bio,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ]);
        }

        Schema::create('parent_kids_alnum_tmp', function (Blueprint $table) {
            $table->id();
            $table->string('parent_profile_id', 5);
            $table->string('name')->nullable();
            $table->unsignedTinyInteger('age')->nullable();
            $table->string('gender', 20)->nullable();
            $table->string('allergies')->nullable();
            $table->string('medical_conditions')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->index('parent_profile_id');
        });

        $kidRows = DB::table('parent_kids')->get();
        foreach ($kidRows as $row) {
            $mappedParentProfileId = $profileIdToPublicUserId[(string) $row->parent_profile_id] ?? null;
            if (! $mappedParentProfileId) {
                throw new RuntimeException('Unable to resolve parent_kids.parent_profile_id for kid '.$row->id);
            }
            DB::table('parent_kids_alnum_tmp')->insert([
                'id' => $row->id,
                'parent_profile_id' => $mappedParentProfileId,
                'name' => $row->name,
                'age' => $row->age,
                'gender' => $row->gender,
                'allergies' => $row->allergies,
                'medical_conditions' => $row->medical_conditions,
                'notes' => $row->notes,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ]);
        }

        Schema::dropIfExists('parent_kids');
        Schema::dropIfExists('parent_profiles');

        Schema::rename('parent_profiles_alnum_tmp', 'parent_profiles');
        Schema::rename('parent_kids_alnum_tmp', 'parent_kids');

        try {
            Schema::table('parent_profiles', function (Blueprint $table) {
                $table->foreign('user_id')->references('user_id')->on('users')->cascadeOnDelete();
            });
        } catch (Throwable) {
            // Keep migration cross-driver safe even if FK creation is not supported.
        }

        try {
            Schema::table('parent_kids', function (Blueprint $table) {
                $table->foreign('parent_profile_id')->references('user_id')->on('parent_profiles')->cascadeOnDelete();
            });
        } catch (Throwable) {
            // Keep migration cross-driver safe even if FK creation is not supported.
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (! Schema::hasTable('parent_profiles') || ! Schema::hasTable('parent_kids')) {
            return;
        }

        $profileRows = DB::table('parent_profiles')->get();
        $publicUserIdToProfileId = [];
        foreach ($profileRows as $row) {
            $publicUserIdToProfileId[(string) $row->user_id] = (int) $row->id;
        }

        Schema::create('parent_profiles_numeric_tmp', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('phone', 30)->nullable();
            $table->string('city')->nullable();
            $table->string('address')->nullable();
            $table->unsignedTinyInteger('children_count')->default(1);
            $table->text('bio')->nullable();
            $table->timestamps();
        });

        foreach ($profileRows as $row) {
            $internalUserId = User::resolveInternalIdByIdentifier($row->user_id ?? null);
            if (! $internalUserId) {
                throw new RuntimeException('Unable to resolve internal users.id for parent_profiles row '.$row->id);
            }
            DB::table('parent_profiles_numeric_tmp')->insert([
                'id' => $row->id,
                'user_id' => $internalUserId,
                'phone' => $row->phone,
                'city' => $row->city,
                'address' => $row->address,
                'children_count' => $row->children_count,
                'bio' => $row->bio,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ]);
        }

        Schema::create('parent_kids_numeric_tmp', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('parent_profile_id');
            $table->string('name')->nullable();
            $table->unsignedTinyInteger('age')->nullable();
            $table->string('gender', 20)->nullable();
            $table->string('allergies')->nullable();
            $table->string('medical_conditions')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->index('parent_profile_id');
        });

        $kidRows = DB::table('parent_kids')->get();
        foreach ($kidRows as $row) {
            $mappedProfileId = $publicUserIdToProfileId[(string) $row->parent_profile_id] ?? null;
            if (! $mappedProfileId) {
                throw new RuntimeException('Unable to resolve numeric parent_profile_id for kid '.$row->id);
            }
            DB::table('parent_kids_numeric_tmp')->insert([
                'id' => $row->id,
                'parent_profile_id' => $mappedProfileId,
                'name' => $row->name,
                'age' => $row->age,
                'gender' => $row->gender,
                'allergies' => $row->allergies,
                'medical_conditions' => $row->medical_conditions,
                'notes' => $row->notes,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ]);
        }

        Schema::dropIfExists('parent_kids');
        Schema::dropIfExists('parent_profiles');

        Schema::rename('parent_profiles_numeric_tmp', 'parent_profiles');
        Schema::rename('parent_kids_numeric_tmp', 'parent_kids');

        try {
            Schema::table('parent_kids', function (Blueprint $table) {
                $table->foreign('parent_profile_id')->references('id')->on('parent_profiles')->cascadeOnDelete();
            });
        } catch (Throwable) {
            // Keep migration cross-driver safe even if FK creation is not supported.
        }
    }
};

