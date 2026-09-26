export default {
  BOT_TOKEN: process.env.BOT_TOKEN || "",
  OWNER_IDS: (process.env.OWNER_IDS || "").split(",").map(id => id.trim()).filter(Boolean),
  MONGO_URI: process.env.MONGO_URI || ""
};
