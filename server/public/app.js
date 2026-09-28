const API = '/api';
let activeSessionId = null;
let pollTimer = null;

// ---------- Tabs ----------

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ---------- Helpers ----------

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

function fillSelect(select, items, labelFn, valueFn) {
  select.innerHTML = '';
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = valueFn(item);
    opt.textContent = labelFn(item);
    select.appendChild(opt);
  }
}

// ---------- Students ----------

async function loadStudents() {
  const students = await api('/students');

  const tbody = document.querySelector('#students-table tbody');
  tbody.innerHTML = '';
  for (const s of students) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${s.id}</td><td>${s.name}</td><td>${s.index_number}</td><td>${s.programme || ''}</td><td>${s.fingerprint_slot_id}</td>
      <td><span class="delete-link" data-id="${s.id}">delete</span></td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('.delete-link').forEach((el) => {
    el.addEventListener('click', async () => {
      await api(`/students/${el.dataset.id}`, { method: 'DELETE' });
      loadStudents();
    });
  });

  fillSelect(document.getElementById('enroll-student'), students, (s) => `${s.name} (${s.index_number})`, (s) => s.id);
  return students;
}

document.getElementById('add-student-btn').addEventListener('click', async () => {
  const name = document.getElementById('student-name').value.trim();
  const index_number = document.getElementById('student-index').value.trim();
  const programme = document.getElementById('student-programme').value.trim();
  const fingerprintIdRaw = document.getElementById('student-fingerprint-id').value.trim();
  if (!name || !index_number) return alert('Enter name and index number');
  try {
    const payload = { name, index_number, programme };
    if (fingerprintIdRaw) payload.fingerprint_slot_id = Number(fingerprintIdRaw);
    const student = await api('/students', { method: 'POST', body: JSON.stringify(payload) });
    document.getElementById('student-name').value = '';
    document.getElementById('student-index').value = '';
    document.getElementById('student-programme').value = '';
    document.getElementById('student-fingerprint-id').value = '';
    alert(`Added ${student.name} with fingerprint slot ID ${student.fingerprint_slot_id}.`);
    loadStudents();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Courses ----------

async function loadCourses() {
  const courses = await api('/courses');

  const tbody = document.querySelector('#courses-table tbody');
  tbody.innerHTML = '';
  for (const c of courses) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c.id}</td><td>${c.name}</td><td>${c.code}</td>
      <td><span class="delete-link" data-id="${c.id}">delete</span></td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('.delete-link').forEach((el) => {
    el.addEventListener('click', async () => {
      if (!confirm('Delete this course and all its sessions/attendance records?')) return;
      await api(`/courses/${el.dataset.id}`, { method: 'DELETE' });
      loadCourses();
    });
  });

  fillSelect(document.getElementById('enroll-course'), courses, (c) => `${c.code} — ${c.name}`, (c) => c.id);
  fillSelect(document.getElementById('session-course'), courses, (c) => `${c.code} — ${c.name}`, (c) => c.id);
  return courses;
}

document.getElementById('add-course-btn').addEventListener('click', async () => {
  const name = document.getElementById('course-name').value.trim();
  const code = document.getElementById('course-code').value.trim();
  if (!name || !code) return alert('Enter course name and code');
  try {
    await api('/courses', { method: 'POST', body: JSON.stringify({ name, code }) });
    document.getElementById('course-name').value = '';
    document.getElementById('course-code').value = '';
    loadCourses();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('enroll-btn').addEventListener('click', async () => {
  const student_id = document.getElementById('enroll-student').value;
  const course_id = document.getElementById('enroll-course').value;
  if (!student_id || !course_id) return alert('Add a student and course first');
  try {
    await api('/enrollments', { method: 'POST', body: JSON.stringify({ student_id, course_id }) });
    alert('Enrolled.');
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Devices ----------

async function loadDevices() {
  const devices = await api('/devices');

  const tbody = document.querySelector('#devices-table tbody');
  tbody.innerHTML = '';
  for (const d of devices) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${d.id}</td><td>${d.label}</td><td><code>${d.api_key}</code></td>`;
    tbody.appendChild(tr);
  }

  fillSelect(document.getElementById('session-device'), devices, (d) => d.label, (d) => d.id);
  return devices;
}

document.getElementById('add-device-btn').addEventListener('click', async () => {
  const label = document.getElementById('device-label').value.trim();
  if (!label) return alert('Enter a device label');
  const device = await api('/devices', { method: 'POST', body: JSON.stringify({ label }) });
  document.getElementById('device-label').value = '';
  alert(`Registered. API key: ${device.api_key}`);
  loadDevices();
});

// ---------- Sessions ----------

async function loadSessionHistory() {
  const sessions = await api('/sessions');
  const tbody = document.querySelector('#session-history-table tbody');
  tbody.innerHTML = '';
  for (const s of sessions) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${s.id}</td><td>${s.course_code}</td><td>${s.device_label}</td>
      <td>${new Date(s.start_time).toLocaleString()}</td><td>${s.status}</td>
      <td><a href="${API}/sessions/${s.id}/report.csv" target="_blank">CSV</a></td>`;
    tbody.appendChild(tr);
  }

  const active = sessions.find((s) => s.status === 'active');
  if (active) startWatchingSession(active.id);
}

document.getElementById('start-session-btn').addEventListener('click', async () => {
  const course_id = document.getElementById('session-course').value;
  const device_id = document.getElementById('session-device').value;
  if (!course_id || !device_id) return alert('Add a course and device first');
  const session = await api('/sessions/start', { method: 'POST', body: JSON.stringify({ course_id, device_id }) });
  startWatchingSession(session.id);
  loadSessionHistory();
});

document.getElementById('end-session-btn').addEventListener('click', async () => {
  if (!activeSessionId) return;
  await api(`/sessions/${activeSessionId}/end`, { method: 'POST' });
  stopWatchingSession();
  loadSessionHistory();
});

function startWatchingSession(sessionId) {
  activeSessionId = sessionId;
  document.getElementById('active-session-card').hidden = false;
  document.getElementById('export-csv-link').href = `${API}/sessions/${sessionId}/report.csv`;
  refreshAttendance();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshAttendance, 3000);
}

function stopWatchingSession() {
  activeSessionId = null;
  document.getElementById('active-session-card').hidden = true;
  if (pollTimer) clearInterval(pollTimer);
}

async function refreshAttendance() {
  if (!activeSessionId) return;
  const data = await api(`/sessions/${activeSessionId}/attendance`);

  document.getElementById('active-session-label').textContent =
    `Session #${data.session.id} (${data.session.status})`;

  document.getElementById('present-count').textContent = data.present.length;
  document.getElementById('absent-count').textContent = data.absent.length;

  const presentList = document.getElementById('present-list');
  presentList.innerHTML = '';
  for (const s of data.present) {
    const li = document.createElement('li');
    li.textContent = `${s.name} (${s.index_number}) — ${new Date(s.timestamp).toLocaleTimeString()}`;
    presentList.appendChild(li);
  }

  const absentList = document.getElementById('absent-list');
  absentList.innerHTML = '';
  for (const s of data.absent) {
    const li = document.createElement('li');
    li.textContent = `${s.name} (${s.index_number})`;
    absentList.appendChild(li);
  }

  if (data.session.status !== 'active') stopWatchingSession();
}

// ---------- Init ----------

(async function init() {
  await Promise.all([loadStudents(), loadCourses(), loadDevices()]);
  await loadSessionHistory();
})();
