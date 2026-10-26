const fs = require('fs');

let s = fs.readFileSync('public/js/app.js', 'utf8');

// 1. In DOMContentLoaded, add refreshPublicLiveQueue()
if (!s.includes('await refreshPublicLiveQueue();')) {
  s = s.replace(
    'await refreshLiveQueueBoard();',
    'await refreshLiveQueueBoard();\n  await refreshPublicLiveQueue();'
  );
}

// 2. Add refreshPublicLiveQueue to socket handlers
if (!s.includes('socket.on(\'queue.doctor_updated\'')) {
  s = s.replace(
    "triggerCallAnnouncement(data);\n    refreshLiveQueueBoard();",
    "triggerCallAnnouncement(data);\n    refreshLiveQueueBoard();\n    refreshPublicLiveQueue();"
  );
  s = s.replace(
    "socket.on('queue.updated', () => {\n    refreshLiveQueueBoard();",
    "socket.on('queue.updated', () => {\n    refreshLiveQueueBoard();\n    refreshPublicLiveQueue();"
  );
  s = s.replace(
    "socket.on('doctor.status_changed', () => {\n    refreshLiveQueueBoard();",
    "socket.on('queue.doctor_updated', () => {\n    refreshLiveQueueBoard();\n    refreshPublicLiveQueue();\n    refreshDisplay();\n    refreshDoctorConsole();\n  });\n\n  socket.on('doctor.status_changed', () => {\n    refreshLiveQueueBoard();\n    refreshPublicLiveQueue();"
  );
  s = s.replace(
    "if (currentUser && currentUser.role === 'admin') loadAdminData();\n  });\n}",
    "if (currentUser && currentUser.role === 'admin') loadAdminData();\n  });\n\n  setInterval(() => { refreshPublicLiveQueue(false); }, 10000);\n}"
  );
}

// 3. Inject Public Queue Display Panel controller
const publicTarget = '// =============================================================\n// RECEPTION & STRICT MINIMAL TOKEN PRINTING';

