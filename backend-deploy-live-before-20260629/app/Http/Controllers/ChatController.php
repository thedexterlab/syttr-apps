<?php

namespace App\Http\Controllers;

use App\Events\ChatMessageSent;
use App\Events\UserNotificationCreated;
use App\Models\ChatConversation;
use App\Models\ChatMessage;
use App\Models\ParentProfile;
use App\Models\SyttrProfile;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class ChatController extends Controller
{
    public function conversations(Request $request): JsonResponse
    {
        // Purge invalid self-conversation rows created by older buggy clients.
        ChatConversation::query()->whereColumn('user_id', 'nanny_id')->delete();

        $userId = $this->resolveUserIdFromInput($request, 'user_id');
        $nannyId = $this->resolveUserIdFromInput($request, 'nanny_id');
        $authUserId = $this->resolveUserId($request, null);

        if (! $userId && ! $nannyId && $authUserId) {
            // Role values can vary across environments; use authenticated id directly.
            $userId = $authUserId;
        }

        if (! $userId && ! $nannyId) {
            return response()->json(['success' => true, 'data' => []]);
        }

        $query = ChatConversation::query();
        $query
            // Invalid rows (same participant on both sides) should never be shown.
            ->whereColumn('user_id', '!=', 'nanny_id');
        if ($userId && $nannyId) {
            $query->where('user_id', $userId)->where('nanny_id', $nannyId);
        } elseif ($nannyId && ! $userId) {
            $query->where('nanny_id', $nannyId);
        } elseif ($userId && ! $nannyId) {
            $query->where(function ($inner) use ($userId, $authUserId) {
                $inner->where('user_id', $userId);
                // If request only has auth-derived user_id, also include rows where this user is nanny.
                if ($authUserId && (string) $userId === (string) $authUserId) {
                    $inner->orWhere('nanny_id', $userId);
                }
            });
        }

        $conversationRows = $query
            ->orderByDesc('updated_at')
            ->orderByDesc('id')
            ->get();
        $conversationBuckets = $conversationRows
            ->groupBy(static fn (ChatConversation $conversation) => strtoupper(trim((string) $conversation->user_id)).'::'.strtoupper(trim((string) $conversation->nanny_id)));
        $conversations = $conversationBuckets
            ->map(static function ($bucket) {
                return $bucket
                    ->sortByDesc('updated_at')
                    ->sortByDesc('id')
                    ->first();
            })
            ->values();
        $conversationIdsByKey = $conversationBuckets
            ->map(static fn ($bucket) => $bucket->pluck('id')->map(static fn ($id) => (int) $id)->values()->all())
            ->all();
        $parentPublicIds = $conversations->pluck('user_id')->filter()->unique()->values();
        $nannyPublicIds = $conversations->pluck('nanny_id')->filter()->unique()->values();

        $parentUsers = $parentPublicIds->count() > 0
            ? User::query()
                ->whereIn('user_id', $parentPublicIds->all())
                ->get(['id', 'user_id', 'name', 'email'])
                ->keyBy('user_id')
            : collect();
        $nannyUsers = $nannyPublicIds->count() > 0
            ? User::query()
                ->whereIn('user_id', $nannyPublicIds->all())
                ->get(['id', 'user_id', 'name', 'email'])
                ->keyBy('user_id')
            : collect();
        $nannyUsersByInternalId = $nannyUsers->keyBy('id');
        $parentProfiles = $parentPublicIds->count() > 0
            ? ParentProfile::query()
                ->whereIn('user_id', $parentPublicIds->all())
                ->get(['user_id', 'phone', 'city', 'address', 'user_image'])
                ->keyBy('user_id')
            : collect();
        $nannyProfiles = $nannyUsersByInternalId->count() > 0
            ? SyttrProfile::query()
                ->whereIn('user_id', $nannyUsersByInternalId->keys()->all())
                ->get(['user_id', 'phone', 'city', 'address', 'user_image'])
                ->mapWithKeys(function (SyttrProfile $profile) use ($nannyUsersByInternalId) {
                    $nannyUser = $nannyUsersByInternalId->get($profile->user_id);
                    $publicUserId = trim((string) ($nannyUser?->user_id ?? ''));
                    if ($publicUserId === '') {
                        return [];
                    }

                    return [$publicUserId => $profile];
                })
            : collect();

        $viewerId = $authUserId ?: ($nannyId ?: $userId);

        $items = $conversations->map(function (ChatConversation $conversation) use (
            $viewerId,
            $parentUsers,
            $parentProfiles,
            $nannyUsers,
            $nannyProfiles,
            $conversationIdsByKey
        ) {
            $isNannyViewer = $viewerId && (string) $viewerId === (string) $conversation->nanny_id;
            $bucketKey = strtoupper(trim((string) $conversation->user_id)).'::'.strtoupper(trim((string) $conversation->nanny_id));
            $conversationIds = $conversationIdsByKey[$bucketKey] ?? [(int) $conversation->id];

            $last = ChatMessage::query()
                ->whereIn('conversation_id', $conversationIds)
                ->latest('id')
                ->first();

            $unread = ChatMessage::query()
                ->whereIn('conversation_id', $conversationIds)
                ->where('sender', $isNannyViewer ? 'user' : 'nanny')
                ->where('is_read', false)
                ->count();

            $parentUser = $parentUsers->get($conversation->user_id);
            $parentProfile = $parentProfiles->get($conversation->user_id);
            $nannyUser = $nannyUsers->get($conversation->nanny_id);
            $nannyProfile = $nannyProfiles->get($conversation->nanny_id);

            $contactName = $isNannyViewer
                ? ($parentUser?->name ?: 'Parent')
                : ($nannyUser?->name ?: 'Syttr');
            $contactImagePath = $isNannyViewer
                ? ($parentProfile?->user_image_url ?: $parentProfile?->user_image)
                : ($nannyProfile?->user_image_url ?: $nannyProfile?->user_image);
            $contactAvatar = $contactImagePath
                ? (preg_match('/^https?:\/\//i', (string) $contactImagePath)
                    ? (string) $contactImagePath
                    : asset('storage/'.ltrim((string) $contactImagePath, '/')))
                : null;

            return [
                'id' => $conversation->id,
                'conversation_id' => $conversation->id,
                'user_id' => $conversation->user_id,
                'nanny_id' => $conversation->nanny_id,
                'name' => $contactName,
                'avatar' => $contactAvatar,
                'user_image' => $isNannyViewer ? $contactAvatar : null,
                'lastMessage' => $last?->message ?: '',
                'message' => $last?->message ?: '',
                'time' => optional($last?->created_at)->toISOString(),
                'updated_at' => optional($last?->updated_at)->toISOString(),
                'unread' => $unread,
                'unread_count' => $unread,
                'user' => [
                    'id' => $conversation->user_id,
                    'name' => $parentUser?->name,
                    'email' => $parentUser?->email,
                    'profile_image' => $parentProfile?->user_image_url ?: $parentProfile?->user_image,
                    'user_image_url' => $parentProfile?->user_image_url,
                ],
                'nanny' => [
                    'id' => $conversation->nanny_id,
                    'name' => $nannyUser?->name,
                    'email' => $nannyUser?->email,
                    'profile_image' => $nannyProfile?->user_image_url ?: $nannyProfile?->user_image,
                    'user_image_url' => $nannyProfile?->user_image_url,
                ],
            ];
        })->sortByDesc(static function (array $item) {
            return strtotime((string) ($item['time'] ?? $item['updated_at'] ?? ''));
        })->values();

        return response()->json([
            'success' => true,
            'data' => $items->values(),
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'id' => ['nullable'],
            'conversation_id' => ['nullable'],
            'user_id' => ['nullable'],
            'nanny_id' => ['nullable'],
        ]);

        $conversationId = $data['id'] ?? $data['conversation_id'] ?? null;
        if (! $conversationId) {
            return response()->json(['messages' => []]);
        }

        $conversation = ChatConversation::query()->find($conversationId);
        if (! $conversation) {
            return response()->json(['messages' => []]);
        }
        if ((string) $conversation->user_id === (string) $conversation->nanny_id) {
            return response()->json(['messages' => []]);
        }

        $relatedConversationIds = ChatConversation::query()
            ->where('user_id', $conversation->user_id)
            ->where('nanny_id', $conversation->nanny_id)
            ->pluck('id')
            ->map(static fn ($id) => (int) $id)
            ->values()
            ->all();
        if (count($relatedConversationIds) === 0) {
            $relatedConversationIds = [(int) $conversation->id];
        }

        $viewerUserId = $this->resolveUserIdFromInput($request, 'user_id');
        $viewerNannyId = $this->resolveUserIdFromInput($request, 'nanny_id');
        $authUserId = $this->resolveUserId($request, null);

        // Authoritative viewer-side detection: prefer authenticated token identity.
        // Some clients send only `user_id` even on nanny side, which breaks read-marking.
        if ($authUserId) {
            if ((string) $authUserId === (string) $conversation->nanny_id) {
                $viewerNannyId = $authUserId;
                $viewerUserId = null;
            } elseif ((string) $authUserId === (string) $conversation->user_id) {
                $viewerUserId = $authUserId;
                $viewerNannyId = null;
            }
        }

        $messages = ChatMessage::query()
            ->whereIn('conversation_id', $relatedConversationIds)
            ->orderBy('id')
            ->get();

        // Mark incoming messages as read for the viewer.
        if ($viewerUserId) {
            ChatMessage::query()
                ->whereIn('conversation_id', $relatedConversationIds)
                ->where('sender', 'nanny')
                ->where('is_read', false)
                ->update(['is_read' => true]);
        } elseif ($viewerNannyId) {
            ChatMessage::query()
                ->whereIn('conversation_id', $relatedConversationIds)
                ->where('sender', 'user')
                ->where('is_read', false)
                ->update(['is_read' => true]);
        }

        return response()->json([
            'success' => true,
            'messages' => $messages->map(fn (ChatMessage $message) => $this->serializeMessage($message)),
        ]);
    }

    public function send(Request $request): JsonResponse
    {
        $data = $request->validate([
            'conversation_id' => ['nullable'],
            'user_id' => ['required'],
            'nanny_id' => ['required'],
            'sender' => ['nullable', 'in:user,nanny'],
            'message' => ['nullable', 'string'],
            'file' => ['nullable', 'file', 'max:51200'],
        ]);

        $userId = $this->resolveUserId($request, $data['user_id']);
        $nannyId = $this->resolveUserId($request, $data['nanny_id']);
        if (! $userId || ! $nannyId) {
            return response()->json(['message' => 'Invalid user_id or nanny_id.'], 422);
        }
        if ((string) $userId === (string) $nannyId) {
            return response()->json(['message' => 'User and nanny cannot be the same account.'], 422);
        }

        $conversation = null;
        if (! empty($data['conversation_id'])) {
            $conversation = ChatConversation::query()->find($data['conversation_id']);
        }
        if ($conversation && (string) $conversation->user_id === (string) $conversation->nanny_id) {
            return response()->json(['message' => 'Invalid conversation participants.'], 422);
        }
        if (
            $conversation &&
            (
                (string) $conversation->user_id !== (string) $userId ||
                (string) $conversation->nanny_id !== (string) $nannyId
            )
        ) {
            $conversation = null;
        }

        if (! $conversation) {
            $conversation = ChatConversation::query()
                ->where('user_id', $userId)
                ->where('nanny_id', $nannyId)
                ->orderByDesc('id')
                ->first();
        }
        if (! $conversation) {
            $conversation = ChatConversation::query()->create([
                'user_id' => $userId,
                'nanny_id' => $nannyId,
            ]);
        }

        $sender = $data['sender'] ?? 'user';
        $text = trim((string) ($data['message'] ?? ''));
        $attachmentPath = null;
        $attachmentName = null;
        $attachmentMime = null;

        if ($request->hasFile('file')) {
            $file = $request->file('file');
            $attachmentPath = $file?->store('chat-attachments', 'public');
            $attachmentName = $file?->getClientOriginalName();
            $attachmentMime = $file?->getMimeType();
            if ($text === '') {
                $text = $attachmentName ?: 'Attachment';
            }
        }

        if ($text === '' && ! $attachmentPath) {
            return response()->json(['message' => 'Message text or file is required.'], 422);
        }

        $message = ChatMessage::query()->create([
            'conversation_id' => $conversation->id,
            'user_id' => $userId,
            'nanny_id' => $nannyId,
            'sender' => $sender,
            'message' => $text,
            'attachment_path' => $attachmentPath,
            'attachment_name' => $attachmentName,
            'attachment_mime' => $attachmentMime,
            'is_read' => false,
        ]);

        $recipientId = $sender === 'nanny' ? $userId : $nannyId;
        $senderId = $sender === 'nanny' ? $nannyId : $userId;
        $senderName = User::query()->where('user_id', $senderId)->value('name') ?: 'Syttr';

        $notification = NotificationController::createForUser(
            $recipientId,
            'chat_message',
            'New Message',
            $senderName.' sent you a message.',
            [
                'conversation_id' => $conversation->id,
                'user_id' => $userId,
                'nanny_id' => $nannyId,
            ],
            $senderId
        );

        try {
            broadcast(new ChatMessageSent($message))->toOthers();
        } catch (\Throwable $e) {
            // Broadcast should not block chat delivery.
            Log::warning('chat.broadcast.failed', [
                'conversation_id' => $conversation->id,
                'message_id' => $message->id,
                'notification_id' => $notification->id,
                'error' => $e->getMessage(),
            ]);
        }

        return response()->json([
            'success' => true,
            'conversation_id' => $conversation->id,
            'message' => $this->serializeMessage($message),
        ], 201);
    }

    private function resolveUserId(Request $request, mixed $rawUserId): ?string
    {
        if ($rawUserId !== null && $rawUserId !== '') {
            return User::resolvePublicUserIdByIdentifier($rawUserId);
        }

        $bearer = trim((string) $request->bearerToken());
        if ($bearer === '') return null;
        return User::query()->where('api_token', $bearer)->value('user_id');
    }

    private function resolveUserIdFromInput(Request $request, string $key): ?string
    {
        $raw = $request->input($key);
        if ($raw === null || $raw === '') {
            return null;
        }

        return $this->resolveUserId($request, $raw);
    }

    private function serializeMessage(ChatMessage $message): array
    {
        $senderUserId = $message->sender === 'user' ? $message->user_id : null;
        $senderNannyId = $message->sender === 'nanny' ? $message->nanny_id : null;

        return [
            'id' => $message->id,
            'conversation_id' => $message->conversation_id,
            'user_id' => $message->user_id,
            'nanny_id' => $message->nanny_id,
            'sender' => $message->sender,
            'sender_user_id' => $senderUserId,
            'sender_nanny_id' => $senderNannyId,
            'message' => $message->message,
            'is_read' => $message->is_read ? 1 : 0,
            'attachment_url' => $message->attachment_path
                ? asset('storage/'.$message->attachment_path)
                : null,
            'attachment_name' => $message->attachment_name,
            'attachment_mime' => $message->attachment_mime,
            'created_at' => optional($message->created_at)->toISOString(),
            'updated_at' => optional($message->updated_at)->toISOString(),
        ];
    }
}
