// Hospital Queue Management System - Asiri Health Inspired Client Controller

const socket = io();

// State
let currentUser = null;
let currentToken = localStorage.getItem('token') || null;
let selectedPortal = 'admin';
let allPatients = [];
let allSessions = [];
let allDoctors = [];
let allRooms = [];
let selectedPatient = null;
let currentDisplaySession = 'OPD';
let activeDoctorId = 'doc-1';
let currentAttendingToken = null;
let currentIssuedToken = null;

// Initial bootstrap
document.addEventListener('DOMContentLoaded', async () => {
  initHeroSlider();
  setupSocketListeners();
  startClock();
  await checkAuthSession();
  await loadBaseData();
  await refreshLiveQueueBoard();
  await refreshPublicLiveQueue();
  renderBarcode('OPD-001');
});

// ============================================================================
// HERO SLIDER CONTROLLER (Asiri Health Inspired)
// Smooth crossfade, subtle zoom, automatic 5s transitions, hover pause, dots & arrows
// ============================================================================
let heroCurrentSlide = 0;
let heroSlideTimer = null;
const HERO_SLIDE_DURATION = 5000;

function initHeroSlider() {
  const slider = document.getElementById('heroSlider');
  if (!slider) return;

  // Preload images for buttery smooth transitions
  const heroImages = [
    '/images/hospital-exterior.jpg',
    '/images/hospital-reception.jpg',
    '/images/modern-ot-theatre.jpg'
  ];
  heroImages.forEach(src => {
    const img = new Image();
    img.src = src;
  });

  // Pause on hover
  slider.addEventListener('mouseenter', () => {
    stopHeroSlider();
  });
  slider.addEventListener('mouseleave', () => {
    startHeroSlider();
  });

  // Start auto transitions
  startHeroSlider();
}

function startHeroSlider() {
  stopHeroSlider();
  heroSlideTimer = setInterval(() => {
    nextHeroSlide();
  }, HERO_SLIDE_DURATION);
}

function stopHeroSlider() {
  if (heroSlideTimer) {
    clearInterval(heroSlideTimer);
    heroSlideTimer = null;
  }
}

function goToHeroSlide(index) {
  const slides = document.querySelectorAll('.hero-slider-wrapper .hero-slide');
  const dots = document.querySelectorAll('.hero-dot');
  if (!slides.length) return;

  heroCurrentSlide = (index + slides.length) % slides.length;

  slides.forEach((slide, idx) => {
    if (idx === heroCurrentSlide) {
      slide.classList.add('active');
    } else {
      slide.classList.remove('active');
    }
  });

  dots.forEach((dot, idx) => {
    if (idx === heroCurrentSlide) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });
}

function nextHeroSlide() {
  goToHeroSlide(heroCurrentSlide + 1);
}

function prevHeroSlide() {
  goToHeroSlide(heroCurrentSlide - 1);
}

// Digital Clock for Live TV Displays
function startClock() {
  setInterval(() => {
    const el = document.getElementById('tvDigitalClock');
    if (el) el.textContent = new Date().toLocaleTimeString();
  }, 1000);
}

// Seamless Section & Tab Navigation
function navigateToSection(target) {
  // If navigating to home or homepage anchors
  if (target === 'home') {
    showView('view-homepage');
    setActiveNav('nav-home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (target === 'services') {
    showView('view-homepage');
    setActiveNav('nav-services');
    const el = document.getElementById('section-services');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (target === 'queue') {
    showView('view-homepage');
    setActiveNav('nav-queue-status');
    const el = document.getElementById('section-queue');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (target === 'about') {
    showView('view-homepage');
    setActiveNav('nav-about');
    const el = document.getElementById('section-about');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (target === 'contact') {
    showView('view-homepage');
    setActiveNav('nav-contact');
    const el = document.getElementById('section-contact');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (target === 'book') {
    showView('view-book');
    setActiveNav('nav-book');
    initBookingWizard();
    return;
  }
  if (target === 'availability') {
    showView('view-availability');
    setActiveNav('nav-availability');
    loadPublicDoctorSchedules();
    return;
  }

  // Application views (Reception, Doctor, Patient, Admin, Display)
  if (target === 'reception') {
    showView('view-reception');
    setActiveNav('nav-reception');
    return;
  }
  if (target === 'display') {
    showView('view-display');
    refreshDisplay();
    return;
  }

  // Protected Role Views: Check Authentication
  if (target === 'doctor') {
    if (!currentUser || currentUser.role !== 'doctor' && currentUser.role !== 'admin') {
      openLoginModal('doctor');
      return;
    }
    showView('view-doctor');
    loadDoctorProfile();
    return;
  }
  if (target === 'patient') {
    if (!currentUser || currentUser.role !== 'patient' && currentUser.role !== 'admin') {
      openLoginModal('patient');
      return;
    }
    showView('view-patient');
    loadPatientDashboard();
    return;
  }
  if (target === 'lab') {
    if (!currentUser || (currentUser.role !== 'lab' && currentUser.role !== 'admin' && currentUser.role !== 'doctor')) {
      openLoginModal('lab');
      return;
    }
    showView('view-lab');
    setActiveNav('nav-lab');
    loadLabRequests();
    return;
  }
  if (target === 'admin') {
    if (!currentUser || currentUser.role !== 'admin') {
      openLoginModal('admin');
      return;
    }
    showView('view-admin');
    setActiveNav('nav-admin');
    loadAdminData();
    return;
  }
}

function showView(viewId) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(viewId);
  if (target) {
    target.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function setActiveNav(navId) {
  document.querySelectorAll('.nav-link-btn').forEach(btn => btn.classList.remove('active'));
  const target = document.getElementById(navId);
  if (target) target.classList.add('active');
}

// Socket.IO Real-time Events
function setupSocketListeners() {
  socket.on('token.called', (data) => {
    triggerCallAnnouncement(data);
    refreshLiveQueueBoard();
    refreshPublicLiveQueue();
    refreshDisplay();
    refreshDoctorConsole();
    if (currentUser && currentUser.role === 'patient') loadPatientDashboard();
  });

  socket.on('queue.updated', () => {
    refreshLiveQueueBoard();
    refreshPublicLiveQueue();
    refreshDisplay();
    refreshDoctorConsole();
    if (currentUser && currentUser.role === 'admin') loadAdminData();
    if (currentUser && currentUser.role === 'patient') loadPatientDashboard();
  });

  socket.on('queue.doctor_updated', () => {
    refreshLiveQueueBoard();
    refreshPublicLiveQueue();
    refreshDisplay();
    refreshDoctorConsole();
  });

  socket.on('doctor.status_changed', () => {
    refreshLiveQueueBoard();
    refreshPublicLiveQueue();
    refreshDisplay();
    if (currentUser && currentUser.role === 'admin') loadAdminData();
  });

  socket.on('schedule.updated', () => {
    if (document.getElementById('view-availability').classList.contains('active')) {
      loadPublicDoctorSchedules();
    }
    if (currentUser && currentUser.role === 'admin' && document.getElementById('view-admin').classList.contains('active')) {
      loadAdminSchedules();
    }
    if (currentUser && currentUser.role === 'doctor' && document.getElementById('view-doctor').classList.contains('active')) {
      loadDoctorDashboard();
    }
  });

  socket.on('appointment.booked', () => {
    if (currentUser && currentUser.role === 'doctor') {
      loadDoctorDashboard();
    }
    if (currentUser && currentUser.role === 'patient') {
      loadPatientDashboard();
    }
    if (currentUser && currentUser.role === 'admin') {
      loadAdminData();
    }
  });

  setInterval(() => { refreshPublicLiveQueue(false); }, 10000);
}

// Two-tone Hospital Audio Chime & Visual Call Alert
function triggerCallAnnouncement(data) {
  const banner = document.getElementById('liveCallBanner');
  document.getElementById('bannerToken').textContent = data.tokenNumber;
  document.getElementById('bannerRoom').textContent = data.roomNumber;
  banner.style.display = 'block';

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const playTone = (freq, start, duration) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime + start);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + start + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + start);
      osc.stop(audioCtx.currentTime + start + duration);
    };
    playTone(659.25, 0, 0.4); // E5
    playTone(523.25, 0.35, 0.6); // C5
  } catch (e) {
    console.log('Audio autoplay prevented');
  }

  setTimeout(() => { banner.style.display = 'none'; }, 6000);
}

// ==============================================================
// AUTHENTICATION & SESSION MANAGEMENT (Requirement 4)
// ==============================================================
async function checkAuthSession() {
  if (!currentToken) {
    updateAuthUI(null);
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      updateAuthUI(currentUser);
    } else {
      localStorage.removeItem('token');
      currentToken = null;
      updateAuthUI(null);
    }
  } catch (e) {
    updateAuthUI(null);
  }
}

function updateAuthUI(user) {
  const badge = document.getElementById('userProfileHeaderBadge');
  const loginBtn = document.getElementById('headerLoginBtnContainer');

  if (user) {
    badge.style.display = 'flex';
    loginBtn.style.display = 'none';
    document.getElementById('headerUserName').textContent = user.fullName;
    document.getElementById('headerUserRole').textContent = user.role.toUpperCase();
  } else {
    badge.style.display = 'none';
    loginBtn.style.display = 'block';
  }
}

function openLoginModal(portal = 'admin') {
  switchLoginPortal(portal);
  document.getElementById('loginModalOverlay').style.display = 'flex';
}

function closeLoginModal() {
  document.getElementById('loginModalOverlay').style.display = 'none';
}

function switchLoginPortal(portal) {
  selectedPortal = portal;
  document.querySelectorAll('.portal-switch-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`portalBtn-${portal}`);
  if (btn) btn.classList.add('active');

  const hint = document.getElementById('demoCredHint');
  const userInp = document.getElementById('loginUsername');
  const passInp = document.getElementById('loginPassword');

  if (portal === 'admin') {
    hint.innerHTML = 'Admin: <code>admin</code> / <code>Admin@123</code>';
    userInp.value = 'admin';
    passInp.value = 'Admin@123';
  } else if (portal === 'doctor') {
    hint.innerHTML = 'Doctor: <code>doctor1</code> / <code>Doctor@123</code> (or doctor2..5)';
    userInp.value = 'doctor1';
    passInp.value = 'Doctor@123';
  } else if (portal === 'patient') {
    hint.innerHTML = 'Patient: <code>patient1</code> / <code>Patient@123</code> (Kamal Jayawardena)';
    userInp.value = 'patient1';
    passInp.value = 'Patient@123';
  } else if (portal === 'lab') {
    hint.innerHTML = 'Laboratory Staff: <code>labstaff</code> / <code>Staff@123</code>';
    userInp.value = 'labstaff';
    passInp.value = 'Staff@123';
  } else if (portal === 'receptionist') {
    hint.innerHTML = 'Reception Counter: <code>reception</code> / <code>Staff@123</code>';
    userInp.value = 'reception';
    passInp.value = 'Staff@123';
  }
}

async function submitLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const alertEl = document.getElementById('loginErrorAlert');
  alertEl.style.display = 'none';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, expectedRole: selectedPortal })
    });

    const data = await res.json();
    if (!res.ok) {
      alertEl.textContent = data.error || 'Authentication failed.';
      alertEl.style.display = 'block';
      return;
    }

    localStorage.setItem('token', data.token);
    currentToken = data.token;
    currentUser = data.user;
    updateAuthUI(currentUser);
    closeLoginModal();

    if (currentUser.role === 'admin') navigateToSection('admin');
    else if (currentUser.role === 'doctor') {
      activeDoctorId = currentUser.doctorId || 'doc-1';
      navigateToSection('doctor');
    }
    else if (currentUser.role === 'patient') navigateToSection('patient');
    else if (currentUser.role === 'lab') navigateToSection('lab');
    else if (currentUser.role === 'receptionist') navigateToSection('reception');
  } catch (err) {
    alertEl.textContent = 'Network or server connection error.';
    alertEl.style.display = 'block';
  }
}

