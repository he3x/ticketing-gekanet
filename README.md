# WA Ticketing - Gekanet

Sistem ticketing WhatsApp berbasis web menggunakan **whatsapp-web.js**, **Express.js**, dan **React**.

## ✨ Fitur

- 📋 Manajemen tiket otomatis dari pesan WhatsApp masuk
- 💬 Balas pesan langsung dari dashboard web
- 📊 Monitoring status koneksi WhatsApp real-time
- 📱 Login via QR Code langsung dari UI
- 🔄 Auto-reconnect jika koneksi terputus

## 🛠️ Stack Teknologi

- **Frontend**: React + TypeScript + Tailwind CSS (Vite)
- **Backend**: Express.js + TypeScript (Node.js)
- **WhatsApp**: whatsapp-web.js (LocalAuth - tanpa scan ulang)
- **Database**: SQLite (better-sqlite3)

## 🚀 Cara Menjalankan

### 1. Install Dependencies

```bash
npm install
```

### 2. Jalankan Backend (Terminal 1)

```bash
npm run server:dev
```

Backend akan berjalan di `http://localhost:3001`

### 3. Jalankan Frontend (Terminal 2)

```bash
npm run dev
```

Frontend akan berjalan di `http://localhost:5173`

### 4. Login WhatsApp

1. Buka browser ke `http://localhost:5173`
2. Klik menu **Pengaturan** di sidebar
3. Tunggu QR Code muncul (status: *Menunggu Scan QR*)
4. Scan QR Code menggunakan WhatsApp di HP:
   - Buka WhatsApp → Menu (⋮) → Perangkat Tertaut → Tautkan Perangkat
5. Setelah scan, status akan berubah menjadi **Terhubung** ✅

## 📡 API Endpoints

### WhatsApp

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/whatsapp/status` | Status koneksi WA saat ini |
| GET | `/api/whatsapp/qr` | QR Code (jika status QR_READY) |
| POST | `/api/whatsapp/logout` | Logout dari WhatsApp |
| POST | `/api/whatsapp/restart` | Restart koneksi WA |

### Tiket

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/tickets` | Daftar semua tiket |
| GET | `/api/tickets/:id` | Detail tiket + pesan |
| PATCH | `/api/tickets/:id` | Update status/prioritas tiket |
| DELETE | `/api/tickets/:id` | Hapus tiket |
| POST | `/api/tickets/:id/reply` | Kirim balasan via WhatsApp |

## 📊 Status WhatsApp

| Status | Warna | Keterangan |
|--------|-------|------------|
| INITIALIZING | 🟡 Kuning | WhatsApp client sedang memuat |
| QR_READY | 🔵 Biru | QR siap di-scan |
| CONNECTED | 🟢 Hijau | Terhubung dan aktif |
| DISCONNECTED | 🔴 Merah | Terputus, perlu restart |

## 🗂️ Struktur Proyek

```
ticketing-gekanet/
├── server.ts          # Backend Express + WhatsApp service
├── src/
│   ├── App.tsx        # Frontend React (UI utama)
│   ├── main.tsx       # Entry point React
│   ├── index.css      # Tailwind CSS
│   └── types.ts       # TypeScript types
├── tailwind.config.js
├── vite.config.ts     # Vite + proxy ke backend
├── tsconfig.json      # TS config untuk frontend
├── tsconfig.server.json # TS config untuk backend
└── package.json
```

## ⚙️ Environment Variables

Buat file `.env` di root project (opsional):

```env
PORT=3001
VITE_API_URL=http://localhost:3001
```

## 🔒 Catatan

- Sesi WhatsApp disimpan di folder `.wwebjs_auth/` (LocalAuth)
- Database SQLite disimpan di `tickets.db`
- Membutuhkan Google Chrome/Chromium untuk puppeteer