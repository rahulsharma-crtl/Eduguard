# Remediation and Streamlit removal

The app now runs on React/Vite + FastAPI + PeerJS, with PostgreSQL for hosted persistence. The old Streamlit runtime, Python UI wrappers, component protocol, and setup scripts have been removed. See [README.md](README.md) for setup, limits, and deployment.

| Request | Current implementation |
| --- | --- |
| BUG-02 | Audio-muting state is separate from visual engagement. No mute substring evasion classifier in the new API. |
| BUG-03 | API room/session state is transactional database state; legacy shared-state helper remains locked for its regressions. |
| BUG-14/15 | API schema indexes room sessions and sample keys; SQLAlchemy contexts close connections. Legacy SQLite manager also has index and connection fixes. |
| BUG-04 | Browser session-storage outbox and idempotent API inserts; failed requests retain samples for retry; timestamps and full-session averages persist. Unsent data cannot be recovered after permanent tab closure. |
| BUG-05 | Canvas/signaling readiness guard retained and tested. |
| BUG-07/08 | Media-aware watchdog, completed ICE support, and original display names in call metadata. |
| BUG-10 | Password has no default; server-side constant-time validation, rate limiting, signed role/room tokens. |
| BUG-11 | Join screen and student panel disclose live audio and derived metrics. |
| BUG-18 | Private signaling server/configuration; pinned CDN scripts with SRI and version-pinned dynamic assets. Live service deployment still needed. |
| Roll | HEAD_TILT label without automatic engagement penalty. |
| Calibration | Neutral-pose camera calibration button using 30 valid frames. |
| Build | esbuild generates browser engagement and roster modules; drift checks in CI. |
| Dataset | Local real-video extractor and benchmark runner ready; real labeled dataset/validation remains unavailable. |

Remaining external work: provision the Vercel/Render services and set their actual addresses; test media between real devices; supply consented labeled videos; choose ongoing database retention beyond the Render free database's 30-day expiry.