async function logout() {
  if (currentToken) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${currentToken}` }
      });
    } catch (e) {}
  }
  localStorage.removeItem('token');
  currentToken = null;
  currentUser = null;
  updateAuthUI(null);
  navigateToSection('home');
}

// ==============================================================
// BASE DATA & HOMEPAGE LIVE QUEUE STATUS (Requirement 3)
// ==============================================================
async function loadBaseData() {
  try {
    const [pRes, sRes, dRes, rRes] = await Promise.all([
      fetch('/api/patients').then(r => r.json()),
      fetch('/api/sessions').then(r => r.json()),
      fetch('/api/doctors').then(r => r.json()),
      fetch('/api/rooms').then(r => r.json())
    ]);

    allPatients = pRes;
    allSessions = sRes;
    allDoctors = dRes;
    allRooms = rRes;

    renderQuickScanButtons();
    populateSessionDropdowns();
    populateDoctorDropdown();
    populateAppointmentDropdowns();
  } catch (err) {
    console.error('Error loading base data:', err);
  }
}

// Live Queue Board on Homepage (Sample Demonstration Data synced with live DB)
async function refreshLiveQueueBoard() {
  try {
    const [opdData, clinicAData] = await Promise.all([
      fetch('/api/displays/OPD').then(r => r.json()),
      fetch('/api/displays/CL-A').then(r => r.json())
    ]);

    const tbody = document.getElementById('homeLiveQueueTbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const rows = [];
    if (opdData && opdData.rooms) {
      opdData.rooms.forEach(r => {
        rows.push({
          session: 'General OPD Queue',
          doctor: r.doctorName,
          room: r.roomNumber,
          currentToken: r.currentToken,
          lastToken: opdData.nextWaitingToken || 'OPD-004',
          wait: r.currentToken ? 'Now Serving' : '~8 min',
          status: r.statusText
        });
      });
    }
    if (clinicAData && clinicAData.rooms) {
      clinicAData.rooms.forEach(r => {
        rows.push({
          session: 'Specialist Fever Clinic A',
          doctor: r.doctorName,
          room: r.roomNumber,
          currentToken: r.currentToken,
          lastToken: clinicAData.nextWaitingToken || 'CL-A-002',
          wait: r.currentToken ? 'Now Serving' : '~15 min',
          status: r.statusText
        });
      });
    }

    rows.forEach(item => {
      const tr = document.createElement('tr');
      const isCalling = item.status.includes('Called');
      const isConsulting = item.status.includes('Consulting');

      tr.innerHTML = `
        <td style="font-weight: 700; color: var(--primary-navy);">${item.session}</td>
        <td><b>${item.doctor}</b></td>
        <td><span style="font-weight: 700; color: var(--accent-teal);">${item.room}</span></td>
        <td>${item.currentToken ? `<span class="token-pill-badge">${item.currentToken}</span>` : '<span style="color: var(--text-muted);">—</span>'}</td>
        <td style="font-family: monospace; font-weight: 700;">${item.lastToken}</td>
        <td style="font-weight: 600; color: var(--text-muted);">${item.wait}</td>
        <td>
          <span class="status-badge-live ${isCalling ? 'status-calling' : isConsulting ? 'status-consulting' : 'status-available'}">
            ${item.status}
          </span>
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Error refreshing live queue board:', err);
  }
}

// ==============================================================
// RECEPTION & STRICT MINIMAL TOKEN PRINTING (Requirement 7)
// ==============================================================
function renderQuickScanButtons() {
  const container = document.getElementById('quickScanButtons');
  if (!container) return;
  container.innerHTML = '';
  allPatients.forEach(p => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-outline';
    btn.style.fontSize = '0.75rem';
    btn.style.padding = '0.25rem 0.55rem';
    btn.textContent = `${p.hospital_number} (${p.name.split(' ')[0]})`;
    btn.onclick = () => {
      document.getElementById('barcodeInput').value = p.hospital_number;
      handleBarcodeScan();
    };
    container.appendChild(btn);
  });
}

function populateSessionDropdowns() {
  const sessionSelect = document.getElementById('sessionSelect');
  if (!sessionSelect) return;
  sessionSelect.innerHTML = '';
  allSessions.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.session_code} - ${s.session_name} (${s.department_name})`;
    sessionSelect.appendChild(opt);
  });
}

async function handleBarcodeScan() {
  const barcode = document.getElementById('barcodeInput').value.trim();
  if (!barcode) return;

  try {
    const res = await fetch('/api/patients/lookup-barcode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Patient lookup failed');
      return;
    }

    selectedPatient = data;
    renderPatientLookupCard(data);
  } catch (err) {
    alert('Network error during barcode scan');
  }
}

function renderPatientLookupCard(data) {
  const card = document.getElementById('patientLookupCard');
  card.style.display = 'block';

  document.getElementById('lookupPatientName').textContent = data.patient.name;
  document.getElementById('lookupHospitalNum').textContent = `Hospital No: ${data.patient.hospital_number} | Blood: ${data.patient.blood_group || 'N/A'}`;
  document.getElementById('lookupDob').textContent = data.patient.dob.split('T')[0];
  document.getElementById('lookupGender').textContent = data.patient.gender;
  document.getElementById('lookupPhone').textContent = data.patient.phone;

  const bookingContainer = document.getElementById('bookingBadgeContainer');
  if (data.booking) {
    bookingContainer.innerHTML = `<span class="status-badge-live status-consulting">Booking Found: ${data.booking.reference}</span>`;
    if (data.booking.sessionId) document.getElementById('sessionSelect').value = data.booking.sessionId;
  } else {
    bookingContainer.innerHTML = `<span class="status-badge-live status-available">Walk-In Patient</span>`;
  }

  const alertBox = document.getElementById('alreadyIssuedAlert');
  const btnIssue = document.getElementById('btnIssueToken');
  const btnReprint = document.getElementById('btnReprintToken');

  if (data.activeToken) {
    alertBox.style.display = 'block';
    document.getElementById('existingTokenNumber').textContent = data.activeToken.token_number;
    btnIssue.style.display = 'none';
    btnReprint.style.display = 'inline-flex';
    currentIssuedToken = data.activeToken;
    updateMinimalReceipt(data.activeToken.token_number);
  } else {
    alertBox.style.display = 'none';
    btnIssue.style.display = 'inline-flex';
    btnReprint.style.display = 'none';
  }
}

// Issue Token & Update Barcode
async function submitTokenIssue() {
  if (!selectedPatient) return;

  const sessionId = document.getElementById('sessionSelect').value;
  const priority = document.getElementById('prioritySelect').value;
  const isAppt = !!selectedPatient.booking;
  const apptRef = selectedPatient.booking ? selectedPatient.booking.reference : null;

  try {
    const res = await fetch('/api/visits/check-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientId: selectedPatient.patient.id,
        sessionId,
        priority,
        isAppointment: isAppt,
        appointmentRef: apptRef
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to issue token');
      return;
    }

    currentIssuedToken = data.token;
    updateMinimalReceipt(data.token.token_number);
    alert(`Token issued successfully: ${data.token.token_number}`);
    handleBarcodeScan();
  } catch (err) {
    alert('Error issuing token');
  }
}

// Update minimal thermal receipt (Section 7: ONLY Token Number and its Barcode)
function updateMinimalReceipt(tokenNumber) {
  document.getElementById('minimalPrintToken').textContent = tokenNumber;
  renderBarcode(tokenNumber);
}

function renderBarcode(codeValue) {
  try {
    JsBarcode("#barcodeCanvas", codeValue, {
      format: "CODE128",
      lineColor: "#000000",
      width: 2.6,
      height: 68,
      displayValue: true,
      fontSize: 15,
      font: "JetBrains Mono",
      margin: 10
    });
  } catch (e) {
    console.error('Barcode generation error:', e);
  }
}

async function triggerMinimalThermalPrint() {
  if (currentIssuedToken) {
    try {
      await fetch(`/api/tokens/${currentIssuedToken.id}/reprint`, { method: 'POST' });
    } catch (e) {}
  }
  window.print();
}

async function resolveTokenBarcode() {
  const tokenRef = document.getElementById('tokenBarcodeScanInput').value.trim();
  if (!tokenRef) return;

  try {
    const res = await fetch(`/api/tokens/lookup/${encodeURIComponent(tokenRef)}`);
    const data = await res.json();
    const info = document.getElementById('tokenBarcodeResolvedInfo');

    if (!res.ok) {
      info.textContent = `❌ ${data.error || 'Token not found'}`;
      info.style.color = 'var(--danger-rose)';
      return;
    }

    info.innerHTML = `
      ✅ <b>Token Resolved:</b> ${data.token_number} | <b>Status:</b> ${data.status} | 
      <b>Patient:</b> ${data.patient_name} (${data.hospital_number}) | 
      <b>Room:</b> ${data.room_number || 'Pending'}
    `;
    info.style.color = 'var(--accent-teal-dark)';
  } catch (err) {
    alert('Failed to resolve barcode');
  }
}

// ==============================================================
// ADVANCE APPOINTMENT BOOKING MODAL
// ==============================================================
function openAppointmentModal() {
  populateAppointmentDropdowns();
  document.getElementById('appointmentModal').style.display = 'flex';
}

function closeAppointmentModal() {
  document.getElementById('appointmentModal').style.display = 'none';
}

function populateAppointmentDropdowns() {
  const patientSelect = document.getElementById('bookingPatientSelect');
  if (patientSelect) {
    patientSelect.innerHTML = '';
    allPatients.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.hospital_number})`;
      patientSelect.appendChild(opt);
    });
  }

  const sessionSelect = document.getElementById('bookingSessionSelect');
  if (sessionSelect) {
    sessionSelect.innerHTML = '';
    allSessions.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.session_name} (${s.session_code})`;
      sessionSelect.appendChild(opt);
    });
  }
}

async function submitAdvanceAppointment() {
  const patientId = document.getElementById('bookingPatientSelect').value;
  const sessionId = document.getElementById('bookingSessionSelect').value;
  const scheduledTime = document.getElementById('bookingTimeInput').value;

  try {
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId, sessionId, scheduledTime, source: 'MOBILE' })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to book appointment');
      return;
    }

    alert(`Appointment Booked Successfully! Reference: ${data.reference}`);
    closeAppointmentModal();
    loadBaseData();
    if (currentUser && currentUser.role === 'patient') loadPatientDashboard();
  } catch (err) {
    alert('Error booking appointment');
  }
}

// ==============================================================
// DOCTOR CONSOLE (Requirement 4 & 8)
// ==============================================================
function populateDoctorDropdown() {
  const select = document.getElementById('activeDoctorSelect');
  if (!select) return;
  select.innerHTML = '';
  allDoctors.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.name} (${d.room_number || 'No Room'}) - ${d.specialization}`;
    select.appendChild(opt);
  });
  if (currentUser && currentUser.doctorId) {
    activeDoctorId = currentUser.doctorId;
    select.value = currentUser.doctorId;
  } else if (allDoctors.length > 0) {
    activeDoctorId = allDoctors[0].id;
  }
}

async function loadDoctorProfile() {
  activeDoctorId = document.getElementById('activeDoctorSelect').value;
  await refreshDoctorConsole();
  await loadDoctorDashboard();
}

// Global countdown timer handle for doctor station
let doctorCountdownInterval = null;
let doctorCountdownSeconds = 0;

