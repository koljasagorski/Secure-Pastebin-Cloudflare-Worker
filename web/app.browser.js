import { encrypt, decrypt, encryptFile, decryptFile, authProof, parseFragment, createReadToken, encode, decode, MAX_PLAINTEXT, MAX_FILE } from '/crypto.js';

const $ = id => document.getElementById(id);
const views = ['createView', 'resultBox', 'openView', 'passwordPrompt', 'decryptView'];
let link = null;
let pendingData = null;
let selectedFile = null;
let openedFile = null;
let copyTimer;
let viewVersion = 0;

function setView(view, title, description) {
  for (const id of views) $(id).hidden = id !== view;
  if (title) $('pageTitle').textContent = title;
  if (description) $('pageDescription').textContent = description;
}
function showError(message, recover = false) {
  $('errorDisplay').hidden = false;
  $('errorMessage').textContent = message;
  $('recoveryLink').hidden = !recover;
}
function clearError() {
  $('errorDisplay').hidden = true;
  $('recoveryLink').hidden = true;
}
function formatSize(bytes) {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
function updateFileMode() {
  const file = Boolean(selectedFile);
  $('content').disabled = file;
  $('clearFileBtn').hidden = !file;
  $('fileLabel').textContent = file ? 'Choose another file' : 'Attach a file instead';
  $('fileHint').textContent = file ? `${selectedFile.name} · ${formatSize(selectedFile.size)}` : 'Up to 100 MB, kept for at most 48 hours.';
  // Files are kept for at most 48 hours.
  for (const option of document.querySelectorAll('#expiresIn [data-text-only]')) option.hidden = option.disabled = file;
  if ($('expiresIn').selectedOptions[0]?.disabled) $('expiresIn').value = '86400';
  updateSize();
}
function updateSize() {
  if (selectedFile) {
    $('byteCount').textContent = `${formatSize(selectedFile.size)} / 100 MB`;
    $('byteCount').classList.toggle('over-limit', selectedFile.size > MAX_FILE);
    return;
  }
  const bytes = new TextEncoder().encode($('content').value).length;
  $('byteCount').textContent = `${bytes ? (bytes / 1024).toFixed(1) : '0'} / 64 KiB`;
  $('byteCount').classList.toggle('over-limit', bytes > MAX_PLAINTEXT);
  $('content').setAttribute('aria-invalid', String(bytes > MAX_PLAINTEXT));
}

async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
  });
  if (response.ok && response.headers.get('content-type')?.startsWith('application/octet-stream')) {
    // Files arrive as raw ciphertext, with the IV and options in a header.
    const meta = JSON.parse(new TextDecoder().decode(decode(response.headers.get('x-paste-meta'))));
    return { ...meta, file: true, bytes: await response.arrayBuffer() };
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// One request for the whole file. XMLHttpRequest is used only because fetch cannot report upload progress.
function uploadFile(ciphertext, meta, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/upload');
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.setRequestHeader('X-Paste-Meta', encode(new TextEncoder().encode(JSON.stringify(meta))));
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    request.onload = () => {
      let data = {};
      try { data = JSON.parse(request.responseText); } catch { /* Non-JSON edge errors fall through. */ }
      if (request.status === 201) resolve(data);
      else reject(new Error(request.status === 413 ? 'File exceeds the 100 MB limit' : data.error || 'Upload failed'));
    };
    request.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    request.send(ciphertext);
  });
}

$('content').addEventListener('input', updateSize);
$('fileInput').addEventListener('change', () => {
  selectedFile = $('fileInput').files[0] ?? null;
  clearError();
  if (selectedFile && selectedFile.size > MAX_FILE) {
    showError('File exceeds the 100 MB limit');
    selectedFile = null;
    $('fileInput').value = '';
  }
  updateFileMode();
});
$('clearFileBtn').addEventListener('click', () => {
  selectedFile = null;
  $('fileInput').value = '';
  updateFileMode();
  $('fileInput').focus();
});
$('skipLink').addEventListener('click', event => {
  event.preventDefault();
  $('main').focus();
});
$('enablePassword').addEventListener('change', () => {
  $('passwordWrapper').hidden = !$('enablePassword').checked;
  if ($('enablePassword').checked) $('passwordInput').focus();
  else { $('passwordInput').value = ''; $('enableShort').checked = false; }
});

