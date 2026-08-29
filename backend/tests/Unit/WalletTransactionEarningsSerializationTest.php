<?php

namespace Tests\Unit;

use App\Http\Controllers\WalletController;
use App\Models\ParentJob;
use App\Models\WalletTransaction;
use Carbon\Carbon;
use PHPUnit\Framework\Attributes\Test;
use ReflectionMethod;
use Tests\TestCase;

class WalletTransactionEarningsSerializationTest extends TestCase
{
    #[Test]
    public function job_payout_uses_net_credit_date_and_central_timezone_for_dashboard_earnings(): void
    {
        $job = new ParentJob([
            'price' => 50,
            'start_date' => '2026-06-26',
            'timezone' => 'America/Chicago',
        ]);

        $transaction = new WalletTransaction([
            'type' => 'job_payout',
            'direction' => 'credit',
            'amount' => 48.25,
            'meta' => [
                'gross_amount' => 50,
                'net_amount' => 48.25,
            ],
        ]);
        $transaction->created_at = Carbon::parse('2026-06-27T02:37:56Z');
        $transaction->setRelation('job', $job);

        $serialize = new ReflectionMethod(WalletController::class, 'serialize');
        $payload = $serialize->invoke(new WalletController, $transaction);

        $this->assertSame(48.25, $payload['earning_amount']);
        $this->assertSame('2026-06-26', $payload['earning_date']);
        $this->assertSame('America/Chicago', $payload['earning_timezone']);
        $this->assertSame(48.25, $payload['amount']);
        $this->assertSame('2026-06-27T02:37:56.000000Z', $payload['created_at']);
    }
}