function startDoctorCountdown(initialSeconds = 60, tokenId = null) {
  stopDoctorCountdown();
  doctorCountdownSeconds = initialSeconds;

  const container = document.getElementById('docCountdownContainer');
  const textEl = document.getElementById('docCountdownText');
  const barEl = document.getElementById('docCountdownProgressBar');

  if (container) container.style.display = 'block';
  if (textEl) textEl.textContent = `${doctorCountdownSeconds}s`;
  if (barEl) barEl.style.width = `${(doctorCountdownSeconds / 60) * 100}%`;

  doctorCountdownInterval = setInterval(async () => {
    doctorCountdownSeconds--;
    if (textEl) textEl.textContent = `${Math.max(0, doctorCountdownSeconds)}s`;
    if (barEl) barEl.style.width = `${Math.max(0, (doctorCountdownSeconds / 60) * 100)}%`;

    if (doctorCountdownSeconds <= 0) {
      stopDoctorCountdown();
      if (currentAttendingToken && currentAttendingToken.id) {
        try {
          await fetch(`/api/tokens/${currentAttendingToken.id}/awaiting`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${currentToken}`
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
    document.getElementById('doctorRoomBadge').textContent = `Room: ${doc.room_number || 'Unassigned'}`;
    document.getElementById('doctorDutyBadge').textContent = `Duty: ${doc.duty_status}`;

    const stateRes = await fetch(`/api/doctor/state?doctorId=${activeDoctorId}`, {
      headers: currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {}
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
      document.getElementById('queueDeptLabel').textContent = `${deptSession.session_name}`;
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
    hospEl.textContent = `Patient Hospital No: ${activeToken.hospital_number || '—'}`;

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
    waitBadge.textContent = `${state.waitingTokens ? state.waitingTokens.length : 0} Waiting`;
  }
  if (waitListEl) {
    waitListEl.innerHTML = '';
    if (!state.waitingTokens || state.waitingTokens.length === 0) {
      waitListEl.innerHTML = '<div style="color: var(--text-muted); padding: 0.75rem;">No patients currently in waiting queue.</div>';
    } else {
      state.waitingTokens.forEach((tk, idx) => {
        const item = document.createElement('div');
        item.style.cssText = 'padding: 0.65rem 0.85rem; background: var(--bg-page); border-radius: 6px; margin-bottom: 0.4rem; display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--border-light);';
        item.innerHTML = `
          <div>
            <span style="font-family: monospace; font-weight: 800; color: #1d4ed8; font-size: 0.95rem;">${tk.token_number}</span>
            <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: 0.5rem;">(${tk.hospital_number})</span>
          </div>
          <span class="status-badge-live ${idx === 0 ? 'status-calling' : 'status-available'}" style="font-size: 0.72rem;">
            ${idx === 0 ? 'Next Eligible' : `Queue #${idx + 1}`}
          </span>
        `;
        waitListEl.appendChild(item);
      });
    }
  }

  const skippedCard = document.getElementById('docSkippedCard');
  const skippedBadge = document.getElementById('skippedCountBadge');
  const skippedListEl = document.getElementById('docSkippedList');

  if (state.skippedTokens && state.skippedTokens.length > 0) {
    if (skippedCard) skippedCard.style.display = 'block';
    if (skippedBadge) skippedBadge.textContent = `${state.skippedTokens.length} Skipped`;
    if (skippedListEl) {
      skippedListEl.innerHTML = '';
      state.skippedTokens.forEach(stk => {
        const div = document.createElement('div');
        div.style.cssText = 'padding: 0.55rem 0.75rem; background: #fffbeb; border-radius: 6px; margin-bottom: 0.35rem; display: flex; justify-content: space-between; align-items: center; border: 1px solid #fde68a; font-size: 0.82rem;';
        div.innerHTML = `
          <div>
            <b style="font-family: monospace; color: #b45309;">${stk.token_number}</b>
            <span style="color: var(--text-muted); margin-left: 0.4rem;">${escapeHtml(stk.patient_name || stk.hospital_number)}</span>
          </div>
          <button type="button" class="btn-outline" style="font-size: 0.7rem; padding: 0.2rem 0.55rem; border-color: #b45309; color: #b45309;" onclick="doctorRecallSkipped('${stk.id}')">
            Recall Patient
          </button>
        `;
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
        'Authorization': `Bearer ${currentToken}`
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
    const res = await fetch(`/api/tokens/${currentAttendingToken.id}/arrived`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
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
    const res = await fetch(`/api/tokens/${currentAttendingToken.id}/start-consultation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
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
    const res = await fetch(`/api/tokens/${currentAttendingToken.id}/recall`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
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
    const res = await fetch(`/api/tokens/${currentAttendingToken.id}/skip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
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
    const res = await fetch(`/api/tokens/${tokenId}/recall-skipped`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
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
}

async function doctorScanTokenBarcode() {
  const barcode = (document.getElementById('doctorBarcodeScanInput').value || '').trim();
  const alertEl = document.getElementById('doctorBarcodeAlert');
  alertEl.style.display = 'none';

  if (!barcode) {
    alertEl.textContent = 'Please enter or scan a token barcode.';
    alertEl.style.display = 'block';
    alertEl.style.color = 'var(--danger-rose)';
    return;
  }

  try {
    const res = await fetch('/api/doctor/scan-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ barcode })
    });

    const data = await res.json();
    if (!res.ok) {
      alertEl.textContent = `❌ ${data.error || 'Barcode scan failed.'}`;
      alertEl.style.display = 'block';
      alertEl.style.color = 'var(--danger-rose)';
      return;
    }

    alertEl.textContent = `✅ Token Validated: ${data.token.token_number} - Assigned to ${data.token.patient_name}`;
    alertEl.style.display = 'block';
    alertEl.style.color = 'var(--success-green)';

    // Update attending token state
    currentAttendingToken = data.token;
    document.getElementById('docCurrentTokenBadge').textContent = data.token.token_number;
    document.getElementById('docCurrentPatientName').textContent = data.patient.name;
    document.getElementById('docCurrentHospitalNo').textContent = `Patient ID: ${data.patient.hospital_number}`;
    document.getElementById('btnRecall').style.display = 'inline-flex';
    document.getElementById('btnMissed').style.display = 'inline-flex';

    // Show Protected Personal Details Banner (Section 2.C)
    const banner = document.getElementById('doctorPatientIdentityBanner');
    banner.style.display = 'block';
    document.getElementById('docPatBannerName').textContent = data.patient.name;
    document.getElementById('docPatBannerHospId').textContent = data.patient.hospital_number;
    document.getElementById('docPatBannerDob').textContent = `${data.patient.dob.split('T')[0]} (${data.patient.gender})`;
    document.getElementById('docPatBannerGender').textContent = data.patient.gender;
    document.getElementById('docPatBannerBlood').textContent = data.patient.blood_group || 'Not recorded';
    document.getElementById('docPatBannerAllergies').textContent = data.patient.allergies || 'No known allergies';

    // Auto-fill consultation symptoms if clean
    document.getElementById('consultSymptoms').value = '';
    document.getElementById('consultDiagnosis').value = '';
    document.getElementById('consultNotes').value = '';
    document.getElementById('consultRecommendations').value = '';
    document.getElementById('consultFollowUpAdvice').value = '';
    document.getElementById('customTaskTitle').value = '';

  } catch (err) {
    alertEl.textContent = 'Server connection error during barcode scan.';
    alertEl.style.display = 'block';
    alertEl.style.color = 'var(--danger-rose)';
  }
}

function openDoctorCorrectionModal() {
  if (!currentAttendingToken) {
    alert('Please call or scan a patient token first.');
    return;
  }
  document.getElementById('doctorCorrectionModal').style.display = 'flex';
}

function closeDoctorCorrectionModal() {
  document.getElementById('doctorCorrectionModal').style.display = 'none';
}

async function submitDoctorCorrectionRequest() {
  if (!currentAttendingToken) return;

  const proposedCorrection = document.getElementById('correctionProposedInput').value.trim();
  const reason = document.getElementById('correctionReasonInput').value.trim();

  try {
    const res = await fetch('/api/doctor/request-patient-info-correction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        patientId: currentAttendingToken.patient_id,
        proposedCorrection,
        reason
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to submit request');
      return;
    }

    alert('Correction request logged and submitted to hospital admin.');
    closeDoctorCorrectionModal();
  } catch (e) {
    alert('Error submitting correction request');
  }
}

function doctorReviewBeforeSaving() {
  if (!currentAttendingToken) {
    alert('No patient is currently called.');
    return;
  }

  const symptoms = document.getElementById('consultSymptoms').value || 'None recorded';
  const diagnosis = document.getElementById('consultDiagnosis').value || 'Unspecified';
  const notes = document.getElementById('consultNotes').value || 'None';
  const recommendations = document.getElementById('consultRecommendations').value || 'None';
  const followUp = document.getElementById('consultFollowUpAdvice').value || 'None';
  const prescItem = document.getElementById('prescItem').value;
  const prescDosage = document.getElementById('prescDosage').value;
  const labItem = document.getElementById('labItem').value;
  const taskTitle = document.getElementById('customTaskTitle').value;

  const content = document.getElementById('doctorReviewContent');
  content.innerHTML = `
    <div style="margin-bottom: 0.75rem;"><b>Token:</b> ${currentAttendingToken.token_number} | <b>Patient:</b> ${currentAttendingToken.patient_name || 'Patient'}</div>
    <div style="margin-bottom: 0.5rem;"><b style="color: var(--primary-navy);">Diagnosis:</b> ${diagnosis}</div>
    <div style="margin-bottom: 0.5rem;"><b>Symptoms:</b> ${symptoms}</div>
    <div style="margin-bottom: 0.5rem;"><b>Clinical Observations:</b> ${notes}</div>
    <div style="margin-bottom: 0.5rem;"><b style="color: var(--accent-teal);">Recommendations:</b> ${recommendations}</div>
    <div style="margin-bottom: 0.5rem;"><b>Follow-up Advice:</b> ${followUp}</div>
    <div style="margin-bottom: 0.5rem;"><b style="color: var(--success-green);">Prescription:</b> ${prescItem ? `${prescItem} (${prescDosage})` : 'None'}</div>
    <div style="margin-bottom: 0.5rem;"><b style="color: #db2777;">Laboratory Test:</b> ${labItem || 'None'}</div>
    <div style="margin-bottom: 0.5rem;"><b style="color: #7c3aed;">Care Task:</b> ${taskTitle || 'None'}</div>
  `;

  document.getElementById('doctorReviewModal').style.display = 'flex';
}

function closeDoctorReviewModal() {
  document.getElementById('doctorReviewModal').style.display = 'none';
}

async function doctorCompleteConsultation() {
  if (!currentAttendingToken) {
    alert('No patient is currently called.');
    return;
  }

  const symptoms = document.getElementById('consultSymptoms').value;
  const diagnosis = document.getElementById('consultDiagnosis').value;
  const clinicalNotes = document.getElementById('consultNotes').value;
  const recommendations = document.getElementById('consultRecommendations').value;
  const followUpAdvice = document.getElementById('consultFollowUpAdvice').value;
  const prescItem = document.getElementById('prescItem').value;
  const prescDosage = document.getElementById('prescDosage').value;
  const labItem = document.getElementById('labItem').value;
  const labUrgency = document.getElementById('labUrgency').value;
  const taskTitle = document.getElementById('customTaskTitle').value;
  const taskDueDate = document.getElementById('customTaskDueDate').value;

  const prescriptions = prescItem ? [{ itemName: prescItem, dosage: prescDosage }] : [];
  const labs = labItem ? [{ testName: labItem, urgency: labUrgency }] : [];
  const tasks = taskTitle ? [{ title: taskTitle, dueDate: taskDueDate || null }] : [];

  try {
    const res = await fetch('/api/consultations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        tokenId: currentAttendingToken.id,
        doctorId: activeDoctorId,
        symptoms,
        diagnosis,
        clinicalNotes,
        recommendations,
        followUpAdvice,
        prescriptions,
        labs,
        tasks
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to save consultation');
      return;
    }

    alert('Consultation saved successfully! Prescriptions, recommendations, and care tasks synchronized to patient portal.');
    stopDoctorCountdown();
    currentAttendingToken = null;
    document.getElementById('doctorPatientIdentityBanner').style.display = 'none';
    await refreshDoctorConsole();
    await refreshPublicLiveQueue();
  } catch (err) {
    alert('Error saving consultation');
  }
}

async function viewPastRecords() {
  const drawer = document.getElementById('pastHistoryDrawer');
  if (drawer.style.display === 'block') {
    drawer.style.display = 'none';
    return;
  }

  const patientId = currentAttendingToken ? currentAttendingToken.patient_id : 'pat-001';
  try {
    const res = await fetch(`/api/patients/${patientId}/history`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Could not load history');
      return;
    }

    const container = document.getElementById('pastConsultationsList');
    container.innerHTML = '';
    if (data.history.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted);">No prior clinical records found.</div>';
    } else {
      data.history.forEach(h => {
        const item = document.createElement('div');
        item.style.background = 'var(--bg-page)';
        item.style.padding = '0.75rem';
        item.style.borderRadius = '6px';
        item.style.marginBottom = '0.5rem';
        item.style.border = '1px solid var(--border-light)';
        item.innerHTML = `
          <div><b style="color: var(--primary-navy);">Date:</b> ${new Date(h.completed_at).toLocaleDateString()} | <b>Dr:</b> ${h.doctor_name}</div>
          <div style="color: var(--accent-teal-dark);"><b>Diagnosis:</b> ${h.diagnosis}</div>
          <div style="color: var(--text-muted);"><b style="color: var(--text-main);">Notes:</b> ${h.clinical_notes || '-'}</div>
          ${h.prescriptions.length ? `<div style="color: var(--success-green);"><b>Rx:</b> ${h.prescriptions.map(p => p.item_name).join(', ')}</div>` : ''}
          ${h.labRequests.length ? `<div style="color: #db2777;"><b>Lab:</b> ${h.labRequests.map(l => `${l.test_name} (${l.results || 'Pending'})`).join(', ')}</div>` : ''}
        `;
        container.appendChild(item);
      });
    }

    drawer.style.display = 'block';
  } catch (err) {
    alert('Failed to load past history');
  }
}

// ==============================================================
// ==============================================================
// PATIENT PERSONAL HEALTH PORTAL (Section 1.A, 1.B, 1.C, 1.D)
// ==============================================================
async function loadPatientDashboard() {
  if (!currentToken || !currentUser || currentUser.role !== 'patient') return;

  try {
    const res = await fetch('/api/patient/dashboard', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!res.ok) return;

    document.getElementById('patientDashName').textContent = data.patient.name;
    document.getElementById('patientDashHospNo').textContent = `Hospital No: ${data.patient.hospital_number} | Phone: ${data.patient.phone}`;

    // 1. Active Token
    if (data.activeToken) {
      document.getElementById('patientDashToken').textContent = data.activeToken.token_number;
      document.getElementById('patientDashSession').textContent = data.activeToken.session_name;
      document.getElementById('patientDashAhead').textContent = data.eta ? data.eta.patientsAhead : '0';
      document.getElementById('patientDashEta').textContent = data.eta ? `~${data.eta.estimatedMinutes} min` : 'Pending';

      const roomAlert = document.getElementById('patientDashRoom');
      if (data.activeToken.status === 'CALLED') {
        roomAlert.textContent = `🔔 Called to ${data.activeToken.room_number || 'Consultation Room'}! Please enter.`;
        roomAlert.style.color = 'var(--danger-rose)';
      } else if (data.activeToken.status === 'IN_CONSULTATION') {
        roomAlert.textContent = `Now in Consultation (${data.activeToken.room_number})`;
        roomAlert.style.color = 'var(--success-green)';
      } else {
        roomAlert.textContent = 'Waiting in Queue (Pending Room Call)';
        roomAlert.style.color = 'var(--warning-amber)';
      }
    } else {
      document.getElementById('patientDashToken').textContent = 'None';
      document.getElementById('patientDashSession').textContent = 'No active queue token currently issued.';
      document.getElementById('patientDashAhead').textContent = '—';
      document.getElementById('patientDashEta').textContent = '—';
      document.getElementById('patientDashRoom').textContent = 'Not currently in queue';
    }

    // 2. Patient Care Plan & Action Tasks (Section 1.C)
    const taskContainer = document.getElementById('patientCareTasksList');
    taskContainer.innerHTML = '';
    const pendingTasks = data.careTasks.filter(t => t.status !== 'VERIFIED_COMPLETED' && t.status !== 'CANCELLED');
    document.getElementById('patientTaskSummaryBadge').textContent = `${pendingTasks.length} Pending / Action Required`;

    if (data.careTasks.length === 0) {
      taskContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 0.5rem 0;">No care tasks assigned.</div>';
    } else {
      data.careTasks.forEach(task => {
        const card = document.createElement('div');
        const isCompleted = task.status === 'VERIFIED_COMPLETED';
        const isMarked = task.status === 'PATIENT_MARKED_COMPLETED' || task.status === 'AWAITING_VERIFICATION';
        const isPending = task.status === 'PENDING' || task.status === 'IN_PROGRESS';

        card.className = `task-card ${isCompleted ? 'task-completed' : isMarked ? 'task-awaiting' : 'task-pending'}`;

        let pillClass = 'pill-pending';
        let pillText = task.status;
        if (isCompleted) { pillClass = 'pill-verified'; pillText = 'Verified Completed'; }
        else if (isMarked) { pillClass = 'pill-awaiting'; pillText = 'Awaiting Verification'; }

        card.innerHTML = `
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
              <span class="task-badge-pill ${pillClass}">${pillText}</span>
              <span style="font-size: 0.75rem; color: var(--text-muted);">Due: ${task.due_date ? task.due_date.split('T')[0] : 'Open'}</span>
            </div>
            <div style="font-weight: 800; color: var(--primary-navy); font-size: 0.95rem;">${task.title}</div>
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">${task.description || ''}</div>
            <div style="font-size: 0.75rem; color: var(--accent-teal-dark); margin-top: 0.35rem;">Requesting Doctor: Dr. ${task.doctor_name || 'Hospital Staff'}</div>
          </div>
          <div>
            ${isPending ? `
              <button class="btn-teal" style="font-size: 0.75rem; padding: 0.4rem 0.75rem;" onclick="patientMarkTaskCompleted('${task.id}')">
                Mark as Completed
              </button>
            ` : isMarked ? `
              <span style="font-size: 0.75rem; color: var(--accent-teal-dark); font-weight: 700;">Awaiting Staff Verification</span>
            ` : `
              <span style="font-size: 0.75rem; color: var(--success-green); font-weight: 800;">✓ Verified</span>
            `}
          </div>
        `;
        taskContainer.appendChild(card);
      });
    }

    // 3. In-App Notifications & Reminders (Section 1.D)
    const notifContainer = document.getElementById('patientNotificationsList');
    notifContainer.innerHTML = '';
    const unreadCount = data.notifications.filter(n => !n.is_read).length;
    document.getElementById('notificationUnreadCount').textContent = `${unreadCount} New`;

    if (data.notifications.length === 0) {
      notifContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 0.5rem 0;">No notifications received.</div>';
    } else {
      data.notifications.forEach(n => {
        const item = document.createElement('div');
        item.className = `notification-item ${!n.is_read ? 'unread' : ''}`;
        item.innerHTML = `
          <div style="flex: 1;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.2rem;">
              <b style="font-size: 0.85rem; color: var(--primary-navy);">${n.title}</b>
              <span style="font-size: 0.7rem; color: var(--text-muted);">${new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-main);">${n.message}</div>
          </div>
          ${!n.is_read ? `
            <button class="btn-outline" style="font-size: 0.7rem; padding: 0.2rem 0.5rem;" onclick="markNotificationRead('${n.id}')">Dismiss</button>
          ` : ''}
        `;
        notifContainer.appendChild(item);
      });
    }

    // 4. Laboratory Investigation Results (Section 4)
    const labContainer = document.getElementById('patientLabResultsList');
    labContainer.innerHTML = '';
    if (data.labRequests.length === 0) {
      labContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">No laboratory tests on record.</div>';
    } else {
      data.labRequests.forEach(l => {
        const row = document.createElement('div');
        row.style.background = '#ffffff';
        row.style.padding = '0.75rem 1rem';
        row.style.borderRadius = '6px';
        row.style.border = '1px solid var(--border-light)';
        row.style.marginBottom = '0.5rem';

        const isReleased = l.status === 'RESULT_RELEASED';
        row.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <b style="color: var(--primary-navy);">${l.test_name}</b>
            <span class="task-badge-pill ${isReleased ? 'pill-verified' : 'pill-pending'}">${l.status}</span>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">
            Requested by Dr. ${l.doctor_name} | Urgency: <b>${l.urgency}</b>
          </div>
          ${l.results ? `
            <div style="margin-top: 0.5rem; background: var(--bg-page); padding: 0.6rem; border-radius: 4px; font-size: 0.85rem; border-left: 3px solid var(--accent-teal);">
              <b style="color: var(--primary-navy);">Official Result:</b> ${l.results}
              <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.2rem;">Verified by: ${l.verified_staff_name || 'Laboratory Staff'}</div>
            </div>
          ` : `
            <div style="font-size: 0.8rem; color: var(--warning-amber); margin-top: 0.35rem;">Laboratory analysis in progress. Official result will be released upon pathology verification.</div>
          `}
        `;
        labContainer.appendChild(row);
      });
    }

    // 5. Advance Appointments
    const apptList = document.getElementById('patientAppointmentsList');
    apptList.innerHTML = '';
    if (data.appointments.length === 0) {
      apptList.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">No advance appointments booked.</div>';
    } else {
      data.appointments.forEach(a => {
        const item = document.createElement('div');
        item.style.padding = '0.65rem 1rem';
        item.style.background = '#ffffff';
        item.style.border = '1px solid var(--border-light)';
        item.style.borderRadius = '6px';
        item.style.marginBottom = '0.4rem';
        item.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <b style="color: var(--primary-navy);">${a.reference}</b>
              <div style="font-size: 0.8rem; color: var(--text-muted);">${a.session_name} • Dr. ${a.doctor_name || 'On Duty'}</div>
            </div>
            <span class="status-badge-live status-consulting">${a.status}</span>
          </div>
        `;
        apptList.appendChild(item);
      });
    }

  } catch (err) {
    console.error('Error loading patient dashboard:', err);
  }
}

async function patientMarkTaskCompleted(taskId) {
  try {
    const res = await fetch(`/api/patient/tasks/${taskId}/mark-completed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      }
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to update task');
      return;
    }

    alert('Task marked as attended by patient. Awaiting staff/laboratory verification.');
    loadPatientDashboard();
  } catch (err) {
    alert('Error marking task as completed');
  }
}

async function markNotificationRead(notifId) {
  try {
    await fetch(`/api/patient/notifications/${notifId}/read`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    loadPatientDashboard();
  } catch (err) {}
}

async function loadPatientOwnHistory() {
  const container = document.getElementById('patientOwnHistoryContainer');
  if (container.style.display === 'block') {
    container.style.display = 'none';
    return;
  }

  try {
    const res = await fetch(`/api/patients/${currentUser.patientId}/history`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to load medical history');
      return;
    }

    const list = document.getElementById('patientOwnHistoryList');
    list.innerHTML = '';
    if (data.history.length === 0) {
      list.innerHTML = '<div style="color: var(--text-muted);">No prior clinical records found.</div>';
    } else {
      data.history.forEach(h => {
        const item = document.createElement('div');
        item.style.background = 'var(--bg-page)';
        item.style.padding = '0.85rem 1rem';
        item.style.borderRadius = '8px';
        item.style.marginBottom = '0.75rem';
        item.style.border = '1px solid var(--border-light)';
        item.innerHTML = `
          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-light); padding-bottom: 0.4rem; margin-bottom: 0.4rem;">
            <div><b style="color: var(--primary-navy);">Date:</b> ${new Date(h.completed_at).toLocaleDateString()} | <b>Dr:</b> ${h.doctor_name} (${h.specialization || 'OPD'})</div>
            <span class="sample-notice-pill" style="background: var(--accent-teal-light); color: var(--accent-teal-dark);">Encounter Completed</span>
          </div>
          <div style="margin-bottom: 0.35rem;"><b style="color: var(--primary-navy);">Diagnosis:</b> <span style="font-weight: 700; color: var(--accent-teal-dark);">${h.diagnosis || 'General Consultation'}</span></div>
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.35rem;"><b style="color: var(--text-main);">Doctor Clinical Notes:</b> ${h.clinical_notes || '-'}</div>
          ${h.recommendations ? `<div style="font-size: 0.85rem; color: var(--primary-navy); margin-bottom: 0.35rem;"><b>Doctor Recommendations:</b> ${h.recommendations}</div>` : ''}
          ${h.follow_up_advice ? `<div style="font-size: 0.85rem; color: var(--warning-amber); margin-bottom: 0.35rem;"><b>Follow-up Advice:</b> ${h.follow_up_advice}</div>` : ''}
          ${h.prescriptions && h.prescriptions.length ? `
            <div style="margin-top: 0.4rem; padding: 0.5rem; background: #ffffff; border-radius: 4px; border: 1px solid var(--border-light);">
              <b style="color: var(--success-green); font-size: 0.85rem;">Prescribed Medicines (Rx):</b>
              <ul style="padding-left: 1.25rem; font-size: 0.8rem; margin-top: 0.2rem;">
                ${h.prescriptions.map(p => `<li><b>${p.item_name}</b> - ${p.dosage} (${p.frequency}) for ${p.duration} ${p.instructions ? '• ' + p.instructions : ''}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${h.labRequests && h.labRequests.length ? `
            <div style="margin-top: 0.4rem; padding: 0.5rem; background: #ffffff; border-radius: 4px; border: 1px solid var(--border-light);">
              <b style="color: #db2777; font-size: 0.85rem;">Laboratory Investigations:</b>
              <ul style="padding-left: 1.25rem; font-size: 0.8rem; margin-top: 0.2rem;">
                ${h.labRequests.map(l => `<li><b>${l.test_name}</b> [${l.urgency}] — Result: <i>${l.results || 'Pending'}</i> (${l.status})</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        `;
        list.appendChild(item);
      });
    }

    container.style.display = 'block';
  } catch (err) {
    alert('Failed to load history');
  }
}

// ==============================================================
// LABORATORY & INVESTIGATION WORKFLOW CONTROLLER (Section 4)
// ==============================================================
let allLabRequests = [];

async function loadLabRequests() {
  try {
    const res = await fetch('/api/lab/requests', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const requests = await res.json();
    if (!res.ok) {
      console.error(requests.error);
      return;
    }
    allLabRequests = requests;

    const tbody = document.getElementById('labRequestsTableBody');
    const badge = document.getElementById('labRequestsCountBadge');
    if (!tbody) return;
    tbody.innerHTML = '';

    const pending = requests.filter(r => r.status !== 'RESULT_RELEASED' && r.status !== 'CANCELLED');
    if (badge) badge.textContent = `${pending.length} Pending Investigations`;

    if (requests.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No laboratory investigation requests on record.</td></tr>`;
      return;
    }

    requests.forEach(r => {
      const tr = document.createElement('tr');
      const isReleased = r.status === 'RESULT_RELEASED';
      const isUrgent = r.urgency === 'URGENT' || r.urgency === 'STAT';

      tr.innerHTML = `
        <td style="font-size: 0.85rem; color: var(--text-muted);">${new Date(r.created_at).toLocaleDateString()}</td>
        <td>
          <div style="font-weight: 800; color: var(--primary-navy);">${r.patient_name}</div>
          <div style="font-size: 0.75rem; color: var(--accent-teal);">${r.hospital_number}</div>
        </td>
        <td><b style="color: #db2777;">${r.test_name}</b></td>
        <td>${r.doctor_name}</td>
        <td>
          <span class="status-badge-live ${isUrgent ? 'status-calling' : 'status-available'}">${r.urgency}</span>
        </td>
        <td>
          <span class="task-badge-pill ${isReleased ? 'pill-verified' : 'pill-pending'}">${r.status}</span>
          ${r.results ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;"><i>${r.results.substring(0, 40)}...</i></div>` : ''}
        </td>
        <td>
          <button class="btn-primary" style="font-size: 0.75rem; padding: 0.35rem 0.75rem; background: ${isReleased ? 'var(--accent-teal)' : '#db2777'};" onclick="openLabResultModal('${r.id}')">
            ${isReleased ? 'View / Amend Result' : 'Enter & Release Result'}
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading lab requests:', err);
  }
}

function openLabResultModal(requestId) {
  const req = allLabRequests.find(r => r.id === requestId);
  if (!req) return;

  document.getElementById('labModalRequestId').value = req.id;
  document.getElementById('labModalPatient').textContent = `${req.patient_name} (${req.hospital_number})`;
  document.getElementById('labModalTest').textContent = req.test_name;
  document.getElementById('labModalDoctor').textContent = req.doctor_name;
  document.getElementById('labModalStatus').value = req.status === 'REQUESTED' ? 'RESULT_RELEASED' : req.status;
  document.getElementById('labModalResultText').value = req.results || '';

  document.getElementById('labResultModal').style.display = 'flex';
}

function closeLabResultModal() {
  document.getElementById('labResultModal').style.display = 'none';
}

async function submitReleaseLabResult() {
  const reqId = document.getElementById('labModalRequestId').value;
  const status = document.getElementById('labModalStatus').value;
  const results = document.getElementById('labModalResultText').value.trim();

  if (!results) {
    alert('Please enter official investigation results.');
    return;
  }

  try {
    const res = await fetch(`/api/lab/requests/${reqId}/release-result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ results, status })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to release lab result');
      return;
    }

    alert('Laboratory result successfully recorded and released to patient portal & doctor records.');
    closeLabResultModal();
    loadLabRequests();
  } catch (err) {
    alert('Network error while saving laboratory result');
  }
}

// ==============================================================
// ADMIN DASHBOARD & HOSPITAL OPERATIONS (Section 3.A, 3.B, 3.C, 3.D)
// ==============================================================
let adminPatientsCache = [];
let adminAppointmentsCache = [];

function switchAdminTab(tabName) {
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.admin-sub-pane').forEach(p => p.classList.remove('active'));

  const btn = document.getElementById(`adminTabBtn-${tabName}`);
  const pane = document.getElementById(`adminTab-${tabName}`);
  if (btn) btn.classList.add('active');
  if (pane) pane.classList.add('active');

  if (tabName === 'doctors') {
    switchAdminScheduleWeek(adminScheduleWeek || 'this_week');
  }
}

async function loadAdminData() {
  try {
    const [statsRes, docRes, patRes, apptRes] = await Promise.all([
      fetch('/api/system-stats').then(r => r.json()),
      fetch('/api/doctors').then(r => r.json()),
      fetch('/api/patients').then(r => r.json()),
      fetch('/api/admin/appointments', { headers: { 'Authorization': `Bearer ${currentToken}` } }).then(r => r.json())
    ]);

    // 1. Operational Overview Metrics (Section 3.D)
    if (document.getElementById('statTotalPatients')) document.getElementById('statTotalPatients').textContent = statsRes.totalPatients || patRes.length;
    if (document.getElementById('statApptsToday')) document.getElementById('statApptsToday').textContent = statsRes.appointmentsToday || '0';
    if (document.getElementById('statActiveWaiting')) document.getElementById('statActiveWaiting').textContent = statsRes.activeWaiting;
    if (document.getElementById('statInService')) document.getElementById('statInService').textContent = statsRes.inService;
    if (document.getElementById('statCompleted')) document.getElementById('statCompleted').textContent = statsRes.completedToday;
    if (document.getElementById('statOnDutyDoctors')) document.getElementById('statOnDutyDoctors').textContent = statsRes.doctorsOnDuty;
    if (document.getElementById('statPendingLabs')) document.getElementById('statPendingLabs').textContent = statsRes.pendingLabs || '0';
    if (document.getElementById('statOutstandingTasks')) document.getElementById('statOutstandingTasks').textContent = statsRes.outstandingTasks || '0';

    // 2. Doctor Rosters (Section 3.B)
    const rosterList = document.getElementById('adminDoctorRosterList');
    if (rosterList) {
      rosterList.innerHTML = '';
      docRes.forEach(d => {
        const item = document.createElement('div');
        item.style.background = 'var(--bg-page)';
        item.style.border = '1px solid var(--border-light)';
        item.style.padding = '0.85rem 1rem';
        item.style.borderRadius = '8px';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';

        item.innerHTML = `
          <div>
            <div style="font-weight: 700; color: var(--primary-navy);">${d.name}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">${d.department_name} • Room: <b>${d.room_number || 'None'}</b> • Specialization: <b>${d.specialization}</b></div>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <select id="dutySelect-${d.id}" class="form-control" style="width: auto; padding: 0.35rem 0.6rem; font-size: 0.8rem;">
              <option value="ON_DUTY" ${d.duty_status === 'ON_DUTY' ? 'selected' : ''}>ON DUTY</option>
              <option value="ON_BREAK" ${d.duty_status === 'ON_BREAK' ? 'selected' : ''}>ON BREAK</option>
              <option value="OFF_DUTY" ${d.duty_status === 'OFF_DUTY' ? 'selected' : ''}>OFF DUTY</option>
            </select>
            <button class="btn-outline" style="font-size: 0.75rem; padding: 0.35rem 0.75rem;" onclick="updateDoctorDuty('${d.id}')">Save Roster</button>
          </div>
        `;
        rosterList.appendChild(item);
      });
    }

    // 3. Patients Directory (Section 3.A)
    adminPatientsCache = Array.isArray(patRes) ? patRes : [];
    renderAdminPatientsTable(adminPatientsCache);

    // 4. Appointments Directory (Section 3.C)
    adminAppointmentsCache = Array.isArray(apptRes) ? apptRes : [];
    renderAdminAppointmentsTable(adminAppointmentsCache);

    // 5. System Audit Trail (Section 3.A, 7)
    const auditContainer = document.getElementById('auditLogList');
    if (auditContainer) {
      auditContainer.innerHTML = '';
      (statsRes.recentLogs || []).forEach(l => {
        const row = document.createElement('div');
        row.style.padding = '0.45rem 0';
        row.style.borderBottom = '1px solid var(--border-light)';
        row.innerHTML = `<span style="color: var(--accent-teal);">[${new Date(l.timestamp).toLocaleTimeString()}]</span> <span class="task-badge-pill pill-awaiting" style="font-size: 0.7rem;">${l.actor_role}</span> <b style="color: var(--primary-navy);">${l.action}</b>: ${l.details || ''}`;
        auditContainer.appendChild(row);
      });
    }

  } catch (err) {
    console.error('Error loading admin data:', err);
  }
}

function renderAdminPatientsTable(patients) {
  const tbody = document.getElementById('adminPatientsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (patients.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1rem;">No registered patients match filter.</td></tr>`;
    return;
  }

  patients.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 800; color: var(--primary-navy); font-family: 'JetBrains Mono', monospace;">${p.hospital_number}</td>
      <td><b>${p.name}</b></td>
      <td>${p.dob ? p.dob.split('T')[0] : '-'} (${p.gender})</td>
      <td>${p.phone}</td>
      <td>
        <span style="font-weight: 700; color: var(--danger-rose);">${p.blood_group || '-'}</span>
        ${p.allergies ? `<div style="font-size: 0.75rem; color: var(--text-muted);">Allergies: ${p.allergies}</div>` : ''}
      </td>
      <td><span class="status-badge-live status-consulting">${p.past_visits_count || 0} Visits</span></td>
      <td>
        <button class="btn-outline" style="font-size: 0.75rem; padding: 0.3rem 0.65rem;" onclick="openAdminEditPatientModal('${p.id}')">
          Edit Profile
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filterAdminPatients() {
  const query = (document.getElementById('adminPatientSearchInput').value || '').toLowerCase();
  const filtered = adminPatientsCache.filter(p =>
    p.name.toLowerCase().includes(query) ||
    p.hospital_number.toLowerCase().includes(query) ||
    p.phone.includes(query)
  );
  renderAdminPatientsTable(filtered);
}

function renderAdminAppointmentsTable(appts) {
  const tbody = document.getElementById('adminAppointmentsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (appts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1rem;">No appointments found.</td></tr>`;
    return;
  }

  appts.forEach(a => {
    const tr = document.createElement('tr');
    const isAppointed = a.status === 'APPOINTED';
    const isCheckedIn = a.status === 'CHECKED_IN';

    tr.innerHTML = `
      <td style="font-weight: 800; color: var(--primary-navy);">${a.reference}</td>
      <td>
        <div><b>${a.patient_name}</b></div>
        <div style="font-size: 0.75rem; color: var(--accent-teal);">${a.hospital_number}</div>
      </td>
      <td>${a.session_name}</td>
      <td>${a.doctor_name || 'Assigned at OPD'}</td>
      <td><b>${a.scheduled_time || '09:00'}</b></td>
      <td>
        <span class="status-badge-live ${isCheckedIn ? 'status-consulting' : isAppointed ? 'status-available' : 'status-calling'}">
          ${a.status}
        </span>
      </td>
      <td>
        ${isAppointed ? `
          <div style="display: flex; gap: 0.35rem;">
            <button class="btn-outline" style="font-size: 0.7rem; padding: 0.25rem 0.5rem;" onclick="adminRescheduleAppointment('${a.id}')">Reschedule</button>
            <button class="btn-outline" style="font-size: 0.7rem; padding: 0.25rem 0.5rem; border-color: var(--danger-rose); color: var(--danger-rose);" onclick="adminCancelAppointment('${a.id}')">Cancel</button>
          </div>
        ` : `
          <span style="font-size: 0.75rem; color: var(--text-muted);">${a.status}</span>
        `}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filterAdminAppointments() {
  const filter = document.getElementById('adminApptStatusFilter').value;
  if (filter === 'ALL') renderAdminAppointmentsTable(adminAppointmentsCache);
  else renderAdminAppointmentsTable(adminAppointmentsCache.filter(a => a.status === filter));
}

async function adminCancelAppointment(apptId) {
  const reason = prompt('Please enter the cancellation reason:');
  if (!reason) return;

  try {
    const res = await fetch(`/api/admin/appointments/${apptId}/update-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ status: 'CANCELLED', reason })
    });
    const data = await res.json();
    if (res.ok) {
      alert('Appointment cancelled and patient notified.');
      loadAdminData();
    } else alert(data.error);
  } catch (e) {
    alert('Failed to cancel appointment');
  }
}

async function adminRescheduleAppointment(apptId) {
  const newTime = prompt('Enter new scheduled time (e.g. 11:30 AM):', '11:00 AM');
  if (!newTime) return;

  try {
    const res = await fetch(`/api/admin/appointments/${apptId}/update-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ status: 'RESCHEDULED', scheduledTime: newTime, reason: 'Patient requested time change' })
    });
    if (res.ok) {
      alert('Appointment rescheduled and patient notified.');
      loadAdminData();
    }
  } catch (e) {
    alert('Failed to reschedule');
  }
}

function openAdminRegisterPatientModal() {
  document.getElementById('adminRegisterPatientModal').style.display = 'flex';
}

function closeAdminRegisterPatientModal() {
  document.getElementById('adminRegisterPatientModal').style.display = 'none';
}

async function submitAdminRegisterPatient() {
  const name = document.getElementById('regPatName').value.trim();
  const dob = document.getElementById('regPatDob').value;
  const gender = document.getElementById('regPatGender').value;
  const phone = document.getElementById('regPatPhone').value.trim();
  const bloodGroup = document.getElementById('regPatBlood').value;
  const allergies = document.getElementById('regPatAllergies').value.trim();
  const address = document.getElementById('regPatAddress').value.trim();

  try {
    const res = await fetch('/api/admin/patients', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ name, dob, gender, phone, bloodGroup, allergies, address })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to register patient');
      return;
    }

    alert(`Patient Registered! Hospital No: ${data.patient.hospital_number} | Portal User: ${data.patient.username}`);
    closeAdminRegisterPatientModal();
    loadAdminData();
    loadBaseData();
  } catch (e) {
    alert('Error registering patient');
  }
}

function openAdminEditPatientModal(patientId) {
  const p = adminPatientsCache.find(x => x.id === patientId);
  if (!p) return;

  document.getElementById('editPatId').value = p.id;
  document.getElementById('editPatName').value = p.name;
  document.getElementById('editPatPhone').value = p.phone;
  document.getElementById('editPatBlood').value = p.blood_group || '';
  document.getElementById('editPatAllergies').value = p.allergies || '';
  document.getElementById('editPatAddress').value = p.address || '';

  document.getElementById('adminEditPatientModal').style.display = 'flex';
}

function closeAdminEditPatientModal() {
  document.getElementById('adminEditPatientModal').style.display = 'none';
}

async function submitAdminUpdatePatient() {
  const patientId = document.getElementById('editPatId').value;
  const name = document.getElementById('editPatName').value.trim();
  const phone = document.getElementById('editPatPhone').value.trim();
  const bloodGroup = document.getElementById('editPatBlood').value.trim();
  const allergies = document.getElementById('editPatAllergies').value.trim();
  const address = document.getElementById('editPatAddress').value.trim();

  try {
    const res = await fetch(`/api/admin/patients/${patientId}/update-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ name, phone, bloodGroup, allergies, address })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to update patient profile');
      return;
    }

    alert('Patient profile updated and audit trail logged.');
    closeAdminEditPatientModal();
    loadAdminData();
    loadBaseData();
  } catch (e) {
    alert('Error updating patient profile');
  }
}

async function updateDoctorDuty(doctorId) {
  const select = document.getElementById(`dutySelect-${doctorId}`);
  const dutyStatus = select.value;

  try {
    const res = await fetch('/api/admin/doctor-duty', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ doctorId, dutyStatus })
    });

    if (res.ok) {
      alert('Doctor status updated.');
      loadAdminData();
      refreshDisplay();
    }
  } catch (err) {
    alert('Failed to update status');
  }
}

// ==============================================================
// PUBLIC KIOSK DIGITAL SIGNAGE (Requirement 8)
// ==============================================================
function switchDisplayChannel(channelCode) {
  currentDisplaySession = channelCode;
  document.getElementById('tvDisplayHeaderTitle').textContent =
    channelCode === 'OPD' ? 'MAIN OUTPATIENT DEPARTMENT (OPD) QUEUE' : 'SPECIALIST INFECTION CLINIC A QUEUE';
  refreshDisplay();
}

async function refreshDisplay() {
  try {
    const res = await fetch(`/api/displays/${currentDisplaySession}`);
    const data = await res.json();

    const tbody = document.getElementById('tvGridBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    data.rooms.forEach(room => {
      const tr = document.createElement('tr');
      const isCalling = room.statusText.includes('Called');
      const isConsulting = room.statusText.includes('Consulting');

      tr.innerHTML = `
        <td style="font-weight: 800; color: var(--primary-navy); font-size: 1.15rem;">${room.roomNumber}</td>
        <td>
          <div style="font-weight: 700; color: var(--text-main);">${room.doctorName}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">${room.dutyStatus === 'ON_DUTY' ? 'On Duty' : 'Offline'}</div>
        </td>
        <td>
          ${room.currentToken 
            ? `<span class="token-pill-badge" style="font-size: 1.6rem;">${room.currentToken}</span>` 
            : `<span style="color: var(--text-muted); font-size: 1.3rem;">—</span>`}
        </td>
        <td>
          <span class="status-badge-live ${isCalling ? 'status-calling' : isConsulting ? 'status-consulting' : 'status-available'}">
            ${room.statusText}
          </span>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('tvNextWaitingToken').textContent = data.nextWaitingToken || 'None (Queue Empty)';
  } catch (err) {
    console.error('Failed to refresh TV display:', err);
  }
}

// ============================================================================
// 1. PATIENT REGISTRATION & APPOINTMENT BOOKING WIZARD CONTROLLER
// ============================================================================
let bookingState = {
  selectedDate: null,
  selectedDepartmentId: null,
  selectedDepartmentName: '',
  selectedDoctorId: null,
  selectedDoctorName: '',
  selectedSpecialization: '',
  selectedTimeSlot: null,
  selectedRoom: '',
  selectedBranch: 'Main Pavilion - Colombo',
  availableDates: [],
  calendarMonthOffset: 0
};

function initBookingWizard() {
  resetBookingWizard();
  loadBookingAvailableDates();
}

function resetBookingWizard() {
  bookingState = {
    selectedDate: null,
    selectedDepartmentId: null,
    selectedDepartmentName: '',
    selectedDoctorId: null,
    selectedDoctorName: '',
    selectedSpecialization: '',
    selectedTimeSlot: null,
    selectedRoom: '',
    selectedBranch: 'Main Pavilion - Colombo',
    availableDates: [],
    calendarMonthOffset: 0
  };

  document.getElementById('btnNextStep1').disabled = true;
  document.getElementById('btnNextStep2').disabled = true;
  document.getElementById('btnNextStep3').disabled = true;
  document.getElementById('btnNextStep4').disabled = true;
  document.getElementById('selectedDateDisplayBadge').textContent = 'Select below';

  document.getElementById('bookingSuccessBox').style.display = 'none';
  document.getElementById('bookingActionButtons').style.display = 'flex';
  document.getElementById('bookingErrorAlert').style.display = 'none';

  // Check auth requirement notice
  const authNotice = document.getElementById('bookingAuthRequiredNotice');
  if (authNotice) {
    authNotice.style.display = (currentUser && currentUser.role === 'patient') ? 'none' : 'block';
  }

  goToBookingStep(1);
}

function goToBookingStep(step) {
  // Enforce step sequence
  if (step === 2 && !bookingState.selectedDate) return;
  if (step === 3 && (!bookingState.selectedDate || !bookingState.selectedDepartmentId)) return;
  if (step === 4 && (!bookingState.selectedDate || !bookingState.selectedDoctorId)) return;
  if (step === 5 && (!bookingState.selectedDate || !bookingState.selectedDoctorId || !bookingState.selectedTimeSlot)) return;

  for (let i = 1; i <= 5; i++) {
    const pane = document.getElementById(`bookingStep-${i}`);
    const indicator = document.getElementById(`stepIndicator-${i}`);
    if (pane) pane.classList.remove('active');
    if (indicator) {
      indicator.classList.remove('active');
      if (i < step) indicator.classList.add('completed');
      else indicator.classList.remove('completed');
    }
  }

  const targetPane = document.getElementById(`bookingStep-${step}`);
  const targetIndicator = document.getElementById(`stepIndicator-${step}`);
  if (targetPane) targetPane.classList.add('active');
  if (targetIndicator) targetIndicator.classList.add('active');

  // Trigger step data loads
  if (step === 2) loadBookingDepartments();
  if (step === 3) loadBookingDoctors();
  if (step === 4) loadBookingSlots();
  if (step === 5) renderBookingSummary();
}

// Step 1: Calendar Date Picker
async function loadBookingAvailableDates() {
  try {
    const res = await fetch('/api/appointments/available-dates');
    const data = await res.json();
    bookingState.availableDates = data.dates || [];
    renderBookingCalendar();
  } catch (err) {
    console.error('Failed to load available dates:', err);
    bookingState.availableDates = [];
    renderBookingCalendar();
  }
}

function changeBookingMonth(delta) {
  bookingState.calendarMonthOffset += delta;
  renderBookingCalendar();
}

function renderBookingCalendar() {
  const grid = document.getElementById('bookingCalendarGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  daysOfWeek.forEach(d => {
    const header = document.createElement('div');
    header.className = 'cal-day-header';
    header.textContent = d;
    grid.appendChild(header);
  });

  const now = new Date();
  const currentMonthDate = new Date(now.getFullYear(), now.getMonth() + bookingState.calendarMonthOffset, 1);
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  document.getElementById('bookingCalendarMonthLabel').textContent = `${monthNames[month]} ${year}`;

  const firstDayIndex = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Blank days before month starts
  for (let i = 0; i < firstDayIndex; i++) {
    const blank = document.createElement('div');
    grid.appendChild(blank);
  }

  const todayStr = new Date().toISOString().split('T')[0];

  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-date-btn';

    const isToday = (dayStr === todayStr);
    const isPast = (dayStr < todayStr);
    const isAvailable = bookingState.availableDates.includes(dayStr);
    const isSelected = (bookingState.selectedDate === dayStr);

    if (isToday) btn.classList.add('today');
    if (isSelected) btn.classList.add('active');

    btn.innerHTML = `<span>${day}</span>`;

    if (isPast || !isAvailable) {
      btn.disabled = true;
    } else {
      btn.innerHTML += `<span class="cal-date-badge">Open</span>`;
      btn.onclick = () => selectBookingDate(dayStr);
    }

    grid.appendChild(btn);
  }
}

function selectBookingDate(dateStr) {
  bookingState.selectedDate = dateStr;
  document.getElementById('selectedDateDisplayBadge').textContent = `Selected: ${dateStr}`;
  document.getElementById('btnNextStep1').disabled = false;
  renderBookingCalendar();
}

function validateStep1AndProceed() {
  if (!bookingState.selectedDate) return;
  goToBookingStep(2);
}

// Step 2: Department Selection
async function loadBookingDepartments() {
  const container = document.getElementById('bookingDeptGrid');
  if (!container) return;
  container.innerHTML = '<div style="color: var(--text-muted);">Loading hospital specialties...</div>';
  document.getElementById('step2SelectedDateText').textContent = bookingState.selectedDate;

  try {
    const res = await fetch(`/api/appointments/scheduled-doctors?date=${bookingState.selectedDate}`);
    const data = await res.json();
    const doctors = data.doctors || [];

    // Distinct departments that have scheduled doctors on this date
    const deptsMap = new Map();
    doctors.forEach(d => {
      if (!deptsMap.has(d.departmentId)) {
        deptsMap.set(d.departmentId, {
          id: d.departmentId,
          name: d.departmentName,
          doctorsCount: 1
        });
      } else {
        deptsMap.get(d.departmentId).doctorsCount++;
      }
    });

    container.innerHTML = '';
    if (deptsMap.size === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; padding: 2rem; background: var(--bg-page); border-radius: 8px; text-align: center;">
          <p style="color: var(--text-muted);">No specialist doctors scheduled for this specific date.</p>
          <button class="btn-outline" style="margin-top: 0.5rem;" onclick="goToBookingStep(1)">Pick Another Date</button>
        </div>
      `;
      return;
    }

    deptsMap.forEach(dept => {
      const card = document.createElement('div');
      card.className = `dept-select-card ${bookingState.selectedDepartmentId === dept.id ? 'selected' : ''}`;
      card.onclick = () => selectBookingDepartment(dept.id, dept.name);
      card.innerHTML = `
        <div class="dept-card-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
        </div>
        <h4 style="font-size: 1.1rem; font-weight: 800; color: var(--primary-navy); margin-bottom: 0.25rem;">${dept.name}</h4>
        <span style="font-size: 0.8rem; color: var(--accent-teal); font-weight: 700;">${dept.doctorsCount} Available Doctor(s)</span>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = '<div style="color: red;">Failed to load departments.</div>';
  }
}

function selectBookingDepartment(deptId, deptName) {
  bookingState.selectedDepartmentId = deptId;
  bookingState.selectedDepartmentName = deptName;
  // If doctor was previously selected under another department, clear it
  bookingState.selectedDoctorId = null;
  bookingState.selectedTimeSlot = null;

  document.querySelectorAll('.dept-select-card').forEach(c => c.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
  document.getElementById('btnNextStep2').disabled = false;
}

function validateStep2AndProceed() {
  if (!bookingState.selectedDepartmentId) return;
  goToBookingStep(3);
}

// Step 3: Doctor Selection
async function loadBookingDoctors() {
  const container = document.getElementById('bookingDoctorGrid');
  if (!container) return;
  container.innerHTML = '<div style="color: var(--text-muted);">Finding scheduled doctors...</div>';
  document.getElementById('step3SelectedDateText').textContent = `${bookingState.selectedDate} (${bookingState.selectedDepartmentName})`;

  try {
    const res = await fetch(`/api/appointments/scheduled-doctors?date=${bookingState.selectedDate}&departmentId=${bookingState.selectedDepartmentId}`);
    const data = await res.json();
    const doctors = data.doctors || [];

    container.innerHTML = '';
    if (doctors.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; padding: 2rem; background: var(--bg-page); border-radius: 8px; text-align: center;">
          <p style="color: var(--text-muted);">No doctors with available booking slots found for this selection.</p>
          <button class="btn-outline" style="margin-top: 0.5rem;" onclick="goToBookingStep(2)">Choose Another Specialty</button>
        </div>
      `;
      return;
    }

    doctors.forEach(doc => {
      const card = document.createElement('div');
      card.className = `doctor-select-card ${bookingState.selectedDoctorId === doc.doctorId ? 'selected' : ''}`;
      card.onclick = () => selectBookingDoctor(doc);

      const avatar = doc.profileImage || 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=300&auto=format&fit=crop&q=80';
      card.innerHTML = `
        <img src="${avatar}" class="doctor-avatar-circle" alt="${doc.doctorName}">
        <div class="doctor-card-info">
          <div class="doctor-card-name">${doc.doctorName}</div>
          <div class="doctor-card-spec">${doc.specialization}</div>
          <div class="doctor-card-hours">⏰ Hours: ${doc.workingHours}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">🏥 Room: <b>${doc.roomNumber}</b></div>
          <div style="margin-top: 0.35rem; font-size: 0.72rem; font-weight: 700; color: var(--success-green);">
            ✓ ${doc.availableSlotsCount} Slot(s) Open
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = '<div style="color: red;">Error loading doctors.</div>';
  }
}

function selectBookingDoctor(doc) {
  bookingState.selectedDoctorId = doc.doctorId;
  bookingState.selectedDoctorName = doc.doctorName;
  bookingState.selectedSpecialization = doc.specialization;
  bookingState.selectedRoom = doc.roomNumber;
  bookingState.selectedBranch = doc.hospitalBranch || 'Main Pavilion - Colombo';
  bookingState.selectedTimeSlot = null;

  document.querySelectorAll('.doctor-select-card').forEach(c => c.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
  document.getElementById('btnNextStep3').disabled = false;
}

function validateStep3AndProceed() {
  if (!bookingState.selectedDoctorId) return;
  goToBookingStep(4);
}

// Step 4: Time Slot Selection
async function loadBookingSlots() {
  const container = document.getElementById('bookingSlotsGrid');
  if (!container) return;
  container.innerHTML = '<div style="color: var(--text-muted);">Generating available slots...</div>';

  document.getElementById('slotDoctorName').textContent = `${bookingState.selectedDoctorName} — ${bookingState.selectedSpecialization}`;
  document.getElementById('slotDoctorHours').textContent = `Date: ${bookingState.selectedDate} | Consultation Room: ${bookingState.selectedRoom}`;

  try {
    const res = await fetch(`/api/appointments/available-slots?doctorId=${bookingState.selectedDoctorId}&date=${bookingState.selectedDate}`);
    const data = await res.json();
    const slots = data.slots || [];

    container.innerHTML = '';
    if (slots.length === 0) {
      container.innerHTML = '<div style="grid-column: 1/-1; color: var(--text-muted); text-align: center;">No time slots configured.</div>';
      return;
    }

    slots.forEach(slot => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `time-slot-pill ${!slot.available ? 'disabled' : ''} ${bookingState.selectedTimeSlot === slot.time ? 'selected' : ''}`;
      pill.textContent = slot.time;
      pill.title = slot.available ? 'Available Slot' : slot.reason;

      if (!slot.available) {
        pill.disabled = true;
      } else {
        pill.onclick = () => selectBookingSlot(slot.time);
      }
      container.appendChild(pill);
    });
  } catch (err) {
    container.innerHTML = '<div style="color: red;">Error retrieving time slots.</div>';
  }
}

function selectBookingSlot(timeStr) {
  bookingState.selectedTimeSlot = timeStr;
  document.querySelectorAll('.time-slot-pill').forEach(p => p.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
  document.getElementById('btnNextStep4').disabled = false;
}

function validateStep4AndProceed() {
  if (!bookingState.selectedTimeSlot) return;
  goToBookingStep(5);
}

// Step 5: Summary and Confirmation
function renderBookingSummary() {
  document.getElementById('summaryDoctorName').textContent = bookingState.selectedDoctorName;
  document.getElementById('summarySpecialty').textContent = `${bookingState.selectedSpecialization} (${bookingState.selectedDepartmentName})`;
  document.getElementById('summaryDate').textContent = bookingState.selectedDate;
  document.getElementById('summaryTime').textContent = bookingState.selectedTimeSlot;
  document.getElementById('summaryRoom').textContent = bookingState.selectedRoom;
  document.getElementById('summaryBranch').textContent = bookingState.selectedBranch;

  const patName = (currentUser && currentUser.fullName) ? currentUser.fullName : 'Guest (Authentication required)';
  document.getElementById('summaryPatientName').textContent = patName;
}

async function submitFinalBooking() {
  // Check auth boundary
  if (!currentUser || currentUser.role !== 'patient' && currentUser.role !== 'admin') {
    openLoginModal('patient');
    return;
  }

  const btn = document.getElementById('btnConfirmBooking');
  const alertEl = document.getElementById('bookingErrorAlert');
  alertEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Reserving Appointment...';

  try {
    const res = await fetch('/api/appointments/book', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        doctorId: bookingState.selectedDoctorId,
        appointmentDate: bookingState.selectedDate,
        scheduledTime: bookingState.selectedTimeSlot,
        departmentId: bookingState.selectedDepartmentId,
        patientId: currentUser.patientId
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alertEl.textContent = data.error || 'Failed to complete appointment booking.';
      alertEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Confirm & Save Appointment →';
      return;
    }

    // Success! Show Reference
    document.getElementById('successApptRef').textContent = data.reference;
    document.getElementById('bookingSuccessBox').style.display = 'block';
    document.getElementById('bookingActionButtons').style.display = 'none';

    // Refresh patient dashboard data
    if (currentUser && currentUser.role === 'patient') {
      loadPatientDashboard();
    }
  } catch (err) {
    alertEl.textContent = 'Server connection error while booking. Please try again.';
    alertEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Confirm & Save Appointment →';
  }
}

// Patient Self Registration Modal Controller
function openPatientRegisterModal() {
  document.getElementById('patientRegisterModal').style.display = 'flex';
}

function closePatientRegisterModal() {
  document.getElementById('patientRegisterModal').style.display = 'none';
}

async function submitPatientRegistration() {
  const fullName = document.getElementById('selfRegName').value.trim();
  const username = document.getElementById('selfRegUsername').value.trim();
  const password = document.getElementById('selfRegPassword').value;
  const phone = document.getElementById('selfRegPhone').value.trim();
  const email = document.getElementById('selfRegEmail').value.trim();
  const dob = document.getElementById('selfRegDob').value;
  const gender = document.getElementById('selfRegGender').value;
  const bloodGroup = document.getElementById('selfRegBlood').value;
  const allergies = document.getElementById('selfRegAllergies').value.trim();

  const alertEl = document.getElementById('selfRegErrorAlert');
  alertEl.style.display = 'none';

  try {
    const res = await fetch('/api/auth/register-patient', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName, username, password, phone, email, dob, gender, bloodGroup, allergies
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alertEl.textContent = data.error || 'Registration failed.';
      alertEl.style.display = 'block';
      return;
    }

    // Auto sign in with new account
    localStorage.setItem('token', data.token);
    currentToken = data.token;
    currentUser = data.user;
    updateAuthUI(currentUser);
    closePatientRegisterModal();
    alert(`Registration successful! Your Hospital Patient ID is: ${data.user.hospitalNumber}`);

    // If currently on booking page, refresh auth notice
    const authNotice = document.getElementById('bookingAuthRequiredNotice');
    if (authNotice) authNotice.style.display = 'none';
    renderBookingSummary();
  } catch (e) {
    alertEl.textContent = 'Network or server error during registration.';
    alertEl.style.display = 'block';
  }
}

// ============================================================================
// 2. PUBLIC DOCTOR AVAILABILITY CONTROLLER (This Week & Next Week)
// ============================================================================
let currentPublicScheduleWeek = 'this_week';

function switchPublicScheduleWeek(week) {
  currentPublicScheduleWeek = week;
  document.getElementById('pillBtnThisWeek').classList.toggle('active', week === 'this_week');
  document.getElementById('pillBtnNextWeek').classList.toggle('active', week === 'next_week');
  loadPublicDoctorSchedules();
}

async function loadPublicDoctorSchedules() {
  const container = document.getElementById('publicAvailabilityGrid');
  if (!container) return;
  container.innerHTML = '<div style="color: var(--text-muted);">Loading published doctor working rosters...</div>';

  const deptFilter = document.getElementById('availFilterDept') ? document.getElementById('availFilterDept').value : '';
  const docFilter = document.getElementById('availFilterDoc') ? document.getElementById('availFilterDoc').value : '';

  try {
    let url = `/api/public/doctor-schedules?week=${currentPublicScheduleWeek}`;
    if (deptFilter) url += `&departmentId=${deptFilter}`;
    if (docFilter) url += `&doctorId=${docFilter}`;

    const res = await fetch(url);
    const data = await res.json();
    const schedules = data.schedules || [];

    // Populate department filter dropdown once if empty
    const deptSelect = document.getElementById('availFilterDept');
    if (deptSelect && deptSelect.options.length <= 1) {
      const depts = new Map();
      schedules.forEach(s => depts.set(s.departmentId, s.departmentName));
      depts.forEach((name, id) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = name;
        deptSelect.appendChild(opt);
      });
    }

    const docSelect = document.getElementById('availFilterDoc');
    if (docSelect && docSelect.options.length <= 1) {
      const docs = new Map();
      schedules.forEach(s => docs.set(s.doctorId, s.doctorName));
      docs.forEach((name, id) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = name;
        docSelect.appendChild(opt);
      });
    }

    container.innerHTML = '';
    if (schedules.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; padding: 2.5rem; background: #ffffff; border-radius: var(--radius-md); text-align: center; border: 1px dashed var(--border-light);">
          <div style="font-size: 1.1rem; font-weight: 700; color: var(--primary-navy);">No doctor schedules published for this period.</div>
          <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.35rem;">Check back shortly or view other departments.</p>
        </div>
      `;
      return;
    }

    schedules.forEach(s => {
      const card = document.createElement('div');
      card.className = 'avail-doc-card';

      const isAvail = s.status === 'AVAILABLE' && !s.bookingDisabled;
      const badgeClass = isAvail ? (s.bookedCount >= s.maxCapacity ? 'avail-badge-full' : 'avail-badge-available') : 'avail-badge-leave';
      const badgeText = isAvail ? (s.bookedCount >= s.maxCapacity ? 'Capacity Reached' : 'Bookable') : s.status;
      const avatar = s.profileImage || 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=300&auto=format&fit=crop&q=80';

      card.innerHTML = `
        <div class="avail-doc-header">
          <img src="${avatar}" class="doctor-avatar-circle" alt="${s.doctorName}">
          <div style="flex: 1;">
            <div style="font-weight: 800; font-size: 1.1rem; color: var(--primary-navy);">${s.doctorName}</div>
            <div style="font-size: 0.82rem; color: var(--accent-teal-dark); font-weight: 600;">${s.specialization}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${s.departmentName}</div>
          </div>
        </div>

        <div style="margin-bottom: 0.85rem; padding: 0.75rem; background: var(--bg-page); border-radius: var(--radius-sm); font-size: 0.82rem; line-height: 1.5;">
          <div>📅 <b>Date:</b> ${s.date}</div>
          <div>⏰ <b>Working Hours:</b> ${s.startTime} - ${s.endTime}</div>
          ${s.breakStart ? `<div>☕ <b>Break:</b> ${s.breakStart} - ${s.breakEnd}</div>` : ''}
          <div>🏥 <b>Room:</b> ${s.roomNumber} | ${s.hospitalBranch}</div>
          <div>⏱️ <b>Consultation Slot:</b> ${s.duration} Mins</div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: auto; padding-top: 0.75rem; border-top: 1px solid var(--border-light);">
          <span class="avail-doc-badge ${badgeClass}">${badgeText}</span>
          ${s.hasSlots ? `
            <button class="btn-primary" style="padding: 0.4rem 0.9rem; font-size: 0.8rem;" onclick="bookDoctorFromSchedule('${s.date}', '${s.departmentId}', '${s.doctorId}')">
              Book Appointment &rarr;
            </button>
          ` : `
            <button class="btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; opacity: 0.6;" disabled>
              Fully Booked / Off
            </button>
          `}
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = '<div style="color: red;">Failed to retrieve doctor schedules.</div>';
  }
}

function resetAvailFilters() {
  const d1 = document.getElementById('availFilterDept');
  const d2 = document.getElementById('availFilterDoc');
  if (d1) d1.value = '';
  if (d2) d2.value = '';
  loadPublicDoctorSchedules();
}

function bookDoctorFromSchedule(date, deptId, doctorId) {
  // If not authenticated, open login modal
  if (!currentUser || currentUser.role !== 'patient') {
    openLoginModal('patient');
    return;
  }
  navigateToSection('book');
  bookingState.selectedDate = date;
  bookingState.selectedDepartmentId = deptId;
  bookingState.selectedDoctorId = doctorId;
  goToBookingStep(4);
}

// ============================================================================
// 3. ADMIN PANEL — DOCTOR SCHEDULE MANAGEMENT CONTROLLER
// ============================================================================
let adminScheduleWeek = 'this_week';
let allAdminSchedules = [];

function switchAdminScheduleWeek(week) {
  adminScheduleWeek = week;
  document.getElementById('adminSchedBtnThisWeek').classList.toggle('active', week === 'this_week');
  document.getElementById('adminSchedBtnNextWeek').classList.toggle('active', week === 'next_week');

  const today = new Date();
  const day = today.getDay();
  const diffToMon = today.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(today.setDate(diffToMon));

  if (week === 'next_week') {
    monday.setDate(monday.getDate() + 7);
  }
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  document.getElementById('adminSchedStartDate').value = monday.toISOString().split('T')[0];
  document.getElementById('adminSchedEndDate').value = sunday.toISOString().split('T')[0];

  loadAdminSchedules();
}

async function loadAdminSchedules() {
  const tbody = document.getElementById('adminSchedulesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">Loading doctor schedules...</td></tr>';

  const startDate = document.getElementById('adminSchedStartDate').value;
  const endDate = document.getElementById('adminSchedEndDate').value;
  const docFilter = document.getElementById('adminSchedDoctorFilter').value;

  try {
    let url = `/api/admin/schedules?startDate=${startDate}&endDate=${endDate}`;
    if (docFilter) url += `&doctorId=${docFilter}`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    allAdminSchedules = data.schedules || [];

    // Populate admin schedule doctor filter
    const docSelect = document.getElementById('adminSchedDoctorFilter');
    if (docSelect && docSelect.options.length <= 1 && allDoctors.length > 0) {
      allDoctors.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name;
        docSelect.appendChild(opt);
      });
    }

    tbody.innerHTML = '';
    if (allAdminSchedules.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">No schedules configured for this date range. Click "+ Add Doctor Schedule" above.</td></tr>';
      return;
    }

    allAdminSchedules.forEach(s => {
      const tr = document.createElement('tr');
      const dateStr = s.schedule_date ? s.schedule_date.split('T')[0] : '';
      tr.innerHTML = `
        <td>
          <div style="font-weight: 800; color: var(--primary-navy);">${s.doctor_name}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${s.specialization}</div>
        </td>
        <td style="font-weight: 700;">${dateStr}</td>
        <td>${s.start_time} - ${s.end_time}</td>
        <td>${s.break_start ? `${s.break_start} - ${s.break_end}` : 'None'}</td>
        <td><b>${s.room_number || 'Room TBD'}</b></td>
        <td>${s.appointment_duration} Mins</td>
        <td>
          <span style="font-weight: 800; color: ${s.booked_count >= s.max_capacity ? 'var(--danger-rose)' : 'var(--primary-navy)'};">
            ${s.booked_count || 0} / ${s.max_capacity}
          </span>
        </td>
        <td>
          <span class="sample-notice-pill" style="font-size: 0.72rem; ${s.status === 'AVAILABLE' ? 'background: #dcfce7; color: #15803d;' : 'background: #fee2e2; color: #b91c1c;'}">
            ${s.status}
          </span>
        </td>
        <td>
          <div style="display: flex; gap: 0.35rem;">
            <button class="btn-outline" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="editAdminSchedule('${s.id}')">Edit</button>
            <button class="btn-outline" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; color: var(--danger-rose); border-color: #fecdd3;" onclick="deleteAdminSchedule('${s.id}')">Delete</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: red;">Error loading schedules.</td></tr>';
  }
}

function openAdminScheduleModal(scheduleData = null) {
  const modal = document.getElementById('adminScheduleModal');
  const alertEl = document.getElementById('adminSchedConflictAlert');
  alertEl.style.display = 'none';

  // Populate doctor select
  const docSelect = document.getElementById('adminSchedDoctorSelect');
  docSelect.innerHTML = '';
  allDoctors.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.name} (${d.specialization})`;
    docSelect.appendChild(opt);
  });

  // Populate room select
  const roomSelect = document.getElementById('adminSchedRoomSelect');
  roomSelect.innerHTML = '<option value="">None / Floating</option>';
  allRooms.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = `${r.room_number} - ${r.name}`;
    roomSelect.appendChild(opt);
  });

  if (scheduleData) {
    document.getElementById('adminScheduleModalTitle').textContent = 'Edit Doctor Working Schedule';
    document.getElementById('adminSchedId').value = scheduleData.id;
    docSelect.value = scheduleData.doctor_id;
    document.getElementById('adminSchedDateInput').value = scheduleData.schedule_date.split('T')[0];
    roomSelect.value = scheduleData.room_id || '';
    document.getElementById('adminSchedStartTime').value = scheduleData.start_time;
    document.getElementById('adminSchedEndTime').value = scheduleData.end_time;
    document.getElementById('adminSchedBreakStart').value = scheduleData.break_start || '';
    document.getElementById('adminSchedBreakEnd').value = scheduleData.break_end || '';
    document.getElementById('adminSchedDuration').value = scheduleData.appointment_duration;
    document.getElementById('adminSchedCapacity').value = scheduleData.max_capacity;
    document.getElementById('adminSchedStatus').value = scheduleData.status;
    document.getElementById('adminSchedBranch').value = scheduleData.hospital_branch;
    document.getElementById('adminSchedPublished').checked = !!scheduleData.is_published;
    document.getElementById('adminSchedDisableBooking').checked = !!scheduleData.booking_disabled;
  } else {
    document.getElementById('adminScheduleModalTitle').textContent = 'Add Doctor Working Schedule';
    document.getElementById('adminSchedId').value = '';
    document.getElementById('adminSchedDateInput').value = new Date().toISOString().split('T')[0];
    document.getElementById('adminSchedStartTime').value = '08:30';
    document.getElementById('adminSchedEndTime').value = '16:30';
    document.getElementById('adminSchedBreakStart').value = '12:30';
    document.getElementById('adminSchedBreakEnd').value = '13:30';
    document.getElementById('adminSchedDuration').value = '15';
    document.getElementById('adminSchedCapacity').value = '25';
    document.getElementById('adminSchedStatus').value = 'AVAILABLE';
    document.getElementById('adminSchedBranch').value = 'Main Pavilion - Colombo';
    document.getElementById('adminSchedPublished').checked = true;
    document.getElementById('adminSchedDisableBooking').checked = false;
  }

  modal.style.display = 'flex';
}

function closeAdminScheduleModal() {
  document.getElementById('adminScheduleModal').style.display = 'none';
}

function editAdminSchedule(id) {
  const sched = allAdminSchedules.find(s => s.id === id);
  if (!sched) return;
  openAdminScheduleModal(sched);
}

async function submitAdminSaveSchedule(forceResolution = false) {
  const id = document.getElementById('adminSchedId').value;
  const doctorId = document.getElementById('adminSchedDoctorSelect').value;
  const scheduleDate = document.getElementById('adminSchedDateInput').value;
  const roomId = document.getElementById('adminSchedRoomSelect').value || null;
  const startTime = document.getElementById('adminSchedStartTime').value;
  const endTime = document.getElementById('adminSchedEndTime').value;
  const breakStart = document.getElementById('adminSchedBreakStart').value || null;
  const breakEnd = document.getElementById('adminSchedBreakEnd').value || null;
  const appointmentDuration = Number(document.getElementById('adminSchedDuration').value) || 15;
  const maxCapacity = Number(document.getElementById('adminSchedCapacity').value) || 25;
  const status = document.getElementById('adminSchedStatus').value;
  const hospitalBranch = document.getElementById('adminSchedBranch').value;
  const isPublished = document.getElementById('adminSchedPublished').checked ? 1 : 0;
  const bookingDisabled = document.getElementById('adminSchedDisableBooking').checked ? 1 : 0;

  const alertEl = document.getElementById('adminSchedConflictAlert');
  alertEl.style.display = 'none';

  try {
    const res = await fetch('/api/admin/schedules/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        id, doctorId, scheduleDate, roomId, startTime, endTime, breakStart, breakEnd,
        appointmentDuration, maxCapacity, status, hospitalBranch, isPublished, bookingDisabled,
        forceResolution
      })
    });

    const data = await res.json();
    if (!res.ok) {
      if (data.conflictType === 'ROOM_CONFLICT') {
        alertEl.textContent = `🚫 ${data.error}`;
        alertEl.style.display = 'block';
        return;
      }
      if (data.conflictType === 'APPOINTMENTS_EXIST' || data.conflictType === 'APPOINTMENTS_OUT_OF_BOUNDS') {
        alertEl.innerHTML = `
          ⚠️ <b>Conflict Detected:</b> ${data.error}<br>
          <div style="margin-top: 0.5rem;">
            <button type="button" class="btn-primary" style="padding: 0.3rem 0.75rem; font-size: 0.75rem;" onclick="submitAdminSaveSchedule(true)">
              Acknowledge & Force Update Schedule
            </button>
          </div>
        `;
        alertEl.style.display = 'block';
        return;
      }
      alertEl.textContent = data.error || 'Failed to save schedule.';
      alertEl.style.display = 'block';
      return;
    }

    alert('Schedule saved and published successfully!');
    closeAdminScheduleModal();
    loadAdminSchedules();
  } catch (err) {
    alertEl.textContent = 'Server error while saving schedule.';
    alertEl.style.display = 'block';
  }
}

async function deleteAdminSchedule(id) {
  if (!confirm('Are you sure you want to remove this doctor working schedule?')) return;
  try {
    const res = await fetch(`/api/admin/schedules/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to delete schedule');
      return;
    }
    alert(data.message);
    loadAdminSchedules();
  } catch (e) {
    alert('Error deleting schedule');
  }
}

// Admin: Copy Week Modal
function openCopyWeekModal() {
  const modal = document.getElementById('adminCopyWeekModal');

  // Populate doctor select
  const docSelect = document.getElementById('copyScopeDoctorSelect');
  docSelect.innerHTML = '<option value="">All Hospital Doctors</option>';
  allDoctors.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    docSelect.appendChild(opt);
  });

  // Calculate current Monday and next Monday
  const today = new Date();
  const day = today.getDay();
  const diffToMon = today.getDate() - day + (day === 0 ? -6 : 1);
  const thisMonday = new Date(today.setDate(diffToMon));
  const nextMonday = new Date(thisMonday);
  nextMonday.setDate(nextMonday.getDate() + 7);

  document.getElementById('copySourceWeekStart').value = thisMonday.toISOString().split('T')[0];
  document.getElementById('copyTargetWeekStart').value = nextMonday.toISOString().split('T')[0];

  modal.style.display = 'flex';
}

function closeCopyWeekModal() {
  document.getElementById('adminCopyWeekModal').style.display = 'none';
}

async function submitCopyWeeklySchedule() {
  const fromWeekStart = document.getElementById('copySourceWeekStart').value;
  const toWeekStart = document.getElementById('copyTargetWeekStart').value;
  const doctorId = document.getElementById('copyScopeDoctorSelect').value || null;

  try {
    const res = await fetch('/api/admin/schedules/copy-week', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ fromWeekStart, toWeekStart, doctorId })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to copy weekly schedule.');
      return;
    }

    alert(data.message);
    closeCopyWeekModal();
    loadAdminSchedules();
  } catch (err) {
    alert('Server error while copying schedule.');
  }
}

// ============================================================================
// 4. DOCTOR PERSONAL DASHBOARD & INTERACTIVE CALENDAR CONTROLLER
// ============================================================================
let doctorDashboardData = {
  stats: {},
  appointments: [],
  schedules: []
};
let doctorCalendarMonthOffset = 0;
let currentDoctorApptFilter = 'today';

async function loadDoctorDashboard() {
  try {
    const res = await fetch(`/api/doctor/my-dashboard?doctorId=${activeDoctorId}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!res.ok) return;

    doctorDashboardData = data;

    // Render 5 Summary Cards
    document.getElementById('docStatTodayAppts').textContent = data.stats.todayAppts || 0;
    document.getElementById('docStatUpcomingAppts').textContent = data.stats.upcomingAppts || 0;
    document.getElementById('docStatWaitingPatients').textContent = data.stats.waitingPatients || 0;
    document.getElementById('docStatCompletedAppts').textContent = data.stats.completedAppts || 0;

    if (data.stats.nextAppt) {
      document.getElementById('docStatNextApptTime').textContent = `${data.stats.nextAppt.scheduled_time} (${data.stats.nextAppt.appointment_date.split('T')[0]})`;
      document.getElementById('docStatNextApptPatient').textContent = `Patient: ${data.stats.nextAppt.patient_name} (${data.stats.nextAppt.reference})`;
    } else {
      document.getElementById('docStatNextApptTime').textContent = 'None';
      document.getElementById('docStatNextApptPatient').textContent = 'No upcoming patient';
    }

    renderDoctorAppointmentsList();
    renderDoctorCalendar();
  } catch (err) {
    console.error('Failed to load doctor dashboard data:', err);
  }
}

function switchDoctorViewMode(mode) {
  const listView = document.getElementById('doctorAppointmentsListView');
  const calView = document.getElementById('doctorCalendarView');
  const btnList = document.getElementById('docViewToggleList');
  const btnCal = document.getElementById('docViewToggleCal');

  if (mode === 'calendar') {
    listView.style.display = 'none';
    calView.style.display = 'block';
    btnList.classList.remove('active');
    btnCal.classList.add('active');
    renderDoctorCalendar();
  } else {
    listView.style.display = 'block';
    calView.style.display = 'none';
    btnList.classList.add('active');
    btnCal.classList.remove('active');
    renderDoctorAppointmentsList();
  }
}

function filterDoctorAppointments(category) {
  currentDoctorApptFilter = category;
  ['today', 'upcoming', 'completed', 'cancelled'].forEach(c => {
    const btn = document.getElementById(`docApptCatBtn-${c}`);
    if (btn) {
      if (c === category) {
        btn.className = 'btn-primary';
      } else {
        btn.className = 'btn-outline';
      }
    }
  });
  renderDoctorAppointmentsList();
}

function renderDoctorAppointmentsList() {
  const tbody = document.getElementById('doctorApptsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const todayStr = new Date().toISOString().split('T')[0];
  const list = doctorDashboardData.appointments || [];

  const filtered = list.filter(a => {
    const apptDate = a.appointment_date ? a.appointment_date.split('T')[0] : '';
    if (currentDoctorApptFilter === 'today') {
      return apptDate === todayStr && a.status !== 'CANCELLED';
    }
    if (currentDoctorApptFilter === 'upcoming') {
      return apptDate > todayStr && a.status !== 'CANCELLED';
    }
    if (currentDoctorApptFilter === 'completed') {
      return a.status === 'COMPLETED';
    }
    if (currentDoctorApptFilter === 'cancelled') {
      return a.status === 'CANCELLED';
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">No appointments in category '${currentDoctorApptFilter}'.</td></tr>`;
    return;
  }

  filtered.forEach(a => {
    const tr = document.createElement('tr');
    const dateStr = a.appointment_date ? a.appointment_date.split('T')[0] : '';
    const checkInBadge = a.status === 'CHECKED_IN' || a.active_token_number
      ? `<span class="sample-notice-pill" style="background: #fef3c7; color: #b45309;">Checked In (${a.active_token_number || 'Token Issued'})</span>`
      : `<span style="color: var(--text-muted); font-size: 0.75rem;">Awaiting Check-In</span>`;

    tr.innerHTML = `
      <td>
        <div style="font-weight: 800; color: var(--primary-navy);">${a.reference}</div>
        ${a.active_token_number ? `<span class="token-pill-badge" style="font-size: 0.8rem; padding: 0.15rem 0.5rem;">${a.active_token_number}</span>` : ''}
      </td>
      <td>${dateStr}</td>
      <td style="font-weight: 700;">${a.scheduled_time}</td>
      <td>
        <div style="font-weight: 700;">${a.patient_name}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${a.patient_phone || '-'} | Blood: ${a.blood_group || 'O+'}</div>
      </td>
      <td><b>${a.room_number || 'Room 01'}</b></td>
      <td>${checkInBadge}</td>
      <td>
        <span class="status-badge-live ${
          a.status === 'APPOINTED' ? 'status-waiting' :
          a.status === 'CHECKED_IN' ? 'status-calling' :
          a.status === 'COMPLETED' ? 'status-consulting' :
          'status-available'
        }">
          ${a.status}
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function prevDoctorCalendarMonth() {
  doctorCalendarMonthOffset--;
  renderDoctorCalendar();
}

function nextDoctorCalendarMonth() {
  doctorCalendarMonthOffset++;
  renderDoctorCalendar();
}

function renderDoctorCalendar() {
  const grid = document.getElementById('doctorCalendarGridBody');
  if (!grid) return;
  grid.innerHTML = '';

  const now = new Date();
  const currentMonthDate = new Date(now.getFullYear(), now.getMonth() + doctorCalendarMonthOffset, 1);
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  document.getElementById('doctorCalendarMonthLabel').textContent = `${monthNames[month]} ${year}`;

  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  daysOfWeek.forEach(d => {
    const colHeader = document.createElement('div');
    colHeader.className = 'cal-col-header';
    colHeader.textContent = d;
    grid.appendChild(colHeader);
  });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement('div');
    grid.appendChild(blank);
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const appts = doctorDashboardData.appointments || [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'cal-cell-day';
    if (dayStr === todayStr) cell.classList.add('is-today');

    cell.innerHTML = `<span class="cal-day-number">${day}</span>`;

    // Matching appointments for this day
    const dayAppts = appts.filter(a => a.appointment_date && a.appointment_date.split('T')[0] === dayStr);

    dayAppts.forEach(a => {
      const chip = document.createElement('div');
      let chipClass = 'appt-chip-appointed';
      if (a.status === 'CHECKED_IN') chipClass = 'appt-chip-checkedin';
      else if (a.status === 'COMPLETED') chipClass = 'appt-chip-completed';
      else if (a.status === 'CANCELLED') chipClass = 'appt-chip-cancelled';

      chip.className = `cal-appt-chip ${chipClass}`;
      chip.textContent = `${a.scheduled_time} - ${a.patient_name}`;
      chip.title = `${a.reference} | ${a.scheduled_time} | ${a.patient_name} (Status: ${a.status}, Room: ${a.room_number || 'Room TBD'})`;
      chip.onclick = () => alert(`Appointment Details:\nReference: ${a.reference}\nPatient: ${a.patient_name}\nTime: ${a.scheduled_time}\nRoom: ${a.room_number || 'Room 01'}\nStatus: ${a.status}`);
      cell.appendChild(chip);
    });

    grid.appendChild(cell);
  }
}

