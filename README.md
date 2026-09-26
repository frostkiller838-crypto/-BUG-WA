# 𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆 - Fixed Package

Fixes applied:
- Removed anti-debug / false process-exit hooks that could crash the bot.
- MongoDB is now optional; it no longer terminates startup when no URI is configured.
- BOT_TOKEN is read from the environment instead of shipping a fake placeholder.
- Added a clear startup error when BOT_TOKEN is missing.
- Disabled target-disruption `bxt-*` commands.
- Removed the duplicate `/pullupdate` handler.
- Preserved the existing JSON database files.

Setup:
1. Set `BOT_TOKEN` to your Telegram bot token.
2. Optional: set `MONGO_URI` for MongoDB features.
3. Optional: set `OWNER_IDS` as comma-separated Telegram user IDs.
4. Run `npm install`.
5. Run `npm start`.

Node.js 18+ is required.
