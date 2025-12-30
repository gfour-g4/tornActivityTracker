# Torn Activity Bot

A Discord bot that tracks member activity for Torn.com factions and generates visual heatmaps.

## Features

- **Activity Tracking**: Polls faction data every 15 minutes and records member activity
- **Heatmaps**: Generates visual heatmaps showing activity patterns
- **Granularity Options**: View data hourly or in 15-minute intervals
- **Day Filtering**: Filter by weekdays, weekends, or specific days
- **Faction Comparison**: Compare activity patterns between factions
- **User Activity**: Track individual member activity patterns
- **Multi-API Key Support**: Round-robin through multiple API keys to avoid rate limits

## Prerequisites

- Node.js 18.0.0 or higher
- A Discord bot token
- Torn API key(s)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/torn-activity-bot.git
cd torn-activity-bot
````

2. Install dependencies:

```bash
npm install
```

3. Create your environment file:

```bash
cp .env.example .env
```

4. Edit `.env` and add your Discord credentials:

```env
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
```

5. Start the bot:

```bash
npm start
```

## Commands

### Activity Commands

#### `/activity faction`

Generate a heatmap for a faction's activity.

| Option        | Type    | Required | Description                                                                         |
| ------------- | ------- | -------- | ----------------------------------------------------------------------------------- |
| `id`          | Integer | Yes      | Faction ID                                                                          |
| `granularity` | String  | No       | `hourly` (default) or `15min`                                                       |
| `days`        | String  | No       | `all` (default), `weekday`, `weekend`, or comma-separated days (e.g. `mon,tue,wed`) |

Example:

```
/activity faction id:47878 granularity:hourly days:weekend
```

#### `/activity user`

Generate a heatmap for a specific user's activity.

| Option        | Type    | Required | Description                                                    |
| ------------- | ------- | -------- | -------------------------------------------------------------- |
| `id`          | Integer | Yes      | User ID                                                        |
| `granularity` | String  | No       | `hourly` (default) or `15min`                                  |
| `days`        | String  | No       | `all` (default), `weekday`, `weekend`, or comma-separated days |

Example:

```
/activity user id:2393235 granularity:15min days:all
```

#### `/activity compare`

Compare activity between two factions with side-by-side and difference heatmaps.

| Option        | Type    | Required | Description                                                    |
| ------------- | ------- | -------- | -------------------------------------------------------------- |
| `faction1`    | Integer | Yes      | First faction ID                                               |
| `faction2`    | Integer | Yes      | Second faction ID                                              |
| `granularity` | String  | No       | `hourly` (default) or `15min`                                  |
| `days`        | String  | No       | `all` (default), `weekday`, `weekend`, or comma-separated days |

Example:

```
/activity compare faction1:47878 faction2:36274 days:weekday
```

### Configuration Commands

#### `/config add`

Add factions or API keys to track.

| Option     | Type   | Required | Description                 |
| ---------- | ------ | -------- | --------------------------- |
| `factions` | String | No       | Comma-separated faction IDs |
| `apikeys`  | String | No       | Comma-separated API keys    |

Example:

```
/config add factions:47878,36274 apikeys:abc123,def456
```

#### `/config remove`

Remove a faction or API key.

| Option    | Type    | Required | Description          |
| --------- | ------- | -------- | -------------------- |
| `faction` | Integer | No       | Faction ID to remove |
| `apikey`  | String  | No       | API key to remove    |

Example:

```
/config remove faction:47878
```

#### `/config list`

Show current configuration, including factions tracked and number of API keys.

## How Activity Is Calculated

A member is considered active if their `last_action.timestamp` is within 15 minutes of when the API was polled.

### Faction Heatmaps

Shows the average number of active members at each time slot over the past 30 days.

### User Heatmaps

Shows how many weeks (out of approximately 4) the user was active at each time slot.

### Heatmap Color Scale

* 🟥 Red: Low activity
* 🟨 Yellow: Medium activity
* 🟩 Green: High activity

## Data Storage

* Data is stored in JSON files in the `data/` directory
* Each faction has its own file: `data/faction_XXXXX.json`
* Data is automatically pruned after 30 days
* Only active member IDs are stored to keep file sizes small

## API Rate Limiting

The bot rotates through all configured API keys to avoid hitting rate limits. Torn allows approximately 100 requests per minute per key.

Recommended: Add at least 2 to 3 API keys if tracking more than 5 factions.

## Time Zone

All times are displayed in TCT (Torn City Time), which is equivalent to UTC.

## Troubleshooting

### "No data available"

The bot needs to collect data before it can generate heatmaps. Wait at least a few hours after adding a faction.

### Canvas installation issues

On some systems, you may need to install additional dependencies for the `canvas` package.

**Ubuntu/Debian:**

```bash
sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

**macOS:**

```bash
brew install pkg-config cairo pango libpng jpeg giflib librsvg
```

### Bot not responding

* Check that `DISCORD_TOKEN` is correct in `.env`
* Ensure the bot has been invited to your server with proper permissions
* Check the console for error messages

## License

MIT

```