$('createView').addEventListener('submit', async event => {
  event.preventDefault();
  clearError();
  if ($('createFields').disabled) return;
  const currentVersion = viewVersion;
  const options = {
    expiresIn: Number($('expiresIn').value),
    burnAfterRead: $('burnAfterRead').checked,
    password: $('enablePassword').checked ? $('passwordInput').value : null,
    short: $('enablePassword').checked && $('enableShort').checked,
  };
  const text = $('content').value;
  const file = selectedFile;
  $('createFields').disabled = true;
  $('createView').setAttribute('aria-busy', 'true');
  $('btnText').textContent = 'Encrypting…';
  try {
    const encrypted = file ? await encryptFile(file, options.password) : await encrypt(text, options.password);
    const access = await createReadToken();
    if (currentVersion !== viewVersion) return;
    $('btnText').textContent = 'Creating link…';
    // A short link has no key in it, so it exists only on request and only with a password.
    // The server stores the public salt and a hash of a password-derived proof. It releases
    // a short-link message only for a matching proof, so guessing a code gets nothing.
    const proof = options.short ? await authProof(options.password, encrypted.secret) : null;
    const shared = {
      expiresIn: options.expiresIn,
      burnAfterRead: options.burnAfterRead,
      hasPassword: encrypted.hasPassword,
      readTokenHash: access.readTokenHash,
      ...(proof ? { short: true, salt: encrypted.secret, authHash: proof.hash } : {}),
    };
    const result = file
      ? await uploadFile(encrypted.ciphertext, { ...shared, iv: encrypted.iv }, fraction => {
        $('btnText').textContent = `Uploading… ${Math.round(fraction * 100)}%`;
      })
      : await api('/api/create', { ...shared, encryptedData: encrypted.encryptedData });
    if (currentVersion !== viewVersion) return;
    $('shortBox').hidden = !result.shortCode;
    $('shortUrl').value = result.shortCode ? `${location.origin}/${result.shortCode}` : '';
    $('shareUrl').value = `${location.origin}/#v3:${result.id}:${encrypted.secret}:${access.readToken}${encrypted.hasPassword ? ':pwd2' : ''}`;
    $('expiryTime').textContent = new Date(result.expiresAt).toLocaleString(undefined, {
      dateStyle: 'medium', timeStyle: 'short',
    });
    $('readingMode').textContent = options.burnAfterRead ? 'One-time retrieval' : 'Until the link expires';
    $('passwordNotice').hidden = !encrypted.hasPassword;
    $('content').value = '';
    $('passwordInput').value = '';
    $('enableShort').checked = false;
    selectedFile = null;
    $('fileInput').value = '';
    updateFileMode();
    setView('resultBox', 'Ready to share.', file ? 'Your file is encrypted. The next step is yours.' : 'Your message is encrypted. The next step is yours.');
    $('resultTitle').focus();
  } catch (error) { if (currentVersion === viewVersion) showError(error.message); }
  finally {
    $('createFields').disabled = false;
    $('createView').setAttribute('aria-busy', 'false');
    $('btnText').textContent = 'Create private link';
  }
});

async function reveal(password = null) {
  const currentLink = link;
  const currentData = pendingData;
  // Short links carry no key. Their salt comes from the server and the password does the rest.
  const secret = currentLink.short ? currentData.salt : currentLink.secret;
  const plaintext = currentData.file ? null : await decrypt(currentData.data, secret, password);
  const opened = currentData.file ? await decryptFile(currentData.iv, currentData.bytes, secret, password) : null;
  // A fragment change during decryption must not reveal a previous message.
  if (link !== currentLink || pendingData !== currentData) return;
  $('decryptedContent').hidden = Boolean(opened);
  $('copyMessageBtn').hidden = Boolean(opened);
  $('fileResult').hidden = !opened;
  openedFile = opened;
  if (opened) $('fileInfo').textContent = `${opened.name} · ${formatSize(opened.data.length)}`;
  else $('decryptedContent').textContent = plaintext;
  $('burnNotice').hidden = !currentData.burnAfterRead;
  $('decryptPassword').value = '';
  pendingData = null;
  link = null;
  history.replaceState(null, '', '/');
  setView('decryptView', opened ? 'A file for you.' : 'A note for you.', 'Decrypted here, in your browser.');
  $('messageTitle').focus();
}

$('openBtn').addEventListener('click', async () => {
  clearError();
  if (!link || $('openBtn').disabled) return;
  const currentLink = link;
  $('openBtn').disabled = true;
  $('openBtn').textContent = 'Opening…';
  $('openView').setAttribute('aria-busy', 'true');
  try {
    // Never retrieve ciphertext on page load: link previews must not burn a paste.
    if (currentLink.short) {
      // Short links first fetch only the public salt. The message is released after the password proof.
      const { salt } = await api(`/api/short/${currentLink.short}`, {});
      if (link !== currentLink) return;
      pendingData = { locked: true, salt };
      history.replaceState(null, '', '/');
      setView('passwordPrompt');
      $('decryptPassword').focus();
      return;
    }
    const data = await api(`/api/read/${currentLink.id}`,
      currentLink.readToken ? { readToken: currentLink.readToken } : {});
    if (link !== currentLink) return;
    pendingData = data;
    if (link.hasPassword !== data.hasPassword) throw new Error('The link does not match this message');
    // The key is needed only in memory now, including during password retries.
    history.replaceState(null, '', '/');
    if (link.hasPassword) {
      setView('passwordPrompt');
      $('decryptPassword').focus();
    } else { await reveal(); }
  } catch (error) {
    if (link !== currentLink) return;
    showError(`${error.message}. If this was a one-time message, ask the sender for a new link.`, true);
    $('openBtn').textContent = 'Unable to open';
  } finally { $('openView').setAttribute('aria-busy', 'false'); }
});

