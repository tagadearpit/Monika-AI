/* global Chart, getComputedStyle */
'use strict';

const state = {
    csrfToken: '',
    overview: null,
    people: [],
    reports: [],
    audit: [],
    sessions: [],
    suspendedUsers: [],
    chartData: null,
    searchTimeout: null,
    maintenanceMode: false,
    livePollingTimer: null,
    livePollingActive: false,
    activeTab: 'overview',
    liveRefresh: {
        timer: null,
        inFlight: false,
        lastOkAt: null,
        failures: 0,
        paused: false
    }
};

const $ = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat();

const ACTION_LABELS = {
    'session.created': 'Signed in',
    'session.logout': 'Signed out',
    'session.revoked': 'Ended a session',
    'session.others_revoked': 'Signed out other devices',
    'session.token_reuse_detected': 'Suspicious session reuse blocked',
    'auth.google_failed': 'Google sign-in failed',
    'auth.firebase_failed': 'Phone sign-in failed',
    'auth.otp_invalid': 'Wrong sign-in code',
    'auth.otp_verification_failed': 'Sign-in code failed',
    'auth.otp_delivery_failed': 'Sign-in code could not be sent',
    'auth.refresh_failed': 'Session refresh failed',
    'auth.refresh_rejected': 'Session refresh rejected',
    'auth.legal_accepted': 'Accepted terms',
    'ai.request_failed': 'AI reply failed',
    'conversation.created': 'Started a conversation',
    'conversation.deleted': 'Deleted a conversation',
    'conversation.all_cleared': 'Cleared all conversations',
    'memory.all_cleared': 'Cleared memory',
    'message.reported': 'Reported a message',
    'reminder.created': 'Created a reminder',
    'settings.updated': 'Changed settings',
    'account.deleted': 'Deleted their account',
    'admin.user_suspended': 'Suspended by admin',
    'admin.user_unsuspended': 'Unsuspended by admin',
    'admin.session_revoked': 'Session ended by admin',
    'admin.maintenance_enabled': 'Maintenance turned on',
    'admin.maintenance_disabled': 'Maintenance turned off',
    admin_login_success: 'Admin signed in',
    admin_login_failed: 'Admin sign-in failed',
    admin_login_locked: 'Admin sign-in locked'
};

const labelForAction = (action) => !action
    ? 'No recorded activity'
    : String(action).startsWith('rate_limit.')
        ? 'Hit the rate limit'
        : (ACTION_LABELS[action] || action);

function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showAdminToast(message, type = 'info') {
    const container = $('adminToastContainer');
    if (!container) return alert(message);
    const toast = document.createElement('div');
    toast.className = `admin-toast ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
    toast.innerHTML = `
        <div style="flex:1">
            <h4 style="margin:0; font-size: 0.95rem;">${type === 'error' ? 'Needs attention' : type === 'success' ? 'Updated' : 'Notice'}</h4>
            <p>${esc(message)}</p>
        </div>
        <button type="button" aria-label="Close">Close</button>
    `;
    toast.querySelector('button')?.addEventListener('click', () => toast.remove());
    container.appendChild(toast);
    window.setTimeout(() => toast.remove(), 5000);
}

function confirmAction(message) {
    return new Promise((resolve) => {
        const dialog = $('confirmDialog');
        if (!dialog || typeof dialog.showModal !== 'function') return resolve(window.confirm(message));
        $('confirmMessage').textContent = message;
        const cancel = $('confirmCancelBtn');
        const proceed = $('confirmProceedBtn');
        const cleanup = (result) => {
            dialog.close();
            cancel.removeEventListener('click', onCancel);
            proceed.removeEventListener('click', onProceed);
            dialog.removeEventListener('cancel', onDialogCancel);
            resolve(result);
        };
        const onCancel = () => cleanup(false);
        const onProceed = () => cleanup(true);
        const onDialogCancel = (event) => { event.preventDefault(); cleanup(false); };
        cancel.addEventListener('click', onCancel, { once: true });
        proceed.addEventListener('click', onProceed, { once: true });
        dialog.addEventListener('cancel', onDialogCancel, { once: true });
        dialog.showModal();
    });
}

function showSkeleton(containerId, count = 3) {
    const container = $(containerId);
    if (!container) return;
    container.innerHTML = Array(count).fill('<div class="list-item"><strong class="muted">Loading…</strong></div>').join('');
}

function setActiveTab(tabName) {
    state.activeTab = tabName;
    const tabs = document.querySelectorAll('.admin-tab');
    const panels = document.querySelectorAll('.tab-panel');
    tabs.forEach((tab) => {
        const active = tab.dataset.tab === tabName;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = 0;
    });
    panels.forEach((panel) => {
        panel.classList.toggle('active', panel.id === `panel-${tabName}`);
    });
    if (window.location.hash !== `#${tabName}`) window.location.hash = tabName;
    if (tabName === 'analytics' && state.chartData) requestAnimationFrame(renderCharts);
}

function initTabs() {
    document.querySelectorAll('.admin-tab').forEach((tab) => {
        tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
    });
    const validTabs = ['overview', 'users', 'moderation', 'analytics'];
    const hash = window.location.hash.replace(/^#/, '');
    if (validTabs.includes(hash)) setActiveTab(hash);
}

async function parseJson(response) {
    try { return await response.json(); } catch (_) { return {}; }
}

async function apiFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== 'GET') headers.set('X-CSRF-Token', state.csrfToken);
    const response = await fetch(url, { ...options, headers, credentials: 'include' });
    if (response.status === 401) {
        window.location.href = '/admin-login';
        throw new Error('Admin session expired.');
    }
    return response;
}

