'use strict';

const $ = (id) => document.getElementById(id);

function showError(message) {
    const el = $('adminLoginError');
    el.textContent = message;
    el.hidden = false;
}

async function getCsrfToken() {
    const response = await fetch('/api/config', { credentials: 'include', cache: 'no-store' });
    const data = await response.json();
    return data.csrfToken || '';
}

async function submitAdminLogin() {
    const email = $('adminEmailInput').value.trim();
    const password = $('adminPasswordInput').value;
    if (!email || !password) return showError('Enter both email and password.');

    const btn = $('adminLoginBtn');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    $('adminLoginError').hidden = true;

    try {
        const csrfToken = await getCsrfToken();
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Invalid email or password.');
        window.location.href = '/admin-dashboard';
    } catch (error) {
        showError(error.message || 'Sign-in failed. Try again.');
        btn.disabled = false;
        btn.textContent = 'Sign in';
    }
}

$('adminLoginBtn').onclick = submitAdminLogin;
$('adminPasswordInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submitAdminLogin();
});
