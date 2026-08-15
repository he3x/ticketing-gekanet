import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import fs from "fs";
import multer from "multer";
import { createRequire } from "module";
// ─── API v1 (JWT + PostgreSQL) ─────────────────────────────────────────────────
import apiV1 from "./api/v1/index.js";
// @ts-ignore
import { setWAClient } from "./services/wa-notify.js";
const _require = createRequire(import.meta.url);
const { Client, LocalAuth } = _require("whatsapp-web.js");
import qrcode from "qrcode";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Simple JSON Database
const DB_FILE = path.join(process.cwd(), "db.json");
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

const initialData = {
  users: [
    { id: "1", username: "admin", password: "password", role: "admin", name: "Admin User" },
    { id: "2", username: "tech1", password: "password", role: "technician", name: "Budi Technician" },
    { id: "3", username: "tech2", password: "password", role: "technician", name: "Andi Technician" },
    { id: "4", username: "vendor1", password: "password", role: "vendor", name: "Vendor Lapangan" },
    { id: "5", username: "pengawas", password: "password", role: "supervisor", name: "Siti Pengawas" },
    { id: "6", username: "superuser", password: "password", role: "superuser", name: "Super User" },
    { id: "7", username: "superadmin", password: "password", role: "superuser", name: "Super Admin" },
  ],
  tickets: [],
  nextDisplayId: 1, // Counter for human-readable ticket IDs
  settings: {
    whatsappGroup: "",
    templateInstallation: "Tiket Pemasangan Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nPaket: {detail}\nTeknisi: {technician}{location}{link}",
    templateMaintenance: "Tiket Maintenance Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nKendala: {detail}\nTeknisi: {technician}{location}{link}",
    templateDismantle: "Tiket Dismantle Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nAlasan: {detail}\nTeknisi: {technician}{location}{link}",
    templateClosed: "Tiket {id} Selesai!\nPelanggan: {customerName}\nStatus: Selesai\nTeknisi: {technician}\nLaporan: {report}{location}{link}",
    mediaRetentionDays: 60,
  },
  logs: []
};

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
}

function getDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function saveDB(data: any) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function addLog(action: string, user: string, details: string) {
  const db = getDB();
  if (!db.logs) db.logs = [];
  db.logs.unshift({
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    action,
    user,
    details
  });
  // Keep only last 500 logs
  if (db.logs.length > 500) db.logs = db.logs.slice(0, 500);
  saveDB(db);
}

// ─── WhatsApp Service (whatsapp-web.js) ────────────────────────────────────────
type WAStatus = "INITIALIZING" | "QR_READY" | "CONNECTED" | "DISCONNECTED";

let waStatus: WAStatus = "INITIALIZING";
let waQrDataUrl: string | null = null;
let waInfo: { pushname?: string; wid?: string } = {};
let waGroupsCache: { id: string; name: string; participants: number }[] = [];
let waGroupsCachedAt: number = 0;

const waClient = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(process.cwd(), ".wwebjs_auth") }),
  webVersionCache: {
    type: 'none',  // Always fetch fresh WA Web version – fixes r:r / getChats errors
  },
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu"
    ]
  }
});

waClient.on("qr", async (qr: string) => {
  console.log("[WhatsApp] QR Code received – scan to connect.");
  waStatus = "QR_READY";
  try {
    waQrDataUrl = await qrcode.toDataURL(qr);
  } catch (err: unknown) {
    console.error("[WhatsApp] Failed to generate QR data URL:", err);
    waQrDataUrl = null;
  }
});

waClient.on("authenticated", () => {
  console.log("[WhatsApp] Authenticated.");
});

