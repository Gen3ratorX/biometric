const express = require('express');
const crypto = require('crypto');
const db = require('./db');

const router = express.Router();

// ---------- Students ----------

router.get('/students', (req, res) => {
  const students = db.prepare('SELECT * FROM students ORDER BY id').all();
  res.json(students);
});

router.post('/students', (req, res) => {
  const { name, index_number, programme } = req.body;
  let { fingerprint_slot_id } = req.body;
  if (!name || !index_number) {
    return res.status(400).json({ error: 'name and index_number are required' });
  }

  if (fingerprint_slot_id === undefined || fingerprint_slot_id === null || fingerprint_slot_id === '') {
    // No slot ID given (e.g. testing without hardware) — fall back to auto-assigning one.
    fingerprint_slot_id = db
      .prepare('SELECT COALESCE(MAX(fingerprint_slot_id), 0) + 1 AS next FROM students')
      .get().next;
  } else {
    fingerprint_slot_id = Number(fingerprint_slot_id);
    if (!Number.isInteger(fingerprint_slot_id) || fingerprint_slot_id <= 0) {
      return res.status(400).json({ error: 'fingerprint_slot_id must be a positive integer' });
    }
  }

  try {
    const info = db
      .prepare(
        'INSERT INTO students (name, index_number, programme, fingerprint_slot_id) VALUES (?, ?, ?, ?)'
      )
      .run(name, index_number, programme || null, fingerprint_slot_id);
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(student);
  } catch (err) {
    res.status(400).json({ error: 'index_number or fingerprint_slot_id already in use' });
  }
});

