<p align="center">
  <img src="https://sp.theazizi.ir/favicon.svg" width="100" height="100" alt="Secure Pastebin Logo">
</p>

<h1 align="center">🔐 Secure Pastebin</h1>

<p align="center">
  <strong>End-to-End Encrypted Message Sharing on Cloudflare Workers</strong><br>
  Zero-Knowledge • Password Protected • Self-Destructing
</p>

<p align="center">
  <a href="https://sp.theazizi.ir" target="_blank"><strong>🚀 Live Demo</strong></a> 
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Encryption-AES--256--GCM-success?style=flat-square" alt="AES-256">
  <img src="https://img.shields.io/badge/Architecture-Zero--Knowledge-blue?style=flat-square" alt="Zero-Knowledge">
  <img src="https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange?style=flat-square" alt="Cloudflare">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License">
</p>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔒 **AES-256-GCM Encryption** | Military-grade encryption in your browser |
| 🛡️ **Zero-Knowledge Architecture** | Server cannot read your data. Ever. |
| 🔑 **Optional Password Protection** | Extra layer with PBKDF2 key derivation |
| 🔥 **Burn After Reading** | Self-destruct after first view |
| ⏱️ **Expiration Control** | 1 hour to 30 days |
| 🌍 **Auto RTL Support** | Persian, Arabic, Hebrew auto-detection |
| 📱 **Fully Responsive** | Works on all devices |
| 🚫 **No Registration** | No emails, no accounts, no tracking |

---

## 🔍 How It Works

```
┌─────────────┐     AES-256-GCM      ┌─────────────┐
│   Browser   │ ───────────────────→ │  Cloudflare │
│  (Encrypt)  │                      │     KV      │
│  Key in URL │ ←─────────────────── │  (Storage)  │
│   Fragment  │                      │             │
└─────────────┘                      └─────────────┘
```

1. **Client-Side Encryption**: Message encrypted in browser before sending
2. **Key in URL Fragment**: Decryption key never reaches server (after `#`)
3. **Zero Storage**: Server only sees ciphertext, never plaintext
4. **Optional Password**: PBKDF2 with 100,000 iterations for extra security

---

## 🚀 Deployment Guide

This guide uses **Cloudflare Dashboard** (no CLI required) - the exact method used for [sp.theazizi.ir](https://sp.theazizi.ir)

### Prerequisites

- Cloudflare account (free tier works)
- 5 minutes of your time

---

### Step 1: Create KV Namespace

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. From left sidebar: **Storage & Databases** → **KV**
3. Click **"Create a namespace"**
4. Name: `PASTEBIN_KV`
5. Click **"Create"**

> ⚠️ **Important**: Remember this exact name - `PASTEBIN_KV`

---

### Step 2: Create Worker

1. Go to **Workers & Pages** → **Create application**
2. Click **"Create Worker"**
3. Name your worker (e.g., `secure-pastebin`)
4. Click **"Deploy"** (we'll replace the code next)

---

### Step 3: Bind KV to Worker

This step is **critical** - connects your KV to the worker:

1. In your Worker dashboard, click **"Settings"** tab
2. Go to **Bindings** section
3. Click **"Add"**
4. Select **"KV Namespace"**
5. Configure:
   - **Variable name**: `PASTEBIN_KV` (must match exactly)
   - **KV namespace**: Select the one you created in Step 1
6. Click **"Deploy"**

---

### Step 4: Add the Code

1. In your Worker, go to **"Edit code"** (or Quick Edit)
2. Delete all existing code
3. Copy the entire `worker.js` from this repo
4. Paste into the editor
5. Click **"Save and Deploy"**

---

### Step 5: Add Custom Domain (Optional)

To use your own domain like `sp.theazizi.ir`:

1. In Worker dashboard, go to **"Triggers"** tab
2. Click **"Add Custom Domain"**
3. Enter your subdomain (e.g., `sp.yourdomain.com`)
4. Add CNAME record in your DNS pointing to your worker
5. Wait for SSL certificate (automatic)

---

## 🛠️ Local Development (Optional)

If you prefer Wrangler CLI:

```bash
# Install Wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create KV namespace
wrangler kv:namespace create "PASTEBIN_KV"

# Update wrangler.toml with your KV ID
# Deploy
wrangler deploy
```

---

## 🔐 Security Details

### Encryption
- **Algorithm**: AES-256-GCM
- **Key Derivation**: PBKDF2 (100,000 iterations)
- **IV**: Random 12-byte per message
- **Key Location**: URL fragment (never sent to server)

### Privacy
- No server-side logs
- No analytics or tracking
- No registration required
- Messages auto-expire
- Burn-after-read option

---

## 📁 Project Structure

```
secure-pastebin/
├── worker.js          # Main Cloudflare Worker code
├── README.md          # This file
└── LICENSE            # MIT License
```

---

## 🌐 Internet Freedom

<p align="center">
  <strong>#InternetForAll</strong>
</p>

> **Internet access is a fundamental human right.**  
> Restricting internet access violates human rights and limits freedom of expression, access to information, and the ability to communicate securely. We believe in **free, open, and secure internet for everyone** — regardless of borders, politics, or censorship.

This tool is built to ensure **private, secure communication** remains accessible to all.

---

## 🤝 Contributing

Contributions welcome! Areas to improve:

- [ ] File attachments (encrypted)
- [ ] QR code generation for sharing
- [ ] Custom themes
- [ ] Browser extension

---

## 📜 License

MIT License - see [LICENSE](LICENSE) file

---

## 👤 Author

**TheGreatAzizi**

- GitHub: [@TheGreatAzizi](https://github.com/TheGreatAzizi)
- X/Twitter: [@the_azzi](https://x.com/the_azzi)
- Demo: [sp.theazizi.ir](https://sp.theazizi.ir)

---

<p align="center">
  <sub>Built with ❤️ for a free and open internet</sub>
</p>
