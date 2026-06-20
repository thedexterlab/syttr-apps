<?php

namespace App\Events;

use App\Models\ChatConversation;
use App\Models\ChatMessage;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class ChatMessageSent implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public ChatMessage $message)
    {
    }

    public function broadcastOn(): array
    {
        $conversationIds = ChatConversation::query()
            ->where('user_id', $this->message->user_id)
            ->where('nanny_id', $this->message->nanny_id)
            ->pluck('id')
            ->map(static fn ($id) => (int) $id)
            ->filter(static fn (int $id) => $id > 0)
            ->unique()
            ->values();

        if ($conversationIds->isEmpty()) {
            $conversationIds = collect([(int) $this->message->conversation_id]);
        }

        return $conversationIds
            ->map(static fn (int $id) => new Channel('chat.'.$id))
            ->all();
    }

    public function broadcastAs(): string
    {
        return 'chat.message.sent';
    }

    public function broadcastWith(): array
    {
        $senderUserId = $this->message->sender === 'user' ? $this->message->user_id : null;
        $senderNannyId = $this->message->sender === 'nanny' ? $this->message->nanny_id : null;

        return [
            'chat' => [
                'id' => $this->message->id,
                'conversation_id' => $this->message->conversation_id,
                'user_id' => $this->message->user_id,
                'nanny_id' => $this->message->nanny_id,
                'sender' => $this->message->sender,
                'sender_user_id' => $senderUserId,
                'sender_nanny_id' => $senderNannyId,
                'message' => $this->message->message,
                'attachment_url' => $this->message->attachment_path
                    ? asset('storage/'.$this->message->attachment_path)
                    : null,
                'attachment_name' => $this->message->attachment_name,
                'attachment_mime' => $this->message->attachment_mime,
                'created_at' => optional($this->message->created_at)->toISOString(),
                'updated_at' => optional($this->message->updated_at)->toISOString(),
            ],
        ];
    }
}