const publicQueueFunctions = `// ============================================================================
// LIVE QUEUE DISPLAY PANEL CONTROLLER (Section 1 & 5 Requirements)
// Displays: Doctor & Specialty, Current Token, Next Token, Status, Wait Time
// ============================================================================
let publicLiveQueueData = [];

async function refreshPublicLiveQueue(showFeedback = false) {
  try {
    const syncPill = document.getElementById('liveSyncStatus');
    if (syncPill) {
      syncPill.innerHTML = \`
        <span class="pulse-dot" style="background: #34d399; width: 8px; height: 8px;"></span>
        Syncing...
      \`;
    }

    const res = await fetch('/api/public/live-queue');
    const json = await res.json();

    if (!json.success || !json.data) return;
    publicLiveQueueData = json.data;

    const tbody = document.getElementById('publicLiveQueueTbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (publicLiveQueueData.length === 0) {
      tbody.innerHTML = \`
        <tr>
          <td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">
            No active doctor clinics scheduled today.
          </td>
        </tr>
      \`;
      return;
    }

    publicLiveQueueData.forEach(item => {
      const tr = document.createElement('tr');
      const isCalling = item.statusCode === 'CALLED' || item.statusCode === 'RECALLED';
      const isArrived = item.statusCode === 'ARRIVED';
      const isConsulting = item.statusCode === 'IN_CONSULTATION';
      const isAwaiting = item.statusCode === 'AWAITING_PATIENT';
      const isPaused = item.dutyStatus === 'ON_BREAK';
      const isOffDuty = item.dutyStatus === 'OFF_DUTY';

      let badgeClass = 'q-status-waiting';
      let iconSvg = '';
      if (isCalling) {
        badgeClass = 'q-status-calling';
        iconSvg = '<span class="pulse-dot" style="background: #f59e0b;"></span>';
      } else if (isArrived) {
        badgeClass = 'q-status-arrived';
        iconSvg = '✓';
      } else if (isConsulting) {
        badgeClass = 'q-status-consulting';
        iconSvg = '<span class="pulse-dot" style="background: #3b82f6;"></span>';
      } else if (isAwaiting) {
        badgeClass = 'q-status-awaiting';
        iconSvg = '⏳';
      } else if (isPaused) {
        badgeClass = 'q-status-paused';
        iconSvg = '⏸';
      } else if (isOffDuty) {
        badgeClass = 'q-status-waiting';
        iconSvg = '⚪';
      }

      let countdownHtml = '';
      if (isCalling && item.countdownRemaining > 0) {
        countdownHtml = \`
          <span class="q-countdown-pill" title="Doctor Call Countdown">
            ⏱ \${item.countdownRemaining}s
          </span>
        \`;
      }

      tr.innerHTML = \`
        <td>
          <div class="doctor-queue-name">\${escapeHtml(item.doctorName)}</div>
          <div class="doctor-queue-spec">\${escapeHtml(item.specialty)}</div>
        </td>
        <td>
          <span class="room-pill">\${escapeHtml(item.roomNumber)}</span>
        </td>
        <td style="text-align: center;">
          \${item.currentToken !== '—' 
            ? \`<span class="token-big-badge">\${escapeHtml(item.currentToken)}</span>\` 
            : \`<span class="token-empty-text">—</span>\`}
        </td>
        <td style="text-align: center;">
          \${item.nextToken !== '—' 
            ? \`<span class="token-next-badge">\${escapeHtml(item.nextToken)}</span>\` 
            : \`<span class="token-empty-text">—</span>\`}
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span class="q-status-badge \${badgeClass}">
              \${iconSvg} \${escapeHtml(item.status)}
            </span>
            \${countdownHtml}
          </div>
        </td>
        <td style="text-align: right; font-weight: 700; color: #475569; font-size: 0.88rem;">
          \${escapeHtml(item.estimatedTime)}
        </td>
      \`;
      tbody.appendChild(tr);
    });

    const updatedEl = document.getElementById('publicQueueLastUpdated');
    if (updatedEl) {
      const now = new Date();
      updatedEl.textContent = \`Last synchronized: \${now.toLocaleTimeString()} (Auto-refreshes on every queue event)\`;
    }

    if (syncPill) {
      syncPill.innerHTML = \`
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
        Live Sync Active
      \`;
    }

    if (showFeedback) {
      alert('Live Doctor Queue synchronized with MySQL database.');
    }
  } catch (err) {
    console.error('Error refreshing public live queue:', err);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toggleQueueFullscreen() {
  const panel = document.getElementById('publicLiveQueuePanel');
  if (!panel) return;
  panel.classList.toggle('is-fullscreen');
  const isFs = panel.classList.contains('is-fullscreen');
  const btn = panel.querySelector('.btn-fullscreen-toggle span');
  if (btn) {
    btn.textContent = isFs ? 'Exit TV Mode (Esc)' : 'Reception TV Mode';
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const panel = document.getElementById('publicLiveQueuePanel');
    if (panel && panel.classList.contains('is-fullscreen')) {
      panel.classList.remove('is-fullscreen');
      const btn = panel.querySelector('.btn-fullscreen-toggle span');
      if (btn) btn.textContent = 'Reception TV Mode';
    }
  }
});

function openQuickTokenModal() {
  const modal = document.getElementById('quickTokenModal');
  const patSelect = document.getElementById('quickTokenPatientSelect');
  const sesSelect = document.getElementById('quickTokenSessionSelect');
  if (!modal || !patSelect || !sesSelect) return;

  patSelect.innerHTML = '';
  allPatients.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = \`\${p.hospital_number} — \${p.name} (\${p.phone || 'No phone'})\`;
    patSelect.appendChild(opt);
  });

  sesSelect.innerHTML = '';
  allSessions.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = \`\${s.session_name} (\${s.clinic_name}) — Today\`;
    sesSelect.appendChild(opt);
  });

  modal.style.display = 'flex';
}

function closeQuickTokenModal() {
  const modal = document.getElementById('quickTokenModal');
  if (modal) modal.style.display = 'none';
}

async function submitQuickQueueRegistration() {
  const patientId = document.getElementById('quickTokenPatientSelect').value;
  const sessionId = document.getElementById('quickTokenSessionSelect').value;
  const priority = document.getElementById('quickTokenPrioritySelect').value;
  const btn = document.getElementById('btnSubmitQuickToken');

  if (!patientId || !sessionId) {
    alert('Please select both a patient profile and clinic session.');
    return;
  }

  try {
    btn.disabled = true;
    btn.textContent = 'Generating Token...';

    const res = await fetch('/api/visits/check-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId, sessionId, priority, isAppointment: false })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to issue token');
      return;
    }

    closeQuickTokenModal();
    if (data.reused) {
      alert(\`Patient already has an active token in this session: \${data.token.token_number} (\${data.token.status})\`);
    } else {
      alert(\`Queue Token Assigned Successfully!\\nToken Number: \${data.token.token_number}\\nEstimated Wait: ~\${data.eta.estimatedMinutes} mins\`);
    }

    await refreshPublicLiveQueue();
    await refreshLiveQueueBoard();
    if (currentUser && currentUser.role === 'patient') loadPatientDashboard();
  } catch (err) {
    alert('Error connecting to queue service: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate Queue Token';
  }
}

`;

