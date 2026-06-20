<?php

return [
    'store' => [
        'disk' => 'local',
        'path' => 'feature_flags.json',
    ],

    'flags' => [
        'verification_free_mode' => [
            'default' => false,
            'description' => 'Skips verification payment, auto-verifies the user, and grants a 30-day subscription.',
        ],
    ],
];
