# Gateway

The gateway ends TLS, checks the API key and the rate limit, and sends the request on to the ledger.

Rate limit: 300 requests per minute per merchant. A merchant over the limit gets HTTP 429.