function displayDate(value, options = {}) {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not recorded';
    return date.toLocaleString([], options);
}

function asCount(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function addHeadlineNumber(container, value) {
    const number = document.createElement('b');
    number.textContent = numberFormat.format(asCount(value));
    container.appendChild(number);
}

function renderHeadline(overview) {
    const headline = $('headline');
    if (!headline) return;
    headline.replaceChildren();
    const users = asCount(overview.users);
    const conversations = asCount(overview.conversations);
    const messages = asCount(overview.messages);
    addHeadlineNumber(headline, users);
    headline.append(document.createTextNode(`${users === 1 ? ' person has' : ' people have'} talked to Monika, in `));
    addHeadlineNumber(headline, conversations);
    headline.append(document.createTextNode(`${conversations === 1 ? ' conversation and ' : ' conversations and '}`));
    addHeadlineNumber(headline, messages);
    headline.append(document.createTextNode(messages === 1 ? ' message.' : ' messages.'));
}

function renderSummary(overview) {
    const parts = [];
    const newUsers = asCount(overview.newUsers24h);
    const activeUsers = asCount(overview.activeUsers24h);
    const activeSessions = asCount(overview.activeSessions);
    const aiFailures = asCount(overview.aiFailures24h);
    const rateLimits = asCount(overview.rateLimitEvents24h);

    if (newUsers === 0) parts.push('Nobody new joined in the last 24 hours.');
    else parts.push(`${numberFormat.format(newUsers)} ${newUsers === 1 ? 'new person joined' : 'new people joined'} in the last 24 hours.`);
    if (activeUsers === 0) parts.push('Nobody came back.');
    else parts.push(`${numberFormat.format(activeUsers)} ${activeUsers === 1 ? 'person was' : 'people were'} active.`);
    parts.push(`${numberFormat.format(activeSessions)} ${activeSessions === 1 ? 'session is' : 'sessions are'} signed in.`);
    if (aiFailures === 0 && rateLimits === 0) parts.push('Nothing failed and nothing was rate limited.');
    else {
        if (aiFailures > 0) parts.push(`${numberFormat.format(aiFailures)} ${aiFailures === 1 ? 'AI reply failed.' : 'AI replies failed.'}`);
        if (rateLimits > 0) parts.push(`${numberFormat.format(rateLimits)} ${rateLimits === 1 ? 'request was' : 'requests were'} rate limited.`);
    }
    $('summary').textContent = parts.join(' ');
}

function renderFacts(overview) {
    const facts = $('metricGrid');
    if (!facts) return;
    facts.replaceChildren();
    const rows = [
        ['Active sessions', overview.activeSessions, 'signed in right now', ''],
        ['Reminders waiting', overview.pendingReminders, 'pending', ''],
        ['AI failures · 24h', overview.aiFailures24h, asCount(overview.aiFailures24h) ? 'check the audit log' : 'all replies delivered', asCount(overview.aiFailures24h) ? 'bad' : 'good'],
        ['Open reports', overview.reports, asCount(overview.reports) ? 'needs a look' : 'all clear', asCount(overview.reports) ? 'bad' : '']
    ];
    rows.forEach(([label, value, note, tone]) => {
        const fact = document.createElement('div');
        fact.className = 'fact';
        const eyebrow = document.createElement('div');
        eyebrow.className = 'eyebrow';
        eyebrow.textContent = label;
        const number = document.createElement('div');
        number.className = `num ${tone}`.trim();
        number.textContent = numberFormat.format(asCount(value));
        const noteLine = document.createElement('div');
        noteLine.className = 'note';
        noteLine.textContent = note;
        fact.append(eyebrow, number, noteLine);
        facts.appendChild(fact);
    });
}

function renderUsage(overview) {
    const usage = $('usage');
    if (!usage) return;
    usage.replaceChildren();
    const data = overview.usage || {};
    const cost = Number(data.estimatedCostUsd);
    const rows = [
        ['Requests', numberFormat.format(asCount(data.messages))],
        ['Estimated tokens', numberFormat.format(asCount(data.estimatedTokens))],
        ['Estimated cost', `$${(Number.isFinite(cost) ? cost : 0).toFixed(2)}`]
    ];
    rows.forEach(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'kv';
        const name = document.createElement('span');
        name.textContent = label;
        const number = document.createElement('b');
        number.textContent = value;
        row.append(name, number);
        usage.appendChild(row);
    });
}

function renderAttention(overview) {
    const attention = $('attention');
    if (!attention) return;
    attention.replaceChildren();
    const reports = asCount(overview.reports);
    const heading = document.createElement('h2');
    heading.textContent = 'Moderation';
    attention.appendChild(heading);
    if (reports === 0) {
        const quiet = document.createElement('p');
        quiet.className = 'muted';
        quiet.textContent = 'No open reports.';
        attention.appendChild(quiet);
        return;
    }
    const box = document.createElement('div');
    box.className = 'callout';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'eyebrow red';
    eyebrow.textContent = `${numberFormat.format(reports)} open ${reports === 1 ? 'report' : 'reports'}`;
    const message = document.createElement('p');
    message.textContent = reports === 1
        ? 'A user flagged a reply. Open the report to read it.'
        : 'Users flagged replies. Open the reports to read them.';
    const actions = document.createElement('div');
    actions.className = 'callout-actions';
    const button = document.createElement('button');
    button.className = 'btn primary';
    button.type = 'button';
    button.textContent = reports === 1 ? 'Read report' : 'Read reports';
    button.addEventListener('click', () => setActiveTab('moderation'));
    actions.appendChild(button);
    box.append(eyebrow, message, actions);
    attention.appendChild(box);
}

