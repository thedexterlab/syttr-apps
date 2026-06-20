<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;

class FeatureFlagService
{
    private const CACHE_KEY = 'feature_flags.runtime';

    public function all(): array
    {
        $defaults = $this->defaults();
        $stored = $this->loadStoredFlags();

        $flags = [];
        foreach ($defaults as $name => $definition) {
            $flags[$name] = [
                'enabled' => (bool) ($stored[$name] ?? ($definition['default'] ?? false)),
                'default' => (bool) ($definition['default'] ?? false),
                'description' => (string) ($definition['description'] ?? ''),
            ];
        }

        return $flags;
    }

    public function enabled(string $flag): bool
    {
        $flags = $this->all();

        return (bool) ($flags[$flag]['enabled'] ?? false);
    }

    public function set(string $flag, bool $enabled): array
    {
        $defaults = $this->defaults();
        if (! array_key_exists($flag, $defaults)) {
            throw new \InvalidArgumentException("Unknown feature flag [{$flag}].");
        }

        $stored = $this->loadStoredFlags();
        $stored[$flag] = $enabled;

        $this->persistStoredFlags($stored);

        return $this->all()[$flag];
    }

    private function defaults(): array
    {
        $flags = config('featureFlags.flags', []);

        return is_array($flags) ? $flags : [];
    }

    private function loadStoredFlags(): array
    {
        $cached = Cache::get(self::CACHE_KEY);
        if (is_array($cached)) {
            return $cached;
        }

        $disk = Storage::disk((string) config('featureFlags.store.disk', 'local'));
        $path = (string) config('featureFlags.store.path', 'feature_flags.json');

        if (! $disk->exists($path)) {
            Cache::forever(self::CACHE_KEY, []);

            return [];
        }

        $decoded = json_decode((string) $disk->get($path), true);
        $flags = is_array($decoded) ? array_map(static fn ($value): bool => (bool) $value, $decoded) : [];

        Cache::forever(self::CACHE_KEY, $flags);

        return $flags;
    }

    private function persistStoredFlags(array $flags): void
    {
        $normalized = [];
        foreach ($flags as $name => $enabled) {
            $normalized[(string) $name] = (bool) $enabled;
        }

        $disk = Storage::disk((string) config('featureFlags.store.disk', 'local'));
        $path = (string) config('featureFlags.store.path', 'feature_flags.json');
        $disk->put($path, json_encode($normalized, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        Cache::forever(self::CACHE_KEY, $normalized);
    }
}
