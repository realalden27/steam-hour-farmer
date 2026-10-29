# Steam Hour Farmer

A lightweight, headless Steam playtime idling client built in TypeScript. Emulate playing games on Steam 24/7 to boost hours on your profile without downloading or installing game files.

Author: Alden (realalden27)

---

## Key Highlights

- Multiple Account Support: Idle games on multiple Steam accounts simultaneously with independent game lists and isolated credentials.
- QR Code Login via Steam Guard: Sign in instantly by scanning a terminal QR code using your official Steam mobile app. No need to store passwords in configuration files.
- Credentials & Two-Factor Authentication: Supports traditional username and password logins with optional Steam TOTP shared secrets for fully automated 2FA code generation.
- Smart Session Management: Automatically detects when you start playing a game on your main gaming PC and pauses farming immediately to prevent conflict. Farming resumes automatically as soon as you exit the game.
- Zero Installation Required: Games only need to be in your Steam library. You do not need to download or install the games on your computer or server.
- Session Persistence: Securely saves OAuth refresh tokens to disk upon approval. Future launches reconnect automatically without requiring repeated logins or 2FA prompts.
- Fault Tolerant Reconnection: Handles weekly Steam Tuesday maintenance, rate limits, and network drops with exponential backoff retries rather than crashing.
- Custom Games & App IDs: Farm official Steam games by App ID (e.g. 730, 440, 1623730) or display custom non-Steam titles. Supports up to 32 simultaneous titles per account.
- VPS & Docker Ready: Minimal memory footprint. Includes a multi-stage Dockerfile and Docker Compose configuration for 24/7 server deployments.

---

## Quick Start

### 1. Requirements

- Node.js version 20.0.0 or higher
- One or more Steam accounts

### 2. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/realalden27/steam-hour-farmer.git
cd steam-hour-farmer
npm install
```

### 3. Quick Run with QR Code (Recommended)

Create a `.env` file in the project root with the games you want to idle:

```sh
GAMES="440,730"
```

Start the application:

```bash
npm run dev
```

A QR code will display directly in your terminal:
1. Open the Steam app on your phone.
2. Tap the Steam Guard tab.
3. Scan the terminal QR code and tap "Approve".
4. The application will authenticate, save your refresh token, and immediately begin farming.

---

## Configuration Methods

You can configure Steam Hour Farmer using either `config.json` (for multiple accounts) or `.env` (for a single account).

### Method A: Multi-Account Mode (config.json)

For running multiple accounts at the same time, create a `config.json` file in the project root:

```json
{
  "accounts": [
    {
      "name": "Main Account",
      "games": [730, 440, 570],
      "persona": 1,
      "loginMethod": "qr"
    },
    {
      "name": "Alt Account",
      "accountName": "alt_steam_username",
      "password": "alt_steam_password",
      "sharedSecret": "optional_shared_secret",
      "games": [730, "Custom Game Title"],
      "persona": 1,
      "loginMethod": "credentials"
    }
  ],
  "settings": {
    "logOnIntervalMs": 600000,
    "refreshGamesIntervalMs": 300000,
    "minRequestGapMs": 60000,
    "dataDirectory": "data"
  }
}
```

#### Account Fields:
- `name`: Display label for logging and identification.
- `games`: Array of numerical App IDs or string titles (maximum 32 per account).
- `loginMethod`: Either `"qr"` (scan with Steam mobile app) or `"credentials"`.
- `accountName`: Steam login username (required if `loginMethod` is `"credentials"`).
- `password`: Steam account password (required if `loginMethod` is `"credentials"`).
- `sharedSecret`: Steam TOTP shared secret for automatic 2FA (optional).
- `persona`: Steam presence state: `1` = Online (default), `2` = Busy, `3` = Away, `4` = Snooze, `7` = Invisible.
- `enabled`: Set to `false` to temporarily skip an account without deleting it.

---

### Method B: Single Account Mode (.env)

For a single account, create a `.env` file in the project root.

#### Passwordless QR Login:
```sh
GAMES="440,730"
```

#### Automated Credentials Login:
```sh
ACCOUNT_NAME="your_steam_username"
PASSWORD="your_steam_password"
GAMES="440,730"
PERSONA=1
SHARED_SECRET="your_shared_secret"
```

---

## Finding Steam App IDs

To find the numerical App ID of any game:
1. In the Steam desktop client, right-click the game in your library and select Properties.
2. The App ID is listed under the Updates tab.
3. Alternatively, search the game on the Steam Store website. The URL format is `https://store.steampowered.com/app/<APP_ID>/<GAME_NAME>/`.

---

## How to Run

### Development Mode

Runs with live file watching (runtime state folders excluded from watch loops):

```bash
npm run dev
```

### Production Build

Compile TypeScript to JavaScript and run the optimized build:

```bash
npm run build
npm start
```

### Running in the Background (PM2)

To keep the application running 24/7 on a server:

```bash
npm install -g pm2
npm run build
pm2 start dist/index.js --name "steam-hour-farmer"
pm2 save
pm2 startup
```

---

## Docker Deployment

A lightweight multi-stage Docker container is included for containerized deployments.

### Using Docker Compose

```bash
docker compose up --build -d
```

View live container logs:

```bash
docker compose logs -f
```

Persistent session data and refresh tokens are stored in the `./data` directory on the host machine.

---

## Troubleshooting

### Game does not show on profile or friends list
1. Profile Privacy: Go to your Steam Profile -> Edit Profile -> Privacy Settings. Set "Game details" to "Public". If set to "Friends Only" or "Private", your active game will not be visible to third parties.
2. Account Ownership: Paid games (e.g. AnyGameName / App ID 1623730) must be owned by the Steam account to track hours and show in-game. For games not owned by the account, you can pass custom titles as text strings: `GAMES="AnyGameName"`.
3. Persona Status: Ensure `PERSONA` is set to `1` (Online). Offline accounts do not broadcast active games.

### Steam Guard Prompted on Every Start
If you log in using credentials without a `SHARED_SECRET`, Steam may require a fresh Guard code. Use the QR code login method instead (`loginMethod: "qr"` or omit credentials in `.env`) to generate a durable refresh token that persists across reboots.

---

## Testing

Run the test suite using Vitest:

```bash
npm test
```

---

## License

This project is licensed under the MIT License.