function renderOverview(overview) {
    renderHeadline(overview);
    renderSummary(overview);
    renderFacts(overview);
    renderUsage(overview);
    renderAttention(overview);
}

function showOverviewError(message) {
    state.overview = null;
    $('headline').textContent = 'Overview data could not be loaded.';
    $('summary').textContent = message;
    $('metricGrid').textContent = message;
    $('usage').textContent = message;
    $('attention').textContent = message;
}

let freshnessTicker = null;

function formatFreshness() {
    if (state.liveRefresh.paused) {
        return 'Paused: too many requests';
    }
    if (!state.liveRefresh.lastOkAt) {
        return '';
    }
    const seconds = Math.max(0, Math.floor((Date.now() - state.liveRefresh.lastOkAt) / 1000));
    if (seconds < 2) {
        return 'Updated just now';
    }
    return `Updated ${seconds}s ago`;
}

function updateFreshnessUI() {
    const el = $('freshness');
    if (!el) return;
    el.textContent = formatFreshness();
}

function startFreshnessTicker() {
    if (freshnessTicker) window.clearInterval(freshnessTicker);
    updateFreshnessUI();
    freshnessTicker = window.setInterval(updateFreshnessUI, 1000);
}

function getLiveRefreshDelay() {
    if (state.liveRefresh.paused) {
        return Math.max(120000, Math.min(300000, 30000 * Math.pow(2, state.liveRefresh.failures)));
    }
    if (state.liveRefresh.failures > 0) {
        return Math.min(300000, 30000 * Math.pow(2, state.liveRefresh.failures));
    }
    return 30000;
}

function scheduleNextLiveRefresh(customDelay) {
    if (state.liveRefresh.timer) {
        window.clearTimeout(state.liveRefresh.timer);
        state.liveRefresh.timer = null;
    }
    if (document.visibilityState !== 'visible') {
        return;
    }
    const delay = customDelay !== undefined ? customDelay : getLiveRefreshDelay();
    state.liveRefresh.timer = window.setTimeout(async () => {
        state.liveRefresh.timer = null;
        await refreshLiveData();
    }, delay);
}

function startLiveRefresh() {
    if (state.liveRefresh.timer) {
        window.clearTimeout(state.liveRefresh.timer);
        state.liveRefresh.timer = null;
    }
    scheduleNextLiveRefresh(getLiveRefreshDelay());
}

function resetLiveRefreshTimer() {
    state.liveRefresh.lastOkAt = Date.now();
    state.liveRefresh.failures = 0;
    state.liveRefresh.paused = false;
    updateFreshnessUI();
    startLiveRefresh();
}

async function refreshLiveData() {
    if (document.visibilityState !== 'visible') return;
    if (state.liveRefresh.inFlight) return;
    const confirmDialog = $('confirmDialog');
    if (confirmDialog && confirmDialog.open) return;

    state.liveRefresh.inFlight = true;
    try {
        const tasks = [
            loadOverview({ background: true }),
            loadPeople({ background: true })
        ];
        const isPeopleActive = state.activeTab === 'users'
            || document.querySelector('.admin-tab.active')?.dataset.tab === 'users';
        if (isPeopleActive) {
            tasks.push(loadSessions({ background: true }));
        }
        await Promise.all(tasks);
        state.liveRefresh.lastOkAt = Date.now();
        state.liveRefresh.failures = 0;
        state.liveRefresh.paused = false;
        updateFreshnessUI();
    } catch (error) {
        state.liveRefresh.failures++;
        if (error?.status === 429) {
            state.liveRefresh.paused = true;
        }
        updateFreshnessUI();
    } finally {
        state.liveRefresh.inFlight = false;
        scheduleNextLiveRefresh();
    }
}

async function init() {
    const status = $('adminStatus');
    try {
        if (status) {
            status.hidden = false;
            status.classList.remove('error');
            status.textContent = 'Verifying administrator session…';
        }
        const configResponse = await fetch('/api/config', { credentials: 'include', cache: 'no-store' });
        if (!configResponse.ok) throw new Error('Could not load admin session configuration.');
        const config = await parseJson(configResponse);
        state.csrfToken = config.csrfToken || '';

        const sessionResponse = await fetch('/api/admin/session', { credentials: 'include', cache: 'no-store' });
        if (!sessionResponse.ok) {
            window.location.href = '/admin-login';
            return;
        }
        if (status) status.textContent = 'Signed in as administrator';
        $('adminContent').hidden = false;
        const today = $('today');
        if (today) today.textContent = new Date().toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

        await Promise.all([
            loadOverview(), loadPeople(), loadReports(), loadAudit(), loadSessions(),
            loadAnalytics(), loadSuspendedUsers(), loadMaintenanceStatus()
        ]);
        state.liveRefresh.lastOkAt = Date.now();
        state.liveRefresh.failures = 0;
        state.liveRefresh.paused = false;
        startFreshnessTicker();
        startLiveRefresh();
        startLiveActivityPolling();
    } catch (error) {
        if (status) {
            status.hidden = false;
            status.textContent = error.message || 'Could not verify administrator access.';
            status.classList.add('error');
        }
    }
}

