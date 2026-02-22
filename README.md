# walter-openclaw

[![npm version](https://img.shields.io/npm/v/walter-openclaw.svg)](https://www.npmjs.com/package/walter-openclaw)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

[OpenClaw](https://openclaw.ai) plugin for [Walter](https://walterops.com) — AI-powered infrastructure management.

Walter is an AI agent that connects to your servers, cloud accounts, and databases. He runs real commands, reads real logs, and explores real systems to answer your questions. This plugin lets you talk to Walter directly from OpenClaw.

## Quick Start

```bash
openclaw plugins install walter-openclaw
```

Add your API token to `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "walter": {
        "config": {
          "token": "your-api-token"
        }
      }
    }
  }
}
```

Get your token from your [walterops.com](https://walterops.com) account settings.

That's it. Start a conversation:

```
> Ask Walter to check disk usage across the production servers

Walter is exploring your systems...

All three production servers look healthy:
- prod-1: 42% used (118GB free)
- prod-2: 67% used (52GB free)  
- prod-3: 38% used (134GB free)

prod-2 is the fullest — most of it is old log files in /var/log/app/.
Want me to look at setting up log rotation?
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `token` | yes | Your Walter API token |
| `url` | no | Walter instance URL. Defaults to `https://walterops.com`. Only needed for self-hosted deployments. |

## Tools

### `walter_chat`

The main tool. Send a message and get a complete response. Walter streams partial results as he works (typically 10–60 seconds — he's running real commands on live systems).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `message` | yes | What you want Walter to investigate or do |
| `chat_id` | no | Continue an existing conversation |

Omit `chat_id` to start fresh. Pass one to continue where you left off (use `walter_list_chats` to find previous conversations).

### `walter_cancel`

Interrupt Walter mid-task. The conversation stays open — send a new message to redirect him.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `chat_id` | yes | Chat session to cancel |

### `walter_list_chats`

List your existing conversations. No parameters.

### `walter_list_turfs`

See what systems Walter has access to and whether they're online. No parameters.

### `walter_search_turfs`

Filter connected systems. At least one filter required.

| Parameter | Description |
|-----------|-------------|
| `name` | Partial name match (case-insensitive) |
| `type` | `server`, `aws`, or `gcp` |
| `os` | `linux`, `darwin`, or `windows` |
| `status` | `online` or `offline` |

## Contributing

```bash
git clone https://github.com/matchylabs/Walter.git
cd Walter/walter-openclaw-plugin
npm install
npm run build    # compile TypeScript
npm run dev      # watch mode
```

## License

MIT
