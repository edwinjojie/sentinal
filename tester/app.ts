const API_BASE = 'http://localhost:3001/api';

// Elements
const cfgTokenLimit = document.getElementById('cfg-token-limit') as HTMLInputElement;
const cfgCostLimit = document.getElementById('cfg-cost-limit') as HTMLInputElement;
const cfgSimWindow = document.getElementById('cfg-sim-window') as HTMLInputElement;
const cfgSimThreshold = document.getElementById('cfg-sim-threshold') as HTMLInputElement;
const cfgSpikeMulti = document.getElementById('cfg-spike-multi') as HTMLInputElement;
const cfgBlockViolation = document.getElementById('cfg-block-violation') as HTMLInputElement;
const updateConfigBtn = document.getElementById('update-config-btn') as HTMLButtonElement;

const subjectIdInput = document.getElementById('subject-id') as HTMLInputElement;
const modelIdInput = document.getElementById('model-id') as HTMLInputElement;
const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const sendRequestBtn = document.getElementById('send-request-btn') as HTMLButtonElement;
const hugePromptBtn = document.getElementById('huge-prompt-btn') as HTMLButtonElement;

const logsContainer = document.getElementById('logs-container') as HTMLDivElement;
const statsDisplay = document.getElementById('stats-display') as HTMLPreElement;
const refreshStatsBtn = document.getElementById('refresh-stats-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const statusDot = document.querySelector('.dot') as HTMLSpanElement;

// Initialization
async function init() {
    try {
        const res = await fetch(`${API_BASE}/config`);
        if (res.ok) {
            const config = await res.json();
            updateConfigFields(config);
            setOnline(true);
        } else {
            setOnline(false);
        }
    } catch (e) {
        setOnline(false);
    }
    refreshStats();
}

function setOnline(online: boolean) {
    statusText.innerText = online ? 'Online' : 'Offline';
    statusDot.className = online ? 'dot online' : 'dot';
}

function updateConfigFields(config: any) {
    if (config.minuteTokenLimit) cfgTokenLimit.value = config.minuteTokenLimit;
    if (config.dailyCostLimitUSD) cfgCostLimit.value = config.dailyCostLimitUSD;
    if (config.abuseDetection) {
        cfgSimWindow.value = config.abuseDetection.promptSimilarityWindowMs;
        cfgSimThreshold.value = config.abuseDetection.promptSimilarityThreshold;
        cfgSpikeMulti.value = config.abuseDetection.spendSpikeMultiplier;
    }
    cfgBlockViolation.checked = !!config.blockOnViolation;
}

// Actions
updateConfigBtn.addEventListener('click', async () => {
    const config = {
        minuteTokenLimit: parseInt(cfgTokenLimit.value),
        dailyCostLimitUSD: parseFloat(cfgCostLimit.value),
        blockOnViolation: cfgBlockViolation.checked,
        abuseDetection: {
            promptSimilarityWindowMs: parseInt(cfgSimWindow.value),
            promptSimilarityThreshold: parseInt(cfgSimThreshold.value),
            spendSpikeMultiplier: parseFloat(cfgSpikeMulti.value),
        }
    };

    try {
        const res = await fetch(`${API_BASE}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        if (res.ok) {
            addLog('system', 'Configuration updated successfully');
        }
    } catch (e: any) {
        addLog('error', `Failed to update config: ${e.message}`);
    }
});

sendRequestBtn.addEventListener('click', async () => {
    const subjectId = subjectIdInput.value;
    const model = modelIdInput.value;
    const prompt = promptInput.value;

    if (!prompt) {
        alert('Please enter a prompt');
        return;
    }

    sendRequestBtn.disabled = true;
    sendRequestBtn.innerText = 'Sending...';

    try {
        const res = await fetch(`${API_BASE}/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subjectId, model, prompt })
        });

        const data = await res.json();
        if (res.ok) {
            addLog('allowed', `Request allowed. Tokens used: ${data.response.totalTokens}`, data.response);
        } else {
            addLog('blocked', `Request blocked: ${data.reason}`, data.details);
        }
    } catch (e: any) {
        addLog('error', `Request failed: ${e.message}`);
    } finally {
        sendRequestBtn.disabled = false;
        sendRequestBtn.innerText = 'Send Request';
        refreshStats();
    }
});

hugePromptBtn.addEventListener('click', () => {
    promptInput.value = 'A'.repeat(50000); // Simulate a large input
});

refreshStatsBtn.addEventListener('click', refreshStats);

async function refreshStats() {
    try {
        const res = await fetch(`${API_BASE}/stats`);
        if (res.ok) {
            const stats = await res.json();
            statsDisplay.innerText = JSON.stringify(stats, null, 2);
        }
    } catch (e) { }
}

resetBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset all data in Redis?')) {
        await fetch(`${API_BASE}/reset`, { method: 'POST' });
        addLog('system', 'Redis store has been reset');
        refreshStats();
    }
});

function addLog(type: string, message: string, details: any = null) {
    const container = logsContainer;
    if (container.querySelector('.empty-state')) {
        container.innerHTML = '';
    }

    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const time = new Date().toLocaleTimeString();

    let metaHtml = '';
    if (details) {
        if (details.abuseFlags && details.abuseFlags.length > 0) {
            metaHtml += `<div class="flags">${details.abuseFlags.map((f: string) => `<span class="flag">${f}</span>`).join('')}</div>`;
        }
        if (details.velocitySpike) {
            metaHtml += `<div class="flags"><span class="flag">Velocity Spike</span></div>`;
        }
    }

    entry.innerHTML = `
        <div class="log-header">
            <span class="log-status">${type.toUpperCase()}</span>
            <span class="log-time">${time}</span>
        </div>
        <div class="log-content">${message}</div>
        ${metaHtml}
    `;

    container.insertBefore(entry, container.firstChild);
}

init();