waClient.on("ready", () => {
  console.log("[WhatsApp] Client ready and connected!");
  waStatus = "CONNECTED";
  waQrDataUrl = null;
  const info = (waClient as any).info;
  if (info) {
    waInfo = {
      pushname: info.pushname,
      wid: info.wid?.user
    };
  }
  // Register client with the shared notification service
  setWAClient(waClient);
  addLog("WA_CONNECTED", "System", `WhatsApp connected as ${waInfo.pushname || waInfo.wid || "unknown"}`);
  // Pre-cache groups via direct Store access (avoids r:r from getChats)
  setTimeout(async () => {
    try {
      const groups = await getGroupsDirect();
      if (groups.length > 0) {
        waGroupsCache = groups;
        waGroupsCachedAt = Date.now();
        console.log(`[WhatsApp] Pre-cached ${waGroupsCache.length} groups via Store.`);
      } else {
        console.log("[WhatsApp] Store returned 0 groups on ready (may still be loading).");
      }
    } catch (err: unknown) {
      console.error("[WhatsApp] Failed to pre-cache groups via Store:", String(err));
    }
  }, 5000);
});

waClient.on("disconnected", (reason: string) => {
  console.log("[WhatsApp] Client disconnected:", reason);
  waStatus = "DISCONNECTED";
  waQrDataUrl = null;
  waInfo = {};
  waGroupsCache = [];
  waGroupsCachedAt = 0;
  // Clear the shared notification service reference
  setWAClient(null);
  addLog("WA_DISCONNECTED", "System", `WhatsApp disconnected: ${reason}`);
  // Auto-reinitialize after 10 seconds
  setTimeout(() => {
    waStatus = "INITIALIZING";
    waClient.initialize().catch(console.error);
  }, 10000);
});

waClient.on("auth_failure", (msg: string) => {
  console.error("[WhatsApp] Authentication failure:", msg);
  waStatus = "DISCONNECTED";
  waQrDataUrl = null;
});

// Send message via whatsapp-web.js
async function sendWhatsApp(to: string, message: string) {
  if (waStatus !== "CONNECTED") {
    console.log(`[WhatsApp] Skip send – not connected (status: ${waStatus}). Target: ${to}`);
    return;
  }
  try {
    // to can be phone number (e.g. "628xx") or group id (e.g. "120363xxx@g.us")
    const chatId = to.includes("@") ? to : `${to}@c.us`;
    console.log(`[WhatsApp] Sending message to chatId: ${chatId}`);

    // Send directly — getChatById pre-check causes r:r errors on some WA Web versions
    await waClient.sendMessage(chatId, message);
    console.log(`[WhatsApp] Message sent successfully to ${chatId}`);
    addLog("WA_SENT", "System", `Message sent to ${chatId}`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[WhatsApp] Send error for", to, ":", errMsg);
    addLog("WA_SEND_ERROR", "System", `Send failed to ${to}: ${errMsg}`);
  }
}

// Initialize WA client
console.log("[WhatsApp] Initializing client...");
waClient.initialize().catch((err: unknown) => {
  console.error("[WhatsApp] Initialization error:", err);
  waStatus = "DISCONNECTED";
});

// ─── Message Template Helper ───────────────────────────────────────────────────
function formatMessage(template: string, ticket: any, db: any, origin?: string) {
  const typeLabel = ticket.type === "maintenance" ? "Maintenance" : ticket.type === "dismantle" ? "Dismantle / Pelepasan" : "Pemasangan Baru";
  const detailLabel = ticket.type === "maintenance" ? `Kendala: ${ticket.issue}` : ticket.type === "dismantle" ? `Alasan: ${ticket.issue}` : `Paket: ${ticket.package}`;
  const locationMsg = ticket.locationUrl ? `\nLokasi: ${ticket.locationUrl}` : "";
  
  // Use displayId for both display and link so they match
  const displayId = ticket.displayId || ticket.id;
  const ticketLink = origin ? `\nLink Tiket: ${origin}/?ticketId=${displayId}` : "";
  
  // Resolve technician names
  let techNames = "";
  if (ticket.technicianId) {
    const mainTech = db.users.find((u: any) => u.id === ticket.technicianId);
    if (mainTech) techNames = mainTech.name;
  }
  if (ticket.assignedTechnicianIds && ticket.assignedTechnicianIds.length > 0) {
    const otherTechs = db.users
      .filter((u: any) => ticket.assignedTechnicianIds.includes(u.id))
      .map((u: any) => u.name);
    if (techNames) {
      techNames = `${techNames}, ${otherTechs.join(", ")}`;
    } else {
      techNames = otherTechs.join(", ");
    }
  }

  // Format media links
  let mediaLinks = "";
  if (ticket.attachments && ticket.attachments.length > 0) {
    mediaLinks = ticket.attachments.map((a: any) => a.url).join("\n");
  } else if (ticket.mediaUrl) {
    mediaLinks = ticket.mediaUrl;
  } else {
    const singleLinks = [ticket.attachmentUrl, ticket.reportAttachmentUrl].filter(Boolean);
    if (singleLinks.length > 0) {
      mediaLinks = singleLinks.join("\n");
    }
  }

  return template
    .replace(/{type}/g, typeLabel)
    .replace(/{id}/g, String(displayId))
    .replace(/{customerName}/g, ticket.customerName || "")
    .replace(/{address}/g, ticket.address || "")
    .replace(/{detail}/g, detailLabel)
    .replace(/{location}/g, locationMsg)
    .replace(/{report}/g, ticket.report || "")
    .replace(/{notes}/g, ticket.technicianNotes || "")
    .replace(/{phone}/g, ticket.phone || "")
    .replace(/{technician}/g, techNames)
    .replace(/{media}/g, mediaLinks)
    .replace(/{link}/g, ticketLink);
}

// ─── File Upload ───────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }
  res.json({ 
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname 
  });
});