$('unlockForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!pendingData || !link || $('decryptBtn').disabled) return;
  const currentLink = link;
  $('passwordError').hidden = true;
  $('decryptPassword').removeAttribute('aria-invalid');
  $('decryptBtn').disabled = true;
  $('decryptBtnText').textContent = 'Decrypting…';
  $('unlockForm').setAttribute('aria-busy', 'true');
  try {
    const password = $('decryptPassword').value;
    if (pendingData.locked) {
      // A wrong password fails here and leaves the message untouched on the server.
      const { proof } = await authProof(password, pendingData.salt);
      const data = await api(`/api/short/${currentLink.short}`, { proof });
      if (link !== currentLink) return;
      pendingData = data;
    }
    await reveal(password);
  } catch {
    if (link !== currentLink) return;
    $('passwordError').textContent = 'That password didn’t unlock the message, or it has expired. Check with the sender and try again in this tab.';
    $('passwordError').hidden = false;
    $('decryptPassword').setAttribute('aria-invalid', 'true');
    $('decryptPassword').focus();
  } finally {
    $('decryptBtn').disabled = false;
    $('decryptBtnText').textContent = 'Unlock message';
    $('unlockForm').setAttribute('aria-busy', 'false');
  }
});

for (const [button, field, label] of [['copyBtn', 'shareUrl', 'Copy link'], ['copyShortBtn', 'shortUrl', 'Copy short link']]) {
  $(button).addEventListener('click', async () => {
    clearTimeout(copyTimer);
    try {
      await navigator.clipboard.writeText($(field).value);
      $(button).textContent = 'Copied';
      $('copyStatus').textContent = 'Link copied. Ready to send.';
      copyTimer = setTimeout(() => { $(button).textContent = label; }, 2500);
    } catch {
      $(field).focus();
      $(field).select();
      $('copyStatus').textContent = 'Copy the selected link manually. Clipboard access is unavailable.';
    }
  });
}
$('downloadBtn').addEventListener('click', () => {
  if (!openedFile) return;
  // octet-stream makes the browser save the file instead of rendering it.
  const url = URL.createObjectURL(new Blob([openedFile.data], { type: 'application/octet-stream' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = openedFile.name.replace(/[\\/:*?"<>|]/g, '_') || 'file';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});
$('copyMessageBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('decryptedContent').textContent);
    $('messageCopyStatus').textContent = 'Message copied.';
  } catch { $('messageCopyStatus').textContent = 'Clipboard access is unavailable. Select and copy the message manually.'; }
});

function openFragment() {
  // /k7m2xq is a short link. Everything else needs a fragment.
  const shortCode = /^\/([2-9a-hj-km-np-z]{6})$/i.exec(location.pathname)?.[1].toLowerCase();
  if (!location.hash && !shortCode) return;
  viewVersion++;
  clearError();
  pendingData = null;
  openedFile = null;
  link = null;
  for (const id of ['content', 'passwordInput', 'shareUrl', 'shortUrl']) $(id).value = '';
  $('decryptedContent').textContent = '';
  $('decryptPassword').value = '';
  $('passwordError').hidden = true;
  $('decryptPassword').removeAttribute('aria-invalid');
  setView('openView', 'A note for you.', 'Someone shared a private message. Open it when you’re ready.');
  try {
    if (shortCode && !location.hash) {
      link = { short: shortCode, hasPassword: true };
      $('openCopy').textContent = 'This message is protected by a password. You will be asked for it next.';
    } else {
      link = parseFragment(location.hash);
      $('openCopy').textContent = 'Your browser will unlock the message using the key in your link.';
    }
    $('openBtn').disabled = false;
    $('openBtn').textContent = 'Open message ↗';
  } catch (error) {
    setView(null, 'This link isn’t complete.', 'Ask the sender to share the full link, including everything after #.');
    showError(error.message, true);
  }
}
window.addEventListener('hashchange', openFragment);
openFragment();

// Clear the document before it can enter the browser's back/forward cache.
window.addEventListener('pagehide', () => {
  viewVersion++;
  pendingData = null;
  openedFile = null;
  link = null;
  for (const id of ['content', 'passwordInput', 'decryptPassword', 'shareUrl', 'shortUrl']) $(id).value = '';
  $('decryptedContent').textContent = '';
});
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

const themePreference = matchMedia('(prefers-color-scheme: dark)');
function updateThemeButton() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark' : themePreference.matches;
  $('themeBtn').textContent = dark ? 'Light mode' : 'Dark mode';
  $('themeBtn').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}
try {
  const saved = localStorage.getItem('paste-theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch { /* Theme selection also works without browser storage. */ }
updateThemeButton();
themePreference.addEventListener('change', updateThemeButton);
$('themeBtn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark' : themePreference.matches;
  const theme = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('paste-theme', theme); } catch { /* Preference is optional. */ }
  updateThemeButton();
});
$('aboutBtn').addEventListener('click', () => $('aboutDialog').showModal());
$('closeAboutBtn').addEventListener('click', () => $('aboutDialog').close());
$('aboutDialog').addEventListener('click', event => {
  if (event.target !== $('aboutDialog')) return;
  const bounds = $('aboutDialog').getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $('aboutDialog').close();
});
