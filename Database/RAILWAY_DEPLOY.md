# Railway deployment — 𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆

## 1. Upload to GitHub
Create a private GitHub repository and upload this folder.

## 2. Deploy on Railway
Choose **New Project → Deploy from GitHub Repo** and select the repository.

Railway will use `railway.json` and start the bot with:

```bash
npm start
```

## 3. Add Variables
In Railway → Variables, add:

```text
BOT_TOKEN=YOUR_NEW_TELEGRAM_BOT_TOKEN
OWNER_IDS=YOUR_TELEGRAM_USER_ID
```

`MONGO_URI` is optional if you want to use MongoDB.

## Important security note
Do not commit a real Telegram bot token to GitHub. The token should be supplied only through Railway Variables. If an old token was ever exposed, revoke it with BotFather and generate a new one.
