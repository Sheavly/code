# Export project: what failed, and what is next

Tried: retrying the upload with backoff, five times. It failed every time with error code E-4471,
because the server rate-limits per IP address. Do not retry the upload again.

Next step: ask Marta to confirm that the CSV delimiter is a semicolon, then write the exporter.
