<?php

namespace App\Http\Controllers;

use App\Models\TazVerificationOrder;
use App\Models\TazWebhookEvent;
use App\Models\User;
use App\Support\NannyVerificationGateResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class TazVerificationController extends Controller
{
    private const CACHE_PREFIX = 'taz:last-order:';
    private const CACHE_TTL_HOURS = 168;
    private const WEBHOOK_CACHE_PREFIX = 'taz:webhook:event:';
    private const WEBHOOK_CACHE_TTL_HOURS = 48;
    private ?array $tazVerificationOrderColumns = null;

    public function createOrder(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['nullable'],
            'nanny_id' => ['nullable'],
            'first_name' => ['nullable', 'string', 'max:255'],
            'last_name' => ['nullable', 'string', 'max:255'],
            'email' => ['nullable', 'email', 'max:255'],
            'mvr' => ['nullable', 'boolean'],
            'verification_type' => ['nullable', 'string', 'max:64'],
            'drivers_license_number' => ['nullable', 'string', 'max:64'],
            'drivers_license_state' => ['nullable', 'string', 'size:2'],
            'date_of_birth' => ['nullable', 'date'],
            'verification_fee' => ['nullable', 'numeric', 'min:0'],
            'product_guid' => ['nullable', 'string', 'max:120'],
            'client_guid' => ['nullable', 'string', 'max:120'],
        ]);

        $identifier = trim((string) ($data['nanny_id'] ?? $data['user_id'] ?? ''));
        if ($identifier === '') {
            return response()->json(['success' => false, 'message' => 'Missing user_id or nanny_id.'], 422);
        }

        [$user, $publicUserId] = $this->resolveUser($identifier);
        if (! $user || $publicUserId === '') {
            return response()->json(['success' => false, 'message' => 'Invalid user_id/nanny_id.'], 422);
        }
        if (! $this->isConfigured()) {
            return response()->json(['success' => false, 'message' => 'TAZ not configured in backend/.env'], 503);
        }

        [$fallbackFirst, $fallbackLast] = $this->splitName((string) $user->name);
        $firstName = trim((string) ($data['first_name'] ?? $fallbackFirst ?: 'User'));
        $lastName = trim((string) ($data['last_name'] ?? $fallbackLast ?: 'Profile'));
        $email = trim((string) ($data['email'] ?? $user->email ?? ''));
        if ($email === '') {
            return response()->json(['success' => false, 'message' => 'Email is required for verification.'], 422);
        }

        $rawVerificationType = strtolower(trim((string) ($data['verification_type'] ?? '')));
        $requestedMvr = $request->boolean('mvr') || in_array($rawVerificationType, [
            'mvr',
            'mvr_employment',
            'mvr+employment',
            'employment_mvr',
            'employment+driving',
            'employment_driving',
        ], true);
        $verificationType = $requestedMvr ? 'mvr_employment' : 'employment';

        $existingOrderResponse = $this->respondForExistingOrder($user, $publicUserId);
        if ($existingOrderResponse) {
            return $existingOrderResponse;
        }

        $base = [
            'external_id' => $publicUserId,
            'user_id' => $publicUserId,
            'nanny_id' => $publicUserId,
            'first_name' => $firstName,
            'last_name' => $lastName,
            'email' => $email,
        ];
        if ($requestedMvr) {
            $base['mvr'] = true;
            $base['drivers_license_number'] = (string) ($data['drivers_license_number'] ?? '');
            $base['drivers_license_state'] = strtoupper((string) ($data['drivers_license_state'] ?? ''));
            $base['date_of_birth'] = (string) ($data['date_of_birth'] ?? '');
        }
        if (isset($data['verification_fee'])) {
            $base['verification_fee'] = round((float) $data['verification_fee'], 2);
        }

        $clientGuidCandidates = $this->resolveCreateOrderClientGuidCandidates($data);
        $configuredProductGuid = trim((string) ($data['product_guid'] ?? ''));
        $result = [
            'ok' => false,
            'data' => [],
            'message' => 'No provider response.',
            'status' => null,
            'path' => null,
            'payload' => null,
        ];
        $clientGuid = '';
        $productGuid = $configuredProductGuid;

        foreach ($clientGuidCandidates as $candidateClientGuid) {
            $candidateProductGuid = $this->resolveClientProductGuid(
                $candidateClientGuid,
                $verificationType,
                $configuredProductGuid
            );
            if ($candidateProductGuid === '') {
                $this->logTaz('product_guid.missing', [
                    'configured_client_guid' => trim((string) config('services.taz.client_guid', '')),
                    'resolved_client_guid' => $candidateClientGuid,
                    'candidate_client_guids' => $clientGuidCandidates,
                    'verification_type' => $verificationType,
                ]);
            }

            $candidateApplicantGuid = $this->resolveApplicantGuid($candidateClientGuid, $user, $publicUserId, [
                ...$data,
                'first_name' => $firstName,
                'last_name' => $lastName,
                'email' => $email,
            ]);

            $candidateBase = $base;
            if ($candidateClientGuid !== '') {
                $candidateBase['client_guid'] = $candidateClientGuid;
            }
            if ($candidateProductGuid !== '') {
                $candidateBase['product_guid'] = $candidateProductGuid;
                $candidateBase['client_product_guid'] = $candidateProductGuid;
                $candidateBase['clientProductGuid'] = $candidateProductGuid;
            }

            $payloadVariants = $candidateApplicantGuid !== '' && $candidateProductGuid !== ''
                ? [
                    $this->quickAppOrderPayload($candidateApplicantGuid, $candidateProductGuid),
                ]
                : [
                    $candidateBase,
                    [
                        ...($candidateClientGuid !== '' ? ['client_guid' => $candidateClientGuid] : []),
                        ...($candidateProductGuid !== '' ? [
                            'product_guid' => $candidateProductGuid,
                            'client_product_guid' => $candidateProductGuid,
                            'clientProductGuid' => $candidateProductGuid,
                        ] : []),
                        'candidate' => [
                            'external_id' => $publicUserId,
                            'first_name' => $firstName,
                            'last_name' => $lastName,
                            'email' => $email,
                        ],
                    ],
                    [
                        ...($candidateClientGuid !== '' ? ['client_id' => $candidateClientGuid] : []),
                        ...($candidateProductGuid !== '' ? ['product_id' => $candidateProductGuid] : []),
                        'candidate' => [
                            'external_id' => $publicUserId,
                            'first_name' => $firstName,
                            'last_name' => $lastName,
                            'email' => $email,
                        ],
                    ],
                ];
            $configuredCreateOrderPath = $this->replaceClientPath(
                (string) config('services.taz.create_order_path', ''),
                $candidateClientGuid
            );
            $paths = $this->uniquePaths([
                $configuredCreateOrderPath,
                $candidateClientGuid !== '' ? '/v1/clients/'.rawurlencode($candidateClientGuid).'/orders' : '',
                $candidateClientGuid !== '' ? '/api/v1/clients/'.rawurlencode($candidateClientGuid).'/orders' : '',
            ]);

            $this->logTaz('create_order.selection', [
                'verification_type' => $verificationType,
                'requested_mvr' => $requestedMvr,
                'client_guid' => $candidateClientGuid,
                'product_guid' => $candidateProductGuid,
                'applicant_guid' => $candidateApplicantGuid !== '' ? $candidateApplicantGuid : null,
                'candidate_client_guids' => $clientGuidCandidates,
            ]);

            $attempt = $this->attempt('POST', $paths, $payloadVariants);
            if ($attempt['ok']) {
                $result = $attempt;
                $clientGuid = $candidateClientGuid;
                $productGuid = $candidateProductGuid;
                break;
            }

            $result = $attempt;
            $this->logTaz('create_order.retry', [
                'verification_type' => $verificationType,
                'client_guid' => $candidateClientGuid,
                'product_guid' => $candidateProductGuid,
                'applicant_guid' => $candidateApplicantGuid !== '' ? $candidateApplicantGuid : null,
                'status' => $attempt['status'] ?? null,
                'message' => $attempt['message'] ?? null,
                'path' => $attempt['path'] ?? null,
            ]);
        }

        if (! $result['ok']) {
            $statusCode = in_array((int) ($result['status'] ?? 0), [401, 403], true) ? 502 : 502;
            $providerStatus = (int) ($result['status'] ?? 0);
            $message = in_array($providerStatus, [401, 403], true)
                ? $this->unauthorizedProviderMessage($result['message'] ?? null, 'creating the verification order')
                : ($result['message'] ?: 'TAZ create-order failed.');
            $this->logTaz('create_order.failed', [
                'verification_type' => $verificationType,
                'candidate_client_guids' => $clientGuidCandidates,
                'status' => $result['status'] ?? null,
                'message' => $result['message'] ?? null,
                'path' => $result['path'] ?? null,
            ]);
            return response()->json([
                'success' => false,
                'message' => $message,
                'code' => in_array((int) ($result['status'] ?? 0), [401, 403], true)
                    ? 'taz_provider_unauthorized'
                    : ($this->isPermissiblePurposeRequiredMessage($result['message'] ?? null)
                        ? 'taz_permissible_purpose_required'
                        : 'taz_create_order_failed'),
            ], $statusCode);
        }

        $providerData = $result['data'];
        $orderGuid = $this->pick($providerData, ['taz_order_guid', 'order_guid', 'orderGuid', 'guid', 'id']) ?? '';
        $quickapp = $this->pick($providerData, [
            'quickappApplicantLink', 'quickapp_applicant_link', 'quickapp_link', 'quick_app_link', 'quickapp_url', 'quick_app_url', 'application_link', 'app_link', 'url',
        ]) ?? '';
        $rawStatus = $this->pick($providerData, ['status', 'orderStatus', 'order_status', 'state', 'taz_status']) ?? '';
        $status = $this->normalizeStatus($rawStatus);

        if ($orderGuid !== '' && $quickapp === '') {
            $regen = $this->regenerateLinkByOrderGuid($orderGuid);
            if ($regen['ok']) {
                $quickapp = $regen['quickapp_link'] ?: $quickapp;
                if (($regen['raw_status'] ?? '') !== '') {
                    $rawStatus = (string) $regen['raw_status'];
                }
                $status = $regen['status'] ?: $status;
            }
        }

        $this->upsertOrderRecord($user, $publicUserId, $orderGuid, [
            'client_guid' => $clientGuid !== '' ? $clientGuid : null,
            'product_guid' => $productGuid !== '' ? $productGuid : null,
            'verification_type' => $verificationType,
            'provider_status' => $rawStatus !== '' ? $rawStatus : null,
            'normalized_status' => $status !== 'unknown' ? $status : null,
            'quickapp_link' => $quickapp !== '' ? $quickapp : null,
            'create_order_request_payload' => is_array($result['payload'] ?? null) ? $result['payload'] : $base,
            'create_order_response_payload' => $providerData,
            'provider_created_at' => now(),
            'provider_updated_at' => now(),
        ]);

        $this->logTaz('create_order.created', [
            'verification_type' => $verificationType,
            'requested_mvr' => $requestedMvr,
            'client_guid' => $clientGuid !== '' ? $clientGuid : null,
            'product_guid' => $productGuid !== '' ? $productGuid : null,
            'order_guid' => $orderGuid !== '' ? $orderGuid : null,
            'status' => $status,
            'raw_status' => $rawStatus !== '' ? $rawStatus : null,
            'has_quickapp_link' => $quickapp !== '',
        ]);

        $this->writeCache($publicUserId, [
            'taz_order_guid' => $orderGuid,
            'quickapp_link' => $quickapp,
            'status' => $status,
        ]);

        if ($quickapp === '') {
            return response()->json([
                'success' => false,
                'message' => 'Order created but quickapp link is unavailable.',
                'taz_order_guid' => $orderGuid,
                'status' => $status,
            ], 200);
        }

        return response()->json([
            'success' => true,
            'message' => 'Background verification started.',
            'taz_order_guid' => $orderGuid,
            'quickapp_link' => $quickapp,
            'status' => $status,
            'verification_type' => $verificationType,
            'product_guid' => $productGuid !== '' ? $productGuid : null,
        ]);
    }

    private function respondForExistingOrder(?User $user, string $publicUserId): ?JsonResponse
    {
        $storedOrder = $this->findOrderRecord($publicUserId);
        if (! $storedOrder) {
            return null;
        }

        $status = $this->storedOrderStatus($storedOrder);
        $orderGuid = trim((string) ($storedOrder->taz_order_guid ?? ''));
        $quickappLink = trim((string) ($storedOrder->quickapp_link ?? ''));
        $rawStatus = trim((string) ($storedOrder->provider_status ?? ''));

        if ($status === 'failed') {
            return response()->json([
                'success' => false,
                'message' => 'Verification has already been submitted for this user. Please contact support to continue.',
                'existing_order' => true,
                'taz_order_guid' => $orderGuid !== '' ? $orderGuid : null,
                'quickapp_link' => $quickappLink !== '' ? $quickappLink : null,
                'status' => $status,
            ], 409);
        }

        if ($status === 'completed') {
            $this->syncUserVerificationStatus($user, $status);
            $this->writeCache($publicUserId, [
                'taz_order_guid' => $orderGuid,
                'quickapp_link' => $quickappLink,
                'status' => $status,
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Verification already completed.',
                'existing_order' => true,
                'taz_order_guid' => $orderGuid !== '' ? $orderGuid : null,
                'quickapp_link' => $quickappLink !== '' ? $quickappLink : null,
                'status' => $status,
            ]);
        }

        if ($orderGuid === '' && $quickappLink === '' && $status === 'unknown') {
            return null;
        }

        if ($orderGuid !== '') {
            $regen = $this->regenerateLinkByOrderGuid($orderGuid);
            if ($regen['ok']) {
                $quickappLink = $regen['quickapp_link'] ?: $quickappLink;
                if (($regen['raw_status'] ?? '') !== '') {
                    $rawStatus = (string) $regen['raw_status'];
                }
                if (($regen['status'] ?? 'unknown') !== 'unknown') {
                    $status = (string) $regen['status'];
                }
            }
        }

        $this->upsertOrderRecord($user, $publicUserId, $orderGuid, [
            'provider_status' => $rawStatus !== '' ? $rawStatus : null,
            'normalized_status' => $status !== 'unknown' ? $status : null,
            'quickapp_link' => $quickappLink !== '' ? $quickappLink : null,
            'provider_updated_at' => now(),
        ]);
        $this->syncUserVerificationStatus($user, $status);
        $this->writeCache($publicUserId, [
            'taz_order_guid' => $orderGuid,
            'quickapp_link' => $quickappLink,
            'status' => $status,
        ]);

        if ($quickappLink === '') {
            return response()->json([
                'success' => false,
                'message' => 'Verification already exists but quickapp link is unavailable.',
                'existing_order' => true,
                'taz_order_guid' => $orderGuid !== '' ? $orderGuid : null,
                'status' => $status,
            ], 200);
        }

        return response()->json([
            'success' => true,
            'message' => 'Existing verification found.',
            'existing_order' => true,
            'taz_order_guid' => $orderGuid !== '' ? $orderGuid : null,
            'quickapp_link' => $quickappLink,
            'status' => $status,
        ]);
    }

    public function regenerateLink(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['nullable'],
            'nanny_id' => ['nullable'],
            'taz_order_guid' => ['nullable', 'string', 'max:120'],
        ]);
        $identifier = trim((string) ($data['nanny_id'] ?? $data['user_id'] ?? ''));
        if ($identifier === '') {
            return response()->json(['success' => false, 'message' => 'Missing user_id or nanny_id.'], 422);
        }
        [$user, $publicUserId] = $this->resolveUser($identifier);
        if ($publicUserId === '') {
            return response()->json(['success' => false, 'message' => 'Invalid user_id/nanny_id.'], 422);
        }

        $storedOrder = $this->findOrderRecord($publicUserId, (string) ($data['taz_order_guid'] ?? ''));
        $cached = $this->readCache($publicUserId);
        $orderGuid = trim((string) ($data['taz_order_guid'] ?? ($storedOrder?->taz_order_guid ?? ($cached['taz_order_guid'] ?? ''))));
        if ($orderGuid === '') {
            $freshOrder = $this->attemptFreshQuickappOrder($user, $publicUserId, $storedOrder);
            if ($freshOrder['ok']) {
                $newOrderGuid = trim((string) ($freshOrder['order_guid'] ?? ''));
                $this->upsertOrderRecord($user, $publicUserId, $newOrderGuid, [
                    'client_guid' => ($freshOrder['client_guid'] ?? '') !== '' ? (string) $freshOrder['client_guid'] : null,
                    'product_guid' => ($freshOrder['product_guid'] ?? '') !== '' ? (string) $freshOrder['product_guid'] : null,
                    'verification_type' => (string) ($storedOrder?->verification_type ?? 'employment'),
                    'provider_status' => ($freshOrder['raw_status'] ?? '') !== '' ? (string) $freshOrder['raw_status'] : null,
                    'normalized_status' => ($freshOrder['status'] ?? 'unknown') !== 'unknown' ? (string) $freshOrder['status'] : null,
                    'quickapp_link' => ($freshOrder['quickapp_link'] ?? '') !== '' ? (string) $freshOrder['quickapp_link'] : null,
                    'create_order_request_payload' => is_array($freshOrder['request_payload'] ?? null) ? $freshOrder['request_payload'] : null,
                    'create_order_response_payload' => is_array($freshOrder['response_payload'] ?? null) ? $freshOrder['response_payload'] : null,
                    'provider_created_at' => now(),
                    'provider_updated_at' => now(),
                ]);

                $this->writeCache($publicUserId, [
                    'taz_order_guid' => $newOrderGuid,
                    'quickapp_link' => (string) ($freshOrder['quickapp_link'] ?? ''),
                    'status' => (string) ($freshOrder['status'] ?? 'unknown'),
                ]);

                return response()->json([
                    'success' => true,
                    'message' => 'Fresh verification link generated.',
                    'taz_order_guid' => $newOrderGuid !== '' ? $newOrderGuid : null,
                    'quickapp_link' => (string) ($freshOrder['quickapp_link'] ?? ''),
                    'status' => (string) ($freshOrder['status'] ?? 'unknown'),
                ]);
            }

            return response()->json(['success' => false, 'message' => 'No verification order found yet.'], 404);
        }

        $regen = $this->regenerateLinkByOrderGuid($orderGuid);
        if (! $regen['ok']) {
            $freshOrder = $this->attemptFreshQuickappOrder($user, $publicUserId, $storedOrder);
            if ($freshOrder['ok']) {
                $newOrderGuid = trim((string) ($freshOrder['order_guid'] ?? ''));
                $this->upsertOrderRecord($user, $publicUserId, $newOrderGuid !== '' ? $newOrderGuid : $orderGuid, [
                    'client_guid' => ($freshOrder['client_guid'] ?? '') !== '' ? (string) $freshOrder['client_guid'] : null,
                    'product_guid' => ($freshOrder['product_guid'] ?? '') !== '' ? (string) $freshOrder['product_guid'] : null,
                    'verification_type' => (string) ($storedOrder?->verification_type ?? 'employment'),
                    'provider_status' => ($freshOrder['raw_status'] ?? '') !== '' ? (string) $freshOrder['raw_status'] : null,
                    'normalized_status' => ($freshOrder['status'] ?? 'unknown') !== 'unknown' ? (string) $freshOrder['status'] : null,
                    'quickapp_link' => ($freshOrder['quickapp_link'] ?? '') !== '' ? (string) $freshOrder['quickapp_link'] : null,
                    'create_order_request_payload' => is_array($freshOrder['request_payload'] ?? null) ? $freshOrder['request_payload'] : null,
                    'create_order_response_payload' => is_array($freshOrder['response_payload'] ?? null) ? $freshOrder['response_payload'] : null,
                    'provider_created_at' => now(),
                    'provider_updated_at' => now(),
                ]);

                $this->writeCache($publicUserId, [
                    'taz_order_guid' => $newOrderGuid !== '' ? $newOrderGuid : $orderGuid,
                    'quickapp_link' => (string) ($freshOrder['quickapp_link'] ?? ''),
                    'status' => (string) ($freshOrder['status'] ?? 'unknown'),
                ]);

                return response()->json([
                    'success' => true,
                    'message' => 'Fresh verification link generated.',
                    'taz_order_guid' => $newOrderGuid !== '' ? $newOrderGuid : $orderGuid,
                    'quickapp_link' => (string) ($freshOrder['quickapp_link'] ?? ''),
                    'status' => (string) ($freshOrder['status'] ?? 'unknown'),
                ]);
            }
        }

        if (! $regen['ok']) {
            $providerStatus = (int) ($regen['provider_status'] ?? 0);
            return response()->json([
                'success' => false,
                'message' => in_array($providerStatus, [401, 403], true)
                    ? $this->unauthorizedProviderMessage($regen['message'] ?? null, 'regenerating the verification link')
                    : $regen['message'],
                'code' => in_array($providerStatus, [401, 403], true)
                    ? 'taz_provider_unauthorized'
                    : 'taz_regenerate_link_failed',
            ], 502);
        }

        $this->upsertOrderRecord($user, $publicUserId, $orderGuid, [
            'provider_status' => ($regen['raw_status'] ?? '') !== '' ? (string) $regen['raw_status'] : null,
            'normalized_status' => $regen['status'] !== 'unknown' ? $regen['status'] : null,
            'quickapp_link' => $regen['quickapp_link'] !== '' ? $regen['quickapp_link'] : null,
            'provider_updated_at' => now(),
        ]);

        $this->writeCache($publicUserId, [
            'taz_order_guid' => $orderGuid,
            'quickapp_link' => $regen['quickapp_link'],
            'status' => $regen['status'],
        ]);

        return response()->json([
            'success' => $regen['quickapp_link'] !== '',
            'message' => $regen['quickapp_link'] !== '' ? 'Verification link regenerated.' : 'Quickapp link still unavailable.',
            'taz_order_guid' => $orderGuid,
            'quickapp_link' => $regen['quickapp_link'],
            'status' => $regen['status'],
        ]);
    }

    public function status(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['nullable'],
            'nanny_id' => ['nullable'],
            'taz_order_guid' => ['nullable', 'string', 'max:120'],
        ]);
        $identifier = trim((string) ($data['nanny_id'] ?? $data['user_id'] ?? ''));
        if ($identifier === '') {
            return response()->json(['success' => false, 'message' => 'Missing user_id or nanny_id.'], 422);
        }
        [$user, $publicUserId] = $this->resolveUser($identifier);
        if ($publicUserId === '') {
            return response()->json(['success' => false, 'message' => 'Invalid user_id/nanny_id.'], 422);
        }
        $localProfileStatus = $this->localProfileVerificationStatus($user);
        $paymentCompleted = $this->hasSuccessfulVerificationPayment($user, $publicUserId);

        $cached = $this->readCache($publicUserId);
        $storedOrder = $this->findOrderRecord($publicUserId, (string) ($data['taz_order_guid'] ?? ''));
        $orderGuid = trim((string) ($data['taz_order_guid'] ?? ($storedOrder?->taz_order_guid ?? ($cached['taz_order_guid'] ?? ''))));
        $cachedQuickapp = trim((string) ($storedOrder?->quickapp_link ?? ($cached['quickapp_link'] ?? '')));
        $storedStatus = $this->storedOrderStatus($storedOrder);
        $cachedStatus = $this->normalizeStatus((string) ($cached['status'] ?? 'unknown'));
        $resolvedCachedStatus = $storedStatus !== 'unknown'
            ? $storedStatus
            : ($cachedStatus !== 'unknown' ? $cachedStatus : $localProfileStatus);

        if ($orderGuid === '') {
            return response()->json([
                'success' => true,
                'status' => $resolvedCachedStatus,
                'payment_completed' => $paymentCompleted,
                'order_found' => false,
                'taz_order_guid' => null,
                'quickapp_link' => $cachedQuickapp !== '' ? $cachedQuickapp : null,
                'orders' => $resolvedCachedStatus !== 'unknown'
                    ? [$this->buildStatusOrderPayload($storedOrder, $resolvedCachedStatus, $cachedQuickapp)]
                    : [],
            ]);
        }

        // TAZ create-order responses and webhooks already give us enough data to continue
        // the QuickApp flow. Avoid probing guessed order-detail endpoints when we already
        // have a cached link or resolved status, because those endpoints often 404.
        if ($cachedQuickapp !== '' || $resolvedCachedStatus !== 'unknown') {
            return response()->json([
                'success' => true,
                'status' => $resolvedCachedStatus,
                'payment_completed' => $paymentCompleted,
                'order_found' => true,
                'taz_order_guid' => $orderGuid,
                'quickapp_link' => $cachedQuickapp !== '' ? $cachedQuickapp : null,
                'orders' => [$this->buildStatusOrderPayload($storedOrder, $orderGuid, $resolvedCachedStatus, $cachedQuickapp)],
            ]);
        }

        $result = $this->attempt('GET', $this->uniquePaths([
            $this->replaceOrderPath((string) config('services.taz.status_path', ''), $orderGuid),
            '/v1/orders/'.rawurlencode($orderGuid),
            '/api/v1/orders/'.rawurlencode($orderGuid),
            '/api/orders/'.rawurlencode($orderGuid),
            '/orders/'.rawurlencode($orderGuid),
        ]), [[]]);

        if (! $result['ok']) {
            return response()->json([
                'success' => true,
                'status' => $resolvedCachedStatus,
                'payment_completed' => $paymentCompleted,
                'order_found' => true,
                'taz_order_guid' => $orderGuid,
                'quickapp_link' => $cachedQuickapp !== '' ? $cachedQuickapp : null,
                'orders' => [$this->buildStatusOrderPayload($storedOrder, $orderGuid, $resolvedCachedStatus, $cachedQuickapp)],
            ]);
        }

        $providerData = $result['data'];
        $rawStatus = $this->pick($providerData, ['status', 'order_status', 'state', 'taz_status']) ?? '';
        $status = $this->normalizeStatus($rawStatus);
        if ($status === 'unknown') {
            $storedStatus = $this->storedOrderStatus($storedOrder);
            $status = $storedStatus !== 'unknown' ? $storedStatus : $localProfileStatus;
        }
        $quickapp = $this->pick($providerData, [
            'quickapp_link', 'quick_app_link', 'quickapp_url', 'quick_app_url', 'application_link', 'app_link', 'url',
        ]) ?? ((string) ($storedOrder?->quickapp_link ?? ($cached['quickapp_link'] ?? '')));

        $storedOrder = $this->upsertOrderRecord($user, $publicUserId, $orderGuid, [
            'provider_status' => $rawStatus !== '' ? $rawStatus : null,
            'normalized_status' => $status !== 'unknown' ? $status : null,
            'quickapp_link' => $quickapp !== '' ? $quickapp : null,
            'provider_updated_at' => now(),
        ]);
        $this->syncUserVerificationStatus($user, $status);

        $this->writeCache($publicUserId, [
            'taz_order_guid' => $orderGuid,
            'quickapp_link' => $quickapp,
            'status' => $status,
        ]);

        return response()->json([
            'success' => true,
            'status' => $status,
            'payment_completed' => $paymentCompleted,
            'order_found' => true,
            'taz_order_guid' => $orderGuid,
            'quickapp_link' => $quickapp !== '' ? $quickapp : null,
            'orders' => [$this->buildStatusOrderPayload($storedOrder, $orderGuid, $status, $quickapp)],
        ]);
    }

    public function webhook(Request $request): JsonResponse
    {
        if (! $this->isWebhookAuthorized($request)) {
            $this->logTaz('webhook.unauthorized', [
                'headers' => [
                    'authorization' => $this->mask((string) $request->header('Authorization', '')),
                    'x_api_key' => $this->mask((string) $request->header('x-api-key', '')),
                    'x_jwt_token' => $this->mask((string) $request->header('X-JWT-Token', '')),
                    'x_access_token' => $this->mask((string) $request->header('x-access-token', '')),
                ],
            ]);

            return response()->json([
                'received' => false,
                'message' => 'Invalid TAZ webhook credentials.',
            ], 401);
        }

        $rawPayload = (string) $request->getContent();
        $decodedPayload = json_decode($rawPayload, true);
        $payload = is_array($decodedPayload) && $decodedPayload !== []
            ? $decodedPayload
            : $request->all();

        if (! is_array($payload) || $payload === []) {
            $this->logTaz('webhook.invalid_payload', [
                'payload' => $this->truncate($rawPayload),
            ]);

            return response()->json([
                'received' => false,
                'message' => 'Invalid TAZ webhook payload.',
            ], 400);
        }

        $eventId = $this->firstString($payload, [
            'webhook_id',
            'event_id',
            'traceId',
            'trace_id',
            'event.id',
            'data.event_id',
        ]);
        $eventHash = sha1($rawPayload !== '' ? $rawPayload : json_encode($payload));
        $existingEvent = $this->findExistingWebhookEvent($eventId, $eventHash);
        if ($existingEvent) {
            return response()->json([
                'received' => true,
                'duplicate' => true,
                'user_id' => $existingEvent->public_user_id ?: null,
                'order_guid' => $existingEvent->taz_order_guid ?: null,
            ]);
        }
        $eventKey = self::WEBHOOK_CACHE_PREFIX.($eventId !== '' ? $eventId : $eventHash);

        $orderGuid = $this->extractWebhookOrderGuid($payload);
        $quickappLink = $this->extractWebhookQuickappLink($payload);
        $eventType = $this->extractWebhookEventType($payload);
        $rawStatus = $this->extractWebhookStatus($payload);
        $status = $this->normalizeWebhookStatus($eventType, $rawStatus);
        $publicUserId = $this->resolveWebhookUserId($payload);
        $receivedAt = now();
        $storedOrder = $this->findOrderRecord($publicUserId, $orderGuid);
        $responseFields = $this->extractWebhookResponseFields(
            $payload,
            $storedOrder ? (array) ($storedOrder->create_order_response_payload ?? []) : []
        );

        if ($publicUserId === '' && filled((string) $storedOrder?->public_user_id)) {
            $publicUserId = (string) $storedOrder?->public_user_id;
        }

        [$user, $resolvedPublicUserId] = $publicUserId !== '' ? $this->resolveUser($publicUserId) : [null, ''];
        if ($resolvedPublicUserId !== '') {
            $publicUserId = $resolvedPublicUserId;
        }
        if (! $user && $storedOrder?->user) {
            $user = $storedOrder->user;
        }

        if ($publicUserId === '') {
            TazWebhookEvent::query()->create([
                'event_id' => $eventId !== '' ? $eventId : null,
                'event_hash' => $eventHash,
                'event_type' => $eventType !== '' ? $eventType : null,
                'provider_status' => $rawStatus !== '' ? $rawStatus : null,
                'normalized_status' => $eventType !== '' ? $eventType : ($status !== 'unknown' ? $status : null),
                'taz_order_guid' => $orderGuid !== '' ? $orderGuid : null,
                ...$responseFields,
                'quickapp_link' => $quickappLink !== '' ? $quickappLink : null,
                'payload' => $payload,
                'received_at' => $receivedAt,
            ]);
            Cache::put($eventKey, $receivedAt->toIso8601String(), $receivedAt->copy()->addHours(self::WEBHOOK_CACHE_TTL_HOURS));
            $this->logTaz('webhook.unmapped', [
                'order_guid' => $orderGuid,
                'status' => $status,
                'payload' => $this->sanitize($payload),
            ]);

            return response()->json([
                'received' => true,
                'updated' => false,
                'message' => 'Webhook accepted but no matching user was found.',
                'order_guid' => $orderGuid !== '' ? $orderGuid : null,
                'status' => $status,
            ]);
        }

        DB::transaction(function () use (
            $eventHash,
            $eventId,
            $eventType,
            $orderGuid,
            $payload,
            $publicUserId,
            $quickappLink,
            $rawStatus,
            $receivedAt,
            $status,
            $responseFields,
            $user,
            &$storedOrder
        ): void {
            $storedOrder = $this->upsertOrderRecord($user, $publicUserId, $orderGuid, [
                'provider_status' => $rawStatus !== '' ? $rawStatus : null,
                'normalized_status' => $eventType !== '' ? $eventType : ($status !== 'unknown' ? $status : null),
                'quickapp_link' => $quickappLink !== '' ? $quickappLink : null,
                'latest_webhook_payload' => $payload,
                'latest_event_id' => $eventId !== '' ? $eventId : null,
                'latest_event_hash' => $eventHash,
                'webhook_received_at' => $receivedAt,
                'provider_updated_at' => $receivedAt,
            ]);

            TazWebhookEvent::query()->create([
                'taz_verification_order_id' => $storedOrder?->id,
                'user_id' => $user?->id,
                'public_user_id' => $publicUserId !== '' ? $publicUserId : null,
                'taz_order_guid' => $orderGuid !== '' ? $orderGuid : ($storedOrder?->taz_order_guid ?: null),
                'event_id' => $eventId !== '' ? $eventId : null,
                'event_hash' => $eventHash,
                'event_type' => $eventType !== '' ? $eventType : null,
                'provider_status' => $rawStatus !== '' ? $rawStatus : null,
                'normalized_status' => $eventType !== '' ? $eventType : ($status !== 'unknown' ? $status : null),
                ...$responseFields,
                'quickapp_link' => $quickappLink !== '' ? $quickappLink : null,
                'payload' => $payload,
                'received_at' => $receivedAt,
            ]);
        });

        if ($orderGuid !== '') {
            $orderResponseFields = $this->filterOrderResponseFields($responseFields);
            TazVerificationOrder::query()
                ->where('taz_order_guid', $orderGuid)
                ->update([
                    'provider_status' => $rawStatus !== '' ? $rawStatus : null,
                    'normalized_status' => $eventType !== '' ? $eventType : ($status !== 'unknown' ? $status : null),
                    ...$orderResponseFields,
                    'quickapp_link' => $quickappLink !== '' ? $quickappLink : null,
                    'latest_webhook_payload' => $payload,
                    'latest_event_id' => $eventId !== '' ? $eventId : null,
                    'latest_event_hash' => $eventHash,
                    'webhook_received_at' => $receivedAt,
                    'provider_updated_at' => $receivedAt,
                    'updated_at' => $receivedAt,
                ]);
        }

        $this->syncUserVerificationStatus(
            $user,
            $this->resolveWebhookProfileStatus($eventType, $status, $responseFields)
        );

        $cacheUpdate = [];
        if (($storedOrder?->taz_order_guid ?? '') !== '') {
            $cacheUpdate['taz_order_guid'] = (string) $storedOrder->taz_order_guid;
        }
        if (($storedOrder?->quickapp_link ?? '') !== '') {
            $cacheUpdate['quickapp_link'] = (string) $storedOrder->quickapp_link;
        }
        $storedStatus = $this->storedOrderStatus($storedOrder);
        if ($storedStatus !== 'unknown') {
            $cacheUpdate['status'] = $storedStatus;
        }
        $this->writeCache($publicUserId, $cacheUpdate);
        Cache::put($eventKey, $receivedAt->toIso8601String(), $receivedAt->copy()->addHours(self::WEBHOOK_CACHE_TTL_HOURS));

        $this->logTaz('webhook.processed', [
            'user_id' => $publicUserId,
            'order_guid' => $orderGuid,
            'status' => $status,
            'payload' => $this->sanitize($payload),
        ]);

        return response()->json([
            'received' => true,
            'updated' => true,
            'user_id' => $publicUserId,
            'order_guid' => $storedOrder?->taz_order_guid ?: ($orderGuid !== '' ? $orderGuid : null),
            'status' => $storedStatus !== 'unknown' ? $storedStatus : $status,
            'quickapp_link' => $storedOrder?->quickapp_link ?: ($quickappLink !== '' ? $quickappLink : null),
        ]);
    }

    private function regenerateLinkByOrderGuid(string $orderGuid): array
    {
        $paths = $this->uniquePaths([
            $this->replaceOrderPath((string) config('services.taz.regenerate_link_path', ''), $orderGuid),
            '/v1/orders/'.rawurlencode($orderGuid).'/regenerate-link',
            '/v1/orders/'.rawurlencode($orderGuid).'/quickapp-link',
            '/api/v1/orders/'.rawurlencode($orderGuid).'/regenerate-link',
            '/api/v1/orders/'.rawurlencode($orderGuid).'/quickapp-link',
            '/api/orders/'.rawurlencode($orderGuid).'/regenerate-link',
            '/api/v1/orders/regenerate-link',
        ]);
        $payloads = [
            [],
            ['order_guid' => $orderGuid],
        ];
        $result = $this->attempt('POST', $paths, $payloads);
        if (! $result['ok']) {
            return [
                'ok' => false,
                'message' => $result['message'] ?: 'TAZ regenerate-link failed.',
                'quickapp_link' => '',
                'status' => 'unknown',
                'provider_status' => (int) ($result['status'] ?? 0),
            ];
        }
        $providerData = $result['data'];
        return [
            'ok' => true,
            'message' => '',
            'quickapp_link' => (string) ($this->pick($providerData, [
                'quickappApplicantLink', 'quickapp_applicant_link', 'quickapp_link', 'quick_app_link', 'quickapp_url', 'quick_app_url', 'application_link', 'app_link', 'url',
            ]) ?? ''),
            'raw_status' => (string) ($this->pick($providerData, ['status', 'orderStatus', 'order_status', 'state', 'taz_status']) ?? ''),
            'status' => $this->normalizeStatus($this->pick($providerData, ['status', 'orderStatus', 'order_status', 'state', 'taz_status'])),
        ];
    }

    private function attemptFreshQuickappOrder(?User $user, string $publicUserId, ?TazVerificationOrder $storedOrder): array
    {
        if (! $user || $publicUserId === '') {
            return ['ok' => false, 'message' => 'User unavailable for fresh verification link.'];
        }

        [$fallbackFirst, $fallbackLast] = $this->splitName((string) $user->name);
        $email = trim((string) ($user->email ?? ''));
        if ($email === '') {
            return ['ok' => false, 'message' => 'Email is required for fresh verification link.'];
        }

        $verificationType = trim((string) ($storedOrder?->verification_type ?? 'employment'));
        if ($verificationType === '') {
            $verificationType = 'employment';
        }

        $seed = is_array($storedOrder?->create_order_request_payload) ? $storedOrder->create_order_request_payload : [];
        $data = [
            'first_name' => trim((string) ($seed['first_name'] ?? $fallbackFirst ?: 'User')),
            'last_name' => trim((string) ($seed['last_name'] ?? $fallbackLast ?: 'Profile')),
            'email' => trim((string) ($seed['email'] ?? $email)),
            'verification_type' => $verificationType,
            'product_guid' => trim((string) ($storedOrder?->product_guid ?? $seed['product_guid'] ?? '')),
            'client_guid' => trim((string) ($storedOrder?->client_guid ?? $seed['client_guid'] ?? '')),
            'date_of_birth' => trim((string) ($seed['date_of_birth'] ?? '')),
        ];

        $requestedMvr = $verificationType === 'mvr_employment';
        $clientGuidCandidates = $this->resolveCreateOrderClientGuidCandidates($data);

        foreach ($clientGuidCandidates as $candidateClientGuid) {
            $candidateProductGuid = $this->resolveClientProductGuid(
                $candidateClientGuid,
                $verificationType,
                trim((string) ($data['product_guid'] ?? ''))
            );
            $candidateApplicantGuid = $this->resolveApplicantGuid($candidateClientGuid, $user, $publicUserId, [
                ...$data,
                'first_name' => $data['first_name'],
                'last_name' => $data['last_name'],
                'email' => $data['email'],
            ]);

            if ($candidateApplicantGuid === '' || $candidateProductGuid === '') {
                continue;
            }

            $payload = $this->quickAppOrderPayload($candidateApplicantGuid, $candidateProductGuid);

            $paths = $this->uniquePaths([
                $candidateClientGuid !== '' ? '/v1/clients/'.rawurlencode($candidateClientGuid).'/orders' : '',
                $candidateClientGuid !== '' ? '/api/v1/clients/'.rawurlencode($candidateClientGuid).'/orders' : '',
            ]);

            $result = $this->attempt('POST', $paths, [$payload]);
            if (! $result['ok']) {
                continue;
            }

            $providerData = $result['data'] ?? [];
            return [
                'ok' => true,
                'order_guid' => (string) ($this->pick($providerData, ['taz_order_guid', 'order_guid', 'orderGuid', 'guid', 'id']) ?? ''),
                'quickapp_link' => (string) ($this->pick($providerData, [
                    'quickappApplicantLink', 'quickapp_applicant_link', 'quickapp_link', 'quick_app_link', 'quickapp_url', 'quick_app_url', 'application_link', 'app_link', 'url',
                ]) ?? ''),
                'raw_status' => (string) ($this->pick($providerData, ['status', 'orderStatus', 'order_status', 'state', 'taz_status']) ?? ''),
                'status' => $this->normalizeStatus($this->pick($providerData, ['status', 'orderStatus', 'order_status', 'state', 'taz_status'])),
                'client_guid' => $candidateClientGuid,
                'product_guid' => $candidateProductGuid,
                'request_payload' => $payload,
                'response_payload' => $providerData,
                'message' => '',
            ];
        }

        return ['ok' => false, 'message' => 'Unable to create a fresh verification link.'];
    }

    private function attempt(string $method, array $paths, array $payloads): array
    {
        $lastMessage = 'No provider response.';
        $lastStatus = null;
        $lastData = [];
        $lastPath = null;
        $lastPayload = null;
        $bestFailure = null;
        foreach ($paths as $path) {
            foreach ($payloads as $payload) {
                $response = $this->requestProvider($method, $path, $payload);
                if ($response['ok']) {
                    return [
                        'ok' => true,
                        'data' => $response['data'],
                        'message' => '',
                        'status' => $response['status'] ?? null,
                        'path' => $path,
                        'payload' => $payload,
                    ];
                }

                $candidateFailure = [
                    'ok' => false,
                    'data' => $response['data'] ?? [],
                    'message' => $response['message'],
                    'status' => $response['status'] ?? null,
                    'path' => $path,
                    'payload' => $payload,
                ];
                if ($this->shouldPreferProviderFailure($candidateFailure, $bestFailure)) {
                    $bestFailure = $candidateFailure;
                }

                $lastMessage = $response['message'];
                $lastStatus = $response['status'] ?? null;
                $lastData = $response['data'] ?? [];
                $lastPath = $path;
                $lastPayload = $payload;
            }
        }
        if (is_array($bestFailure)) {
            return $bestFailure;
        }
        return [
            'ok' => false,
            'data' => $lastData,
            'message' => $lastMessage,
            'status' => $lastStatus,
            'path' => $lastPath,
            'payload' => $lastPayload,
        ];
    }

    private function isWebhookAuthorized(Request $request): bool
    {
        $secret = trim((string) config('services.taz.webhook_secret', config('services.taz.jwt', '')));
        $allowUnsigned = true;

        $candidates = [
            (string) $request->header('x-api-key', ''),
            (string) $request->header('X-JWT-Token', ''),
            (string) $request->header('x-access-token', ''),
            (string) $request->header('Authorization', ''),
            (string) $request->input('api_key', ''),
            (string) $request->input('token', ''),
            (string) $request->input('jwt', ''),
            (string) $request->query('api_key', ''),
            (string) $request->query('token', ''),
            (string) $request->query('jwt', ''),
        ];

        foreach ($candidates as $candidate) {
            $normalized = $this->normalizeWebhookSecretCandidate($candidate);
            if ($normalized !== '' && hash_equals($secret, $normalized)) {
                return true;
            }
        }

        if ($allowUnsigned) {
            $this->logTaz('webhook.unsigned_accepted', [
                'message' => 'Accepted unsigned TAZ webhook payload.',
            ]);

            return true;
        }

        return false;
    }

    private function requestProvider(string $method, string $path, array $payload): array
    {
        $lastMessage = 'No provider response.';
        $lastStatus = null;
        $lastData = [];

        foreach ($this->authHeaderVariants(trim((string) config('services.taz.jwt', ''))) as $authIndex => $authHeaders) {
            $response = $this->sendProviderRequest($method, $path, $payload, $authHeaders, $authIndex + 1);
            if ($response['ok']) {
                return $response;
            }

            $lastMessage = $response['message'];
            $lastStatus = $response['status'] ?? null;
            $lastData = $response['data'] ?? [];
            if ($this->isDefinitiveProviderClientError($response['status'] ?? null)) {
                return $response;
            }
            if (($response['status'] ?? 0) >= 500) {
                break;
            }
        }

        return ['ok' => false, 'data' => $lastData, 'message' => $lastMessage, 'status' => $lastStatus];
    }

    private function sendProviderRequest(string $method, string $path, array $payload, array $authHeaders, int $authVariant): array
    {
        $base = rtrim((string) config('services.taz.base_url', ''), '/');
        $url = $base.'/'.ltrim($path, '/');
        $headers = array_merge([
            'Accept' => 'application/json',
            'User-Agent' => 'Syttr-TAZ/1.0',
        ], $authHeaders);

        $this->logTaz('provider.request', [
            'method' => $method,
            'url' => $url,
            'auth_variant' => $authVariant,
            'auth_keys' => array_keys($authHeaders),
            'payload' => $this->sanitize($payload),
        ]);

        try {
            $http = Http::timeout(30)->withHeaders($headers);
            if (! (bool) config('services.taz.verify_ssl', true)) {
                $http = $http->withoutVerifying();
            }
            $res = strtoupper($method) === 'POST' ? $http->asJson()->post($url, $payload) : $http->get($url);
            $body = (string) $res->body();
            $decoded = $res->json();
            $data = is_array($decoded) ? $decoded : [];
            $this->logTaz('provider.response', [
                'method' => $method,
                'url' => $url,
                'auth_variant' => $authVariant,
                'auth_keys' => array_keys($authHeaders),
                'status' => $res->status(),
                'body' => $this->truncate($body),
            ]);

            if ($res->successful() && (! array_key_exists('success', $data) || $data['success'] !== false)) {
                return ['ok' => true, 'data' => $data, 'message' => '', 'status' => $res->status()];
            }

            return [
                'ok' => false,
                'data' => $data,
                'message' => $this->extractProviderErrorMessage($data, $res->status(), $body),
                'status' => $res->status(),
            ];
        } catch (\Throwable $e) {
            $this->logTaz('provider.exception', [
                'method' => $method,
                'url' => $url,
                'auth_variant' => $authVariant,
                'auth_keys' => array_keys($authHeaders),
                'error' => $e->getMessage(),
            ]);

            return [
                'ok' => false,
                'data' => [],
                'message' => $e->getMessage(),
                'status' => null,
            ];
        }
    }

    private function normalizeWebhookSecretCandidate(string $value): string
    {
        $raw = trim($value, " \t\n\r\0\x0B\"'");
        if ($raw === '') {
            return '';
        }

        $withoutBearer = preg_replace('/^(Bearer|JWT|Token)\s+/i', '', $raw);

        return trim((string) $withoutBearer, " \t\n\r\0\x0B\"'");
    }

    private function resolveWebhookUserId(array $payload): string
    {
        $candidate = $this->firstString($payload, [
            'external_id',
            'user_id',
            'nanny_id',
            'candidate.external_id',
            'candidate.user_id',
            'candidate.nanny_id',
            'applicant.external_id',
            'applicant.user_id',
            'applicant.nanny_id',
            'order.external_id',
            'order.user_id',
            'order.nanny_id',
            'data.external_id',
            'data.user_id',
            'data.nanny_id',
            'data.order.external_id',
            'data.order.user_id',
            'data.order.nanny_id',
        ]);

        if ($candidate === '') {
            return '';
        }

        return (string) (User::resolvePublicUserIdByIdentifier($candidate) ?? '');
    }

    private function extractWebhookOrderGuid(array $payload): string
    {
        $orderGuid = $this->firstString($payload, [
            'resourceGuid',
            'resource_guid',
            'order.order_guid',
            'order.orderGuid',
            'order.guid',
            'data.order.order_guid',
            'data.order.orderGuid',
            'data.order.guid',
            'data.order_guid',
            'data.orderGuid',
            'taz_order_guid',
            'order_guid',
            'orderGuid',
            'guid',
        ]);

        if ($orderGuid !== '') {
            return $orderGuid;
        }

        return $this->firstString($payload, [
            'order.id',
            'data.order.id',
            'data.id',
        ]);
    }

    private function extractWebhookStatus(array $payload): string
    {
        return $this->firstString($payload, [
            'order.status',
            'order.order_status',
            'data.order.status',
            'data.order.order_status',
            'data.status',
            'data.order_status',
            'status',
            'order_status',
            'state',
            'taz_status',
        ]);
    }

    private function extractWebhookQuickappLink(array $payload): string
    {
        return $this->firstString($payload, [
            'order.quickapp_link',
            'order.quick_app_link',
            'data.order.quickapp_link',
            'data.order.quick_app_link',
            'data.quickapp_link',
            'data.quick_app_link',
            'quickapp_link',
            'quick_app_link',
            'quickapp_url',
            'quick_app_url',
            'application_link',
            'app_link',
            'url',
        ]);
    }

    private function extractWebhookEventType(array $payload): string
    {
        return $this->firstString($payload, [
            'event',
            'event_type',
            'type',
            'event.type',
            'data.type',
            'data.event_type',
        ]);
    }

    private function filterOrderResponseFields(array $fields): array
    {
        $allowed = $this->tazVerificationOrderColumns();
        if ($allowed === []) {
            return [];
        }

        return array_filter(
            $fields,
            static fn ($key) => in_array($key, $allowed, true),
            ARRAY_FILTER_USE_KEY
        );
    }

    private function tazVerificationOrderColumns(): array
    {
        if (is_array($this->tazVerificationOrderColumns)) {
            return $this->tazVerificationOrderColumns;
        }

        try {
            $columns = Schema::getColumnListing('taz_verification_orders');
        } catch (\Throwable) {
            $columns = [];
        }

        return $this->tazVerificationOrderColumns = array_values(array_map('strval', $columns));
    }

    private function extractWebhookResponseFields(array $payload, array $fallbackResponse = []): array
    {
        $fallback = $this->normalizeResponsePayload($fallbackResponse);
        $hasPayloadResponseFields = array_key_exists('fileNumber', $payload)
            || array_key_exists('orderStatus', $payload)
            || array_key_exists('quickappApplicantLink', $payload)
            || array_key_exists('applicantName', $payload)
            || array_key_exists('clientName', $payload)
            || array_key_exists('clientCode', $payload)
            || array_key_exists('productName', $payload);

        $responseFileNumber = $this->firstString($payload, ['fileNumber']);
        if ($responseFileNumber === '' && ! $hasPayloadResponseFields) {
            $responseFileNumber = $this->firstString($fallback, ['fileNumber']);
        }

        $responseOrderStatus = $this->firstString($payload, ['orderStatus']);
        if ($responseOrderStatus === '' && ! $hasPayloadResponseFields) {
            $responseOrderStatus = $this->firstString($fallback, ['orderStatus']);
        }

        $responseOrderType = $this->firstString($payload, ['orderType']);
        if ($responseOrderType === '' && ! $hasPayloadResponseFields) {
            $responseOrderType = $this->firstString($fallback, ['orderType']);
        }

        $responseOrderedDate = $this->firstString($payload, ['orderedDate']);
        if ($responseOrderedDate === '' && ! $hasPayloadResponseFields) {
            $responseOrderedDate = $this->firstString($fallback, ['orderedDate']);
        }

        $responseApplicantName = $this->firstString($payload, ['applicantName']);
        if ($responseApplicantName === '' && ! $hasPayloadResponseFields) {
            $responseApplicantName = $this->firstString($fallback, ['applicantName']);
        }

        $responseClientName = $this->firstString($payload, ['clientName']);
        if ($responseClientName === '' && ! $hasPayloadResponseFields) {
            $responseClientName = $this->firstString($fallback, ['clientName']);
        }

        $responseClientCode = $this->firstString($payload, ['clientCode']);
        if ($responseClientCode === '' && ! $hasPayloadResponseFields) {
            $responseClientCode = $this->firstString($fallback, ['clientCode']);
        }

        $responseProductName = $this->firstString($payload, ['productName']);
        if ($responseProductName === '' && ! $hasPayloadResponseFields) {
            $responseProductName = $this->firstString($fallback, ['productName']);
        }

        $responseRequestedBy = $this->firstString($payload, ['requestedBy']);
        if ($responseRequestedBy === '' && ! $hasPayloadResponseFields) {
            $responseRequestedBy = $this->firstString($fallback, ['requestedBy']);
        }

        $responseSearchFlagged = array_key_exists('searchFlagged', $payload)
            ? (bool) $payload['searchFlagged']
            : ($hasPayloadResponseFields
                ? null
                : (array_key_exists('searchFlagged', $fallback) ? (bool) $fallback['searchFlagged'] : null));

        $responseQuickappApplicantLink = $this->firstString($payload, ['quickappApplicantLink']);
        if ($responseQuickappApplicantLink === '' && ! $hasPayloadResponseFields) {
            $responseQuickappApplicantLink = $this->firstString($fallback, ['quickappApplicantLink']);
        }

        $responseCreatedDate = $this->firstString($payload, ['createdDate']);
        if ($responseCreatedDate === '' && ! $hasPayloadResponseFields) {
            $responseCreatedDate = $this->firstString($fallback, ['createdDate']);
        }

        $responseCreatedBy = $this->firstString($payload, ['createdBy']);
        if ($responseCreatedBy === '' && ! $hasPayloadResponseFields) {
            $responseCreatedBy = $this->firstString($fallback, ['createdBy']);
        }

        $responseModifiedDate = $this->firstString($payload, ['modifiedDate']);
        if ($responseModifiedDate === '' && ! $hasPayloadResponseFields) {
            $responseModifiedDate = $this->firstString($fallback, ['modifiedDate']);
        }

        $responseModifiedBy = $this->firstString($payload, ['modifiedBy']);
        if ($responseModifiedBy === '' && ! $hasPayloadResponseFields) {
            $responseModifiedBy = $this->firstString($fallback, ['modifiedBy']);
        }

        return [
            'resource_guid' => $this->firstString($payload, ['resourceGuid']) ?: $this->firstString($fallback, ['orderGuid']) ?: null,
            'resource_path' => $this->firstString($payload, ['resourcePath']) ?: null,
            'event_timestamp' => $this->firstString($payload, ['timestamp']) ?: null,
            'instance_guid' => $this->firstString($payload, ['instanceGuid']) ?: null,
            'base_client_guid' => $this->firstString($payload, ['baseClientGuid']) ?: null,
            'external_identifier' => $this->firstString($payload, ['externalIdentifier']) ?: null,
            'response_file_number' => $responseFileNumber !== '' ? $responseFileNumber : null,
            'response_order_status' => $responseOrderStatus !== '' ? $responseOrderStatus : null,
            'response_order_type' => $responseOrderType !== '' ? $responseOrderType : null,
            'response_ordered_date' => $responseOrderedDate !== '' ? $responseOrderedDate : null,
            'response_applicant_name' => $responseApplicantName !== '' ? $responseApplicantName : null,
            'response_client_name' => $responseClientName !== '' ? $responseClientName : null,
            'response_client_code' => $responseClientCode !== '' ? $responseClientCode : null,
            'response_product_name' => $responseProductName !== '' ? $responseProductName : null,
            'response_requested_by' => $responseRequestedBy !== '' ? $responseRequestedBy : null,
            'response_search_flagged' => $responseSearchFlagged,
            'response_quickapp_applicant_link' => $responseQuickappApplicantLink !== '' ? $responseQuickappApplicantLink : null,
            'response_created_date' => $responseCreatedDate !== '' ? $responseCreatedDate : null,
            'response_created_by' => $responseCreatedBy !== '' ? $responseCreatedBy : null,
            'response_modified_date' => $responseModifiedDate !== '' ? $responseModifiedDate : null,
            'response_modified_by' => $responseModifiedBy !== '' ? $responseModifiedBy : null,
        ];
    }

    private function normalizeResponsePayload(array $payload): array
    {
        return $payload;
    }

    private function firstString(array $payload, array $paths): string
    {
        foreach ($paths as $path) {
            $value = data_get($payload, $path);
            if (is_string($value) && trim($value) !== '') {
                return trim($value);
            }
            if (is_numeric($value)) {
                return (string) $value;
            }
        }

        return '';
    }

    private function localProfileVerificationStatus(?User $user): string
    {
        if (! $user) {
            return 'unknown';
        }

        return NannyVerificationGateResolver::effectiveStatus(
            (string) ($user->profile_status ?? ''),
            null,
            (bool) $user->is_blacklisted
        );
    }

    private function hasSuccessfulVerificationPayment(?User $user, string $publicUserId): bool
    {
        if (! Schema::hasTable('stripe_transactions')) {
            return false;
        }

        $normalizedUserId = strtoupper(trim((string) ($user?->user_id ?? $publicUserId)));
        if ($normalizedUserId === '') {
            return false;
        }

        return DB::table('stripe_transactions')
            ->where('user_id', $normalizedUserId)
            ->where('source', 'stripe.verification.charge')
            ->whereIn('status', ['succeeded', 'completed'])
            ->exists();
    }

    private function authHeaderVariants(string $jwt): array
    {
        if ($jwt === '') {
            return [[]];
        }

        return [
            [
                'Authorization' => 'Bearer '.$jwt,
            ],
            [
                'Authorization' => 'JWT '.$jwt,
            ],
            [
                'Authorization' => 'Token '.$jwt,
            ],
            [
                'x-api-key' => $jwt,
            ],
            [
                'X-JWT-Token' => $jwt,
            ],
            [
                'x-access-token' => $jwt,
            ],
            [
                'Authorization' => $jwt,
            ],
            [
                'x-api-key' => $jwt,
                'X-JWT-Token' => $jwt,
                'x-access-token' => $jwt,
            ],
        ];
    }

    private function discoverProductGuid(string $clientGuid, string $verificationType = 'employment', string $preferredGuid = ''): string
    {
        $configuredProductsPath = $this->replaceClientPath(
            (string) config('services.taz.products_path', ''),
            $clientGuid
        );
        $paths = $this->uniquePaths([
            $configuredProductsPath,
            $clientGuid !== '' ? '/v1/clients/'.rawurlencode($clientGuid).'/products' : '',
            '/v1/products',
            '/api/v1/products',
            '/api/products',
            '/products',
            $clientGuid !== '' ? '/api/v1/clients/'.rawurlencode($clientGuid).'/products' : '',
        ]);
        foreach ($paths as $path) {
            $fullPath = $clientGuid !== '' && ! str_contains($path, rawurlencode($clientGuid))
                ? $path.(str_contains($path, '?') ? '&' : '?').'client_guid='.rawurlencode($clientGuid)
                : $path;
            $response = $this->requestProvider('GET', $fullPath, []);
            if (! $response['ok']) {
                continue;
            }
            $guid = $this->pickProductGuid($response['data'], $verificationType, $preferredGuid);
            if (is_string($guid) && trim($guid) !== '') {
                return trim($guid);
            }
        }
        return '';
    }

    private function resolveClientProductGuid(string $clientGuid, string $verificationType = 'employment', string $configuredGuid = ''): string
    {
        $preferredGuid = trim($configuredGuid);
        if ($preferredGuid === '') {
            $preferredGuid = $this->resolveProductGuidByType($verificationType);
        }

        if ($clientGuid !== '') {
            $discovered = $this->discoverProductGuid($clientGuid, $verificationType, $preferredGuid);
            if ($discovered !== '') {
                return $discovered;
            }
        }

        return $preferredGuid;
    }

    private function resolveProductGuidByType(string $verificationType): string
    {
        $defaultGuid = trim((string) config('services.taz.product_guid', ''));
        $employmentGuid = trim((string) config('services.taz.product_guid_employment', ''));
        $mvrOnlyGuid = trim((string) config('services.taz.product_guid_mvr', ''));
        $mvrEmploymentGuid = trim((string) config('services.taz.product_guid_mvr_employment', ''));

        $employmentResolved = $employmentGuid !== '' ? $employmentGuid : $defaultGuid;
        $mvrResolved = $mvrEmploymentGuid !== ''
            ? $mvrEmploymentGuid
            : ($mvrOnlyGuid !== '' ? $mvrOnlyGuid : $employmentResolved);

        return $verificationType === 'mvr_employment'
            ? $mvrResolved
            : ($employmentResolved !== '' ? $employmentResolved : $mvrResolved);
    }

    private function pickProductGuid(array $data, string $verificationType, string $preferredGuid = ''): ?string
    {
        $products = $this->extractProductEntries($data);
        $preferred = trim($preferredGuid);
        if ($preferred === '') {
            $preferred = $this->resolveProductGuidByType($verificationType);
        }

        if ($preferred !== '' && count($products) > 0) {
            foreach ($products as $entry) {
                $matches = [
                    trim((string) ($entry['client_product_guid'] ?? '')),
                    trim((string) ($entry['product_guid'] ?? '')),
                    trim((string) ($entry['guid'] ?? '')),
                ];

                if (in_array($preferred, array_filter($matches), true)) {
                    return trim((string) ($entry['client_product_guid'] ?? $entry['guid'] ?? '')) ?: $preferred;
                }
            }
        }

        if ($preferred !== '' && count($products) === 0) {
            return $preferred;
        }

        if (count($products) === 0) {
            return $this->pick($data, ['client_product_guid', 'clientProductGuid', 'product_guid', 'productGuid', 'guid', 'id']);
        }

        $scored = array_map(function (array $entry) use ($verificationType): array {
            $name = strtolower(trim((string) ($entry['name'] ?? '')));
            $score = 0;

            if ($verificationType === 'mvr_employment') {
                if (str_contains($name, 'mvr') || str_contains($name, 'driv')) {
                    $score += 6;
                }
                if (str_contains($name, 'employment')) {
                    $score += 2;
                }
            } else {
                if (str_contains($name, 'employment')) {
                    $score += 6;
                }
                if (str_contains($name, 'mvr') || str_contains($name, 'driv')) {
                    $score -= 2;
                }
            }

            if (str_contains($name, 'tenant') || str_contains($name, 'demo')) {
                $score -= 5;
            }

            $entry['score'] = $score;
            return $entry;
        }, $products);

        usort($scored, static fn (array $a, array $b) => ($b['score'] <=> $a['score']));
        $best = $scored[0] ?? null;
        if (is_array($best) && ! empty($best['guid'])) {
            return (string) $best['guid'];
        }

        return $this->pick($data, ['client_product_guid', 'clientProductGuid', 'product_guid', 'productGuid', 'guid', 'id']);
    }

    private function extractProductEntries(array $data): array
    {
        $entries = [];
        $walker = function ($node) use (&$walker, &$entries): void {
            if (! is_array($node)) {
                return;
            }

            $clientProductGuid = $node['clientProductGuid']
                ?? $node['client_product_guid']
                ?? null;
            $productGuid = $node['productGuid']
                ?? $node['product_guid']
                ?? null;
            $guid = $clientProductGuid
                ?? $productGuid
                ?? $node['guid']
                ?? null;
            $name = $node['productName']
                ?? $node['product_name']
                ?? $node['name']
                ?? '';

            if ((is_string($guid) || is_numeric($guid)) && trim((string) $guid) !== '') {
                $entries[] = [
                    'guid' => trim((string) $guid),
                    'client_product_guid' => is_scalar($clientProductGuid) ? trim((string) $clientProductGuid) : '',
                    'product_guid' => is_scalar($productGuid) ? trim((string) $productGuid) : '',
                    'name' => trim((string) $name),
                ];
            }

            foreach ($node as $child) {
                if (is_array($child)) {
                    $walker($child);
                }
            }
        };

        $walker($data);

        $unique = [];
        foreach ($entries as $entry) {
            $guid = (string) ($entry['guid'] ?? '');
            if ($guid === '') {
                continue;
            }
            if (! array_key_exists($guid, $unique)) {
                $unique[$guid] = $entry;
                continue;
            }
            if (trim((string) ($unique[$guid]['name'] ?? '')) === '' && trim((string) ($entry['name'] ?? '')) !== '') {
                $unique[$guid] = $entry;
            }
        }

        return array_values($unique);
    }

    private function resolveApplicantGuid(string $clientGuid, ?User $user, string $publicUserId, array $data): string
    {
        if ($clientGuid === '') {
            return '';
        }

        $existing = $this->findApplicantGuid($clientGuid, $publicUserId, (string) ($data['email'] ?? ''));
        if ($existing !== '') {
            return $existing;
        }

        return $this->createApplicantGuid($clientGuid, $user, $publicUserId, $data);
    }

    private function findApplicantGuid(string $clientGuid, string $publicUserId, string $email): string
    {
        $paths = $this->uniquePaths([
            '/v1/clients/'.rawurlencode($clientGuid).'/applicants',
            '/api/v1/clients/'.rawurlencode($clientGuid).'/applicants',
        ]);

        foreach ($paths as $path) {
            $response = $this->requestProvider('GET', $path, []);
            if (! $response['ok']) {
                continue;
            }

            foreach ($this->extractApplicantEntries($response['data']) as $entry) {
                $entryGuid = trim((string) ($entry['guid'] ?? ''));
                $entryExternalId = strtoupper(trim((string) ($entry['external_id'] ?? '')));
                $entryEmail = strtolower(trim((string) ($entry['email'] ?? '')));

                if ($entryGuid === '') {
                    continue;
                }

                if ($publicUserId !== '' && $entryExternalId === strtoupper($publicUserId)) {
                    return $entryGuid;
                }

                if ($email !== '' && $entryEmail === strtolower(trim($email))) {
                    return $entryGuid;
                }
            }
        }

        return '';
    }

    private function createApplicantGuid(string $clientGuid, ?User $user, string $publicUserId, array $data): string
    {
        $firstName = trim((string) ($data['first_name'] ?? ''));
        $lastName = trim((string) ($data['last_name'] ?? ''));
        $email = trim((string) ($data['email'] ?? ''));
        if ($firstName === '' || $lastName === '' || $email === '') {
            return '';
        }

        $payload = [
            'externalId' => $publicUserId,
            'firstName' => $firstName,
            'lastName' => $lastName,
            'email' => $this->buildUniqueApplicantEmail($email),
        ];

        $dateOfBirth = $this->resolveApplicantDateOfBirth($user, $data);
        if ($dateOfBirth !== '') {
            $payload['dateOfBirth'] = $dateOfBirth;
        }

        $paths = $this->uniquePaths([
            '/v1/clients/'.rawurlencode($clientGuid).'/applicants',
            '/api/v1/clients/'.rawurlencode($clientGuid).'/applicants',
        ]);

        $response = $this->attempt('POST', $paths, [$payload]);
        if (! $response['ok']) {
            $this->logTaz('applicant.create.failed', [
                'client_guid' => $clientGuid,
                'status' => $response['status'] ?? null,
                'message' => $response['message'] ?? null,
                'path' => $response['path'] ?? null,
            ]);
            return '';
        }

        return trim((string) ($this->pick($response['data'], ['applicantGuid', 'applicant_guid', 'guid', 'id']) ?? ''));
    }

    private function resolveApplicantDateOfBirth(?User $user, array $data): string
    {
        $requestDob = trim((string) ($data['date_of_birth'] ?? ''));
        if ($requestDob !== '') {
            return $requestDob;
        }

        if (! $user || ! Schema::hasTable('syttr_profiles')) {
            return '';
        }

        $profileDob = $user?->syttrProfile?->date_of_birth;
        if ($profileDob instanceof \DateTimeInterface) {
            return $profileDob->format('Y-m-d');
        }

        $normalizedProfileDob = trim((string) ($profileDob ?? ''));
        return $normalizedProfileDob;
    }

    private function buildUniqueApplicantEmail(string $email): string
    {
        $email = trim($email);
        if ($email === '' || ! str_contains($email, '@')) {
            return $email;
        }

        [$local, $domain] = explode('@', $email, 2);
        $suffix = (string) now()->timestamp;

        return $local.'+'.$suffix.'@'.$domain;
    }

    private function extractApplicantEntries(array $data): array
    {
        $entries = [];
        $walker = function ($node) use (&$walker, &$entries): void {
            if (! is_array($node)) {
                return;
            }

            $guid = $node['applicantGuid']
                ?? $node['applicant_guid']
                ?? $node['guid']
                ?? $node['id']
                ?? null;
            if ((is_string($guid) || is_numeric($guid)) && trim((string) $guid) !== '') {
                $entries[] = [
                    'guid' => trim((string) $guid),
                    'external_id' => trim((string) ($node['externalId'] ?? $node['external_id'] ?? '')),
                    'email' => trim((string) ($node['email'] ?? '')),
                ];
            }

            foreach ($node as $child) {
                if (is_array($child)) {
                    $walker($child);
                }
            }
        };

        $walker($data);

        $unique = [];
        foreach ($entries as $entry) {
            $guid = trim((string) ($entry['guid'] ?? ''));
            if ($guid === '' || array_key_exists($guid, $unique)) {
                continue;
            }
            $unique[$guid] = $entry;
        }

        return array_values($unique);
    }

    private function pick(array $data, array $keys): ?string
    {
        foreach ($keys as $key) {
            $v = $data[$key] ?? null;
            if (is_string($v) && trim($v) !== '') return trim($v);
            if (is_numeric($v)) return (string) $v;
        }
        foreach ($data as $value) {
            if (is_array($value)) {
                $found = $this->pick($value, $keys);
                if ($found !== null && $found !== '') return $found;
            }
        }
        return null;
    }

    private function resolveUser(string $identifier): array
    {
        $public = User::resolvePublicUserIdByIdentifier($identifier);
        $internal = User::resolveInternalIdByIdentifier($identifier);
        $user = $internal ? User::query()->find($internal) : ($public ? User::query()->where('user_id', $public)->first() : null);
        if ($user && ! $public) $public = (string) $user->user_id;
        return [$user, (string) ($public ?? '')];
    }

    private function resolveClientGuid(): string
    {
        foreach ($this->resolveClientGuidCandidatesExpanded() as $candidate) {
            $normalized = trim((string) $candidate);
            if ($normalized !== '') {
                return $normalized;
            }
        }

        return '';
    }

    private function resolveCreateOrderClientGuidCandidates(array $data): array
    {
        $requested = trim((string) ($data['client_guid'] ?? ''));
        if ($requested !== '') {
            return [$requested];
        }

        $configured = trim((string) config('services.taz.client_guid', ''));
        if ($configured !== '') {
            return [$configured];
        }

        $candidates = $this->resolveClientGuidCandidatesExpanded();

        return count($candidates) > 0 ? $candidates : [''];
    }

    private function resolveClientGuidCandidates(): array
    {
        $candidates = [];

        $configured = trim((string) config('services.taz.client_guid', ''));
        if ($configured !== '') {
            $candidates[] = $configured;
        }

        $jwt = trim((string) config('services.taz.jwt', ''));
        $parts = explode('.', $jwt);
        if (count($parts) >= 2) {
            $payload = strtr($parts[1], '-_', '+/');
            $payload .= str_repeat('=', (4 - strlen($payload) % 4) % 4);
            $decoded = base64_decode($payload, true);
            $claims = $decoded ? json_decode($decoded, true) : [];
            if (is_array($claims)) {
                foreach (['client_guid', 'iss', 'custom:tw-sub', 'sub'] as $key) {
                    $value = trim((string) ($claims[$key] ?? ''));
                    if ($value !== '') {
                        $candidates[] = $value;
                    }
                }
            }
        }

        return array_values(array_unique($candidates));
    }

    private function resolveClientGuidCandidatesExpanded(): array
    {
        $expanded = [];

        foreach ($this->resolveClientGuidCandidates() as $candidate) {
            $normalized = trim((string) $candidate);
            if ($normalized === '') {
                continue;
            }

            $expanded[] = $normalized;

            $discoveredFromCra = $this->discoverClientGuidFromCra($normalized);
            if ($discoveredFromCra !== '') {
                $expanded[] = $discoveredFromCra;
            }
        }

        return array_values(array_unique($expanded));
    }

    private function discoverClientGuidFromCra(string $candidateGuid): string
    {
        $guid = trim($candidateGuid);
        if ($guid === '') {
            return '';
        }

        $paths = $this->uniquePaths([
            '/v1/clients?cra_guid='.rawurlencode($guid),
            '/v1/clients?cra_id='.rawurlencode($guid),
            '/api/v1/clients?cra_guid='.rawurlencode($guid),
            '/api/v1/clients?cra_id='.rawurlencode($guid),
        ]);

        foreach ($paths as $path) {
            $response = $this->requestProvider('GET', $path, []);
            if (! $response['ok']) {
                continue;
            }
            $clientGuid = $this->pick($response['data'], ['clientGuid', 'client_guid', 'guid', 'id']);
            if (is_string($clientGuid) && trim($clientGuid) !== '' && trim($clientGuid) !== $guid) {
                return trim($clientGuid);
            }
        }

        return '';
    }

    private function isConfigured(): bool
    {
        return trim((string) config('services.taz.base_url', '')) !== '' && trim((string) config('services.taz.jwt', '')) !== '';
    }

    private function replaceOrderPath(string $path, string $orderGuid): string
    {
        return str_replace(['{order_guid}', '{orderGuid}', ':order_guid', ':orderGuid'], rawurlencode($orderGuid), $path);
    }

    private function replaceClientPath(string $path, string $clientGuid): string
    {
        return str_replace(
            ['{client_guid}', '{clientGuid}', ':client_guid', ':clientGuid'],
            rawurlencode($clientGuid),
            $path
        );
    }

    private function normalizeStatus(?string $status): string
    {
        $s = strtolower(trim((string) $status));
        if ($s === '') return 'unknown';
        if (str_contains($s, 'pend')) return 'pending';
        if (str_contains($s, 'clear') || str_contains($s, 'complete') || str_contains($s, 'approved') || str_contains($s, 'verified') || str_contains($s, 'accept')) return 'completed';
        if (str_contains($s, 'reject') || str_contains($s, 'declin') || str_contains($s, 'denied') || str_contains($s, 'fail') || str_contains($s, 'blacklist')) return 'reject';
        return $s;
    }

    private function normalizeWebhookStatus(?string $eventType, ?string $rawStatus): string
    {
        $event = strtolower(trim((string) $eventType));
        if ($event !== '') {
            return $event;
        }

        return $this->normalizeStatus($rawStatus);
    }

    private function splitName(string $name): array
    {
        $parts = array_values(array_filter(preg_split('/\s+/', trim($name)) ?: []));
        return [$parts[0] ?? '', count($parts) > 1 ? implode(' ', array_slice($parts, 1)) : ''];
    }

    private function uniquePaths(array $paths): array
    {
        $out = [];
        foreach ($paths as $path) {
            $clean = '/'.ltrim(trim((string) $path), '/');
            if ($clean !== '/' && ! in_array($clean, $out, true)) $out[] = $clean;
        }
        return $out;
    }

    private function readCache(string $publicUserId): array
    {
        $v = Cache::get(self::CACHE_PREFIX.strtoupper($publicUserId), []);
        return is_array($v) ? $v : [];
    }

    private function findOrderRecord(string $publicUserId = '', string $orderGuid = ''): ?TazVerificationOrder
    {
        $normalizedPublicUserId = strtoupper(trim($publicUserId));
        $normalizedOrderGuid = trim($orderGuid);

        if ($normalizedOrderGuid !== '') {
            $byGuid = TazVerificationOrder::query()
                ->where('taz_order_guid', $normalizedOrderGuid)
                ->first();
            if ($byGuid) {
                return $byGuid;
            }
        }

        if ($normalizedPublicUserId === '') {
            return null;
        }

        $query = TazVerificationOrder::query()
            ->where('public_user_id', $normalizedPublicUserId);

        if ($normalizedOrderGuid !== '') {
            $matchWithoutGuid = (clone $query)
                ->whereNull('taz_order_guid')
                ->latest('id')
                ->first();
            if ($matchWithoutGuid) {
                return $matchWithoutGuid;
            }
        }

        return $query->latest('id')->first();
    }

    private function upsertOrderRecord(?User $user, string $publicUserId, string $orderGuid, array $attributes = []): TazVerificationOrder
    {
        $normalizedPublicUserId = strtoupper(trim($publicUserId));
        $normalizedOrderGuid = trim($orderGuid);
        $order = $this->findOrderRecord($normalizedPublicUserId, $normalizedOrderGuid) ?? new TazVerificationOrder();

        $updates = [];
        if ($user?->id) {
            $updates['user_id'] = $user->id;
        } elseif (! $order->exists && $normalizedPublicUserId !== '') {
            $resolvedInternalId = User::resolveInternalIdByIdentifier($normalizedPublicUserId);
            if ($resolvedInternalId) {
                $updates['user_id'] = $resolvedInternalId;
            }
        }
        if ($normalizedPublicUserId !== '') {
            $updates['public_user_id'] = $normalizedPublicUserId;
        }
        if ($normalizedOrderGuid !== '') {
            $updates['taz_order_guid'] = $normalizedOrderGuid;
        }

        foreach ($attributes as $key => $value) {
            if ($value === null) {
                continue;
            }
            if (is_string($value) && trim($value) === '') {
                continue;
            }
            $updates[$key] = $value;
        }

        if (array_key_exists('provider_created_at', $updates) && $order->provider_created_at) {
            unset($updates['provider_created_at']);
        }

        $order->fill($updates);
        $order->save();

        return $order->fresh();
    }

    private function findExistingWebhookEvent(string $eventId, string $eventHash): ?TazWebhookEvent
    {
        $normalizedEventId = trim($eventId);
        if ($normalizedEventId !== '') {
            $byEventId = TazWebhookEvent::query()
                ->where('event_id', $normalizedEventId)
                ->first();
            if ($byEventId) {
                return $byEventId;
            }
        }

        return TazWebhookEvent::query()
            ->where('event_hash', trim($eventHash))
            ->first();
    }

    private function storedOrderStatus(?TazVerificationOrder $order): string
    {
        if (! $order) {
            return 'unknown';
        }

        $normalized = $this->normalizeStatus((string) ($order->normalized_status ?? ''));
        if ($normalized !== 'unknown') {
            return $normalized;
        }

        return $this->normalizeStatus((string) ($order->provider_status ?? ''));
    }

    private function buildStatusOrderPayload(
        ?TazVerificationOrder $order,
        string $status,
        ?string $quickappLink = null
    ): array {
        $resolvedQuickappLink = $quickappLink !== null
            ? trim($quickappLink)
            : trim((string) ($order?->quickapp_link ?? ''));

        return [
            'status' => $status,
            'order_guid' => $order?->taz_order_guid,
            'taz_order_guid' => $order?->taz_order_guid,
            'provider_status' => $order?->provider_status,
            'normalized_status' => $order?->normalized_status,
            'response_order_status' => $order?->response_order_status,
            'response_order_type' => $order?->response_order_type,
            'response_file_number' => $order?->response_file_number,
            'response_quickapp_applicant_link' => $order?->response_quickapp_applicant_link,
            'quickapp_link' => $resolvedQuickappLink !== '' ? $resolvedQuickappLink : null,
        ];
    }

    private function writeCache(string $publicUserId, array $data): void
    {
        Cache::put(
            self::CACHE_PREFIX.strtoupper($publicUserId),
            array_merge($this->readCache($publicUserId), $data, ['updated_at' => now()->toIso8601String()]),
            now()->addHours(self::CACHE_TTL_HOURS)
        );
    }

    private function syncUserVerificationStatus(?User $user, string $status): void
    {
        if (! $user || (bool) $user->is_blacklisted) {
            return;
        }

        $nextStatus = match ($status) {
            'completed' => 'completed',
            'accept' => 'accepted',
            'reject' => 'rejected',
            'pending' => 'pending',
            default => '',
        };

        if ($nextStatus === '') {
            return;
        }

        $currentStatus = strtolower(trim((string) ($user->profile_status ?? '')));
        if ($currentStatus === $nextStatus) {
            return;
        }

        $updates = [
            'profile_status' => $nextStatus,
            'profile_status_updated_at' => now(),
        ];

        if ($nextStatus === 'rejected') {
            $updates['is_blacklisted'] = true;
            $updates['blacklisted_reason'] = 'TAZ verification rejected';
        }

        $user->forceFill($updates)->save();
    }

    private function resolveWebhookProfileStatus(string $eventType, string $status, array $responseFields): string
    {
        $normalizedEventType = strtolower(trim($eventType));
        $normalizedStatus = strtolower(trim($status));
        $decisionStatus = strtolower(trim((string) ($responseFields['response_order_status'] ?? '')));

        $isRejected = fn (string $value): bool => str_contains($value, 'reject')
            || str_contains($value, 'declin')
            || str_contains($value, 'blacklist')
            || str_contains($value, 'fail')
            || str_contains($value, 'deny')
            || str_contains($value, 'cancel')
            || str_contains($value, 'expire');

        $isAccepted = fn (string $value): bool => str_contains($value, 'accept')
            || str_contains($value, 'approved')
            || str_contains($value, 'verified');

        if ($isRejected($decisionStatus)) {
            return 'reject';
        }
        if ($isAccepted($decisionStatus)) {
            return 'accept';
        }

        if ($normalizedEventType === 'order.quickapp.completed') {
            return 'pending';
        }
        if ($normalizedEventType === 'order.quickapp.created') {
            return 'pending';
        }
        if ($normalizedEventType !== '' && $isRejected($normalizedEventType)) {
            return 'reject';
        }
        if ($normalizedEventType !== '' && $isAccepted($normalizedEventType)) {
            return 'accept';
        }

        if ($normalizedStatus === 'app-pending' || str_contains($normalizedStatus, 'pend')) {
            return 'pending';
        }

        return '';
    }

    private function sanitize(array $payload): array
    {
        foreach ($payload as $k => $v) {
            if (is_array($v)) {
                $payload[$k] = $this->sanitize($v);
                continue;
            }
            if (! is_string($v)) continue;
            $lk = strtolower((string) $k);
            if (str_contains($lk, 'token') || str_contains($lk, 'jwt') || str_contains($lk, 'license')) {
                $payload[$k] = $this->mask($v);
            } elseif (str_contains($lk, 'email')) {
                $payload[$k] = $this->maskEmail($v);
            }
        }
        return $payload;
    }

    private function mask(string $value): string
    {
        $v = trim($value);
        return strlen($v) <= 8 ? str_repeat('*', strlen($v)) : substr($v, 0, 4).'...'.substr($v, -4);
    }

    private function maskEmail(string $value): string
    {
        $raw = trim($value);
        if (! str_contains($raw, '@')) return $this->mask($raw);
        [$local, $domain] = explode('@', $raw, 2);
        $localMasked = strlen($local) <= 2 ? '**' : substr($local, 0, 2).str_repeat('*', max(strlen($local) - 2, 1));
        return $localMasked.'@'.$domain;
    }

    private function truncate(string $value, int $limit = 1200): string
    {
        $v = trim($value);
        return strlen($v) > $limit ? substr($v, 0, $limit).'...[truncated]' : $v;
    }

    private function logTaz(string $event, array $context = []): void
    {
        $allowedEvents = [
            'create_order.created',
            'webhook.processed',
        ];

        if (! in_array($event, $allowedEvents, true)) {
            return;
        }

        $message = '[TAZ] '.$event;
        Log::info($message, $context);
        Log::channel('stderr')->info($message, $context);
    }

    private function isDefinitiveProviderClientError(?int $status): bool
    {
        $normalized = (int) ($status ?? 0);
        return $normalized >= 400 && $normalized < 500 && ! in_array($normalized, [401, 403, 404], true);
    }

    private function shouldPreferProviderFailure(array $candidate, ?array $current): bool
    {
        if (! is_array($current)) {
            return true;
        }

        $candidateDefinitive = $this->isDefinitiveProviderClientError($candidate['status'] ?? null);
        $currentDefinitive = $this->isDefinitiveProviderClientError($current['status'] ?? null);

        if ($candidateDefinitive !== $currentDefinitive) {
            return $candidateDefinitive;
        }

        $candidateInformative = $this->isInformativeProviderMessage((string) ($candidate['message'] ?? ''));
        $currentInformative = $this->isInformativeProviderMessage((string) ($current['message'] ?? ''));

        if ($candidateInformative !== $currentInformative) {
            return $candidateInformative;
        }

        return strlen((string) ($candidate['message'] ?? '')) > strlen((string) ($current['message'] ?? ''));
    }

    private function isInformativeProviderMessage(string $message): bool
    {
        $normalized = strtolower(trim($message));
        if ($normalized === '') {
            return false;
        }

        return ! preg_match('/^provider status \d+$/', $normalized);
    }

    private function extractProviderErrorMessage(array $data, int $status, string $body = ''): string
    {
        $baseMessage = trim((string) ($this->pick($data, ['message', 'error', 'detail']) ?? ''));
        $fieldErrors = $this->flattenProviderFieldErrors($data['fields'] ?? null);

        if ($baseMessage !== '' && count($fieldErrors) > 0) {
            return $baseMessage.' Fields: '.implode('; ', $fieldErrors);
        }

        if ($baseMessage !== '') {
            return $baseMessage;
        }

        if (count($fieldErrors) > 0) {
            return implode('; ', $fieldErrors);
        }

        $code = trim((string) ($data['code'] ?? ''));
        if ($code !== '') {
            return $code;
        }

        $normalizedBody = trim($body);
        if ($normalizedBody !== '') {
            return $this->truncate($normalizedBody, 400);
        }

        return "Provider status {$status}";
    }

    private function flattenProviderFieldErrors(mixed $fields): array
    {
        if (! is_array($fields)) {
            return [];
        }

        $messages = [];
        foreach ($fields as $field => $errors) {
            if (is_array($errors)) {
                $parts = array_values(array_filter(array_map(static function ($value): string {
                    return is_scalar($value) ? trim((string) $value) : '';
                }, $errors)));
                if (count($parts) > 0) {
                    $messages[] = trim((string) $field).': '.implode(', ', $parts);
                }
                continue;
            }

            if (is_scalar($errors) && trim((string) $errors) !== '') {
                $messages[] = trim((string) $field).': '.trim((string) $errors);
            }
        }

        return $messages;
    }

    private function isPermissiblePurposeRequiredMessage(?string $message): bool
    {
        $normalized = strtolower(trim((string) $message));
        if ($normalized === '') {
            return false;
        }

        return str_contains($normalized, 'permissible purpose')
            && (str_contains($normalized, 'certified') || str_contains($normalized, 'certify'))
            && str_contains($normalized, 'quickapp');
    }

    private function quickAppOrderPayload(string $applicantGuid, string $clientProductGuid): array
    {
        return [
            'applicantGuid' => $applicantGuid,
            'clientProductGuid' => $clientProductGuid,
            'useQuickApp' => true,
            'certifyPermissiblePurpose' => true,
        ];
    }

    private function unauthorizedProviderMessage(?string $message, string $operation): string
    {
        $normalized = trim((string) $message);
        if ($normalized !== '' && strtolower($normalized) !== 'unauthorized') {
            return $normalized;
        }

        return 'TAZ provider returned an unauthorized response while '.$operation.'.';
    }
}
