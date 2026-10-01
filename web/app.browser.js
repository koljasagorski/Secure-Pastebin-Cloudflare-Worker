import { encrypt, decrypt, parseFragment } from '/crypto.js';

const $ = id => document.getElementById(id);
let link = null;
let pendingData = null;

function showError(message) {
  $('errorDisplay').style.display = 'flex';
  $('errorMessage').textContent = message;
}
function clearError() { $('errorDisplay').style.display = 'none'; }

async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

$('enablePassword').addEventListener('change', () => {
  $('passwordWrapper').classList.toggle('show', $('enablePassword').checked);
});

$('createBtn').addEventListener('click', async () => {
  clearError();
  $('resultBox').classList.remove('show');
  $('createBtn').disabled = true;
  $('btnText').textContent = 'Encrypting…';
  try {
    const encrypted = await encrypt($('content').value, $('enablePassword').checked ? $('passwordInput').value : null);
    const result = await api('/api/create', {
      encryptedData: encrypted.encryptedData,
      expiresIn: Number($('expiresIn').value),
      burnAfterRead: $('burnAfterRead').checked,
      hasPassword: encrypted.hasPassword,
    });
    $('shareUrl').value = `${location.origin}/#${result.id}:${encrypted.secret}${encrypted.hasPassword ? ':pwd2' : ''}`;
    $('expiryTime').textContent = new Date(result.expiresAt).toLocaleString();
    $('passwordNotice').style.display = encrypted.hasPassword ? 'flex' : 'none';
    $('resultBox').classList.add('show');
    $('content').value = '';
    $('passwordInput').value = '';
  } catch (error) { showError(error.message); }
  finally {
    $('createBtn').disabled = false;
    $('btnText').textContent = '🔐 Encrypt & Save';
  }
});

async function reveal(password = null) {
  const plaintext = await decrypt(pendingData.data, link.secret, password);
  $('decryptedContent').textContent = plaintext;
  $('burnNotice').style.display = pendingData.burnAfterRead ? 'flex' : 'none';
  $('passwordPrompt').classList.remove('show');
  $('openView').hidden = true;
  $('decryptView').classList.add('show');
  $('decryptPassword').value = '';
  pendingData = null;
  link = null;
  history.replaceState(null, '', '/');
}

$('openBtn').addEventListener('click', async () => {
  clearError();
  $('openBtn').disabled = true;
  $('openBtn').textContent = 'Opening…';
  try {
    // Never retrieve ciphertext on page load: link previews must not burn a paste.
    pendingData = await api(`/api/read/${link.id}`, {});
    if (link.hasPassword !== pendingData.hasPassword) throw new Error('The link does not match this message');
    if (link.hasPassword) {
      $('openView').hidden = true;
      $('passwordPrompt').classList.add('show');
      $('decryptPassword').focus();
    } else { await reveal(); }
  } catch (error) {
    showError(`${error.message}. A one-time message may already have been removed. Ask the sender for a new link if needed.`);
    $('openBtn').textContent = 'Unable to open message';
  }
});

async function unlock() {
  if (!pendingData || !link) return;
  $('passwordError').style.display = 'none';
  $('decryptBtn').disabled = true;
  $('decryptBtnText').textContent = 'Decrypting…';
  try { await reveal($('decryptPassword').value); }
  catch {
    $('passwordError').textContent = 'Unable to decrypt. Check the password and link, then try again in this tab.';
    $('passwordError').style.display = 'block';
  } finally {
    $('decryptBtn').disabled = false;
    $('decryptBtnText').textContent = '🔓 Decrypt';
  }
}
$('decryptBtn').addEventListener('click', unlock);
$('decryptPassword').addEventListener('keydown', event => { if (event.key === 'Enter') void unlock(); });
$('newBtn').addEventListener('click', () => { location.href = '/'; });
$('copyBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('shareUrl').value);
    $('copyBtn').textContent = 'Copied!';
    setTimeout(() => { $('copyBtn').textContent = '📋 Copy'; }, 2000);
  } catch {
    $('shareUrl').select();
    showError('Clipboard access is unavailable. Copy the selected link manually.');
  }
});

function openFragment() {
  if (!location.hash) return;
  clearError();
  pendingData = null;
  link = null;
  $('decryptedContent').textContent = '';
  $('decryptPassword').value = '';
  $('decryptView').classList.remove('show');
  $('passwordPrompt').classList.remove('show');
  $('createView').style.display = 'none';
  $('openView').hidden = true;
  try {
    link = parseFragment(location.hash);
    $('openView').hidden = false;
    $('openBtn').disabled = false;
    $('openBtn').textContent = 'Open message';
  } catch (error) { showError(error.message); }
}
window.addEventListener('hashchange', openFragment);
openFragment();