if (!s.includes('function refreshPublicLiveQueue')) {
  s = s.replace(publicTarget, publicQueueFunctions + publicTarget);
}

// 4. Upgrade Doctor Console functions
const oldDoctorSection = `async function refreshDoctorConsole() {
  try {
    const res = await fetch('/api/doctors');
    const doctors = await res.json();
    allDoctors = doctors;

    const doc = doctors.find(d => d.id === activeDoctorId);
    if (!doc) return;

    document.getElementById('activeDoctorTitle').textContent = doc.name;
    document.getElementById('doctorRoomBadge').textContent = \`Room: \${doc.room_number || 'Unassigned'}\`;
    document.getElementById('doctorDutyBadge').textContent = \`Duty: \${doc.duty_status}\`;

    if (doc.current_token) {
      document.getElementById('docCurrentTokenBadge').textContent = doc.current_token;
      document.getElementById('docCurrentPatientName').textContent = 'Patient In Consultation';
      document.getElementById('docCurrentHospitalNo').textContent = 'Active Consultation';
      document.getElementById('btnRecall').style.display = 'inline-flex';
      document.getElementById('btnMissed').style.display = 'inline-flex';
    } else {
      document.getElementById('docCurrentTokenBadge').textContent = '—';
      document.getElementById('docCurrentPatientName').textContent = 'No Patient Called';
      document.getElementById('docCurrentHospitalNo').textContent = 'Room Ready for Next Patient';
      document.getElementById('btnRecall').style.display = 'none';
      document.getElementById('btnMissed').style.display = 'none';
    }

    const sessionRes = await fetch('/api/sessions');
    const sessions = await sessionRes.json();
    const deptSession = sessions.find(s => s.department_id === doc.department_id && s.state === 'ACTIVE');

    if (deptSession) {
      document.getElementById('queueDeptLabel').textContent = \`\${deptSession.session_name}\`;
      document.getElementById('waitingCountBadge').textContent = \`\${deptSession.waiting_count} Waiting\`;
      renderSessionWaitingList(deptSession.session_code);
    }
  } catch (err) {
    console.error('Error refreshing doctor console:', err);
  }
}

async function renderSessionWaitingList(sessionCode) {
  try {
    const res = await fetch(\`/api/displays/\${sessionCode}\`);
    const data = await res.json();
    const list = document.getElementById('sessionWaitingList');
    list.innerHTML = '';

    if (!data.nextWaitingToken) {
      list.innerHTML = \`<div style=\"color: var(--text-muted); padding: 0.5rem;\">Queue is currently empty.</div>\`;
      return;
    }

    list.innerHTML = \`
      <div style=\"padding: 0.75rem; background: var(--bg-page); border-radius: 6px; margin-bottom: 0.4rem; display: flex; justify-content: space-between; border: 1px solid var(--border-light);\">
        <span><b>Next Waiting Token:</b> \${data.nextWaitingToken}</span>
        <span class=\"status-badge-live status-calling\">Waiting</span>
      </div>
      <div style=\"font-size: 0.8rem; color: var(--text-muted); padding: 0.25rem 0.5rem;\">
        Total waiting: \${data.waitingCount} | Completed today: \${data.completedCount}
      </div>
    \`;
  } catch (err) {
    console.error(err);
  }
}

async function doctorCallNext() {
  try {
    const res = await fetch('/api/queues/next', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${currentToken}\`
      },
      body: JSON.stringify({ doctorId: activeDoctorId })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to call next patient');
      return;
    }

    if (data.empty) {
      alert('The waiting queue is empty.');
      return;
    }
    if (data.hasActive) {
      alert(data.message);
      return;
    }

    currentAttendingToken = data.token;
    document.getElementById('docCurrentTokenBadge').textContent = data.token.token_number;
    document.getElementById('docCurrentPatientName').textContent = data.token.patient_name;
    document.getElementById('docCurrentHospitalNo').textContent = \`Patient ID: \${data.token.hospital_number}\`;
    document.getElementById('btnRecall').style.display = 'inline-flex';
    document.getElementById('btnMissed').style.display = 'inline-flex';

    document.getElementById('consultSymptoms').value = '';
    document.getElementById('consultDiagnosis').value = '';
    document.getElementById('consultNotes').value = '';
  } catch (err) {
    alert('Failed to call next patient');
  }
}

async function doctorRecall() {
  if (!currentAttendingToken) return;
  try {
    await fetch(\`/api/tokens/\${currentAttendingToken.id}/recall\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${currentToken}\`
      },
      body: JSON.stringify({ doctorId: activeDoctorId })
    });
  } catch (err) {
    alert('Recall failed');
  }
}

async function doctorMarkMissed() {
  if (!currentAttendingToken) return;
  try {
    await fetch(\`/api/tokens/\${currentAttendingToken.id}/missed\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${currentToken}\`
      },
      body: JSON.stringify({ doctorId: activeDoctorId, reason: 'Patient did not answer chime' })
    });
    currentAttendingToken = null;
    refreshDoctorConsole();
  } catch (err) {
    alert('Error marking missed');
  }
}`;

