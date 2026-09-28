const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'attendance.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    index_number TEXT UNIQUE NOT NULL,
    programme TEXT,
    fingerprint_slot_id INTEGER UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    student_id INTEGER NOT NULL REFERENCES students(id),
    course_id INTEGER NOT NULL REFERENCES courses(id),
    PRIMARY KEY (student_id, course_id)
  );

  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL REFERENCES courses(id),
    device_id INTEGER NOT NULL REFERENCES devices(id),
    start_time TEXT NOT NULL,
    end_time TEXT,
    status TEXT NOT NULL DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    timestamp TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'present',
    UNIQUE(student_id, session_id)
  );
`);

// Migrate existing databases created before index_number/programme existed.
const studentColumns = db.prepare('PRAGMA table_info(students)').all().map((c) => c.name);
if (studentColumns.includes('matric_number') && !studentColumns.includes('index_number')) {
  db.exec('ALTER TABLE students RENAME COLUMN matric_number TO index_number');
}
if (!studentColumns.includes('programme')) {
  db.exec('ALTER TABLE students ADD COLUMN programme TEXT');
}

module.exports = db;