app.use("/uploads", express.static(UPLOADS_DIR));

// ─── URL Resolver Helper ───────────────────────────────────────────────────────
async function resolveUrl(url: string): Promise<string> {
  if (!url) return url;
  
  const isShortened = 
    url.includes("goo.gl") || 
    url.includes("maps.app.goo.gl") || 
    url.includes("bit.ly") || 
    url.includes("t.co") || 
    url.includes("tinyurl.com");

  if (!isShortened) return url;

  try {
    const response = await axios.get(url, {
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return response.request.res.responseUrl || url;
  } catch (err: unknown) {
    console.error("URL Resolve error:", err);
    return url;
  }
}

app.get("/api/resolve-url", async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ message: "URL is required" });
  }
  try {
    const resolvedUrl = await resolveUrl(url);
    res.json({ url: resolvedUrl });
  } catch (err) {
    res.status(500).json({ message: "Failed to resolve URL" });
  }
});

// ─── WhatsApp Monitoring API ───────────────────────────────────────────────────

/** GET /api/whatsapp/status — Returns current WA connection status */
app.get("/api/whatsapp/status", (req, res) => {
  res.json({ status: waStatus, info: waInfo });
});

/** Get all models from a Backbone.js-style collection (handles both .models array and .getModelsArray()) */
function getModels(coll: any): any[] {
  if (!coll) return [];
  if (Array.isArray(coll.models)) return coll.models;
  if (typeof coll.getModelsArray === "function") return coll.getModelsArray();
  if (typeof coll.toArray === "function") return coll.toArray();
  return [];
}

/** Read a Backbone model attribute — tries .get(key) then direct property */
function attr(model: any, key: string): any {
  if (model == null) return undefined;
  if (typeof model.get === "function") {
    const v = model.get(key);
    if (v !== undefined) return v;
  }
  return model[key];
}

/** Get groups from WA — reads directly from IndexedDB.
 *  The evaluate body is passed as a RAW STRING so esbuild never compiles it
 *  and cannot inject __name() or any other helpers into the browser context. */
