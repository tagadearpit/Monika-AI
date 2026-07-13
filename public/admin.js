'use strict';

let csrfToken = '';
let authToken = null;

const $ = (id) => document.getElementById(id);

async function parseJson(response) {
    try { return await response.json(); } catch (_) { return {}; }
}

async function refreshSession() {
    const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
    });
    if (!response.ok) return false;
    const data = await response.json();
    authToken = data.token;
    return true;
}

async function apiFetch(url, options = {}, retry = true) {
    const headers = new Headers(options.headers || {});
    if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
    if (options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrfToken);
    const response = await fetch(url, { ...options, headers, credentials: 'include' });
    if (response.status === 401 && retry && await refreshSession()) return apiFetch(url, options, false);
    return response;
}

async function init() {
    try {
        const configResponse = await fetch('/api/config', { credentials: 'include', cache: 'no-store' });
        const config = await configResponse.json();
        csrfToken = config.csrfToken || '';
        if (!await refreshSession()) throw new Error('Sign in to Monika AI before opening the admin dashboard.');
        await loadOverview();
        await Promise.all([loadReports(), loadAudit()]);
        $('adminStatus').hidden = true;
        $('adminContent').hidden = false;
    } catch (error) {
        $('adminStatus').textContent = error.message;
        $('adminStatus').classList.add('error');
    }
}

async function loadOverview() {
    const response = await apiFetch('/api/admin/overview', { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok) throw new Error(data.error || 'Administrator access is required.');
    const metrics = [
        ['Users', data.users],
        ['New users (24h)', data.newUsers24h],
        ['Active users (24h)', data.activeUsers24h],
        ['Conversations', data.conversations],
        ['Messages', data.messages],
        ['Active sessions', data.activeSessions],
        ['Open reports', data.reports],
        ['AI failures (24h)', data.aiFailures24h],
        ['Auth events (24h)', data.authenticationFailures24h],
        ['Rate limits (24h)', data.rateLimitEvents24h],
        ['AI requests', data.usage?.messages || 0],
        ['Estimated tokens', data.usage?.estimatedTokens || 0],
        ['Estimated cost (USD)', Number(data.usage?.estimatedCostUsd || 0).toFixed(4)]
    ];
    $('metricGrid').innerHTML = metrics.map(([label, value]) => `<article class="metric-card"><span>${label}</span><strong>${Number(value || 0).toLocaleString()}</strong></article>`).join('');
}

async function loadReports() {
    const response = await apiFetch('/api/admin/reports', { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok) return;
    const list = $('reportList');
    list.innerHTML = '';
    if (!data.length) list.innerHTML = '<div class="admin-list-item">No reports.</div>';
    for (const report of data) {
        const item = document.createElement('article');
        item.className = 'admin-list-item';
        const title = document.createElement('strong');
        title.textContent = `${report.feedback?.reportType || 'report'} · ${report.userId}`;
        const text = document.createElement('p');
        text.textContent = report.content;
        const meta = document.createElement('small');
        meta.textContent = report.feedback?.comment || new Date(report.feedback?.updatedAt || report.createdAt).toLocaleString();
        item.append(title, text, meta);
        list.appendChild(item);
    }
}

async function loadAudit() {
    const response = await apiFetch('/api/admin/audit', { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok) return;
    const list = $('auditList');
    list.innerHTML = '';
    if (!data.length) list.innerHTML = '<div class="admin-list-item">No audit events.</div>';
    for (const event of data) {
        const item = document.createElement('article');
        item.className = 'admin-list-item';
        const title = document.createElement('strong');
        title.textContent = event.action;
        const meta = document.createElement('small');
        meta.textContent = `${event.userId || 'anonymous'} · ${new Date(event.createdAt).toLocaleString()}`;
        item.append(title, meta);
        list.appendChild(item);
    }
}

async function setSuspension(suspended) {
    const userId = $('adminUserId').value.trim();
    const reason = $('adminReason').value.trim();
    if (!userId) return alert('Enter the user email or phone number.');
    const response = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/suspension`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspended, reason })
    });
    const data = await parseJson(response);
    if (!response.ok) return alert(data.error || 'Account update failed.');
    alert(suspended ? 'User suspended and active sessions revoked.' : 'User suspension removed.');
    await Promise.all([loadOverview(), loadAudit()]);
}

$('suspendUserBtn').onclick = () => setSuspension(true);
$('unsuspendUserBtn').onclick = () => setSuspension(false);
$('refreshReportsBtn').onclick = loadReports;
$('refreshAuditBtn').onclick = loadAudit;
window.addEventListener('load', init);
