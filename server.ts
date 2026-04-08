import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import fs from "fs";
import multer from "multer";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

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
    { id: "4", username: "pengawas", password: "password", role: "supervisor", name: "Siti Pengawas" },
    { id: "5", username: "superuser", password: "password", role: "superuser", name: "Super User" },
    { id: "6", username: "superadmin", password: "password", role: "superuser", name: "Super Admin" },
  ],
  tickets: [],
  settings: {
    fonnteToken: process.env.FONNTE_API_KEY || "",
    whatsappGroup: "",
    templateInstallation: "Tiket Pemasangan Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nPaket: {detail}{link}",
    templateMaintenance: "Tiket Maintenance Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nKendala: {detail}{link}",
    templateClosed: "Tiket {id} Selesai!\nPelanggan: {customerName}\nStatus: Selesai\nLaporan: {report}{link}",
    mediaRetentionDays: 60,
  }
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

// WhatsApp Helper
function formatMessage(template: string, ticket: any, db: any, origin?: string) {
  const typeLabel = ticket.type === "maintenance" ? "Maintenance" : "Pemasangan Baru";
  const detailLabel = ticket.type === "maintenance" ? `Kendala: ${ticket.issue}` : `Paket: ${ticket.package}`;
  const locationMsg = ticket.locationUrl ? `\nLokasi: ${ticket.locationUrl}` : "";
  
  const ticketLink = origin ? `\nLink Tiket: ${origin}/?ticketId=${ticket.id}` : "";
  
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
  }

  return template
    .replace(/{type}/g, typeLabel)
    .replace(/{id}/g, ticket.id || "")
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

async function sendWhatsApp(to: string, message: string) {
  const db = getDB();
  const token = db.settings.fonnteToken;
  if (!token) {
    console.log("WhatsApp skip: No Fonnte Token");
    return;
  }

  try {
    await axios.post("https://api.fonnte.com/send", {
      target: to,
      message: message,
    }, {
      headers: { Authorization: token }
    });
    console.log(`WhatsApp sent to ${to}`);
  } catch (err) {
    console.error("WhatsApp error:", err);
  }
}

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

// API Routes
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const db = getDB();
  const user = db.users.find((u: any) => u.username === username && u.password === password);
  if (user) {
    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } else {
    res.status(401).json({ message: "Invalid credentials" });
  }
});

app.get("/api/tickets", (req, res) => {
  const db = getDB();
  res.json(db.tickets);
});

app.post("/api/tickets", async (req, res) => {
  const db = getDB();
  const newTicket = {
    id: Date.now().toString(),
    createdAt: new Date().toISOString(),
    status: "open",
    ...req.body
  };
  db.tickets.push(newTicket);
  saveDB(db);

  // Notify via WhatsApp if it's maintenance or if group is configured
  const template = newTicket.type === "maintenance" 
    ? (db.settings.templateMaintenance || "Tiket Maintenance Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nKendala: {detail}")
    : (db.settings.templateInstallation || "Tiket Pemasangan Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nPaket: {detail}");
  
  const message = formatMessage(template, newTicket, db, req.headers.origin);

  // Send to technician if maintenance
  if (newTicket.type === "maintenance") {
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
    ? (db.settings.templateMaintenance || "Tiket Maintenance Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nKendala: {detail}")
    : (db.settings.templateInstallation || "Tiket Pemasangan Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nPaket: {detail}");
    
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
    db.tickets[index] = { ...db.tickets[index], ...req.body };
    saveDB(db);

    // Notify if handled
    if (req.body.status === "completed") {
      const ticket = db.tickets[index];
      const template = db.settings.templateClosed || "Tiket {id} Selesai!\nPelanggan: {customerName}\nStatus: Selesai\nLaporan: {report}";
      const message = formatMessage(template, ticket, db, req.headers.origin);

      if (db.settings.whatsappGroup) {
        await sendWhatsApp(db.settings.whatsappGroup, message);
      }
      
      console.log(`Ticket ${id} completed and notification sent`);
    }

    res.json(db.tickets[index]);
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
  res.json(db.users);
});

app.post("/api/users", (req, res) => {
  const db = getDB();
  const newUser = { id: Date.now().toString(), ...req.body };
  db.users.push(newUser);
  saveDB(db);
  res.json(newUser);
});

app.patch("/api/users/:id", (req, res) => {
  const { id } = req.params;
  const db = getDB();
  const index = db.users.findIndex((u: any) => u.id === id);
  if (index !== -1) {
    db.users[index] = { ...db.users[index], ...req.body };
    saveDB(db);
    res.json(db.users[index]);
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

// Cleanup task: delete tickets older than 3 months and media older than retention days
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

  // Media cleanup
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
        if (err) {
          console.error(`Error statting file ${file}:`, err);
          return;
        }

        if (stats.mtime < retentionDate) {
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error(`Error deleting file ${file}:`, err);
            } else {
              deletedCount++;
            }
          });
        }
      });
    });
    if (deletedCount > 0) {
      console.log(`Cleaned up ${deletedCount} old media files.`);
    }
  });
}

// Run cleanup on start and every 24 hours
cleanupOldData();
setInterval(cleanupOldData, 24 * 60 * 60 * 1000);

// Vite middleware
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
  });
}

startServer();
