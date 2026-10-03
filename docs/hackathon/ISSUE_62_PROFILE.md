# Profile redesign — issue #62

The Profile tab now groups personal information, security, browser appearance preferences and the current signed-in session. Account metadata and access details remain available in compact disclosures. The account menu opens the Profile tab even when the dashboard is already mounted.

Personal information saves refresh the session in the background so the form and feedback stay visible. Password changes require matching confirmation and clear sensitive fields after success. Read-only accounts cannot edit personal information or passwords. Appearance uses the existing persisted browser theme preference. Sessions shows the actual current session and signs it out; it does not claim to list other devices.

Photos accept PNG, JPEG and WebP files up to 5 MB in the browser. The browser crops and resizes them to a 256-pixel square PNG before upload. The API checks canonical base64, a 256 KiB limit, PNG structure and checksums, bounded dimensions and decompression, static RGB/RGBA scanlines, and removes ancillary metadata. Images remain private in the configured StorageService bucket under a server-owned user key. Photo metadata and image reads require profile read permission; mutations require profile update permission. Reading another account's image is denied except for ROOT. Storage failures return sanitized, correlated errors. No database or dependency changes are required.

Automated coverage includes form updates and errors, confirmation and password clearing, read-only controls, preferences, logout, background session refresh, account-menu navigation, client image preparation, user-scoped cache updates, avatar feedback, API validation, authentication, ownership, explicit deny, account status, storage failures and OpenAPI contracts.

Browser visual acceptance remains pending because the desktop browser approval review rejected localhost inspection with “protocol not allowed.” Full repository verification and production build results are recorded in the pull request.
