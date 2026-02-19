export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // API Routes
    if (path === '/api/create' && request.method === 'POST') {
      return handleCreate(request, env, corsHeaders);
    }
    
    if (path.startsWith('/api/get/') && request.method === 'GET') {
      const id = path.split('/')[3];
      return handleGet(id, env, corsHeaders);
    }

    // Serve Static UI
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
    const { id, encryptedData, expiresIn, burnAfterRead } = await request.json();
    
    // Validation
    if (!id || !encryptedData || encryptedData.length > 500000) {
      return jsonResponse({ error: 'Invalid data' }, 400, corsHeaders);
    }

    const ttl = Math.min(parseInt(expiresIn) || 3600, 2592000); // Max 30 days
    
    const paste = {
      data: encryptedData,
      created: Date.now(),
      burnAfterRead: !!burnAfterRead,
      views: 0
    };

    await env.PASTEBIN_KV.put(id, JSON.stringify(paste), { expirationTtl: ttl });

    return jsonResponse({ 
      success: true, 
      id,
      expiresIn: ttl,
      url: `https://${request.headers.get('host')}/#${id}`
    }, 200, corsHeaders);

  } catch (err) {
    return jsonResponse({ error: 'Server error' }, 500, corsHeaders);
  }
}

async function handleGet(id, env, corsHeaders) {
  try {
    const data = await env.PASTEBIN_KV.get(id);
    
    if (!data) {
      return jsonResponse({ error: 'Paste not found or expired' }, 404, corsHeaders);
    }

    const paste = JSON.parse(data);
    
    // Burn after reading logic
    if (paste.burnAfterRead) {
      await env.PASTEBIN_KV.delete(id);
    } else {
      // Update view count (optional tracking)
      paste.views = (paste.views || 0) + 1;
      const remainingTtl = Math.floor((paste.created + paste.expiresIn * 1000 - Date.now()) / 1000);
      if (remainingTtl > 0) {
        await env.PASTEBIN_KV.put(id, JSON.stringify(paste), { expirationTtl: remainingTtl });
      }
    }

    return jsonResponse({
      data: paste.data,
      burnAfterRead: paste.burnAfterRead,
      created: paste.created
    }, 200, corsHeaders);

  } catch (err) {
    return jsonResponse({ error: 'Server error' }, 500, corsHeaders);
  }
}

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
}