async function loadOverview(options = {}) {
    try {
        const response = await apiFetch('/api/admin/overview', { method: 'GET', cache: 'no-store' });
        const data = await parseJson(response);
        if (!response.ok) {
            const err = new Error(data.error || 'Overview data could not be loaded.');
            err.status = response.status;
            throw err;
        }
        state.overview = data;
        renderOverview(data);
    } catch (error) {
        if (!options.background) {
            showOverviewError(error.message || 'Overview data could not be loaded.');
        }
        if (options.background) {
            throw error;
        }
    }
}

function statusOf(person) {
    if (person.status === 'suspended') return ['bad', 'Suspended'];
    if (person.lastAction === 'message.reported') return ['warn', 'Reported'];
    if (String(person.lastAction || '').startsWith('rate_limit.')) return ['warn', 'Limited'];
    return ['ok', 'Active'];
}

async function loadPeople(options = {}) {
    const tbody = $('peopleBody');
    if (!tbody) return;
    if (!options.background) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted">Loading people…</td></tr>';
    }
    try {
        const response = await apiFetch('/api/admin/people', { method: 'GET', cache: 'no-store' });
        const data = await parseJson(response);
        if (!response.ok) {
            const err = new Error(data.error || 'People could not be loaded.');
            err.status = response.status;
            throw err;
        }
        state.people = Array.isArray(data) ? data : [];
        if (!state.people.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="dim">No users yet.</td></tr>';
            return;
        }
        tbody.innerHTML = state.people.map((person) => {
            const [tagClass, statusText] = statusOf(person);
            return `<tr>
                <td class="id">${esc(person.userIdMasked || '')}</td>
                <td>${esc(person.loginMethod || 'Not recorded')}</td>
                <td class="dim">${esc(labelForAction(person.lastAction))}</td>
                <td>${esc(displayDate(person.lastActive))}</td>
                <td><span class="tag ${tagClass}">${statusText}</span></td>
            </tr>`;
        }).join('');
        $('peopleNote').textContent = `${numberFormat.format(state.people.length)} recent ${state.people.length === 1 ? 'person' : 'people'}`;
    } catch (error) {
        if (!options.background) {
            tbody.innerHTML = `<tr><td colspan="5" class="dim">${esc(error.message || 'People could not be loaded.')}</td></tr>`;
        }
        if (options.background) {
            throw error;
        }
    }
}

async function loadReports() {
    const list = $('reportList');
    if (!list) return;
    try {
        const response = await apiFetch('/api/admin/reports', { method: 'GET', cache: 'no-store' });
        const data = await parseJson(response);
        if (!response.ok) throw new Error(data.error || 'Reports could not be loaded.');
        state.reports = Array.isArray(data) ? data : [];
        if (!state.reports.length) {
            list.innerHTML = '<div class="list-item"><strong class="muted">No reports.</strong></div>';
            return;
        }
        list.innerHTML = state.reports.map((report) => {
            const reportType = report.feedback?.reportType || 'report';
            const timestamp = displayDate(report.feedback?.updatedAt || report.createdAt);
            const commentOrTime = report.feedback?.comment ? esc(report.feedback.comment) : esc(timestamp);
            const identifier = report.userIdMasked || '';
            return `<article class="list-item">
                <div class="h2row"><strong>${esc(identifier)}</strong><span class="tag warn">${esc(reportType)}</span></div>
                <p>${esc(report.content || '')}</p>
                <small class="muted">${commentOrTime}</small>
            </article>`;
        }).join('');
    } catch (error) {
        list.innerHTML = `<div class="list-item"><strong class="muted">${esc(error.message || 'Reports could not be loaded.')}</strong></div>`;
    }
}

async function loadAudit(category = '') {
    const categoryParam = category ? `?category=${encodeURIComponent(category)}` : '';
    const list = $('auditList');
    try {
        const response = await apiFetch(`/api/admin/audit${categoryParam}`, { method: 'GET', cache: 'no-store' });
        const data = await parseJson(response);
        if (!response.ok) throw new Error(data.error || 'Audit events could not be loaded.');
        state.audit = Array.isArray(data) ? data : [];
        if (!list) return;
        if (!state.audit.length) {
            list.innerHTML = '<div class="list-item"><strong class="muted">No audit events.</strong></div>';
            return;
        }
        list.innerHTML = state.audit.map((event) => {
            const identifier = event.identifierMasked || event.userIdMasked || 'Anonymous';
            const methodLabel = event.method ? ` · ${event.method}` : '';
            return `<article class="list-item">
                <strong>${esc(labelForAction(event.action))}</strong>
                <small class="muted">${esc(identifier)}${esc(methodLabel)} · ${esc(displayDate(event.createdAt))}</small>
            </article>`;
        }).join('');
    } catch (error) {
        if (list) list.innerHTML = `<div class="list-item"><strong class="muted">${esc(error.message || 'Audit events could not be loaded.')}</strong></div>`;
    }
}

