# Classroom Attendance System (Fingerprint-based)

A university project: an ESP32 + AS608 fingerprint sensor captures attendance and reports it
to a hosted backend API, which a lecturer dashboard uses to show live attendance and export
reports.

## Live deployment

- **Dashboard / API:** https://attendance-system-production-eb6e.up.railway.app
- Hosted on Railway, with a persistent volume so the SQLite database survives restarts and
  redeploys.
- Redeploy after any change to `server/` with: `cd server && railway up`

## Components

- **`biometric.ino`** — ESP32 firmware. Enrolls/matches fingerprints on the AS608, shows status
  on a 16x2 I2C LCD, and POSTs a match to the hosted backend over WiFi/HTTPS.
- **`server/`** — Node.js/Express backend + SQLite database (using Node's built-in `node:sqlite`,
  no native build step required). Exposes the REST API used by both the firmware and dashboard.
- **`server/public/`** — Static lecturer/admin dashboard (served by the backend) for managing
  students, courses, devices, and running live attendance sessions.

## Setup order

### 1. Open the dashboard

Go to https://attendance-system-production-eb6e.up.railway.app — no local server needed since
it's already hosted.

To run it locally instead (e.g. for development without touching the live deployment):

```bash
cd server
npm install
npm start   # http://localhost:3000
```

### 2. Register a device (Devices tab)

Give it a label like "Room 204 ESP32". This generates an **API key** — copy it.

### 3. Add courses and students

Adding a student auto-assigns a **fingerprint slot ID** — note it down, you'll enroll that
exact ID on the sensor next. Enroll students into courses from the Students tab.

### 4. Configure and flash the firmware

In `biometric.ino`, fill in:

```cpp
const char* WIFI_SSID = "...";
const char* WIFI_PASSWORD = "...";
const char* SERVER_URL = "https://attendance-system-production-eb6e.up.railway.app/api/attendance";
const char* DEVICE_API_KEY = "...";  // from step 2
```

Since the backend is hosted online, the ESP32 just needs any working WiFi with internet access —
no need to match networks with a particular computer.

**Libraries required** (Arduino IDE → Manage Libraries): `Adafruit Fingerprint Sensor`,
`LiquidCrystal I2C` (Frank de Brabander), `ArduinoJson`, plus the ESP32 board package.

Flash the sketch, then open the Serial Monitor at 115200 baud. Use the `e` command to enroll
each student's fingerprint under the slot ID the dashboard assigned them — the LCD walks
through each step too.

### 5. Run a session

In the dashboard's Sessions tab, pick a course + device and click **Start Session**. As students
scan their fingerprint on the sensor, they appear in the live "Present" list (and the LCD shows
"Welcome!" + their name). End the session when done, and export a CSV report.

## Notes

- The sensor stores only a fingerprint **template** on-device, never a raw image — the network
  only ever sees an integer slot ID.
- The firmware uses `WiFiClientSecure` with `setInsecure()` for HTTPS (skips certificate
  validation) — a reasonable simplification for a class project, not for production use.
- The ESP32 brownout detector is **enabled** (the earlier diagnostic disable was removed). If
  the board resets unexpectedly during a scan, that's the brownout detector doing its job —
  it means the power supply (LCD + sensor + WiFi drawing together) still isn't stable enough
  and needs the external 5V supply / capacitor fix, not a firmware change.
- Fingerprint template slots are allocated by scanning for the first free ID (`loadModel()`
  probing), not `templateCount + 1` — the latter breaks after any out-of-order deletion and
  can silently overwrite another student's template.
- Enrollment steps and finger-release detection are timeout-bounded (10s) so the device can't
  hang indefinitely if someone walks away mid-scan.
- The Railway deployment's SQLite file lives on a persistent volume at `/data/attendance.db`
  (see `DB_PATH` env var), independent of the app code — redeploys don't wipe it.
