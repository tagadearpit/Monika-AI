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
    
    // Check if new HTML grid elements are present, they are a bit different
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
    
    // Update the "This week" conversation activity panel if it exists
    const kpiValue = document.querySelector('.soft-panel .kpi-value');
    if (kpiValue) kpiValue.textContent = Number(data.conversations || 0).toLocaleString();
}

async function loadReports() {
    const response = await apiFetch('/api/admin/reports', { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok) return;
    const list = $('reportList');
    if (!list) return;
    list.innerHTML = '';
    if (!data.length) {
        list.innerHTML = '<div class="list-item"><strong class="muted">No reports.</strong></div>';
        return;
    }
    for (const report of data) {
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
    const list = $('auditList');
    if (!list) return;
    list.innerHTML = '';
    if (!data.length) {
        list.innerHTML = '<div class="list-item"><strong class="muted">No audit events.</strong></div>';
        return;
    }
    for (const event of data) {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <strong>${event.action}</strong>
            <small>${event.userId || 'anonymous'} · ${new Date(event.createdAt).toLocaleString()}</small>
        `;
        list.appendChild(item);
    }
}

// Mock implementation since backend /api/admin/sessions doesn't exist
async function loadSessions() {
    const tbody = $('sessionTableBody');
    if (!tbody) return;
    
    // Simulated data
    const sessions = [
        { device: 'Chrome on Windows', lastActive: new Date().toLocaleString(), created: new Date(Date.now() - 86400000).toLocaleString(), status: 'Active' },
        { device: 'Safari on iPhone', lastActive: new Date(Date.now() - 3600000).toLocaleString(), created: new Date(Date.now() - 172800000).toLocaleString(), status: 'Inactive' }
    ];
    
    tbody.innerHTML = sessions.map(s => `
        <tr>
            <td><strong>${s.device}</strong></td>
            <td>${s.lastActive}</td>
            <td>${s.created}</td>
            <td><span class="pill ${s.status === 'Active' ? 'success' : 'warning'}">${s.status}</span></td>
            <td><button class="secondary-action-btn" style="padding: 4px 8px; min-height: unset; font-size: 0.8rem;" type="button">Revoke</button></td>
        </tr>
    `).join('');
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

function handleSearch() {
    const query = $('adminSearchQuery').value.trim();
    if (!query) return alert('Enter a search query.');
    alert(`Search for "${query}" is not implemented on the backend yet.`);
}

function mockExport(type) {
    alert(`Exporting ${type}... (mock implementation)`);
}

// Bind events if elements exist
if ($('suspendUserBtn')) $('suspendUserBtn').onclick = () => setSuspension(true);
if ($('unsuspendUserBtn')) $('unsuspendUserBtn').onclick = () => setSuspension(false);
if ($('refreshReportsBtn')) $('refreshReportsBtn').onclick = loadReports;
if ($('refreshAuditBtn')) $('refreshAuditBtn').onclick = loadAudit;
if ($('refreshDashboardBtn')) $('refreshDashboardBtn').onclick = init;
if ($('refreshSessionsBtn')) $('refreshSessionsBtn').onclick = loadSessions;
if ($('adminSearchBtn')) $('adminSearchBtn').onclick = handleSearch;
if ($('adminClearSearchBtn')) $('adminClearSearchBtn').onclick = () => $('adminSearchQuery').value = '';
if ($('exportAdminSnapshotBtn')) $('exportAdminSnapshotBtn').onclick = () => mockExport('Snapshot');
if ($('exportReportsBtn')) $('exportReportsBtn').onclick = () => mockExport('Reports');
if ($('exportAuditBtn')) $('exportAuditBtn').onclick = () => mockExport('Audit');
if ($('exportMetricsBtn')) $('exportMetricsBtn').onclick = () => mockExport('Metrics');

window.addEventListener('load', init);