async function loadSessions(options = {}) {
    const tbody = $('sessionTableBody');
    if (!tbody) return;
    if (!options.background) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted">Loading sessions…</td></tr>';
    }
    try {
        const response = await apiFetch('/api/admin/sessions', { method: 'GET', cache: 'no-store' });
        const data = await parseJson(response);
        if (!response.ok) {
            const err = new Error(data.error || 'Active sessions could not be loaded.');
            err.status = response.status;
            throw err;
        }
        state.sessions = Array.isArray(data) ? data : [];
        if (!state.sessions.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="dim">No active sessions found.</td></tr>';
            return;
        }
        tbody.innerHTML = state.sessions.map((s) => {
            const device = esc(s.deviceName || s.browser || 'Unknown device');
            const osAndUser = `${esc(s.operatingSystem || 'OS unknown')} · ${esc(s.userIdMasked || '')}`;
            const ipHashSnippet = s.lastIpHash ? esc(`${s.lastIpHash.substring(0, 8)}…`) : '';
            return `<tr>
                <td><strong>${device}</strong><div class="muted">${osAndUser}</div>${ipHashSnippet ? `<div class="muted">IP hash: ${ipHashSnippet}</div>` : ''}</td>
                <td>${esc(displayDate(s.lastSeenAt))}</td>
                <td>${esc(displayDate(s.createdAt))}</td>
                <td><span class="tag ok">Active</span></td>
                <td><button class="danger-action-btn revoke-session-btn" data-session-id="${esc(s._id || '')}" type="button">Terminate</button></td>
            </tr>`;
        }).join('');
        tbody.querySelectorAll('.revoke-session-btn').forEach((button) => {
            button.addEventListener('click', () => revokeSession(button.getAttribute('data-session-id')));
        });
    } catch (error) {
        if (!options.background) {
            tbody.innerHTML = `<tr><td colspan="5" class="dim">${esc(error.message || 'Active sessions could not be loaded.')}</td></tr>`;
        }
        if (options.background) {
            throw error;
        }
    }
}