async function getGroupsDirect(): Promise<{ id: string; name: string; participants: number }[]> {
  // language=JavaScript  (pure JS string — no TypeScript syntax)
  const script = `(async () => {
    var w = window;

    var getModelsArr = function(coll) {
      if (!coll) return [];
      if (Array.isArray(coll.models)) return coll.models;
      if (typeof coll.getModelsArray === 'function') return coll.getModelsArray();
      if (typeof coll.toArray === 'function') return coll.toArray();
      return [];
    };

    var getAttr = function(m, key) {
      if (m == null) return undefined;
      if (typeof m.get === 'function') { var v = m.get(key); if (v !== undefined) return v; }
      return m[key];
    };

    var isGroupId = function(cid) {
      if (!cid) return false;
      if (typeof cid === 'string') return cid.endsWith('@g.us');
      if (cid._serialized) return cid._serialized.endsWith('@g.us');
      if (cid.server) return cid.server === 'g.us';
      return false;
    };

    var serializeId = function(cid) {
      if (!cid) return '';
      if (typeof cid === 'string') return cid;
      if (cid._serialized) return cid._serialized;
      return (cid.user || '') + '@' + (cid.server || '');
    };

    var idbOpen = function(dbName) {
      return new Promise(function(resolve) {
        try {
          var req = indexedDB.open(dbName);
          req.onerror = function() { resolve(null); };
          req.onsuccess = function(e) { resolve(e.target.result); };
        } catch(err) { resolve(null); }
      });
    };

    var idbGetAll = function(db, storeName) {
      return new Promise(function(resolve) {
        try {
          if (!db.objectStoreNames.contains(storeName)) { resolve([]); return; }
          var tx = db.transaction(storeName, 'readonly');
          var req = tx.objectStore(storeName).getAll();
          req.onsuccess = function(e) { resolve(e.target.result || []); };
          req.onerror = function() { resolve([]); };
        } catch(err) { resolve([]); }
      });
    };

    var mapGroup = function(c) {
      var parts = 0;
      if (Array.isArray(c.participants)) parts = c.participants.length;
      else if (c.groupMetadata && Array.isArray(c.groupMetadata.participants)) parts = c.groupMetadata.participants.length;
      return { id: serializeId(c.id), name: c.name || c.formattedTitle || c.subject || '', participants: parts };
    };

    /* ── Path A: window.Store Backbone ── */
    if (w.Store) {
      var chatModels = getModelsArr(w.Store.Chat);
      var groupsA = chatModels.filter(function(c) {
        return getAttr(c, 'isGroup') || isGroupId(getAttr(c, 'id'));
      }).map(function(c) {
        var id = getAttr(c, 'id');
        var name = getAttr(c, 'name') || getAttr(c, 'formattedTitle') || getAttr(c, 'subject') || '';
        var partColl = getAttr(c, 'participants');
        var participants = partColl ? (getModelsArr(partColl).length || partColl.length || 0) : 0;
        return { id: serializeId(id), name: name, participants: participants };
      });
      if (groupsA.length > 0) return groupsA;
    }

    /* ── Path B: model-storage IDB ── */
    var mdb = await idbOpen('model-storage');
    if (mdb) {
      var mStores = Array.from(mdb.objectStoreNames);

      if (mStores.indexOf('chat') !== -1) {
        var chats = await idbGetAll(mdb, 'chat');
        var groups = chats.filter(function(c) { return isGroupId(c.id); });
        if (groups.length > 0) { mdb.close(); return groups.map(mapGroup); }
      }

      var gmStores = ['GroupMetadata', 'groupMetadata', 'group-metadata', 'groupMetadatas'];
      for (var i = 0; i < gmStores.length; i++) {
        if (mStores.indexOf(gmStores[i]) !== -1) {
          var metas = await idbGetAll(mdb, gmStores[i]);
          if (metas.length > 0) {
            mdb.close();
            return metas.map(function(g) {
              var parts = Array.isArray(g.participants) ? g.participants.length : 0;
              return { id: serializeId(g.id), name: g.subject || g.name || '', participants: parts };
            });
          }
        }
      }

      var cStores = ['Contact', 'contact'];
      for (var j = 0; j < cStores.length; j++) {
        if (mStores.indexOf(cStores[j]) !== -1) {
          var contacts = await idbGetAll(mdb, cStores[j]);
          var cgroups = contacts.filter(function(c) { return isGroupId(c.id); });
          if (cgroups.length > 0) {
            mdb.close();
            return cgroups.map(function(c) {
              return { id: serializeId(c.id), name: c.name || c.pushname || c.verifiedName || '', participants: 0 };
            });
          }
          break;
        }
      }
      mdb.close();
    }

    /* ── Path C: wawc IDB ── */
    var wdb = await idbOpen('wawc');
    if (wdb) {
      var wStores = Array.from(wdb.objectStoreNames);
      var toTry = ['chat', 'Chat', 'contact', 'Contact'];
      for (var k = 0; k < toTry.length; k++) {
        if (wStores.indexOf(toTry[k]) !== -1) {
          var items = await idbGetAll(wdb, toTry[k]);
          var wgroups = items.filter(function(c) { return isGroupId(c.id); });
          if (wgroups.length > 0) { wdb.close(); return wgroups.map(mapGroup); }
        }
      }
      wdb.close();
    }

    return [];
  })()`;

  return (waClient as any).pupPage.evaluate(script);
}

