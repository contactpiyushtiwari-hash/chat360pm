/**
 * Cloudflare Pages Function: forwards /api/* to the API Worker through a service binding.
 * Keeping the API on the same origin as the app lets session cookies stay SameSite=Strict and
 * removes the need for CORS (ADR-002).
 */
interface Env {
  API: Fetcher;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.API) {
    return Response.json(
      { error: { code: 'api_unavailable', message: 'The API service binding is not configured.' } },
      { status: 503 },
    );
  }
  return env.API.fetch(request);
};
