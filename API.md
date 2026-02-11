# Storage Tech Bot API

Base URL (production):

`https://botapi.llamamc.org`

All endpoints require bearer auth.

## Authentication

Send this header on every request:

`Authorization: Bearer <token>`

Token creation and management is done in Discord with `/token`:

- `/token get [label]` creates a token
- `/token list` lists tokens (SysAdmin only)
- `/token revoke tokenid` revokes a token (SysAdmin only)
- `/token delete tokenid` deletes a token (SysAdmin only)

If auth is missing/invalid/revoked, API returns `401`:

```json
{
  "ok": false,
  "error": "Unauthorized"
}
```

## Endpoints

### GET `/healthz`
Also available as `/health` and `/ping`.

Response:

```json
{
  "ok": true,
  "service": "storage-tech-bot-api",
  "timestamp": "2026-02-11T00:00:00.000Z"
}
```

### GET `/servers`

Returns guilds currently loaded by the bot.

Response:

```json
{
  "ok": true,
  "servers": [
    {
      "id": "123456789012345678",
      "name": "Example Server"
    }
  ]
}
```

### GET `/server/:serverId/submissions`

Returns paginated submissions for a server.

Query params:

- `page` integer, default `1`, min `1`
- `pageSize` integer, default `50`, min `1`, max `200`

Sort order:

- Sorted by submission snowflake ID descending (newest first)

Response:

```json
{
  "ok": true,
  "server": {
    "id": "123456789012345678",
    "name": "Example Server"
  },
  "submissions": [
    {
      "id": "234567890123456789",
      "name": "My submission",
      "status": "waiting",
      "threadId": "234567890123456789",
      "threadUrl": "https://discord.com/channels/...",
      "timestamp": {
        "createdMs": 1739330000000,
        "createdISO": "2025-02-12T00:00:00.000Z",
        "updatedMs": 1739400000000,
        "updatedISO": "2025-02-12T19:26:40.000Z"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "total": 123,
    "totalPages": 3,
    "hasNext": true,
    "hasPrevious": false
  }
}
```

### GET `/server/:serverId/submission/:submissionId`

Returns full details for one submission.

Response:

```json
{
  "ok": true,
  "server": {
    "id": "123456789012345678",
    "name": "Example Server"
  },
  "submission": {
    "id": "234567890123456789",
    "name": "My submission",
    "status": "waiting",
    "threadId": "234567890123456789",
    "threadUrl": "https://discord.com/channels/...",
    "archiveChannelId": "345678901234567890",
    "isLocked": false,
    "lockReason": "",
    "onHold": false,
    "holdReason": "",
    "rejectionReason": "",
    "retractionReason": "",
    "tags": [],
    "authors": [],
    "endorsers": [],
    "images": [],
    "attachments": [],
    "timestamp": {
      "createdMs": 1739330000000,
      "createdISO": "2025-02-12T00:00:00.000Z",
      "updatedMs": 1739400000000,
      "updatedISO": "2025-02-12T19:26:40.000Z"
    }
  }
}
```

### GET `/server/:serverId/submission/:submissionId/attachments/:attachmentId`

Returns attachment content.

Behavior:

- If file is locally available, streams the file (`200`)
- Otherwise, redirects (`302`) to upstream URL when available
- Returns `404` if attachment or content is unavailable

### GET `/server/:serverId/submission/:submissionId/images/:imageId`

Returns image content.

Behavior:

- If file is locally available, streams the file (`200`)
- Otherwise, redirects (`302`) to upstream URL when available
- Returns `404` if image or content is unavailable

## Common error responses

`404`:

```json
{
  "ok": false,
  "error": "Not Found"
}
```

Server-specific missing resource examples:

- `Server not found: <id>`
- `Submission not found: <id>`
- `Attachment not found: <id>`
- `Image not found: <id>`

`500`:

```json
{
  "ok": false,
  "error": "Internal Server Error"
}
```

## Curl examples

```bash
TOKEN='paste_token_here'
BASE='https://botapi.llamamc.org'

# health
curl -i -H "Authorization: Bearer $TOKEN" "$BASE/healthz"

# servers
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/servers" | jq

# submissions page 1
SERVER_ID='123456789012345678'
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/server/$SERVER_ID/submissions?page=1&pageSize=25" | jq

# one submission
SUBMISSION_ID='234567890123456789'
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/server/$SERVER_ID/submission/$SUBMISSION_ID" | jq

# attachment download
ATTACHMENT_ID='345678901234567890'
curl -L -H "Authorization: Bearer $TOKEN" \
  "$BASE/server/$SERVER_ID/submission/$SUBMISSION_ID/attachments/$ATTACHMENT_ID" \
  -o attachment.bin

# image download
IMAGE_ID='456789012345678901'
curl -L -H "Authorization: Bearer $TOKEN" \
  "$BASE/server/$SERVER_ID/submission/$SUBMISSION_ID/images/$IMAGE_ID" \
  -o image.bin
```
