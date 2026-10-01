import { encrypt, decrypt, parseFragment, createReadToken, MAX_PLAINTEXT } from '/crypto.js';

const $ = id => document.getElementById(id);
const views = ['createView', 'resultBox', 'openView', 'passwordPrompt', 'decryptView'];
let link = null;
let pendingData = null;
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
function updateSize() {
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
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

$('content').addEventListener('input', updateSize);
$('skipLink').addEventListener('click', event => {
  event.preventDefault();
  $('main').focus();
});
$('enablePassword').addEventListener('change', () => {
  $('passwordWrapper').hidden = !$('enablePassword').checked;
  if ($('enablePassword').checked) $('passwordInput').focus();
  else $('passwordInput').value = '';
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
  };
  const text = $('content').value;
  $('createFields').disabled = true;
  $('createView').setAttribute('aria-busy', 'true');
  $('btnText').textContent = 'Encrypting…';
  try {
    const encrypted = await encrypt(text, options.password);
    const access = await createReadToken();
    if (currentVersion !== viewVersion) return;
    $('btnText').textContent = 'Creating link…';
    const result = await api('/api/create', {
      encryptedData: encrypted.encryptedData,
      expiresIn: options.expiresIn,
      burnAfterRead: options.burnAfterRead,
      hasPassword: encrypted.hasPassword,
      readTokenHash: access.readTokenHash,
    });
    if (currentVersion !== viewVersion) return;
    $('shareUrl').value = `${location.origin}/#v3:${result.id}:${encrypted.secret}:${access.readToken}${encrypted.hasPassword ? ':pwd2' : ''}`;
    $('expiryTime').textContent = new Date(result.expiresAt).toLocaleString(undefined, {
      dateStyle: 'medium', timeStyle: 'short',
    });
    $('readingMode').textContent = options.burnAfterRead ? 'One-time retrieval' : 'Until the link expires';
    $('passwordNotice').hidden = !encrypted.hasPassword;
    $('content').value = '';
    $('passwordInput').value = '';
    updateSize();
    setView('resultBox', 'Ready to share.', 'Your message is encrypted. The next step is yours.');
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
  const plaintext = await decrypt(currentData.data, currentLink.secret, password);
  // A fragment change during decryption must not reveal a previous message.
  if (link !== currentLink || pendingData !== currentData) return;
  $('decryptedContent').textContent = plaintext;
  $('burnNotice').hidden = !currentData.burnAfterRead;
  $('decryptPassword').value = '';
  pendingData = null;
  link = null;
  history.replaceState(null, '', '/');
  setView('decryptView', 'A note for you.', 'Decrypted here, in your browser.');
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
    const data = await api(`/api/read/${currentLink.id}`, currentLink.readToken ? { readToken: currentLink.readToken } : {});
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
  try { await reveal($('decryptPassword').value); }
  catch {
    if (link !== currentLink) return;
    $('passwordError').textContent = 'That password didn’t unlock the message. Check with the sender and try again in this tab.';
    $('passwordError').hidden = false;
    $('decryptPassword').setAttribute('aria-invalid', 'true');
    $('decryptPassword').focus();
  } finally {
    $('decryptBtn').disabled = false;
    $('decryptBtnText').textContent = 'Unlock message';
    $('unlockForm').setAttribute('aria-busy', 'false');
  }
});

$('copyBtn').addEventListener('click', async () => {
  clearTimeout(copyTimer);
  try {
    await navigator.clipboard.writeText($('shareUrl').value);
    $('copyBtn').textContent = 'Copied';
    $('copyStatus').textContent = 'Link copied. Ready to send.';
    copyTimer = setTimeout(() => { $('copyBtn').textContent = 'Copy link'; }, 2500);
  } catch {
    $('shareUrl').focus();
    $('shareUrl').select();
    $('copyStatus').textContent = 'Copy the selected link manually. Clipboard access is unavailable.';
  }
});
$('copyMessageBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('decryptedContent').textContent);
    $('messageCopyStatus').textContent = 'Message copied.';
  } catch { $('messageCopyStatus').textContent = 'Clipboard access is unavailable. Select and copy the message manually.'; }
});

function openFragment() {
  if (!location.hash) return;
  viewVersion++;
  clearError();
  pendingData = null;
  link = null;
  for (const id of ['content', 'passwordInput', 'shareUrl']) $(id).value = '';
  $('decryptedContent').textContent = '';
  $('decryptPassword').value = '';
  $('passwordError').hidden = true;
  $('decryptPassword').removeAttribute('aria-invalid');
  setView('openView', 'A note for you.', 'Someone shared a private message. Open it when you’re ready.');
  try {
    link = parseFragment(location.hash);
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
  link = null;
  for (const id of ['content', 'passwordInput', 'decryptPassword', 'shareUrl']) $(id).value = '';
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
