# Storage to S3

Status: planned (next after data export)

- The `FileStore` interface is already merged, with a local-disk adapter: `put(key, stream)` and `signedUrl(key, ttl)`. Every feature that writes files writes through it, never to the disk or to S3 directly.
- This task builds the S3 adapter and the bucket setup, then switches `FileStore` to S3. Callers do not change.
