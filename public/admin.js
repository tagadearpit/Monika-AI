'use strict';

let csrfToken = '';
let authToken = null;

let overviewData = null;
let reportsData = [];
let auditData = [];
let sessionsData = [];

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
        
        $('adminStatus').textContent = 'Loading dashboard...';
        $('adminStatus').hidden = false;
        
        await Promise.all([
            loadOverview(), 
            loadReports(), 
            loadAudit(),
            loadSessions()
        ]);
        
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
    
    overviewData = data;

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
    
    const grid = $('metricGrid');
    if (grid) {
        grid.innerHTML = metrics.map(([label, value]) => `
            <div class="kpi-card">
                <div class="kpi-top">
                    <p class="kpi-label">${label}</p>
                    <div class="kpi-icon"><i class="fas fa-chart-line"></i></div>
                </div>
                <h3 class="kpi-value">${Number(value || 0).toLocaleString()}</h3>
            </div>
        `).join('');
    }
    
    const kpiValue = document.querySelector('.soft-panel .kpi-value');
    if (kpiValue) kpiValue.textContent = Number(data.conversations || 0).toLocaleString();

    const convNote = $('conversationActivityNote');
    if (convNote) {
        convNote.textContent = `${Number(data.messages || 0).toLocaleString()} total messages processed across sessions.`;
    }
}

