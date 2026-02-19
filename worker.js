// Secure Pastebin - Cloudflare Worker v1.0

export default {
  async fetch(request, env, ctx) {
    if (!env.PASTEBIN_KV) {
      return new Response(JSON.stringify({
        error: "KV Binding Missing",
        message: "Please bind PASTEBIN_KV in Worker Settings > Bindings",
        steps: [
          "1. Go to dash.cloudflare.com",
          "2. Workers & Pages > Your Worker > Settings > Bindings",
          "3. Click 'Add' > Select 'KV Namespace'",
          "4. Variable name: PASTEBIN_KV",
          "5. Select your KV namespace",
          "6. Click Deploy"
        ]
      }, null, 2), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (path === '/api/create' && request.method === 'POST') {
      return handleCreate(request, env, corsHeaders);
    }
    
    if (path.startsWith('/api/get/') && request.method === 'GET') {
      const id = path.split('/')[3];
      return handleGet(id, env, corsHeaders);
    }

    if (path === '/favicon.ico' || path === '/favicon.svg') {
      return new Response(FAVICON_SVG, {
        headers: { 'Content-Type': 'image/svg+xml' }
      });
    }

    if (path === '/' || path === '/index.html') {
      return new Response(HTML_UI, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};

async function handleCreate(request, env, corsHeaders) {
  try {
    const body = await request.json();
    const { id, encryptedData, expiresIn, burnAfterRead, hasPassword } = body;
    
    if (!id || typeof id !== 'string' || id.length < 16) {
      return jsonResponse({ error: 'Invalid ID' }, 400, corsHeaders);
    }
    if (!encryptedData || !Array.isArray(encryptedData.iv) || !Array.isArray(encryptedData.data)) {
      return jsonResponse({ error: 'Invalid encrypted data format' }, 400, corsHeaders);
    }

    const ttl = Math.min(parseInt(expiresIn) || 3600, 2592000);
    
    const paste = {
      data: encryptedData,
      created: Date.now(),
      burnAfterRead: !!burnAfterRead,
      hasPassword: !!hasPassword,
      views: 0
    };

    await env.PASTEBIN_KV.put(id, JSON.stringify(paste), { expirationTtl: ttl });

    return jsonResponse({ 
      success: true, 
      id,
      expiresIn: ttl,
      hasPassword: !!hasPassword,
      url: `https://${request.headers.get('host')}/#${id}`
    }, 200, corsHeaders);

  } catch (err) {
    return jsonResponse({ 
      error: 'Server error', 
      message: err.message 
    }, 500, corsHeaders);
  }
}

async function handleGet(id, env, corsHeaders) {
  try {
    const data = await env.PASTEBIN_KV.get(id);
    if (!data) {
      return jsonResponse({ error: 'Paste not found or expired' }, 404, corsHeaders);
    }

    const paste = JSON.parse(data);
    
    if (paste.burnAfterRead) {
      await env.PASTEBIN_KV.delete(id);
    } else {
      paste.views = (paste.views || 0) + 1;
      const remainingTtl = Math.floor((paste.created + 3600000 - Date.now()) / 1000);
      if (remainingTtl > 0) {
        await env.PASTEBIN_KV.put(id, JSON.stringify(paste), { expirationTtl: remainingTtl });
      }
    }

    return jsonResponse({
      data: paste.data,
      burnAfterRead: paste.burnAfterRead,
      hasPassword: paste.hasPassword,
      created: paste.created
    }, 200, corsHeaders);

  } catch (err) {
    return jsonResponse({ error: 'Server error' }, 500, corsHeaders);
  }
}

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366f1;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#ec4899;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="20" fill="url(#grad)"/>
  <path d="M50 25c-8 0-14 6-14 14v6h-4c-3 0-6 3-6 6v24c0 3 3 6 6 6h36c3 0 6-3 6-6v-24c0-3-3-6-6-6h-4v-6c0-8-6-14-14-14zm0 6c4 0 8 4 8 8v6H42v-6c0-4 4-8 8-8z" fill="white"/>
</svg>`;

const HTML_UI = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    
    <!-- SEO -->
    <title>Secure Pastebin - End-to-End Encrypted Message Sharing</title>
    <meta name="description" content="Share sensitive messages securely with AES-256 encryption. Zero-knowledge architecture, password protection, self-destructing messages.">
    <meta name="keywords" content="secure pastebin, encrypted messaging, AES-256, end-to-end encryption, self-destructing messages">
    
    <!-- Favicon -->
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    
    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Vazirmatn:wght@400;500;600&display=swap" rel="stylesheet">
    
    <style>
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --secondary: #ec4899;
            --bg-dark: #0f172a;
            --bg-card: rgba(30, 41, 59, 0.7);
            --text: #f8fafc;
            --text-muted: #94a3b8;
            --border: rgba(148, 163, 184, 0.2);
            --success: #10b981;
            --error: #ef4444;
            --warning: #f59e0b;
            --internet-for-all: #22d3ee;
        }
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Inter', 'Vazirmatn', sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%);
            min-height: 100vh;
            color: var(--text);
            line-height: 1.6;
        }
        
        .container {
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
        }
        
        header {
            text-align: center;
            padding: 40px 0 30px;
        }
        
        .logo {
            font-size: 3rem;
            margin-bottom: 12px;
            display: inline-block;
            animation: pulse 2s ease-in-out infinite;
            filter: drop-shadow(0 0 20px rgba(99, 102, 241, 0.5));
        }
        
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
        
        h1 {
            font-size: 2rem;
            font-weight: 700;
            background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 8px;
        }
        
        .subtitle {
            color: var(--text-muted);
            font-size: 1rem;
            font-weight: 300;
        }
        
        .security-badges {
            display: flex;
            gap: 8px;
            justify-content: center;
            margin-top: 16px;
            flex-wrap: wrap;
        }
        
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 6px 12px;
            background: rgba(99, 102, 241, 0.15);
            border: 1px solid rgba(99, 102, 241, 0.3);
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 500;
            color: #a5b4fc;
        }
        
        .card {
            background: var(--bg-card);
            backdrop-filter: blur(20px);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 24px;
            margin-bottom: 20px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }
        
        .alert {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 14px 16px;
            border-radius: 12px;
            margin-bottom: 20px;
            font-size: 0.875rem;
            line-height: 1.5;
        }
        
        .alert-warning {
            background: rgba(245, 158, 11, 0.1);
            border: 1px solid rgba(245, 158, 11, 0.3);
            color: #fbbf24;
        }
        
        .alert-error {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            color: #f87171;
        }
        
        .alert-success {
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid rgba(16, 185, 129, 0.3);
            color: #34d399;
        }
        
        .alert-info {
            background: rgba(99, 102, 241, 0.1);
            border: 1px solid rgba(99, 102, 241, 0.3);
            color: #a5b4fc;
        }
        
        textarea, input[type="password"] {
            width: 100%;
            background: rgba(15, 23, 42, 0.6);
            border: 2px solid var(--border);
            border-radius: 16px;
            padding: 16px;
            color: var(--text);
            font-size: 15px;
            transition: all 0.3s ease;
            unicode-bidi: plaintext;
            text-align: start;
        }
        
        textarea {
            min-height: 200px;
            line-height: 1.8;
            resize: vertical;
            font-family: 'JetBrains Mono', 'Vazirmatn', monospace;
        }
        
        input[type="password"] {
            height: 50px;
            font-family: 'JetBrains Mono', monospace;
        }
        
        textarea:focus, input[type="password"]:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
        
        /* Auto RTL for Persian/Arabic/Hebrew */
        textarea:dir(rtl), .content-box:dir(rtl) {
            font-family: 'Vazirmatn', sans-serif;
        }
        
        .password-section {
            margin: 20px 0;
            padding: 20px;
            background: rgba(15, 23, 42, 0.4);
            border: 1px solid var(--border);
            border-radius: 12px;
        }
        
        .password-toggle {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 12px;
            cursor: pointer;
        }
        
        .password-toggle input[type="checkbox"] {
            width: 20px;
            height: 20px;
            accent-color: var(--secondary);
        }
        
        .password-input-wrapper {
            display: none;
            animation: slideDown 0.3s ease;
        }
        
        .password-input-wrapper.show {
            display: block;
        }
        
        @keyframes slideDown {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .password-input-wrapper label {
            display: block;
            margin-bottom: 8px;
            color: var(--text-muted);
            font-size: 0.875rem;
        }
        
        .options-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin: 20px 0;
        }
        
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        
        label {
            font-size: 0.8rem;
            font-weight: 500;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        select {
            padding: 12px;
            background: rgba(15, 23, 42, 0.6);
            border: 2px solid var(--border);
            border-radius: 10px;
            color: var(--text);
            font-size: 0.875rem;
            cursor: pointer;
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 10px center;
            background-size: 18px;
            padding-right: 36px;
        }
        
        .checkbox-wrapper {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 12px;
            background: rgba(15, 23, 42, 0.4);
            border: 2px solid var(--border);
            border-radius: 10px;
            cursor: pointer;
        }
        
        input[type="checkbox"] {
            width: 20px;
            height: 20px;
            accent-color: var(--secondary);
        }
        
        .btn {
            width: 100%;
            padding: 14px 24px;
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
            border: none;
            border-radius: 12px;
            color: white;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            box-shadow: 0 10px 30px -10px rgba(99, 102, 241, 0.5);
            transition: all 0.3s ease;
        }
        
        .btn:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 20px 40px -10px rgba(99, 102, 241, 0.6);
        }
        
        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        
        .btn-secondary {
            background: rgba(255, 255, 255, 0.1);
            box-shadow: none;
        }
        
        .btn-secondary:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.15);
        }
        
        .result-box {
            display: none;
            margin-top: 20px;
            padding: 20px;
            background: rgba(16, 185, 129, 0.05);
            border: 1px solid rgba(16, 185, 129, 0.3);
            border-radius: 12px;
        }
        
        .result-box.show {
            display: block;
            animation: slideUp 0.4s ease;
        }
        
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .url-container {
            display: flex;
            gap: 10px;
            margin-top: 12px;
            flex-wrap: wrap;
        }
        
        .url-input {
            flex: 1;
            min-width: 200px;
            padding: 12px;
            background: rgba(15, 23, 42, 0.8);
            border: 1px solid rgba(16, 185, 129, 0.3);
            border-radius: 10px;
            color: #34d399;
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.8rem;
            word-break: break-all;
        }
        
        .btn-copy {
            width: auto;
            padding: 12px 20px;
            background: rgba(16, 185, 129, 0.2);
            color: #34d399;
            border: 1px solid rgba(16, 185, 129, 0.3);
        }
        
        .meta-info {
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid rgba(16, 185, 129, 0.2);
            color: var(--text-muted);
            font-size: 0.8rem;
        }
        
        .decrypt-view {
            display: none;
        }
        
        .decrypt-view.show {
            display: block;
        }
        
        .password-prompt {
            display: none;
            text-align: center;
            padding: 40px 20px;
        }
        
        .password-prompt.show {
            display: block;
            animation: fadeIn 0.5s ease;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        .password-prompt h3 {
            margin-bottom: 20px;
            font-size: 1.25rem;
        }
        
        .password-prompt input {
            max-width: 300px;
            margin: 0 auto 20px;
            display: block;
        }
        
        .password-prompt .btn {
            max-width: 300px;
            margin: 0 auto;
        }
        
        .content-box {
            background: rgba(15, 23, 42, 0.8);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 20px;
            margin-top: 16px;
            font-family: 'JetBrains Mono', 'Vazirmatn', monospace;
            font-size: 15px;
            line-height: 1.8;
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 500px;
            overflow-y: auto;
            unicode-bidi: plaintext;
            text-align: start;
        }
        
        .burn-warning {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 14px;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 10px;
            margin-bottom: 16px;
            color: #f87171;
            font-weight: 500;
        }
        
        .loading {
            display: inline-block;
            width: 18px;
            height: 18px;
            border: 2px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            border-top-color: #fff;
            animation: spin 0.8s linear infinite;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        /* How It Works */
        .how-it-works {
            margin-top: 40px;
            padding: 30px;
            background: rgba(15, 23, 42, 0.5);
            border: 1px solid var(--border);
            border-radius: 20px;
        }
        
        .how-it-works h2 {
            font-size: 1.5rem;
            margin-bottom: 20px;
            color: #fff;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .steps {
            display: grid;
            gap: 16px;
        }
        
        .step {
            display: flex;
            gap: 16px;
            padding: 16px;
            background: rgba(99, 102, 241, 0.1);
            border: 1px solid rgba(99, 102, 241, 0.2);
            border-radius: 12px;
            transition: transform 0.2s;
        }
        
        .step:hover {
            transform: translateX(5px);
        }
        
        .step-number {
            width: 32px;
            height: 32px;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 0.875rem;
            flex-shrink: 0;
        }
        
        .step-content h3 {
            font-size: 1rem;
            margin-bottom: 4px;
            color: #fff;
        }
        
        .step-content p {
            font-size: 0.875rem;
            color: var(--text-muted);
            line-height: 1.5;
        }
        
        .tech-specs {
            margin-top: 24px;
            padding: 20px;
            background: rgba(16, 185, 129, 0.05);
            border: 1px solid rgba(16, 185, 129, 0.2);
            border-radius: 12px;
        }
        
        .tech-specs h3 {
            font-size: 1rem;
            margin-bottom: 12px;
            color: #34d399;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .specs-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 12px;
            font-size: 0.875rem;
        }
        
        .spec-item {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--text-muted);
        }
        
        .spec-item::before {
            content: '✓';
            color: var(--success);
            font-weight: bold;
        }
        
        footer {
            text-align: center;
            padding: 40px 0 30px;
            color: var(--text-muted);
            font-size: 0.875rem;
        }
        
        .footer-links {
            display: flex;
            gap: 20px;
            justify-content: center;
            margin: 16px 0;
            flex-wrap: wrap;
        }
        
        .footer-links a {
            color: var(--primary);
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: color 0.3s;
        }
        
        .footer-links a:hover {
            color: #a5b4fc;
        }
        
        /* Internet for All - Human Rights */
        .internet-for-all {
            margin: 30px 0;
            padding: 30px;
            background: linear-gradient(135deg, rgba(34, 211, 238, 0.1) 0%, rgba(239, 68, 68, 0.05) 100%);
            border: 1px solid rgba(34, 211, 238, 0.3);
            border-radius: 16px;
            position: relative;
        }
        
        .internet-for-all::before {
            content: '✊';
            position: absolute;
            top: 20px;
            left: 20px;
            font-size: 1.5rem;
            opacity: 0.5;
        }
        
        .internet-for-all::after {
            content: '🌐';
            position: absolute;
            top: 20px;
            right: 20px;
            font-size: 1.5rem;
            opacity: 0.5;
        }
        
        .hashtag {
            font-size: 1.75rem;
            font-weight: 800;
            color: var(--internet-for-all);
            text-shadow: 0 0 30px rgba(34, 211, 238, 0.5);
            letter-spacing: -0.02em;
        }
        
        .rights-text {
            margin-top: 16px;
            font-size: 0.9375rem;
            line-height: 1.7;
            color: var(--text);
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
        }
        
        .rights-text strong {
            color: #f87171;
        }
        
        .tech-stack {
            display: flex;
            gap: 12px;
            justify-content: center;
            margin-top: 20px;
            opacity: 0.6;
            font-size: 0.75rem;
            flex-wrap: wrap;
        }
        
        @media (max-width: 640px) {
            h1 { font-size: 1.5rem; }
            .options-grid { grid-template-columns: 1fr; }
            .card { padding: 16px; }
            .url-container { flex-direction: column; }
            textarea { min-height: 150px; }
            .specs-grid { grid-template-columns: 1fr; }
            .step { flex-direction: column; gap: 12px; }
            .hashtag { font-size: 1.5rem; }
            .internet-for-all::before,
            .internet-for-all::after { display: none; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="logo">🔐</div>
            <h1>Secure Pastebin</h1>
            <p class="subtitle">End-to-End Encrypted • Password Protected • Self-Destructing</p>
            <div class="security-badges">
                <span class="badge">🔒 AES-256-GCM</span>
                <span class="badge">🔑 Password</span>
                <span class="badge">🛡️ Zero-Knowledge</span>
                <span class="badge">⚡ Web Crypto API</span>
            </div>
        </header>

        <div id="errorDisplay" class="card alert alert-error" style="display: none;">
            <span>❌</span>
            <div style="flex: 1;">
                <strong>Error</strong>
                <div id="errorMessage"></div>
            </div>
        </div>

        <!-- Create View -->
        <div id="createView" class="card">
            <div class="alert alert-warning">
                <span>⚠️</span>
                <div>
                    <strong>Important:</strong> The encryption key is stored only in the URL fragment (after #). 
                    If you lose the URL, the data is permanently lost. We cannot recover it.
                </div>
            </div>
            
            <textarea id="content" placeholder="Enter your secret message here... (Supports English, Persian, Arabic, Hebrew, and all languages)" dir="auto"></textarea>
            
            <!-- Password Section -->
            <div class="password-section">
                <label class="password-toggle">
                    <input type="checkbox" id="enablePassword" onchange="togglePassword()">
                    <span>🔐 Protect with Password (Optional)</span>
                </label>
                <div id="passwordWrapper" class="password-input-wrapper">
                    <label>Enter Password:</label>
                    <input type="password" id="passwordInput" placeholder="Minimum 4 characters">
                    <small style="color: var(--text-muted); display: block; margin-top: 8px;">
                        This password will be required to decrypt the message. Share it separately.
                    </small>
                </div>
            </div>
            
            <div class="options-grid">
                <div class="form-group">
                    <label>⏱️ Expiration</label>
                    <select id="expiresIn">
                        <option value="3600">1 Hour</option>
                        <option value="86400" selected>1 Day</option>
                        <option value="604800">1 Week</option>
                        <option value="2592000">30 Days</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>🔥 Security Mode</label>
                    <label class="checkbox-wrapper">
                        <input type="checkbox" id="burnAfterRead">
                        <span>Burn after reading</span>
                    </label>
                </div>
            </div>
            
            <button id="createBtn" class="btn" onclick="createPaste()">
                <span id="btnText">🔐 Encrypt & Save</span>
            </button>
            
            <div id="resultBox" class="result-box">
                <div class="alert alert-success" style="margin-bottom: 12px;">
                    <span>✅</span>
                    <strong>Successfully encrypted!</strong>
                </div>
                <div id="passwordNotice" class="alert alert-info" style="display: none; margin-bottom: 12px;">
                    <span>🔑</span>
                    <div>
                        <strong>Password Protected!</strong><br>
                        Remember to share the password separately. It is NOT in the URL.
                    </div>
                </div>
                <div class="url-container">
                    <input type="text" id="shareUrl" class="url-input" readonly>
                    <button class="btn btn-copy" onclick="copyUrl()">📋 Copy</button>
                </div>
                <div class="meta-info">
                    ⏰ Expires: <span id="expiryTime"></span> • 🔑 Key never leaves your browser
                </div>
            </div>
        </div>

        <!-- Password Prompt -->
        <div id="passwordPrompt" class="card password-prompt">
            <div class="alert alert-info" style="margin-bottom: 20px;">
                <span>🔐</span>
                <div>This message is password protected.</div>
            </div>
            <h3>Enter Password to Decrypt</h3>
            <input type="password" id="decryptPassword" placeholder="Password">
            <button class="btn" onclick="decryptWithPassword()">
                <span id="decryptBtnText">🔓 Decrypt</span>
            </button>
            <p id="passwordError" style="color: var(--error); margin-top: 12px; display: none;">
                ❌ Wrong password!
            </p>
        </div>

        <!-- Decrypt View -->
        <div id="decryptView" class="card decrypt-view">
            <div id="burnNotice" class="burn-warning" style="display: none;">
                <span>🔥</span>
                <span>This message will be permanently deleted after you view it!</span>
            </div>
            
            <h3 style="margin-bottom: 12px;">🔓 Decrypted Content</h3>
            <div id="decryptedContent" class="content-box" dir="auto"></div>
            
            <button class="btn btn-secondary" onclick="window.location.href='/'" style="margin-top: 16px;">
                📝 Create New Message
            </button>
        </div>

        <!-- How It Works -->
        <div class="card how-it-works">
            <h2>🔍 How It Works</h2>
            <div class="steps">
                <div class="step">
                    <div class="step-number">1</div>
                    <div class="step-content">
                        <h3>Client-Side Encryption</h3>
                        <p>Your message is encrypted in your browser using AES-256-GCM before being sent to the server. The encryption key is generated locally and never transmitted.</p>
                    </div>
                </div>
                <div class="step">
                    <div class="step-number">2</div>
                    <div class="step-content">
                        <h3>Zero-Knowledge Storage</h3>
                        <p>The server only stores the encrypted ciphertext. It cannot read, decrypt, or access your original message. We have zero knowledge of your content.</p>
                    </div>
                </div>
                <div class="step">
                    <div class="step-number">3</div>
                    <div class="step-content">
                        <h3>Key in URL Fragment</h3>
                        <p>The decryption key is embedded in the URL fragment (after #) which never reaches the server. Only the recipient with the full URL can decrypt.</p>
                    </div>
                </div>
                <div class="step">
                    <div class="step-number">4</div>
                    <div class="step-content">
                        <h3>Password Protection (Optional)</h3>
                        <p>You can add an extra password layer. The password is used to derive the encryption key via PBKDF2 with 100,000 iterations. Share it separately.</p>
                    </div>
                </div>
                <div class="step">
                    <div class="step-number">5</div>
                    <div class="step-content">
                        <h3>Self-Destruction</h3>
                        <p>Choose "Burn after reading" to automatically delete the message after first view, or set an expiration time (1 hour to 30 days).</p>
                    </div>
                </div>
            </div>
            
            <div class="tech-specs">
                <h3>🛡️ Technical Specifications</h3>
                <div class="specs-grid">
                    <div class="spec-item">AES-256-GCM Encryption</div>
                    <div class="spec-item">PBKDF2 Key Derivation (100k iterations)</div>
                    <div class="spec-item">Random 12-byte IV per message</div>
                    <div class="spec-item">256-bit Encryption Keys</div>
                    <div class="spec-item">No Server-Side Logs</div>
                    <div class="spec-item">Cloudflare KV Storage</div>
                    <div class="spec-item">Web Crypto API (Native)</div>
                    <div class="spec-item">No Registration Required</div>
                </div>
            </div>
        </div>

        <footer>
            <p>🛡️ Zero-Knowledge Architecture • Server cannot read your data</p>
            <p style="font-size: 0.8rem; margin-top: 8px; color: var(--text-muted);">
                Built with privacy in mind. No tracking. No analytics. Open source.
            </p>
            
            <div class="footer-links">
                <a href="https://github.com/TheGreatAzizi/Secure-Pastebin-Cloudflare-Worker/" target="_blank" rel="noopener">
                    <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                    GitHub
                </a>
                <a href="https://x.com/the_azzi" target="_blank" rel="noopener">
                    <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    @the_azzi
                </a>
            </div>

            <!-- Internet for All - Human Rights -->
            <div class="internet-for-all">
                <div class="hashtag">#InternetForAll</div>
                <div class="rights-text">
                    <strong>Internet access is a fundamental human right.</strong><br>
                    Restricting internet access violates human rights and limits freedom of expression, 
                    access to information, and the ability to communicate securely. 
                    We believe in <strong>free, open, and secure internet for everyone</strong> — 
                    regardless of borders, politics, or censorship.
                </div>
            </div>

            <div class="tech-stack">
                <span>Cloudflare Workers</span>
                <span>•</span>
                <span>Web Crypto API</span>
                <span>•</span>
                <span>KV Storage</span>
                <span>•</span>
                <span>AES-256-GCM</span>
            </div>
        </footer>
    </div>

    <script>
        let pendingKey = null;
        let pendingData = null;

        function showError(msg) {
            document.getElementById('errorDisplay').style.display = 'flex';
            document.getElementById('errorMessage').textContent = msg;
        }
        
        function clearError() {
            document.getElementById('errorDisplay').style.display = 'none';
        }

        // Auto-detect RTL languages (Persian, Arabic, Hebrew, Urdu, etc.)
        function isRTL(text) {
            // Unicode ranges for RTL scripts
            const rtlRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0590-\u05FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
            return rtlRegex.test(text);
        }

        // Apply RTL styling to textarea
        const contentTextarea = document.getElementById('content');
        contentTextarea.addEventListener('input', function(e) {
            const text = e.target.value;
            if (isRTL(text)) {
                e.target.style.direction = 'rtl';
                e.target.style.fontFamily = "'Vazirmatn', sans-serif";
            } else {
                e.target.style.direction = 'ltr';
                e.target.style.fontFamily = "'JetBrains Mono', monospace";
            }
        });

        function togglePassword() {
            const enabled = document.getElementById('enablePassword').checked;
            const wrapper = document.getElementById('passwordWrapper');
            wrapper.classList.toggle('show', enabled);
        }

        const Base64 = {
            encode(buf) {
                const bytes = new Uint8Array(buf);
                let bin = '';
                for (let b of bytes) bin += String.fromCharCode(b);
                return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
            },
            decode(str) {
                str = str.replace(/-/g, '+').replace(/_/g, '/');
                while (str.length % 4) str += '=';
                const bin = atob(str);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                return bytes;
            }
        };

        async function deriveKeyFromPassword(password, salt) {
            const encoder = new TextEncoder();
            const keyMaterial = await crypto.subtle.importKey(
                'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
            );
            return crypto.subtle.deriveKey(
                { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
                keyMaterial,
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt', 'decrypt']
            );
        }

        function genId() {
            const arr = new Uint8Array(16);
            crypto.getRandomValues(arr);
            return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
        }

        async function createPaste() {
            clearError();
            const content = document.getElementById('content').value.trim();
            if (!content) return showError('Please enter content to encrypt');

            const hasPassword = document.getElementById('enablePassword').checked;
            const password = document.getElementById('passwordInput').value;
            
            if (hasPassword && password.length < 4) {
                return showError('Password must be at least 4 characters');
            }

            const btn = document.getElementById('createBtn');
            const btnText = document.getElementById('btnText');
            btn.disabled = true;
            btnText.innerHTML = '<span class="loading"></span> Encrypting...';

            try {
                let key, keyToExport;
                
                if (hasPassword) {
                    const salt = crypto.getRandomValues(new Uint8Array(16));
                    key = await deriveKeyFromPassword(password, salt);
                    keyToExport = salt;
                } else {
                    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
                    keyToExport = await crypto.subtle.exportKey('raw', key);
                }
                
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const encrypted = await crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv }, 
                    key, 
                    new TextEncoder().encode(content)
                );
                
                const id = genId();
                const payload = { 
                    iv: Array.from(iv), 
                    data: Array.from(new Uint8Array(encrypted)) 
                };
                
                const res = await fetch('/api/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        id, 
                        encryptedData: payload, 
                        expiresIn: parseInt(document.getElementById('expiresIn').value), 
                        burnAfterRead: document.getElementById('burnAfterRead').checked,
                        hasPassword: hasPassword
                    })
                });
                
                const result = await res.json();
                if (!res.ok) throw new Error(result.error || 'Server error');

                let url;
                if (hasPassword) {
                    url = \`\${location.origin}/#\${id}:\${Base64.encode(keyToExport)}:pwd\`;
                } else {
                    url = \`\${location.origin}/#\${id}:\${Base64.encode(keyToExport)}\`;
                }
                
                document.getElementById('shareUrl').value = url;
                document.getElementById('expiryTime').textContent = new Date(Date.now() + parseInt(document.getElementById('expiresIn').value) * 1000).toLocaleString();
                document.getElementById('passwordNotice').style.display = hasPassword ? 'flex' : 'none';
                document.getElementById('resultBox').classList.add('show');
                document.getElementById('content').value = '';
                
            } catch (err) {
                showError(err.message);
            } finally {
                btn.disabled = false;
                btnText.textContent = '🔐 Encrypt & Save';
            }
        }

        async function decryptPaste() {
            const hash = location.hash.slice(1);
            if (!hash.includes(':')) return;
            
            const parts = hash.split(':');
            const id = parts[0];
            const keyData = parts[1];
            const isPasswordProtected = parts[2] === 'pwd';
            
            try {
                const res = await fetch(\`/api/get/\${id}\`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);

                if (data.hasPassword || isPasswordProtected) {
                    pendingKey = keyData;
                    pendingData = data;
                    document.getElementById('createView').style.display = 'none';
                    document.getElementById('passwordPrompt').classList.add('show');
                    return;
                }
                
                await performDecryption(keyData, data);
                
            } catch (err) {
                showError('Failed: ' + err.message);
                setTimeout(() => location.href = '/', 3000);
            }
        }

        async function decryptWithPassword() {
            const password = document.getElementById('decryptPassword').value;
            if (!password) return;
            
            const btn = document.querySelector('#passwordPrompt .btn');
            const btnText = document.getElementById('decryptBtnText');
            btn.disabled = true;
            btnText.innerHTML = '<span class="loading"></span> Decrypting...';
            
            try {
                const salt = Base64.decode(pendingKey);
                const key = await deriveKeyFromPassword(password, salt);
                await performDecryption(key, pendingData, true);
            } catch (err) {
                document.getElementById('passwordError').style.display = 'block';
                btn.disabled = false;
                btnText.textContent = '🔓 Decrypt';
            }
        }

        async function performDecryption(keyOrData, data, isKeyObject = false) {
            let key;
            
            if (isKeyObject) {
                key = keyOrData;
            } else {
                const keyRaw = Base64.decode(keyOrData);
                key = await crypto.subtle.importKey(
                    'raw', keyRaw, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
                );
            }
            
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: new Uint8Array(data.data.iv) }, 
                key, 
                new Uint8Array(data.data.data)
            );
            
            const text = new TextDecoder().decode(decrypted);
            
            document.getElementById('passwordPrompt').classList.remove('show');
            document.getElementById('decryptView').classList.add('show');
            
            if (data.burnAfterRead) {
                document.getElementById('burnNotice').style.display = 'flex';
            }
            
            const contentBox = document.getElementById('decryptedContent');
            contentBox.textContent = text;
            
            // Apply RTL to decrypted content if needed
            if (isRTL(text)) {
                contentBox.style.direction = 'rtl';
                contentBox.style.fontFamily = "'Vazirmatn', sans-serif";
            } else {
                contentBox.style.direction = 'ltr';
                contentBox.style.fontFamily = "'JetBrains Mono', monospace";
            }
            
            history.replaceState(null, null, ' ');
        }

        function copyUrl() {
            const inp = document.getElementById('shareUrl');
            inp.select();
            document.execCommand('copy');
            const btn = document.querySelector('.btn-copy');
            btn.textContent = '✅ Copied!';
            setTimeout(() => btn.textContent = '📋 Copy', 2000);
        }

        window.addEventListener('load', () => {
            if (location.hash.length > 1) decryptPaste();
        });
    </script>
</body>
</html>`;
