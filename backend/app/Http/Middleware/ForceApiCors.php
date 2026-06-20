<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ForceApiCors
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if (! $request->is('api/*')) {
            return $response;
        }

        $origin = trim((string) $request->headers->get('Origin', '*'));
        if ($origin === '') {
            $origin = '*';
        }

        $response->headers->set('Vary', 'Origin', false);
        $response->headers->set('Access-Control-Allow-Origin', $origin);
        $response->headers->set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        $response->headers->set(
            'Access-Control-Allow-Headers',
            'Origin, Content-Type, Accept, Authorization, X-Requested-With, X-API-KEY, x-api-key, nanny-id, nanny_id'
        );
        $response->headers->set('Access-Control-Max-Age', '86400');

        return $response;
    }
}