const newDoctorSection = `// Global countdown timer handle for doctor station
let doctorCountdownInterval = null;
let doctorCountdownSeconds = 0;

function startDoctorCountdown(initialSeconds = 60, tokenId = null) {
  stopDoctorCountdown();
  doctorCountdownSeconds = initialSeconds;

  const container = document.getElementById('docCountdownContainer');
  const textEl = document.getElementById('docCountdownText');
  const barEl = document.getElementById('docCountdownProgressBar');

  if (container) container.style.display = 'block';
  if (textEl) textEl.textContent = \`\${doctorCountdownSeconds}s\`;
  if (barEl) barEl.style.width = \`\${(doctorCountdownSeconds / 60) * 100}%\`;

  doctorCountdownInterval = setInterval(async () => {
    doctorCountdownSeconds--;
    if (textEl) textEl.textContent = \`\${Math.max(0, doctorCountdownSeconds)}s\`;
    if (barEl) barEl.style.width = \`\${Math.max(0, (doctorCountdownSeconds / 60) * 100)}%\`;

    if (doctorCountdownSeconds <= 0) {
      stopDoctorCountdown();
      if (currentAttendingToken && currentAttendingToken.id) {
        try {
          await fetch(\`/api/tokens/\${currentAttendingToken.id}/awaiting\`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': \`Bearer \${currentToken}\`
            },
            body: JSON.stringify({ doctorId: activeDoctorId })
          });
        } catch (e) {
          console.error('Failed to notify countdown expiry:', e);
        }
      }
      await refreshDoctorConsole();
    }
  }, 1000);
}

function stopDoctorCountdown() {
  if (doctorCountdownInterval) {
    clearInterval(doctorCountdownInterval);
    doctorCountdownInterval = null;
  }
  const container = document.getElementById('docCountdownContainer');
  if (container) container.style.display = 'none';
}

async function refreshDoctorConsole() {
  try {
    const res = await fetch('/api/doctors');
    const doctors = await res.json();
    allDoctors = doctors;

    const doc = doctors.find(d => d.id === activeDoctorId);
    if (!doc) return;

    document.getElementById('activeDoctorTitle').textContent = doc.name;
    document.getElementById('doctorRoomBadge').textContent = \`Room: \${doc.room_number || 'Unassigned'}\`;
    document.getElementById('doctorDutyBadge').textContent = \`Duty: \${doc.duty_status}\`;

    const stateRes = await fetch(\`/api/doctor/state?doctorId=\${activeDoctorId}\`, {
      headers: currentToken ? { 'Authorization': \`Bearer \${currentToken}\` } : {}
    });

    if (stateRes.ok) {
      const state = await stateRes.json();
      applyDoctorQueueState(state);
    } else {
      document.getElementById('docCurrentTokenBadge').textContent = '—';
      document.getElementById('docCurrentPatientName').textContent = 'No Patient Called';
    }

    const sessionRes = await fetch('/api/sessions');
    const sessions = await sessionRes.json();
    const deptSession = sessions.find(s => s.department_id === doc.department_id && s.state === 'ACTIVE');

    if (deptSession) {
      document.getElementById('queueDeptLabel').textContent = \`\${deptSession.session_name}\`;
    }
  } catch (err) {
    console.error('Error refreshing doctor console:', err);
  }
}

function applyDoctorQueueState(state) {
  const activeToken = state.activeToken;
  currentAttendingToken = activeToken;

  const badgeEl = document.getElementById('docCurrentTokenBadge');
  const nameEl = document.getElementById('docCurrentPatientName');
  const hospEl = document.getElementById('docCurrentHospitalNo');
  const stateBadgeEl = document.getElementById('docQueueStateBadge');

  const btnCallNext = document.getElementById('btnCallNext');
  const btnMarkArrived = document.getElementById('btnMarkArrived');
  const btnStartConsult = document.getElementById('btnStartConsult');
  const btnRecall = document.getElementById('btnRecall');
  const btnSkip = document.getElementById('btnSkipPatient');

  if (activeToken) {
    badgeEl.textContent = activeToken.token_number;
    nameEl.textContent = activeToken.patient_name || 'Attending Patient';
    hospEl.textContent = \`Patient Hospital No: \${activeToken.hospital_number || '—'}\`;

    document.getElementById('docPatBannerName').textContent = activeToken.patient_name || 'Patient';
    document.getElementById('docPatBannerHospId').textContent = activeToken.hospital_number || '—';
    document.getElementById('docPatBannerDob').textContent = activeToken.dob ? activeToken.dob.split('T')[0] : '—';
    document.getElementById('docPatBannerGender').textContent = activeToken.gender || '—';
    document.getElementById('docPatBannerBlood').textContent = activeToken.blood_group || 'O+';
    document.getElementById('docPatBannerAllergies').textContent = activeToken.allergies || 'None';
    document.getElementById('doctorPatientIdentityBanner').style.display = 'block';

    const st = activeToken.status;
    if (stateBadgeEl) {
      stateBadgeEl.textContent = st;
      stateBadgeEl.className = 'status-badge-live ' + (
        st === 'CALLED' || st === 'RECALLED' ? 'status-calling' :
        st === 'ARRIVED' ? 'status-consulting' :
        st === 'IN_CONSULTATION' ? 'status-consulting' :
        'status-available'
      );
    }

    if (st === 'CALLED' || st === 'RECALLED') {
      btnCallNext.style.display = 'none';
      btnMarkArrived.style.display = 'inline-flex';
      btnStartConsult.style.display = 'inline-flex';
      btnRecall.style.display = 'inline-flex';
      btnSkip.style.display = 'inline-flex';

      if (state.countdownRemaining > 0) {
        startDoctorCountdown(state.countdownRemaining, activeToken.id);
      } else {
        stopDoctorCountdown();
      }
    } else if (st === 'ARRIVED') {
      stopDoctorCountdown();
      btnCallNext.style.display = 'none';
      btnMarkArrived.style.display = 'none';
      btnStartConsult.style.display = 'inline-flex';
      btnRecall.style.display = 'inline-flex';
      btnSkip.style.display = 'inline-flex';
    } else if (st === 'IN_CONSULTATION') {
      stopDoctorCountdown();
      btnCallNext.style.display = 'none';
      btnMarkArrived.style.display = 'none';
      btnStartConsult.style.display = 'none';
      btnRecall.style.display = 'none';
      btnSkip.style.display = 'inline-flex';
    } else if (st === 'AWAITING_PATIENT') {
      stopDoctorCountdown();
      btnCallNext.style.display = 'none';
      btnMarkArrived.style.display = 'inline-flex';
      btnStartConsult.style.display = 'inline-flex';
      btnRecall.style.display = 'inline-flex';
      btnSkip.style.display = 'inline-flex';
    }
  } else {
    stopDoctorCountdown();
    badgeEl.textContent = '—';
    nameEl.textContent = 'No Patient Called';
    hospEl.textContent = 'Examination Room Ready';
    if (stateBadgeEl) {
      stateBadgeEl.textContent = 'Available';
      stateBadgeEl.className = 'status-badge-live status-available';
    }
    document.getElementById('doctorPatientIdentityBanner').style.display = 'none';

    btnCallNext.style.display = 'inline-flex';
    btnMarkArrived.style.display = 'none';
    btnStartConsult.style.display = 'none';
    btnRecall.style.display = 'none';
    btnSkip.style.display = 'none';
  }

  const waitBadge = document.getElementById('waitingCountBadge');
  const waitListEl = document.getElementById('sessionWaitingList');
  if (waitBadge) {
    waitBadge.textContent = \`\${state.waitingTokens ? state.waitingTokens.length : 0} Waiting\`;
  }
  if (waitListEl) {
    waitListEl.innerHTML = '';
    if (!state.waitingTokens || state.waitingTokens.length === 0) {
      waitListEl.innerHTML = '<div style=\"color: var(--text-muted); padding: 0.75rem;\">No patients currently in waiting queue.</div>';
    } else {
      state.waitingTokens.forEach((tk, idx) => {
        const item = document.createElement('div');
        item.style.cssText = 'padding: 0.65rem 0.85rem; background: var(--bg-page); border-radius: 6px; margin-bottom: 0.4rem; display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--border-light);';
        item.innerHTML = \`
          <div>
            <span style=\"font-family: monospace; font-weight: 800; color: #1d4ed8; font-size: 0.95rem;\">\${tk.token_number}</span>
            <span style=\"font-size: 0.75rem; color: var(--text-muted); margin-left: 0.5rem;\">(\${tk.hospital_number})</span>
          </div>
          <span class=\"status-badge-live \${idx === 0 ? 'status-calling' : 'status-available'}\" style=\"font-size: 0.72rem;\">
            \${idx === 0 ? 'Next Eligible' : \`Queue #\${idx + 1}\`}
          </span>
        \`;
        waitListEl.appendChild(item);
      });
    }
  }

  const skippedCard = document.getElementById('docSkippedCard');
  const skippedBadge = document.getElementById('skippedCountBadge');
  const skippedListEl = document.getElementById('docSkippedList');

  if (state.skippedTokens && state.skippedTokens.length > 0) {
    if (skippedCard) skippedCard.style.display = 'block';
    if (skippedBadge) skippedBadge.textContent = \`\${state.skippedTokens.length} Skipped\`;
    if (skippedListEl) {
      skippedListEl.innerHTML = '';
      state.skippedTokens.forEach(stk => {
        const div = document.createElement('div');
        div.style.cssText = 'padding: 0.55rem 0.75rem; background: #fffbeb; border-radius: 6px; margin-bottom: 0.35rem; display: flex; justify-content: space-between; align-items: center; border: 1px solid #fde68a; font-size: 0.82rem;';
        div.innerHTML = \`
          <div>
            <b style=\"font-family: monospace; color: #b45309;\">\${stk.token_number}</b>
            <span style=\"color: var(--text-muted); margin-left: 0.4rem;\">\${escapeHtml(stk.patient_name || stk.hospital_number)}</span>
          </div>
          <button type=\"button\" class=\"btn-outline\" style=\"font-size: 0.7rem; padding: 0.2rem 0.55rem; border-color: #b45309; color: #b45309;\" onclick=\"doctorRecallSkipped('\${stk.id}')\">
            Recall Patient
          </button>
        \`;
        skippedListEl.appendChild(div);
      });
    }
  } else {
    if (skippedCard) skippedCard.style.display = 'none';
  }
}

// A. CALL NEXT PATIENT
async function doctorCallNext() {
  const btn = document.getElementById('btnCallNext');
  try {
    if (btn) btn.disabled = true;

    const res = await fetch('/api/queues/next', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${currentToken}\`
      },
      body: JSON.stringify({ doctorId: activeDoctorId })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to call next patient');
      return;
    }

    if (data.empty) {
      alert('The waiting queue is currently empty.');
      return;
    }
    if (data.hasActive) {
      alert(data.message);
      return;
    }

    currentAttendingToken = data.token;
    startDoctorCountdown(60, data.token.id);
    await refreshDoctorConsole();
    await refreshPublicLiveQueue();
  } catch (err) {
    alert('Failed to call next patient: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// B. MARK PATIENT AS ARRIVED
async function doctorMarkPatientArrived() {
  if (!currentAttendingToken) return;
  try {
    const res = await fetch(\`/api/tokens/\${currentAttendingToken.id}/arrived\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${currentToken}\`
      },
      body: JSON.stringify({ doctorId: activeDoctorId })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to mark patient arrived');
      return;
    }

    stopDoctorCountdown();
    await refreshDoctorConsole();
    await refreshPublicLiveQueue();
  } catch (err) {
    alert('Error marking patient as arrived');
  }
}

// C. START CONSULTATION
async function doctorStartConsultation() {
  if (!currentAttendingToken) return;
  try {
    const res = await fetch(\`/api/tokens/\${currentAttendingToken.id}/start-consultation\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${currentToken}\`
      },
      body: JSON.stringify({ doctorId: activeDoctorId })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to start consultation');
      return;
    }

    stopDoctorCountdown();
    await refreshDoctorConsole();
    await refreshPublicLiveQueue();
  } catch (err) {
    alert('Error starting consultation');
  }
}

// RECALL CHIME (During CALLED state)
async function doctorRecall() {
  if (!currentAttendingToken) return;
  try {
    const res = await fetch(\`/api/tokens/\${currentAttendingToken.id}/recall\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${currentToken}\`
      },
      body: JSON.stringify({ doctorId: activeDoctorId })
    });
    const data = await res.json();
    if (res.ok) {
      startDoctorCountdown(60, currentAttendingToken.id);
      await refreshPublicLiveQueue();
    }
  } catch (err) {
    alert('Recall failed');
  }
}

// E. SKIP PATIENT
async function doctorSkipPatient() {
  if (!currentAttendingToken) return;
  const reason = prompt('Reason for skipping patient (e.g. absent at consultation room):', 'Patient did not respond to chime within 60s');
  if (reason === null) return;

  try {
    const res = await fetch(\`/api/tokens/\${currentAttendingToken.id}/skip\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${currentToken}\`
      },
      body: JSON.stringify({ doctorId: activeDoctorId, reason })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to skip patient');
      return;
    }

    stopDoctorCountdown();
    currentAttendingToken = null;
    await refreshDoctorConsole();
    await refreshPublicLiveQueue();
  } catch (err) {
    alert('Error skipping patient');
  }
}

// RECALL SKIPPED PATIENT BACK
async function doctorRecallSkipped(tokenId) {
  try {
    const res = await fetch(\`/api/tokens/\${tokenId}/recall-skipped\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${currentToken}\`
      },
      body: JSON.stringify({ doctorId: activeDoctorId })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to recall patient');
      return;
    }

    currentAttendingToken = data.token;
    startDoctorCountdown(60, tokenId);
    await refreshDoctorConsole();
    await refreshPublicLiveQueue();
  } catch (err) {
    alert('Error recalling skipped patient: ' + err.message);
  }
}

// Legacy alias
async function doctorMarkMissed() {
  return doctorSkipPatient();
}`;

if (s.includes(oldDoctorSection)) {
  s = s.replace(oldDoctorSection, newDoctorSection);
} else {
  console.log('WARNING: oldDoctorSection not matched exactly');
}

// 5. Update doctorCompleteConsultation to refresh public queue and stop timer
s = s.replace(
  "alert('Consultation saved successfully! Prescriptions, recommendations, and care tasks synchronized to patient portal.');\n    currentAttendingToken = null;\n    document.getElementById('doctorPatientIdentityBanner').style.display = 'none';\n    refreshDoctorConsole();",
  "alert('Consultation saved successfully! Prescriptions, recommendations, and care tasks synchronized to patient portal.');\n    stopDoctorCountdown();\n    currentAttendingToken = null;\n    document.getElementById('doctorPatientIdentityBanner').style.display = 'none';\n    await refreshDoctorConsole();\n    await refreshPublicLiveQueue();"
);

fs.writeFileSync('public/js/app.js', s, 'utf8');
console.log('app.js patched cleanly');
