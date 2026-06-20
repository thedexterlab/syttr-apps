<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AppData\AppUser;
use App\Support\AdminTazClient;
use App\Support\AppDataHelper;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\Response;

class AdminTazController extends Controller
{
    public function __construct(
        private readonly AdminTazClient $tazClient,
    ) {
    }

    public function index(): JsonResponse
    {
        $items = AppDataHelper::tazCacheMap()
            ->map(function (array $payload): array {
                $orderGuid = trim((string) ($payload['taz_order_guid'] ?? $payload['order_guid'] ?? ''));

                return [
                    'user_id' => $payload['user_id'] ?? null,
                    'status' => AppDataHelper::displayTazStatus((string) ($payload['status'] ?? '')),
                    'order_guid' => $orderGuid !== '' ? $orderGuid : null,
                    'taz_order_guid' => $orderGuid !== '' ? $orderGuid : null,
                    'created_at' => $payload['updated_at'] ?? null,
                ];
            })
            ->values()
            ->all();

        return response()->json([
            'data' => $items,
        ]);
    }

    public function show(string $user): JsonResponse
    {
        $appUser = AppUser::resolveByIdentifier($user);
        if (! $appUser) {
            return response()->json([
                'message' => 'User not found.',
            ], 404);
        }

        $cachePayload = AppDataHelper::tazCacheFor($user) ?? [];
        $orderGuid = trim((string) ($cachePayload['taz_order_guid'] ?? $cachePayload['order_guid'] ?? ''));
        $status = AppDataHelper::displayTazStatus((string) ($cachePayload['status'] ?? ''));

        if ($orderGuid !== '') {
            $live = $this->tazClient->fetchOrderStatus($orderGuid);
            if ($live['status'] ?? null) {
                $status = $live['status'];
            }
        }

        if (! $status) {
            $status = $appUser->role === 'syttr'
                ? AppDataHelper::nannyStatusLabel($appUser)
                : AppDataHelper::parentStatusLabel($appUser);
        }

        return response()->json([
            'status' => $status,
            'order_guid' => $orderGuid !== '' ? $orderGuid : null,
            'data' => [
                'status' => $status,
                'order_guid' => $orderGuid !== '' ? $orderGuid : null,
            ],
        ]);
    }

    public function pdf(string $user, string $orderGuid): Response|JsonResponse
    {
        $appUser = AppUser::resolveByIdentifier($user);
        if (! $appUser) {
            return response()->json([
                'message' => 'User not found.',
            ], 404);
        }

        $pdf = $this->tazClient->downloadOrderPdf($orderGuid);
        if (! $pdf) {
            return response()->json([
                'message' => 'Background check report is unavailable for this order.',
            ], 404);
        }

        return response($pdf['content'], 200, [
            'Content-Type' => $pdf['content_type'],
            'Content-Disposition' => 'inline; filename="'.$pdf['filename'].'"',
        ]);
    }
}