/** GET /api/whatsapp/qr — Returns the latest QR code data URL (if status is QR_READY) */
app.get("/api/whatsapp/qr", (req, res) => {
  if (waStatus !== "QR_READY") {
    return res.status(404).json({ error: "No QR code available", status: waStatus });
  }
  if (!waQrDataUrl) {
    return res.status(503).json({ error: "QR code not yet generated", status: waStatus });
  }
  res.json({ qr: waQrDataUrl, status: waStatus });
});

/** GET /api/whatsapp/groups — Returns list of groups the WA account is in */
app.get("/api/whatsapp/groups", async (req, res) => {
  if (waStatus !== "CONNECTED") {
    return res.status(503).json({ error: "WhatsApp not connected", status: waStatus });
  }
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const forceRefresh = req.query.refresh === "1";
  const cacheAge = Date.now() - waGroupsCachedAt;

  // Return cache if valid and no forced refresh
  if (!forceRefresh && waGroupsCache.length > 0 && cacheAge < CACHE_TTL_MS) {
    return res.json({ groups: waGroupsCache, cached: true, cachedAgoSec: Math.floor(cacheAge / 1000) });
  }

  try {
    const groups = await getGroupsDirect();
    if (groups.length > 0) {
      waGroupsCache = groups;
      waGroupsCachedAt = Date.now();
      return res.json({ groups: waGroupsCache, cached: false });
    }
    // Store empty — return stale cache or empty list
    if (waGroupsCache.length > 0) {
      return res.json({ groups: waGroupsCache, cached: true, stale: true, cachedAgoSec: Math.floor(cacheAge / 1000), warning: "Store returned empty, using cached data" });
    }
    return res.json({ groups: [], cached: false, warning: "No groups found yet. WA Store may still be loading." });
  } catch (err: unknown) {
    console.error("[WhatsApp] getGroupsDirect error:", String(err));
    if (waGroupsCache.length > 0) {
      return res.json({ groups: waGroupsCache, cached: true, stale: true, cachedAgoSec: Math.floor(cacheAge / 1000) });
    }
    return res.status(503).json({ error: "Failed to read groups from WA Store.", details: String(err) });
  }
});