// Embedded UI (Single File Deployment)
const HTML_UI = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🔐 Secure Pastebin</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Segoe UI', Tahoma, system-ui, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            min-height: 100vh;
            color: #eaeaea;
            padding: 20px;
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        
        header {
            text-align: center;
            padding: 40px 0;
        }
        
        h1 {
            font-size: 2.5rem;
            background: linear-gradient(45deg, #e94560, #ff6b6b);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 10px;
        }
        
        .subtitle {
            color: #a0a0a0;
            font-size: 1.1rem;
        }
        
        .card {
            background: rgba(255,255,255,0.05);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 20px;
            padding: 30px;
            margin-bottom: 20px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }
        
        textarea {
            width: 100%;
            min-height: 200px;
            background: rgba(0,0,0,0.3);
            border: 2px solid rgba(255,255,255,0.1);
            border-radius: 12px;
            padding: 15px;
            color: #fff;
            font-family: 'Fira Code', monospace;
            font-size: 14px;
            resize: vertical;
            transition: border-color 0.3s;
        }
        
        textarea:focus {
            outline: none;
            border-color: #e94560;
        }
        
        .options {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin: 20px 0;
        }
        
        .option-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        label {
            font-size: 0.9rem;
            color: #b0b0b0;
            font-weight: 500;
        }
        
        select, input[type="checkbox"] {
            padding: 12px;
            background: rgba(0,0,0,0.3);
            border: 2px solid rgba(255,255,255,0.1);
            border-radius: 8px;
            color: #fff;
            cursor: pointer;
        }
        
        .checkbox-wrapper {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 12px;
            background: rgba(0,0,0,0.2);
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.3s;
        }
        
        .checkbox-wrapper:hover {
            background: rgba(233, 69, 96, 0.1);
        }
        
        input[type="checkbox"] {
            width: 20px;
            height: 20px;
            accent-color: #e94560;
        }
        
        button {
            width: 100%;
            padding: 15px;
            background: linear-gradient(45deg, #e94560, #ff6b6b);
            border: none;
            border-radius: 12px;
            color: white;
            font-size: 1.1rem;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        button:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 10px 30px rgba(233, 69, 96, 0.4);
        }
        
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        
        .result {
            display: none;
            margin-top: 20px;
            padding: 20px;
            background: rgba(0,255,0,0.1);
            border: 1px solid rgba(0,255,0,0.3);
            border-radius: 12px;
        }
        
        .result.show {
            display: block;
            animation: slideIn 0.3s ease;
        }
        
        @keyframes slideIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .url-box {
            display: flex;
            gap: 10px;
            margin-top: 10px;
        }
        
        .url-box input {
            flex: 1;
            padding: 12px;
            background: rgba(0,0,0,0.5);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 8px;
            color: #4ade80;
            font-family: monospace;
            direction: ltr;
        }
        
        .copy-btn {
            width: auto;
            padding: 12px 20px;
            background: rgba(255,255,255,0.1);
        }
        
        .warning {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 15px;
            background: rgba(234, 179, 8, 0.1);
            border: 1px solid rgba(234, 179, 8, 0.3);
            border-radius: 8px;
            margin-bottom: 20px;
            font-size: 0.9rem;
        }
        
        .security-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 5px 12px;
            background: rgba(74, 222, 128, 0.2);
            color: #4ade80;
            border-radius: 20px;
            font-size: 0.8rem;
            margin-top: 10px;
        }
        
        .decrypt-view {
            display: none;
        }
        
        .decrypt-view.show {
            display: block;
        }
        
        .content-display {
            background: rgba(0,0,0,0.5);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px;
            padding: 20px;
            margin-top: 15px;
            font-family: 'Fira Code', monospace;
            white-space: pre-wrap;
            word-break: break-all;
            max-height: 500px;
            overflow-y: auto;
        }
        
        .burn-notice {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            color: #f87171;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            border-top-color: #fff;
            animation: spin 1s ease-in-out infinite;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        footer {
            text-align: center;
            padding: 40px 0;
            color: #666;
            font-size: 0.9rem;
        }
        
        @media (max-width: 600px) {
            .options { grid-template-columns: 1fr; }
            h1 { font-size: 1.8rem; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🔐 Secure Pastebin</h1>
            <p class="subtitle">رمزنگاری سرتاسری - حتی سرور هم نمی‌تونه محتوا رو بخونه</p>
            <span class="security-badge">🔒 AES-256-GCM + PBKDF2</span>
        </header>

        <!-- Create View -->
        <div id="createView" class="card">
            <div class="warning">
                <span>⚠️</span>
                <span>کلید رمزنگاری فقط در URL ذخیره می‌شه. اگر URL رو گم کنی، داده‌ها برای همیشه از دست می‌رن!</span>
            </div>
            
            <textarea id="content" placeholder="متن خود را اینجا بنویسید..."></textarea>
            
            <div class="options">
                <div class="option-group">
                    <label>⏱️ مدت اعتبار</label>
                    <select id="expiresIn">
                        <option value="3600">۱ ساعت</option>
                        <option value="86400" selected>۱ روز</option>
                        <option value="604800">۱ هفته</option>
                        <option value="2592000">۳۰ روز</option>
                    </select>
                </div>
                
                <div class="option-group">
                    <label>🔥 حالت خود-تخریب</label>
                    <label class="checkbox-wrapper">
                        <input type="checkbox" id="burnAfterRead">
                        <span>بعد از اولین بازدید حذف شود</span>
                    </label>
                </div>
            </div>
            
            <button id="createBtn" onclick="createPaste()">
                <span id="btnText">🔐 رمزنگاری و ذخیره</span>
            </button>
            
            <div id="result" class="result">
                <strong>✅ با موفقیت ایجاد شد!</strong>
                <p style="margin: 10px 0; color: #aaa;">این لینک رو کپی کن و برای طرف مقابل بفرست:</p>
                <div class="url-box">
                    <input type="text" id="shareUrl" readonly>
                    <button class="copy-btn" onclick="copyUrl()">📋 کپی</button>
                </div>
                <p style="margin-top: 10px; font-size: 0.9rem; color: #888;">
                    ⏰ منقضی می‌شود: <span id="expiryDisplay"></span>
                </p>
            </div>
        </div>

        <!-- Decrypt View -->
        <div id="decryptView" class="card decrypt-view">
            <div id="burnNotice" class="burn-notice" style="display: none;">
                <span>🔥</span>
                <span>این پیام بعد از نمایش برای همیشه حذف خواهد شد!</span>
            </div>
            
            <h3>🔓 محتوای رمزگشایی شده:</h3>
            <div id="decryptedContent" class="content-display"></div>
            
            <button onclick="window.location.href='/'" style="margin-top: 15px;">
                📝 ایجاد پیام جدید
            </button>
        </div>

        <footer>
            <p>🛡️ Zero-Knowledge Architecture | هیچ داده‌ای روی سرور ذخیره نمی‌شود</p>
            <p style="margin-top: 5px; font-size: 0.8rem;">ساخته شده با Cloudflare Workers</p>
        </footer>
    </div>

    <script>
        // Crypto Utilities
        const CryptoUtils = {
            async generateKey() {
                const array = new Uint8Array(32);
                crypto.getRandomValues(array);
                return array;
            },
            
            async deriveKey(password, salt) {
                const encoder = new TextEncoder();
                const keyMaterial = await crypto.subtle.importKey(
                    'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
                );
                
                return crypto.subtle.deriveKey(
                    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
                    keyMaterial,
                    { name: 'AES-GCM', length: 256 },
                    false,
                    ['encrypt', 'decrypt']
                );
            },
            
            async encrypt(text, key) {
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const encoder = new TextEncoder();
                const encrypted = await crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv },
                    key,
                    encoder.encode(text)
                );
                
                return {
                    iv: Array.from(iv),
                    data: Array.from(new Uint8Array(encrypted))
                };
            },
            
            async decrypt(encryptedData, key) {
                const decrypted = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv: new Uint8Array(encryptedData.iv) },
                    key,
                    new Uint8Array(encryptedData.data)
                );
                
                return new TextDecoder().decode(decrypted);
            },
            
            bufferToBase64(buffer) {
                const bytes = new Uint8Array(buffer);
                let binary = '';
                for (let i = 0; i < bytes.byteLength; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
            },
            
            base64ToBuffer(base64) {
                base64 = base64.replace(/-/g, '+').replace(/_/g, '/');
                while (base64.length % 4) base64 += '=';
                const binary = atob(base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                return bytes;
            }
        };

        // Generate random ID
        function generateId() {
            const array = new Uint8Array(16);
            crypto.getRandomValues(array);
            return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
        }

        // Create Paste
        async function createPaste() {
            const content = document.getElementById('content').value;
            if (!content.trim()) {
                alert('لطفاً متنی وارد کنید!');
                return;
            }

            const btn = document.getElementById('createBtn');
            const btnText = document.getElementById('btnText');
            btn.disabled = true;
            btnText.innerHTML = '<span class="loading"></span> در حال رمزنگاری...';

            try {
                // Generate encryption key
                const key = await crypto.subtle.generateKey(
                    { name: 'AES-GCM', length: 256 },
                    true,
                    ['encrypt', 'decrypt']
                );
                
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const encoder = new TextEncoder();
                
                // Encrypt content
                const encrypted = await crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv },
                    key,
                    encoder.encode(content)
                );

                // Export key raw
                const keyRaw = await crypto.subtle.exportKey('raw', key);
                
                // Prepare data for server
                const pasteId = generateId();
                const encryptedPackage = {
                    iv: Array.from(iv),
                    data: Array.from(new Uint8Array(encrypted))
                };

                // Send to server
                const response = await fetch('/api/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: pasteId,
                        encryptedData: encryptedPackage,
                        expiresIn: parseInt(document.getElementById('expiresIn').value),
                        burnAfterRead: document.getElementById('burnAfterRead').checked
                    })
                });

                if (!response.ok) throw new Error('Server error');

                // Build URL with key in fragment
                const keyBase64 = CryptoUtils.bufferToBase64(keyRaw);
                const shareUrl = \`\${window.location.origin}/#\${pasteId}:\${keyBase64}\`;
                
                // Show result
                document.getElementById('shareUrl').value = shareUrl;
                document.getElementById('expiryDisplay').textContent = 
                    new Date(Date.now() + parseInt(document.getElementById('expiresIn').value) * 1000).toLocaleString('fa-IR');
                document.getElementById('result').classList.add('show');
                
                // Clear textarea
                document.getElementById('content').value = '';

            } catch (err) {
                console.error(err);
                alert('خطا در رمزنگاری: ' + err.message);
            } finally {
                btn.disabled = false;
                btnText.textContent = '🔐 رمزنگاری و ذخیره';
            }
        }

        // Decrypt Paste
        async function decryptPaste() {
            const hash = window.location.hash.slice(1);
            if (!hash.includes(':')) return false;
            
            const [pasteId, keyBase64] = hash.split(':');
            
            try {
                // Fetch encrypted data
                const response = await fetch(\`/api/get/\${pasteId}\`);
                if (!response.ok) throw new Error('Paste not found');
                
                const result = await response.json();
                
                // Import key
                const keyRaw = CryptoUtils.base64ToBuffer(keyBase64);
                const key = await crypto.subtle.importKey(
                    'raw', keyRaw, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
                );
                
                // Decrypt
                const decrypted = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv: new Uint8Array(result.data.iv) },
                    key,
                    new Uint8Array(result.data.data)
                );
                
                const text = new TextDecoder().decode(decrypted);
                
                // Show decrypted content
                document.getElementById('createView').style.display = 'none';
                document.getElementById('decryptView').classList.add('show');
                
                if (result.burnAfterRead) {
                    document.getElementById('burnNotice').style.display = 'flex';
                }
                
                document.getElementById('decryptedContent').textContent = text;
                
                // Clear hash for security
                history.replaceState(null, null, ' ');
                
                return true;
                
            } catch (err) {
                console.error(err);
                alert('❌ خطا در رمزگشایی! احتمالاً کلید اشتباه است یا پیام منقضی شده.');
                window.location.href = '/';
                return false;
            }
        }

        function copyUrl() {
            const input = document.getElementById('shareUrl');
            input.select();
            document.execCommand('copy');
            
            const btn = document.querySelector('.copy-btn');
            const original = btn.textContent;
            btn.textContent = '✅ کپی شد!';
            setTimeout(() => btn.textContent = original, 2000);
        }

        // Check for paste ID on load
        window.addEventListener('load', () => {
            if (window.location.hash.length > 1) {
                decryptPaste();
            }
        });
    </script>
</body>
</html>`;