async function loadSuspendedUsers() {
    const list = $('suspendedUsersList');
    if (!list) return;
    try {
        const response = await apiFetch('/api/admin/users/suspended', { method: 'GET', cache: 'no-store' });
        const data = await parseJson(response);
        if (!response.ok) throw new Error(data.error || 'Suspended users could not be loaded.');
        state.suspendedUsers = Array.isArray(data) ? data : [];
        if (!state.suspendedUsers.length) {
            list.innerHTML = '<div class="list-item"><strong class="muted">No suspended users.</strong></div>';
            return;
        }
        list.innerHTML = state.suspendedUsers.map((u) => {
            const identifier = esc(u.sessionIdMasked || '');
            const reasonAndDate = `${esc(u.suspensionReason || 'No reason given')} · Suspended ${esc(displayDate(u.suspendedAt))}`;
            return `<div class="suspended-user-item">
                <div><strong>${identifier}</strong><small>${reasonAndDate}</small></div>
                <button class="secondary-action-btn unsuspend-btn" data-user-id="${esc(u.sessionId || '')}" type="button">Unsuspend</button>
            </div>`;
        }).join('');
        list.querySelectorAll('.unsuspend-btn').forEach((button) => {
            button.addEventListener('click', async () => {
                const userId = button.getAttribute('data-user-id');
                if (!await confirmAction(`Unsuspend ${userId}?`)) return;
                const result = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/suspension`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ suspended: false, reason: '' })
                });
                if (!result.ok) return showAdminToast('Failed to unsuspend user.', 'error');
                showAdminToast('User suspension removed.', 'success');
                await Promise.all([loadSuspendedUsers(), loadPeople(), loadSessions(), loadAudit()]);
                resetLiveRefreshTimer();
            });
        });
    } catch (error) {
        list.innerHTML = `<div class="list-item"><strong class="muted">${esc(error.message || 'Suspended users could not be loaded.')}</strong></div>`;
    }
}

async function loadMaintenanceStatus() {
    const description = $('maintenanceDescription');
    try {
        const response = await apiFetch('/api/admin/maintenance', { method: 'GET', cache: 'no-store' });
        const data = await parseJson(response);
        if (!response.ok) throw new Error(data.error || 'Maintenance status could not be loaded.');
        state.maintenanceMode = Boolean(data.maintenanceMode);
        updateMaintenanceUI();
    } catch (error) {
        if (description) description.textContent = error.message || 'Maintenance status could not be loaded.';
    }
}

function updateMaintenanceUI() {
    const toggle = $('maintenanceToggle');
    const status = $('maintenanceStatusPill');
    const description = $('maintenanceDescription');
    const banner = $('maintenanceBanner');
    if (toggle) toggle.checked = state.maintenanceMode;
    if (status) status.textContent = state.maintenanceMode ? 'On' : 'Off';
    if (description) description.textContent = state.maintenanceMode
        ? 'On. Only admins can use the app.'
        : 'Off. Everyone can use the app.';
    if (banner) banner.hidden = !state.maintenanceMode;
}

async function toggleMaintenance() {
    const turningOn = !state.maintenanceMode;
    const prompt = turningOn
        ? 'Turn maintenance mode on? Only administrators will be able to use the app.'
        : 'Turn maintenance mode off? Normal service will resume.';
    if (!await confirmAction(prompt)) {
        if ($('maintenanceToggle')) $('maintenanceToggle').checked = state.maintenanceMode;
        return;
    }
    try {
        const response = await apiFetch('/api/admin/maintenance', { method: 'POST' });
        const data = await parseJson(response);
        if (!response.ok) throw new Error(data.error || 'Maintenance mode could not be changed.');
        state.maintenanceMode = Boolean(data.maintenanceMode);
        updateMaintenanceUI();
        showAdminToast(`Maintenance mode ${state.maintenanceMode ? 'enabled' : 'disabled'}.`, 'success');
        resetLiveRefreshTimer();
    } catch (error) {
        showAdminToast(error.message || 'Maintenance mode could not be changed.', 'error');
        if ($('maintenanceToggle')) $('maintenanceToggle').checked = state.maintenanceMode;
    }
}

function setAnalyticsError(message) {
    const box = $('analyticsError');
    if (!box) return;
    box.textContent = message || '';
    box.hidden = !message;
}

async function loadAnalytics() {
    setAnalyticsError('');
    if (!window.Chart) {
        setAnalyticsError('Charts could not load: the chart library failed to load.');
        return;
    }
    try {
        const response = await apiFetch('/api/admin/analytics', { method: 'GET', cache: 'no-store' });
        const data = await parseJson(response);
        if (!response.ok) throw new Error(`Analytics data could not be loaded (HTTP ${response.status}).`);
        state.chartData = data;
        renderCharts();
    } catch (error) {
        setAnalyticsError(error.message || 'Analytics data could not be loaded.');
    }
}

let chartsObj = {};

function cssToken(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function rgbaFromHex(hex, alpha) {
    const value = hex.replace('#', '').trim();
    if (!/^[0-9a-f]{6}$/i.test(value)) return `rgba(31, 107, 79, ${alpha})`;
    const red = parseInt(value.slice(0, 2), 16);
    const green = parseInt(value.slice(2, 4), 16);
    const blue = parseInt(value.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function chartDefaults() {
    Chart.defaults.color = cssToken('--muted');
    Chart.defaults.font.family = cssToken('--body');
    Chart.defaults.font.size = 13;
    Chart.defaults.elements.line.borderWidth = 2;
    Chart.defaults.elements.point.radius = 0;
    Chart.defaults.elements.point.hoverRadius = 4;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.padding = 14;
}

function chartScales(horizontal = false) {
    const rule = cssToken('--rule');
    const muted = cssToken('--muted');
    return horizontal ? {
        x: { beginAtZero: true, suggestedMax: 1, grid: { color: rule, lineWidth: 1 }, ticks: { color: muted, precision: 0 } },
        y: { grid: { display: false }, ticks: { color: muted } }
    } : {
        x: { grid: { display: false }, ticks: { color: muted } },
        y: { beginAtZero: true, suggestedMax: 1, grid: { color: rule, lineWidth: 1 }, ticks: { color: muted, precision: 0 } }
    };
}

function lineDataset(label, values, color, backgroundColor, options = {}) {
    return {
        label,
        data: Array.isArray(values) ? values : [],
        borderColor: color,
        backgroundColor,
        fill: options.fill ?? true,
        borderDash: options.dash || [],
        tension: 0.25,
        pointBackgroundColor: color,
        pointRadius: (context) => context.dataIndex === context.dataset.data.length - 1 ? 4 : 0,
        pointHoverRadius: 4,
        borderWidth: 2
    };
}

function renderCharts() {
    if (!state.chartData || !window.Chart) return;
    chartDefaults();
    const data = state.chartData;
    const green = cssToken('--green');
    const ink = cssToken('--ink');
    const ochre = cssToken('--ochre');
    const red = cssToken('--red');
    const paper = cssToken('--card');
    const dates = Array.isArray(data.dates) ? data.dates : [];
    const signups = Array.isArray(data.signups) ? data.signups : dates.map(() => 0);
    const activeUsers = Array.isArray(data.activeUsers) ? data.activeUsers : dates.map(() => 0);
    const messages = Array.isArray(data.messages) ? data.messages : dates.map(() => 0);
    const errors = Array.isArray(data.errors) ? data.errors : dates.map(() => 0);
    const tokenFill = (color) => rgbaFromHex(color, 0.12);

    Object.values(chartsObj).forEach((chart) => chart?.destroy());
    chartsObj = {};
    const growthCanvas = $('growthChart');
    if (growthCanvas) {
        chartsObj.growth = new Chart(growthCanvas, {
            type: 'line',
            data: { labels: dates, datasets: [
                lineDataset('Messages', messages, green, tokenFill(green)),
                lineDataset('Active users', activeUsers, ink, tokenFill(ink), { fill: false }),
                lineDataset('Signups', signups, ochre, tokenFill(ochre), { fill: false, dash: [6, 4] })
            ] },
            options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: chartScales() }
        });
    }

    const errorsCanvas = $('errorsChart');
    if (errorsCanvas) {
        chartsObj.errors = new Chart(errorsCanvas, {
            type: 'bar',
            data: { labels: dates, datasets: [{
                label: 'Errors', data: errors, backgroundColor: tokenFill(red), borderColor: red,
                borderWidth: 1, borderRadius: 0, hoverBackgroundColor: red
            }] },
            options: { responsive: true, maintainAspectRatio: false, scales: chartScales() }
        });
    }

    const palette = [green, ink, cssToken('--green-bg'), cssToken('--muted'), cssToken('--rule')];
    const devices = data.devices || {};
    const renderDoughnut = (canvasId, key, title) => {
        const canvas = $(canvasId);
        if (!canvas) return;
        const source = devices[key] || {};
        const labels = Object.keys(source);
        const values = Object.values(source).map(asCount);
        const chartLabels = labels.length ? labels : ['No data'];
        const chartValues = labels.length ? values : [0];
        chartsObj[key] = new Chart(canvas, {
            type: 'doughnut',
            data: { labels: chartLabels, datasets: [{
                data: chartValues,
                backgroundColor: chartLabels.map((_, index) => palette[index % palette.length]),
                borderColor: paper,
                borderWidth: 2,
                hoverOffset: 4
            }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '62%',
                plugins: {
                    legend: { position: 'bottom', labels: { color: cssToken('--muted'), font: { family: cssToken('--body'), size: 13 }, padding: 10 } },
                    title: { display: true, text: title, color: cssToken('--ink'), font: { family: cssToken('--display'), size: 16, weight: '700' } }
                }
            }
        });
    };
    renderDoughnut('browserChart', 'browsers', 'Browsers');
    renderDoughnut('osChart', 'operatingSystems', 'Operating systems');

    const featureCanvas = $('featureChart');
    if (featureCanvas) {
        const totals = data.featureTotals || {};
        chartsObj.feature = new Chart(featureCanvas, {
            type: 'bar',
            data: {
                labels: ['Conversations', 'Messages', 'Reminders', 'Memory facts'],
                datasets: [{
                    label: 'Lifetime totals',
                    data: [asCount(totals.conversations), asCount(totals.messages), asCount(totals.reminders), asCount(totals.memoryFacts)],
                    backgroundColor: tokenFill(green),
                    borderColor: green,
                    borderWidth: 1,
                    borderRadius: 0,
                    barPercentage: 0.62
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                scales: chartScales(true),
                plugins: { legend: { display: false } }
            }
        });
    }
}

function formatAuditEvent(event) {
    const identifier = event.identifierMasked || event.userIdMasked
        || (String(event.action || '').startsWith('admin_') || String(event.action || '').startsWith('admin.') ? 'Administrator' : 'Anonymous');
    const methodLabel = event.method ? ` · ${event.method}` : '';
    const time = displayDate(event.createdAt, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    return { time, action: labelForAction(event.action), identifier: `${identifier}${methodLabel}` };
}

async function fetchLiveActivity() {
    const feed = $('liveActivityFeed');
    if (!feed || document.visibilityState !== 'visible') return;
    try {
        const response = await apiFetch('/api/admin/audit', { method: 'GET', cache: 'no-store' });
        const data = await parseJson(response);
        if (!response.ok) {
            const err = new Error(data.error || 'Latest activity could not be loaded.');
            err.status = response.status;
            throw err;
        }
        const events = (Array.isArray(data) ? data : []).slice(0, 8);
        if (!events.length) {
            feed.innerHTML = '<div class="live-event"><span class="live-event-time">—</span><span class="live-event-action muted">No events yet</span><span class="live-event-id"></span></div>';
            return;
        }
        feed.innerHTML = events.map((event) => {
            const { time, action, identifier } = formatAuditEvent(event);
            return `<div class="live-event"><span class="live-event-time">${esc(time)}</span><span class="live-event-action">${esc(action)}</span><span class="live-event-id">${esc(identifier)}</span></div>`;
        }).join('');
    } catch (error) {
        if (error?.status === 429) {
            state.liveRefresh.paused = true;
            updateFreshnessUI();
        }
        if (!feed.children.length) {
            feed.textContent = error.message || 'Latest activity could not be loaded.';
        }
    }
}

function startLiveActivityPolling() {
    if (state.livePollingTimer) window.clearInterval(state.livePollingTimer);
    fetchLiveActivity();
    state.livePollingActive = true;
    updateLiveStatus(true);
    state.livePollingTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible') fetchLiveActivity();
    }, 10000);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
}

function handleVisibilityChange() {
    const active = document.visibilityState === 'visible';
    state.livePollingActive = active;
    updateLiveStatus(active);
    if (!active) {
        if (state.liveRefresh.timer) {
            window.clearTimeout(state.liveRefresh.timer);
            state.liveRefresh.timer = null;
        }
    } else {
        fetchLiveActivity();
        const ageMs = state.liveRefresh.lastOkAt ? (Date.now() - state.liveRefresh.lastOkAt) : Infinity;
        if (ageMs >= 30000) {
            refreshLiveData();
        } else {
            scheduleNextLiveRefresh(Math.max(1000, 30000 - ageMs));
        }
    }
}

function updateLiveStatus(active) {
    const status = $('liveActivityStatus');
    if (status) status.textContent = active ? 'Polling' : 'Paused';
}

async function revokeSession(sessionId) {
    if (!sessionId) return;
    if (!await confirmAction('End this session? The device will be signed out immediately.')) return;
    try {
        const response = await apiFetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
        const data = await parseJson(response);
        if (!response.ok) throw new Error(data.error || 'Session could not be ended.');
        showAdminToast('Session ended.', 'success');
        await Promise.all([loadSessions(), loadPeople()]);
        resetLiveRefreshTimer();
    } catch (error) { showAdminToast(error.message || 'Session could not be ended.', 'error'); }
}

async function setSuspension(suspended) {
    const userId = $('adminUserId').value.trim();
    const reason = $('adminReason').value.trim();
    if (!userId) return showAdminToast('Enter the user email or phone number.', 'error');
    if (!await confirmAction(suspended ? `Suspend ${userId}?` : `Unsuspend ${userId}?`)) return;
    try {
        const response = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/suspension`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ suspended, reason })
        });
        const data = await parseJson(response);
        if (!response.ok) throw new Error(data.error || 'Account update failed.');
        showAdminToast(suspended ? 'User suspended and active sessions ended.' : 'User suspension removed.', 'success');
        $('adminUserId').value = '';
        $('adminReason').value = '';
        await Promise.all([loadOverview(), loadPeople(), loadAudit(), loadSessions(), loadSuspendedUsers()]);
        resetLiveRefreshTimer();
    } catch (error) { showAdminToast(error.message || 'Account update failed.', 'error'); }
}