/** GET /api/whatsapp/debug-store — Diagnose WA page context and IDB stores */
app.get("/api/whatsapp/debug-store", async (req, res) => {
  if (waStatus !== "CONNECTED") {
    return res.status(503).json({ error: "WhatsApp not connected", status: waStatus });
  }
  // String-based evaluate to avoid esbuild __name injection
  const debugScript = `(async () => {
    var w = window;

    var idbStoreNames = function(dbName) {
      return new Promise(function(resolve) {
        try {
          var req = indexedDB.open(dbName);
          req.onerror = function() { resolve([]); };
          req.onsuccess = function(e) {
            var db = e.target.result;
            var names = Array.from(db.objectStoreNames);
            db.close();
            resolve(names);
          };
        } catch(err) { resolve([]); }
      });
    };

    var idbCount = function(dbName, storeName) {
      return new Promise(function(resolve) {
        try {
          var req = indexedDB.open(dbName);
          req.onerror = function() { resolve(-1); };
          req.onsuccess = function(e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve(0); return; }
            var tx = db.transaction(storeName, 'readonly');
            var countReq = tx.objectStore(storeName).count();
            countReq.onsuccess = function(e2) { db.close(); resolve(e2.target.result); };
            countReq.onerror = function() { db.close(); resolve(-1); };
          };
        } catch(err) { resolve(-1); }
      });
    };

    var modelStorageStores = await idbStoreNames('model-storage');
    var wawcStores = await idbStoreNames('wawc');

    var counts = {};
    var keyStores = ['chat', 'Contact', 'contact', 'GroupMetadata', 'groupMetadata'];
    for (var i = 0; i < keyStores.length; i++) {
      var sn = keyStores[i];
      if (modelStorageStores.indexOf(sn) !== -1) {
        counts['model-storage/' + sn] = await idbCount('model-storage', sn);
      }
      if (wawcStores.indexOf(sn) !== -1) {
        counts['wawc/' + sn] = await idbCount('wawc', sn);
      }
    }

    var WWebJS = w.WWebJS;
    return {
      storeAvailable: !!w.Store,
      WWebJSAvailable: !!WWebJS,
      WWebJSKeys: WWebJS ? Object.keys(WWebJS) : [],
      waRelatedGlobals: Object.keys(w).filter(function(k) {
        return k.startsWith('WA') || k === 'Store' || k.startsWith('wa') || k === 'mR' || k === 'require';
      }),
      idbModelStorageStores: modelStorageStores,
      idbWawcStores: wawcStores,
      recordCounts: counts
    };
  })()`;

  try {
    const info = await (waClient as any).pupPage.evaluate(debugScript);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** POST /api/whatsapp/logout — Logout from WhatsApp */
app.post("/api/whatsapp/logout", async (req, res) => {
  try {
    await waClient.logout();
    waStatus = "INITIALIZING";
    waQrDataUrl = null;
    waInfo = {};
    addLog("WA_LOGOUT", "System", "WhatsApp logged out");
    res.json({ success: true, message: "Logged out from WhatsApp" });
  } catch (err) {
    res.status(500).json({ error: "Failed to logout", details: String(err) });
  }
});

/** POST /api/whatsapp/restart — Restart WhatsApp client */
app.post("/api/whatsapp/restart", async (req, res) => {
  try {
    waStatus = "INITIALIZING";
    waQrDataUrl = null;
    waInfo = {};
    await waClient.destroy();
    setTimeout(() => {
      waClient.initialize().catch(console.error);
    }, 2000);
    addLog("WA_RESTART", "System", "WhatsApp client restarted");
    res.json({ success: true, message: "WhatsApp client restarting..." });
  } catch (err) {
    res.status(500).json({ error: "Failed to restart", details: String(err) });
  }
});

// ─── API v1 Routes (JWT-protected, PostgreSQL-backed) ──────────────────────────
// Mount BEFORE the legacy /api routes so /api/v1/* is handled first.
app.use("/api/v1", apiV1);

// ─── Legacy API Routes (JSON file–backed) ──────────────────────────────────────

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const db = getDB();
  const user = db.users.find((u: any) => u.username === username && u.password === password);
  if (user) {
    const { password, ...userWithoutPassword } = user;
    addLog("LOGIN", user.name, `User ${user.username} logged in`);
    res.json(userWithoutPassword);
  } else {
    res.status(401).json({ message: "Invalid credentials" });
  }
});

app.get("/api/logs", (req, res) => {
  const db = getDB();
  res.json(db.logs || []);
});

app.get("/api/tickets", (req, res) => {
  const db = getDB();
  const userId = req.query.userId as string;
  const userRole = req.query.role as string;

  let filteredTickets = db.tickets;

  if (userId && (userRole === 'technician' || userRole === 'vendor')) {
    filteredTickets = db.tickets.filter((t: any) => {
      if (t.status === 'open' && (!t.assignedTechnicianIds || t.assignedTechnicianIds.length === 0)) {
        return true;
      }
      const isAssigned = t.assignedTechnicianIds?.includes(userId) || t.technicianId === userId;
      return isAssigned;
    });
  }

  res.json(filteredTickets);
});

app.post("/api/tickets", async (req, res) => {
  const db = getDB();
  
  let locationUrl = req.body.locationUrl;
  if (locationUrl) {
    locationUrl = await resolveUrl(locationUrl);
  }

  // Initialize nextDisplayId if it doesn't exist (for backward compatibility)
  if (!db.nextDisplayId) {
    db.nextDisplayId = db.tickets.length + 1;
  }

  const newTicket = {
    id: Date.now().toString(),
    displayId: db.nextDisplayId,
    createdAt: new Date().toISOString(),
    status: "open",
    ...req.body,
    locationUrl
  };
  
  // Increment the display ID counter
  db.nextDisplayId++;
  
  db.tickets.push(newTicket);
  saveDB(db);
  addLog("TICKET_CREATE", req.body.createdBy || "System", `Created ticket #${newTicket.displayId} for ${newTicket.customerName}`);

  const template = newTicket.type === "maintenance" 
    ? (db.settings.templateMaintenance || "Tiket Maintenance Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nKendala: {detail}")
    : newTicket.type === "dismantle"
    ? (db.settings.templateDismantle || "Tiket Dismantle Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nAlasan: {detail}")
    : (db.settings.templateInstallation || "Tiket Pemasangan Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nPaket: {detail}");
  
  const message = formatMessage(template, newTicket, db, req.headers.origin);

  // Send to assigned technicians
  if (newTicket.assignedTechnicianIds && newTicket.assignedTechnicianIds.length > 0) {
    for (const techId of newTicket.assignedTechnicianIds) {
      const tech = db.users.find((u: any) => u.id === techId);
      if (tech && tech.phone) {
        await sendWhatsApp(tech.phone, message);
      }
    }
  } else if (newTicket.technicianId) {
    const tech = db.users.find((u: any) => u.id === newTicket.technicianId);
    if (tech && tech.phone) {
      await sendWhatsApp(tech.phone, message);
    }
  }

  // Send to group if configured
  if (db.settings.whatsappGroup) {
    await sendWhatsApp(db.settings.whatsappGroup, message);
  }

  res.json(newTicket);
});

app.post("/api/tickets/:id/resend-notification", async (req, res) => {
  const { id } = req.params;
  const db = getDB();
  const ticket = db.tickets.find((t: any) => t.id === id);
  
  if (!ticket) {
    return res.status(404).json({ message: "Ticket not found" });
  }

  const template = ticket.type === "maintenance"
    ? (db.settings.templateMaintenance || "Tiket Maintenance Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nKendala: {detail}\nTeknisi: {technician}{location}{link}")
    : ticket.type === "dismantle"
    ? (db.settings.templateDismantle || "Tiket Dismantle Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nAlasan: {detail}\nTeknisi: {technician}{location}{link}")
    : (db.settings.templateInstallation || "Tiket Pemasangan Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nPaket: {detail}\nTeknisi: {technician}{location}{link}");
    
  const message = `[REMINDER] ${formatMessage(template, ticket, db, req.headers.origin)}`;

  if (db.settings.whatsappGroup) {
    await sendWhatsApp(db.settings.whatsappGroup, message);
    res.json({ message: "Notification resent to group" });
  } else {
    res.status(400).json({ message: "WhatsApp Group ID not configured" });
  }
});

app.patch("/api/tickets/:id", async (req, res) => {
  const { id } = req.params;
  const db = getDB();
  const index = db.tickets.findIndex((t: any) => t.id === id);
  if (index !== -1) {
    let updateData = { ...req.body };
    if (updateData.locationUrl) {
      updateData.locationUrl = await resolveUrl(updateData.locationUrl);
    }
    db.tickets[index] = { ...db.tickets[index], ...updateData };
    saveDB(db);
    addLog("TICKET_UPDATE", req.body.updatedBy || "System", `Updated ticket ${id} status to ${updateData.status || db.tickets[index].status}`);

    if (req.body.status === "completed") {
      const ticket = db.tickets[index];
      const template = db.settings.templateClosed || "Tiket {id} Selesai!\nPelanggan: {customerName}\nStatus: Selesai\nLaporan: {report}";
      const message = formatMessage(template, ticket, db, req.headers.origin);

      if (db.settings.whatsappGroup) {
        await sendWhatsApp(db.settings.whatsappGroup, message);
      }
      
      console.log(`Ticket ${id} completed`);
    }

    res.json(db.tickets[index]);
  } else {
    res.status(404).json({ message: "Ticket not found" });
  }
});

app.post("/api/tickets/:id/resolve-location", async (req, res) => {
  const { id } = req.params;
  const db = getDB();
  const index = db.tickets.findIndex((t: any) => t.id === id);
  if (index !== -1) {
    const ticket = db.tickets[index];
    if (ticket.locationUrl) {
      ticket.locationUrl = await resolveUrl(ticket.locationUrl);
      saveDB(db);
      res.json(ticket);
    } else {
      res.status(400).json({ message: "No location URL to resolve" });
    }
  } else {
    res.status(404).json({ message: "Ticket not found" });
  }
});

app.delete("/api/tickets/:id", (req, res) => {
  const { id } = req.params;
  const db = getDB();
  const initialLength = db.tickets.length;
  db.tickets = db.tickets.filter((t: any) => t.id !== id);
  if (db.tickets.length !== initialLength) {
    saveDB(db);
    res.json({ message: "Ticket deleted" });
  } else {
    res.status(404).json({ message: "Ticket not found" });
  }
});

app.get("/api/users", (req, res) => {
  const db = getDB();
  const usersWithoutPasswords = db.users.map(({ password, ...user }: any) => user);
  res.json(usersWithoutPasswords);
});

app.get("/api/technicians", (req, res) => {
  const db = getDB();
  const technicians = db.users
    .filter((u: any) => u.role === "technician" || u.role === "vendor")
    .map(({ password, ...user }: any) => ({ ...user }));
  res.json(technicians);
});

app.post("/api/users", (req, res) => {
  const db = getDB();
  const newUser = { id: Date.now().toString(), ...req.body };
  db.users.push(newUser);
  saveDB(db);
  const { password, ...userWithoutPassword } = newUser;
  res.json(userWithoutPassword);
});

app.patch("/api/users/:id", (req, res) => {
  const { id } = req.params;
  const db = getDB();
  const index = db.users.findIndex((u: any) => u.id === id);
  if (index !== -1) {
    const updateData = { ...req.body };
    if (!updateData.password) {
      delete updateData.password;
    }
    db.users[index] = { ...db.users[index], ...updateData };
    saveDB(db);
    const { password, ...userWithoutPassword } = db.users[index];
    res.json(userWithoutPassword);
  } else {
    res.status(404).json({ message: "User not found" });
  }
});

app.delete("/api/users/:id", (req, res) => {
  const { id } = req.params;
  const db = getDB();
  const initialLength = db.users.length;
  db.users = db.users.filter((u: any) => u.id !== id);
  if (db.users.length !== initialLength) {
    saveDB(db);
    res.json({ message: "User deleted" });
  } else {
    res.status(404).json({ message: "User not found" });
  }
});

app.get("/api/settings", (req, res) => {
  const db = getDB();
  res.json(db.settings);
});

app.post("/api/settings", (req, res) => {
  const db = getDB();
  db.settings = { ...db.settings, ...req.body };
  saveDB(db);
  res.json(db.settings);
});

// ─── Cleanup Task ──────────────────────────────────────────────────────────────
function cleanupOldData() {
  const db = getDB();
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  
  const initialCount = db.tickets.length;
  db.tickets = db.tickets.filter((t: any) => new Date(t.createdAt) >= threeMonthsAgo);
  
  if (db.tickets.length !== initialCount) {
    saveDB(db);
    console.log(`Cleaned up ${initialCount - db.tickets.length} old tickets.`);
  }

  const retentionDays = db.settings.mediaRetentionDays || 60;
  const retentionDate = new Date();
  retentionDate.setDate(retentionDate.getDate() - retentionDays);

  fs.readdir(UPLOADS_DIR, (err, files) => {
    if (err) {
      console.error("Error reading uploads directory:", err);
      return;
    }

    let deletedCount = 0;
    files.forEach(file => {
      const filePath = path.join(UPLOADS_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        if (stats.mtime < retentionDate) {
          fs.unlink(filePath, (err) => {
            if (!err) deletedCount++;
          });
        }
      });
    });
  });
}

cleanupOldData();
setInterval(cleanupOldData, 24 * 60 * 60 * 1000);

// ─── Vite / Static Frontend ────────────────────────────────────────────────────
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`WhatsApp status: ${waStatus}`);
  });
}

startServer();