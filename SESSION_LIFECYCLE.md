# Session lifecycle and recovery

The running app is React/FastAPI, not Streamlit. These changes apply to its SQLite/PostgreSQL store and browser retry queue; core/db_manager.py and core/global_state.py remain supported legacy helpers. Do not reintroduce Streamlit rerun state as the source of attendance truth.

## Events and delivery

Every API sample requires a UUID event ID scoped to its stable server-issued participant/session ID. Composite database keys make retries idempotent. Captured event timestamps and server receipt timestamps are separate UTC epoch seconds; reports include explicit UTC ISO strings. Server heartbeat times, not client timestamps or upload arrival of old buffers, validate attendance. Delayed duplicate events cannot extend presence.

The frontend commits each derived event to IndexedDB before sending. It flushes immediately, every five seconds, on network recovery, on visibility/pagehide, and before explicit leave. Individual event records and transactional acknowledgements prevent concurrent tabs from overwriting each other's queues. Browser close/crash does not require an unload handler to persist already committed records. Pending legacy sessionStorage/localStorage buffers migrate transactionally before their old keys are removed.

Browser storage can still be cleared, evicted, denied or exhausted; samples that never committed cannot be reconstructed. A browser that never returns cannot transmit its remaining local records. Closing a browser is not proof of absence or low attention. Local queues expire per RETENTION_DAYS, default seven, when the application/database is next opened. No background deletion can run inside a closed browser.

## Identity, reconnects and statuses

A private random client admission ID is retained per room/browser. Concurrent retry requests map through a unique admission table to one issued session ID; display aliases are never identity keys. Two students with identical aliases remain separate. This identifies a browser participant, not a verified person; clearing browser state or changing devices cannot safely be correlated by name.

A separate signed resume ticket restores the same participant ID without using a guessable session ID as authentication. Resume is bounded by room retention and never works for a deleted or completed room. Existing valid student tokens can obtain a resume ticket without discarding historical attendance. Lost/expired credentials require a new authorized admission; historical identities are not guessed or silently merged. Credentials are retained locally with expiry to allow browser-close recovery, which increases exposure to same-origin scripts or a shared computer. Teacher and student storage keys are separate so testing both roles does not overwrite them.

Session statuses are active, stale, left and completed. Five-second heartbeats update a validated interval. A gap over 30 seconds closes the prior interval at the last confirmed heartbeat; reconnection opens another interval on the same participant. A five-second server sweep closes stale sessions after process/browser crashes, including after restart. Explicit leave closes its interval; teacher End Class atomically closes the room and finalizes every participant. Repeating End Class is idempotent. Completed rooms reject admission/resume/new telemetry and cannot be reopened by heartbeat.

Buffered pre-cutoff samples can be submitted through a restricted signed recovery endpoint after closure. Recovery never changes session status or attendance intervals. Samples dated after the cutoff are rejected and counted in the client warning; deleted/expired sessions cannot recover data. Client-supplied capture times are not independent forensic proof, and the API never claims they establish attendance.

## Duration and observation coverage

Duration is the sum of validated, non-overlapping heartbeat intervals, ending at their last confirmed heartbeat. Disconnect gaps and an unconfirmed tail are not credited. Within those intervals, a known scored sample covers at most five seconds, clipped to validated bounds; coverage windows are unioned to avoid double counting. Unknown samples and gaps remain unobserved, distinct from a known score of zero. Mean engagement is the mean of recorded known samples, not a time-weighted estimate of unobserved periods. Missing mean is null/blank, never 100% or a fabricated zero.

Historical rows without heartbeat intervals retain their original timestamps, scores and identities, but their start/end span is labeled historical/unverified rather than invented attendance. New reconnect intervals do not retroactively validate old time. Legacy reports group by stable participant IDs and union intervals; legacy rows receive per-session identifiers rather than being merged by name.

## Database safety and migrations

API Store.migrate is additive and idempotent. It adds status/receipt metadata, interval/admission tables, indexes and a schema migration ledger. Existing rows and old timestamps are retained; no name-based deduplication, destructive rebuild or retroactive interval fabrication occurs. Legacy SQLite adds its own migration ledger and stable-ID/status metadata. Back up production databases, run migrations with one process, then start workers. Use `python -m scripts.migrate_db` for the API database configured by DATABASE_URL.

SQLite enables foreign keys, WAL, FULL synchronization and a busy timeout. Room mutations acquire write locks on SQLite as well as PostgreSQL, serializing admission, heartbeat, closure and deletion. PostgreSQL remains the hosted persistence option. Power loss, host filesystem replacement, backups, storage hardware and provider durability remain operational concerns beyond the application.

The legacy global-state cache returns detached snapshots, uses an RLock, accepts stable participant IDs with optional display aliases, and prunes entries older than one hour. It is process-local and must not be used as a durable or multi-worker attendance ledger.

Tests cover durable queue reopen/failure/concurrent tabs, duplicate events, reconnect gaps, stale-session recovery after store restart, whole-room finalization, late recovery, same-name participants, concurrent admission/writes, UTC reporting and additive migration of old records.

The end-to-end browser regression runs the built React UI against a temporary real API database, simulates network failure and tab closure, verifies durable recovery on reopening with the same participant ID, and confirms the teacher closes every participant. Test data is synthetic. Deployment migrations themselves do not invoke retention cleanup; starting the running API continues the separately configured retention policy.

Validated presence means authenticated browser contact, not proof of physical presence, attention or learning; automated clients can emit heartbeats. Client capture time is estimated against server heartbeat UTC and remains untrusted metadata.