async function handleSearch() {
    const query = $('adminSearchQuery').value.trim();
    if (!query) return clearSearch();
    const resultBox = $('adminSearchResults');
    resultBox.hidden = false;
    resultBox.innerHTML = '<div class="list-item"><strong class="muted">Searching…</strong></div>';
    try {
        const response = await apiFetch(`/api/admin/search?q=${encodeURIComponent(query)}`, { method: 'GET', cache: 'no-store' });
        const data = await parseJson(response);
        if (!response.ok) throw new Error(data.error || 'Search request failed.');
        const { users = [], auditEvents = [], reports = [] } = data;
        if (!users.length && !auditEvents.length && !reports.length) {
            resultBox.innerHTML = '<div class="list-item"><strong class="muted">No matching records found.</strong></div>';
            return;
        }
        let html = '';
        users.forEach((user) => {
            const userLabel = `User: ${user.sessionIdMasked || ''}`;
            const status = `Status: ${user.suspendedAt ? 'Suspended' : 'Active'} · Last active: ${displayDate(user.lastActive)}`;
            html += `<div class="list-item"><strong>${esc(userLabel)}</strong><small class="muted">${esc(status)}</small></div>`;
        });
        auditEvents.forEach((event) => {
            const auditLabel = `Audit: ${labelForAction(event.action)}`;
            const auditMeta = `User: ${event.identifierMasked || event.userIdMasked || 'Anonymous'} · ${displayDate(event.createdAt)}`;
            html += `<div class="list-item"><strong>${esc(auditLabel)}</strong><small class="muted">${esc(auditMeta)}</small></div>`;
        });
        reports.forEach((report) => {
            const reportType = `Report: ${esc(report.feedback?.reportType || 'report')}`;
            const reportMeta = `User: ${esc(report.userIdMasked || '')} · ${displayDate(report.createdAt)}`;
            html += `<div class="list-item"><strong>${reportType}</strong><p>${esc(report.content || '')}</p><small class="muted">${reportMeta}</small></div>`;
        });
        resultBox.innerHTML = html;
    } catch (error) {
        resultBox.innerHTML = `<div class="list-item"><strong class="muted">${esc(error.message || 'Search request failed.')}</strong></div>`;
    }
}