async function loadReports() {
    const response = await apiFetch('/api/admin/reports', { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok) return;
    reportsData = Array.isArray(data) ? data : [];
    const list = $('reportList');
    if (!list) return;
    list.innerHTML = '';
    if (!reportsData.length) {
        list.innerHTML = '<div class="list-item"><strong class="muted">No reports.</strong></div>';
        return;
    }
    for (const report of reportsData) {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <strong>${report.feedback?.reportType || 'report'} · ${report.userId}</strong>
            <p>${report.content}</p>
            <small>${report.feedback?.comment || new Date(report.feedback?.updatedAt || report.createdAt).toLocaleString()}</small>
        `;
        list.appendChild(item);
    }
}

async function loadAudit() {
    const response = await apiFetch('/api/admin/audit', { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok) return;
    auditData = Array.isArray(data) ? data : [];
    const list = $('auditList');
    if (!list) return;
    list.innerHTML = '';
    if (!auditData.length) {
        list.innerHTML = '<div class="list-item"><strong class="muted">No audit events.</strong></div>';
        return;
    }
    for (const event of auditData) {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <strong>${event.action}</strong>
            <small>${event.userId || 'anonymous'} · ${new Date(event.createdAt).toLocaleString()}</small>
        `;
        list.appendChild(item);
    }
}

async function loadSessions() {
    const tbody = $('sessionTableBody');
    if (!tbody) return;
    const response = await apiFetch('/api/admin/sessions', { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted">Unable to load active sessions.</td></tr>';
        return;
    }
    sessionsData = Array.isArray(data) ? data : [];
    if (!sessionsData.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted">No active sessions found.</td></tr>';
        return;
    }
    tbody.innerHTML = sessionsData.map(s => `
        <tr>
            <td>
                <strong>${s.deviceName || s.browser || 'Unknown Device'}</strong>
                <div class="muted" style="font-size:0.78rem;">${s.operatingSystem || 'OS unknown'} · ${s.userId}</div>
            </td>
            <td>${s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : 'Just now'}</td>
            <td>${s.createdAt ? new Date(s.createdAt).toLocaleString() : 'N/A'}</td>
            <td><span class="pill success">Active</span></td>
            <td>
                <button class="secondary-action-btn revoke-session-btn" data-session-id="${s._id || ''}" style="padding: 4px 10px; min-height: unset; font-size: 0.82rem;" type="button">
                    Revoke
                </button>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.revoke-session-btn').forEach(btn => {
        btn.onclick = () => revokeSession(btn.getAttribute('data-session-id'));
    });
}

async function revokeSession(sessionId) {
    if (!sessionId) return;
    if (!confirm('Are you sure you want to revoke this session? The device will be signed out immediately.')) return;
    const response = await apiFetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    const data = await parseJson(response);
    if (!response.ok) return alert(data.error || 'Failed to revoke session.');
    await loadSessions();
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
    await Promise.all([loadOverview(), loadAudit(), loadSessions()]);
}

async function handleSearch() {
    const query = $('adminSearchQuery').value.trim();
    if (!query) return alert('Enter a search query.');
    const resultBox = $('adminSearchResults');
    if (resultBox) {
        resultBox.style.display = 'block';
        resultBox.innerHTML = '<div class="list-item"><strong class="muted">Searching...</strong></div>';
    }
    const response = await apiFetch(`/api/admin/search?q=${encodeURIComponent(query)}`, { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok) {
        if (resultBox) resultBox.innerHTML = '<div class="list-item"><strong class="muted">Search request failed.</strong></div>';
        return;
    }
    const { users = [], auditEvents = [], reports = [] } = data;
    const count = users.length + auditEvents.length + reports.length;
    if (!count) {
        if (resultBox) resultBox.innerHTML = '<div class="list-item"><strong class="muted">No matching users, audit events, or reports found.</strong></div>';
        return;
    }
    let html = '';
    for (const u of users) {
        html += `<div class="list-item"><strong>User Account: ${u.sessionId}</strong><small>Status: ${u.suspendedAt ? 'Suspended (' + (u.suspensionReason || 'No reason') + ')' : 'Active'} · Last Active: ${u.lastActive ? new Date(u.lastActive).toLocaleString() : 'N/A'}</small></div>`;
    }
    for (const a of auditEvents) {
        html += `<div class="list-item"><strong>Audit: ${a.action}</strong><small>User: ${a.userId || 'anonymous'} · ${new Date(a.createdAt).toLocaleString()}</small></div>`;
    }
    for (const r of reports) {
        html += `<div class="list-item"><strong>Report: ${r.feedback?.reportType || 'report'}</strong><p>${r.content}</p><small>User: ${r.userId} · ${new Date(r.createdAt).toLocaleString()}</small></div>`;
    }
    if (resultBox) resultBox.innerHTML = html;
}

function clearSearch() {
    if ($('adminSearchQuery')) $('adminSearchQuery').value = '';
    const resultBox = $('adminSearchResults');
    if (resultBox) {
        resultBox.style.display = 'none';
        resultBox.innerHTML = '';
    }
}

function downloadJsonFile(dataObj, filename) {
    const jsonStr = JSON.stringify(dataObj, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function handleExport(type) {
    const timestamp = new Date().toISOString().slice(0, 10);
    if (type === 'Snapshot') {
        downloadJsonFile({
            exportedAt: new Date().toISOString(),
            overview: overviewData,
            reports: reportsData,
            audit: auditData,
            sessions: sessionsData
        }, `monika-admin-snapshot-${timestamp}.json`);
    } else if (type === 'Reports') {
        downloadJsonFile(reportsData, `monika-admin-reports-${timestamp}.json`);
    } else if (type === 'Audit') {
        downloadJsonFile(auditData, `monika-admin-audit-${timestamp}.json`);
    } else if (type === 'Metrics') {
        downloadJsonFile(overviewData || {}, `monika-admin-metrics-${timestamp}.json`);
    }
}

function setupScrollButtons() {
    const auditBtn = $('auditScrollDownBtn');
    const auditList = $('auditList');
    if (auditBtn && auditList) {
        auditBtn.onclick = () => {
            auditList.scrollBy({ top: 260, behavior: 'smooth' });
        };
    }
}

if ($('suspendUserBtn')) $('suspendUserBtn').onclick = () => setSuspension(true);
if ($('unsuspendUserBtn')) $('unsuspendUserBtn').onclick = () => setSuspension(false);
if ($('refreshReportsBtn')) $('refreshReportsBtn').onclick = loadReports;
if ($('refreshAuditBtn')) $('refreshAuditBtn').onclick = loadAudit;
if ($('refreshDashboardBtn')) $('refreshDashboardBtn').onclick = init;
if ($('refreshSessionsBtn')) $('refreshSessionsBtn').onclick = loadSessions;
if ($('adminSearchBtn')) $('adminSearchBtn').onclick = handleSearch;
if ($('adminClearSearchBtn')) $('adminClearSearchBtn').onclick = clearSearch;
if ($('adminSearchQuery')) {
    $('adminSearchQuery').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSearch();
        }
    });
}
if ($('exportAdminSnapshotBtn')) $('exportAdminSnapshotBtn').onclick = () => handleExport('Snapshot');
if ($('exportReportsBtn')) $('exportReportsBtn').onclick = () => handleExport('Reports');
if ($('exportAuditBtn')) $('exportAuditBtn').onclick = () => handleExport('Audit');
if ($('exportMetricsBtn')) $('exportMetricsBtn').onclick = () => handleExport('Metrics');

window.addEventListener('load', () => {
    init();
    setupScrollButtons();
});
