# Club Ping Pong ELO Website - Server Deployment Guide

All project files, frontend assets, and backend server logic are fully contained inside the **`website_files/`** folder!

---

## 📁 File Structure (`website_files/`)

```
website_files/
├── index.html        # Main web page (Leaderboard, Stats & Best of 3 Form)
├── styles.css        # Responsive CSS theme & status badges
├── app.js            # Frontend logic & Google Sheets sync engine
├── server.js         # Node.js backend server API & static file server
├── data/             # Server storage directory
│   └── matches.json  # Stored unlogged / logged matches
└── README.md         # Deployment & copy-paste instructions
```

---

## 🚀 How to Copy & Deploy to Your DigitalOcean Droplet

### 1. Copy `website_files` to your server
From your computer terminal inside your project directory, run:

```bash
scp -r website_files/* root@<YOUR_DROPLET_IP>:/var/www/venkykanniganti.com/html/
```

### 2. Start Node.js Server on DigitalOcean (Optional / Background API)
On your DigitalOcean Droplet inside `/var/www/venkykanniganti.com/html`:

```bash
node server.js
```

To keep it running continuously in the background:
```bash
npm install -g pm2
pm2 start server.js --name "pingpong-api"
pm2 save
```