function clearSearch() {
    if ($('adminSearchQuery')) $('adminSearchQuery').value = '';
    const resultBox = $('adminSearchResults');
    if (resultBox) {
        resultBox.hidden = true;
        resultBox.innerHTML = '';
    }
}

function downloadJsonFile(dataObj, filename) {
    const jsonStr = JSON.stringify(dataObj, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function handleExport(type) {
    const timestamp = new Date().toISOString().slice(0, 10);
    const exports = {
        Snapshot: { exportedAt: new Date().toISOString(), overview: state.overview, people: state.people, reports: state.reports, audit: state.audit, sessions: state.sessions },
        Reports: state.reports,
        Audit: state.audit,
        Metrics: state.overview || {}
    };
    downloadJsonFile(exports[type], `monika-admin-${type.toLowerCase()}-${timestamp}.json`);
}

window.addEventListener('load', () => {
    initTabs();
    init();
    $('suspendUserBtn')?.addEventListener('click', () => setSuspension(true));
    $('unsuspendUserBtn')?.addEventListener('click', () => setSuspension(false));
    $('refreshReportsBtn')?.addEventListener('click', () => { showSkeleton('reportList'); loadReports(); });
    $('refreshAuditBtn')?.addEventListener('click', () => loadAudit($('auditCategoryFilter')?.value || ''));
    $('refreshDashboardBtn')?.addEventListener('click', init);
    $('exportAdminSnapshotBtn')?.addEventListener('click', () => handleExport('Snapshot'));
    $('adminLogoutBtn')?.addEventListener('click', async () => {
        try { await apiFetch('/api/admin/logout', { method: 'POST' }); } catch (_) { /* Redirect after logout or expiry. */ }
        window.location.href = '/admin-login';
    });
    $('refreshSessionsBtn')?.addEventListener('click', loadSessions);
    $('refreshSuspendedBtn')?.addEventListener('click', () => { showSkeleton('suspendedUsersList', 2); loadSuspendedUsers(); });
    $('adminSearchBtn')?.addEventListener('click', handleSearch);
    $('adminClearSearchBtn')?.addEventListener('click', clearSearch);
    $('maintenanceToggle')?.addEventListener('change', toggleMaintenance);
    $('maintenanceBannerOff')?.addEventListener('click', toggleMaintenance);
    $('auditCategoryFilter')?.addEventListener('change', () => loadAudit($('auditCategoryFilter').value));

    const searchInput = $('adminSearchQuery');
    searchInput?.addEventListener('input', () => {
        window.clearTimeout(state.searchTimeout);
        state.searchTimeout = window.setTimeout(handleSearch, 400);
    });
    ['Snapshot', 'Reports', 'Audit', 'Metrics'].forEach((type) => {
        const button = $(`export${type}Btn`);
        button?.addEventListener('click', () => handleExport(type));
    });
});