router.delete('/students/:id', (req, res) => {
  db.prepare('DELETE FROM attendance_records WHERE student_id = ?').run(req.params.id);
  db.prepare('DELETE FROM enrollments WHERE student_id = ?').run(req.params.id);
  db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- Courses ----------

router.get('/courses', (req, res) => {
  res.json(db.prepare('SELECT * FROM courses ORDER BY id').all());
});

router.post('/courses', (req, res) => {
  const { name, code } = req.body;
  if (!name || !code) {
    return res.status(400).json({ error: 'name and code are required' });
  }
  try {
    const info = db.prepare('INSERT INTO courses (name, code) VALUES (?, ?)').run(name, code);
    res.status(201).json(db.prepare('SELECT * FROM courses WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    res.status(400).json({ error: 'course code already exists' });
  }
});

router.delete('/courses/:id', (req, res) => {
  const sessionIds = db
    .prepare('SELECT id FROM sessions WHERE course_id = ?')
    .all(req.params.id)
    .map((s) => s.id);
  for (const sessionId of sessionIds) {
    db.prepare('DELETE FROM attendance_records WHERE session_id = ?').run(sessionId);
  }
  db.prepare('DELETE FROM sessions WHERE course_id = ?').run(req.params.id);
  db.prepare('DELETE FROM enrollments WHERE course_id = ?').run(req.params.id);
  db.prepare('DELETE FROM courses WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

router.get('/courses/:id/students', (req, res) => {
  const students = db
    .prepare(
      `SELECT s.* FROM students s
       JOIN enrollments e ON e.student_id = s.id
       WHERE e.course_id = ?
       ORDER BY s.name`
    )
    .all(req.params.id);
  res.json(students);
});

// ---------- Enrollments ----------

router.post('/enrollments', (req, res) => {
  const { student_id, course_id } = req.body;
  if (!student_id || !course_id) {
    return res.status(400).json({ error: 'student_id and course_id are required' });
  }
  try {
    db.prepare('INSERT INTO enrollments (student_id, course_id) VALUES (?, ?)').run(
      student_id,
      course_id
    );
    res.status(201).json({ student_id, course_id });
  } catch (err) {
    res.status(400).json({ error: 'student already enrolled in this course' });
  }
});

// ---------- Devices ----------

router.get('/devices', (req, res) => {
  res.json(db.prepare('SELECT * FROM devices ORDER BY id').all());
});

router.post('/devices', (req, res) => {
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: 'label is required' });

  const api_key = crypto.randomBytes(16).toString('hex');
  const info = db
    .prepare('INSERT INTO devices (label, api_key) VALUES (?, ?)')
    .run(label, api_key);
  res.status(201).json(db.prepare('SELECT * FROM devices WHERE id = ?').get(info.lastInsertRowid));
});

// ---------- Sessions ----------

router.post('/sessions/start', (req, res) => {
  const { course_id, device_id } = req.body;
  if (!course_id || !device_id) {
    return res.status(400).json({ error: 'course_id and device_id are required' });
  }

  db.prepare(
    "UPDATE sessions SET status = 'ended', end_time = ? WHERE device_id = ? AND status = 'active'"
  ).run(new Date().toISOString(), device_id);

  const info = db
    .prepare(
      "INSERT INTO sessions (course_id, device_id, start_time, status) VALUES (?, ?, ?, 'active')"
    )
    .run(course_id, device_id, new Date().toISOString());

  res.status(201).json(db.prepare('SELECT * FROM sessions WHERE id = ?').get(info.lastInsertRowid));
});

router.post('/sessions/:id/end', (req, res) => {
  db.prepare("UPDATE sessions SET status = 'ended', end_time = ? WHERE id = ?").run(
    new Date().toISOString(),
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id));
});

router.get('/sessions', (req, res) => {
  const sessions = db
    .prepare(
      `SELECT sess.*, c.name AS course_name, c.code AS course_code, d.label AS device_label
       FROM sessions sess
       JOIN courses c ON c.id = sess.course_id
       JOIN devices d ON d.id = sess.device_id
       ORDER BY sess.id DESC`
    )
    .all();
  res.json(sessions);
});

router.get('/sessions/:id/attendance', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });

  const present = db
    .prepare(
      `SELECT s.id, s.name, s.index_number, s.programme, a.timestamp
       FROM attendance_records a
       JOIN students s ON s.id = a.student_id
       WHERE a.session_id = ?
       ORDER BY a.timestamp`
    )
    .all(req.params.id);

  const absent = db
    .prepare(
      `SELECT s.id, s.name, s.index_number, s.programme
       FROM students s
       JOIN enrollments e ON e.student_id = s.id
       WHERE e.course_id = ?
         AND s.id NOT IN (SELECT student_id FROM attendance_records WHERE session_id = ?)
       ORDER BY s.name`
    )
    .all(session.course_id, req.params.id);

  res.json({ session, present, absent });
});

// ---------- Attendance (called by the ESP32) ----------

router.post('/attendance', (req, res) => {
  const { api_key, fingerprint_slot_id } = req.body;
  if (!api_key || fingerprint_slot_id === undefined) {
    return res.status(400).json({ status: 'error', reason: 'api_key and fingerprint_slot_id are required' });
  }

  const device = db.prepare('SELECT * FROM devices WHERE api_key = ?').get(api_key);
  if (!device) return res.status(401).json({ status: 'error', reason: 'invalid_api_key' });

  const session = db
    .prepare("SELECT * FROM sessions WHERE device_id = ? AND status = 'active'")
    .get(device.id);
  if (!session) return res.status(404).json({ status: 'error', reason: 'no_active_session' });

  const student = db
    .prepare('SELECT * FROM students WHERE fingerprint_slot_id = ?')
    .get(fingerprint_slot_id);
  if (!student) return res.status(404).json({ status: 'error', reason: 'unknown_fingerprint' });

  const enrolled = db
    .prepare('SELECT 1 FROM enrollments WHERE student_id = ? AND course_id = ?')
    .get(student.id, session.course_id);
  if (!enrolled) return res.status(403).json({ status: 'error', reason: 'not_enrolled' });

  try {
    db.prepare(
      'INSERT INTO attendance_records (student_id, session_id, timestamp) VALUES (?, ?, ?)'
    ).run(student.id, session.id, new Date().toISOString());
    return res.json({ status: 'success', student_name: student.name });
  } catch (err) {
    return res.json({ status: 'duplicate', student_name: student.name });
  }
});

// ---------- Reports ----------

router.get('/sessions/:id/report.csv', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });

  const present = db
    .prepare(
      `SELECT s.index_number, s.programme, s.name, a.timestamp
       FROM attendance_records a
       JOIN students s ON s.id = a.student_id
       WHERE a.session_id = ?`
    )
    .all(req.params.id);

  const absent = db
    .prepare(
      `SELECT s.index_number, s.programme, s.name
       FROM students s
       JOIN enrollments e ON e.student_id = s.id
       WHERE e.course_id = ?
         AND s.id NOT IN (SELECT student_id FROM attendance_records WHERE session_id = ?)`
    )
    .all(session.course_id, req.params.id);

  let csv = 'index_number,name,programme,status,timestamp\n';
  for (const p of present) csv += `${p.index_number},${p.name},${p.programme || ''},present,${p.timestamp}\n`;
  for (const a of absent) csv += `${a.index_number},${a.name},${a.programme || ''},absent,\n`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="session-${req.params.id}-report.csv"`);
  res.send(csv);
});

module.exports = router;
