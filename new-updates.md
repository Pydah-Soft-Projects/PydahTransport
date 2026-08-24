# Offline QR Verification PWA — Implementation Specification

## 1. Project Objective

Enhance the existing Transport Management Application to support **offline QR verification**.

The existing application generates QR codes for transport/student verification. Currently, scanning the QR redirects the user to the Transport website, which requires an internet connection to communicate with the backend/database.

The new requirement is to build an **offline-capable QR Verification PWA**.

The system must support:

1. Online QR verification using the existing backend.
2. Offline QR scanning and verification.
3. Cryptographic verification of QR authenticity without internet.
4. Local transport/student data using IndexedDB.
5. Synchronization between the local PWA database and the backend.
6. Offline scan logging.
7. Synchronization of offline scan logs when internet connectivity returns.
8. The existing public QR verification flow must continue working.

---

# 2. Important Architectural Decision

Do NOT replace the existing Transport Application.

Add a dedicated lightweight **QR Verification module/PWA**.

The recommended architecture is:

```text
Existing Transport Application
        |
        | Node.js / Express API
        |
        +----------------------+
        |                      |
        v                      v
      MySQL               QR Generator
                               |
                         Private Key
                               |
                               v
                        Signed QR Code
                               |
                               v
                    QR Verification PWA
                               |
              +----------------+----------------+
              |                                 |
              v                                 v
        Public Key                        IndexedDB
              |                                 |
              +----------------+----------------+
                               |
                           QR Scanner
                               |
                 +-------------+-------------+
                 |                           |
             Internet                     Offline
                 |                           |
                 v                           v
          Backend Verify              Local Verify
                 |                           |
                 +-------------+-------------+
                               |
                               v
                         Verification Result
```

---

# 3. High-Level Requirements Checklist

## Phase 1 — PWA Foundation

* [ ] Create/install PWA support for the verification module.
* [ ] Make the verification page installable on supported mobile browsers.
* [ ] Add application manifest.
* [ ] Add service worker.
* [ ] Cache all required application assets.
* [ ] Ensure the verification UI loads without internet after initial installation/cache.
* [ ] Add online/offline connectivity indicator.
* [ ] Add last synchronization timestamp.
* [ ] Do NOT cache sensitive API responses through an uncontrolled HTTP cache.
* [ ] Use explicit application-level IndexedDB storage.

---

# 4. Phase 2 — QR Generation

Modify the existing QR-generation logic.

The QR must no longer rely exclusively on a server URL for verification.

The QR must contain a **signed payload**.

Example conceptual payload:

```json
{
  "version": 1,
  "studentId": "12345",
  "transportId": "TRP123",
  "academicYear": "2026",
  "routeId": "R12",
  "busId": "BUS07",
  "validUntil": "2027-03-31",
  "signature": "..."
}
```

The actual payload should be optimized/encoded so that the QR remains reasonably compact.

Checklist:

* [ ] Define QR payload version.
* [ ] Define mandatory fields.
* [ ] Define optional fields.
* [ ] Implement canonical serialization of payload.
* [ ] Generate digital signature on backend.
* [ ] Add signature to QR payload.
* [ ] Keep private signing key only on backend.
* [ ] Never expose private key to frontend.
* [ ] Generate QR from the signed payload.
* [ ] Maintain backward compatibility with existing QR codes where practical.

---

# 5. Cryptographic Design

Use asymmetric cryptography.

Recommended model:

```text
Private Key
    |
    | kept only on backend
    v
Node.js QR Generator
    |
    v
Digital Signature
```

The PWA receives only:

```text
Public Key
```

The PWA uses the public key to verify the signature.

Example:

```text
Payload
   +
Signature
   |
   v
Public Key
   |
   v
VALID / INVALID
```

## Security Rules

* [ ] Generate a secure asymmetric key pair.
* [ ] Store private key securely on backend/server.
* [ ] Never commit private key to Git.
* [ ] Never place private key in `.env` committed to repository.
* [ ] Never send private key to frontend.
* [ ] Public key may be bundled with the PWA.
* [ ] Support key versioning/key IDs.
* [ ] QR payload must include a version.
* [ ] QR signature must cover all security-sensitive fields.
* [ ] Reject modified payloads.
* [ ] Reject invalid signatures.
* [ ] Reject expired QR codes if expiration is included.
* [ ] Reject unsupported payload versions.

Prefer a modern asymmetric signature algorithm such as **Ed25519**, provided browser and Node.js support are confirmed for the selected implementation.

---

# 6. QR Payload Design

Do not put unnecessary personal information into the QR.

Prefer a compact structure.

Example:

```json
{
  "v": 1,
  "kid": "2026-01",
  "sid": "12345",
  "tid": "TRP123",
  "ay": "2026",
  "exp": "2027-03-31",
  "sig": "..."
}
```

Where:

* `v` = QR payload version
* `kid` = key ID/version
* `sid` = student ID
* `tid` = transport assignment/transport ID
* `ay` = academic year
* `exp` = expiration date
* `sig` = digital signature

Do not include unnecessary:

* Parent phone numbers
* Addresses
* Sensitive personal information
* Passwords
* Internal credentials
* Authentication tokens

If additional information is required for display, retrieve it from IndexedDB or the backend.

---

# 7. Phase 3 — QR Scanner

Implement QR scanning inside the Verification PWA.

Requirements:

* [ ] Use device camera.
* [ ] Request camera permission properly.
* [ ] Provide clear camera permission error.
* [ ] Allow scanning using rear camera where available.
* [ ] Detect QR codes.
* [ ] Decode payload.
* [ ] Validate payload structure.
* [ ] Validate QR version.
* [ ] Extract signature.
* [ ] Verify signature.
* [ ] Display result.

Expected flow:

```text
Open Verification PWA
        |
        v
     Scan QR
        |
        v
Decode QR
        |
        v
Validate structure
        |
        v
Verify signature
        |
        +----------------------+
        |                      |
      VALID                  INVALID
        |                      |
        v                      v
Check local data          Show INVALID
        |                  / TAMPERED
        v
Display result
```

---

# 8. Phase 4 — IndexedDB Local Database

Use **IndexedDB** for offline application data.

Do not use localStorage as the primary database.

Recommended stores:

```text
IndexedDB
|
+-- students
|
+-- transportAssignments
|
+-- routes
|
+-- buses
|
+-- stops
|
+-- syncMetadata
|
+-- offlineScans
```

The exact stores should be determined from the existing Transport application's database/API structure.

---

# 9. Local Student/Transport Data

The PWA should not necessarily download the entire production database.

Only download the data required for verification.

For example:

```text
studentId
studentName
transportStatus
transportId
routeId
routeName
busId
busNumber
pickupPoint
academicYear
validFrom
validUntil
lastUpdated
```

Avoid storing unnecessary personal information.

---

# 10. Synchronization

Create a synchronization mechanism.

When the device has internet:

```text
PWA
 |
 | GET sync API
 v
Node.js Backend
 |
 v
MySQL
 |
 v
Required Transport Data
 |
 v
IndexedDB
```

The PWA should maintain:

```text
lastSyncAt
```

Example:

```text
Last synchronized:
24-Aug-2026 08:15 AM
```

Checklist:

* [ ] Detect network availability.
* [ ] Implement initial sync.
* [ ] Implement manual sync.
* [ ] Implement automatic sync when application opens.
* [ ] Update only changed records where possible.
* [ ] Store synchronization timestamp.
* [ ] Handle failed synchronization.
* [ ] Prevent duplicate data.
* [ ] Handle deleted/inactive records.
* [ ] Display synchronization status.

---

# 11. Offline Verification

When internet is unavailable:

```text
Scan QR
   |
   v
Verify digital signature
   |
   v
Find student/transport data in IndexedDB
   |
   v
Check locally available status
   |
   v
Display result
```

Example:

```text
--------------------------------
        QR VERIFIED
--------------------------------

Student:
Durga Prasad

Admission No:
12345

Route:
R12

Bus:
AP05XX1234

Transport Status:
ACTIVE

Verification:
Offline

Last Sync:
24-Aug-2026 08:15 AM
--------------------------------
```

---

# 12. Important Offline Limitation

The system MUST clearly communicate that offline verification uses the **last synchronized data**.

Example:

```text
⚠ Offline Verification

Data last synchronized:
24-Aug-2026 08:15 AM
```

Do NOT claim that the system knows the real-time server status while offline.

Example scenario:

```text
08:15 AM
Student = ACTIVE
        |
        v
PWA syncs

09:00 AM
Admin cancels transport
        |
        v
PWA has no internet
```

The PWA cannot know about the 09:00 AM cancellation.

Therefore, display:

```text
Verified using data synchronized at 08:15 AM.
```

---

# 13. Online Verification

When internet is available, prefer real-time server verification.

Flow:

```text
Scan QR
   |
   v
Local cryptographic verification
   |
   v
Backend verification
   |
   v
Latest MySQL data
   |
   v
Final result
```

This gives the best accuracy.

Possible result:

```text
ONLINE VERIFIED
```

---

# 14. Offline Verification

When internet is unavailable:

```text
Scan QR
   |
   v
Cryptographic verification
   |
   v
IndexedDB lookup
   |
   v
Offline result
```

Display:

```text
OFFLINE VERIFIED
```

along with:

```text
Last Sync: <timestamp>
```

---

# 15. Offline Scan Logging

Every scan should optionally be recorded locally.

Example:

```json
{
  "scanId": "local-generated-id",
  "studentId": "12345",
  "transportId": "TRP123",
  "verificationResult": "VALID",
  "mode": "OFFLINE",
  "scannedAt": "2026-08-24T08:35:22",
  "deviceId": "BUS-07",
  "synced": false
}
```

Store this in:

```text
offlineScans
```

When internet returns:

```text
IndexedDB
   |
   v
POST /api/verification/offline-scans
   |
   v
Node.js
   |
   v
MySQL
```

Checklist:

* [ ] Generate unique local scan ID.
* [ ] Store scan timestamp.
* [ ] Store verification result.
* [ ] Store online/offline mode.
* [ ] Store device identifier if required.
* [ ] Prevent duplicate uploads.
* [ ] Mark records as synchronized.
* [ ] Retry failed uploads.

---

# 16. Device Identification

If scan logs are required, consider assigning each verification device a unique identifier.

Example:

```text
BUS-07
SECURITY-GATE-01
TRANSPORT-OFFICE-02
```

Do not use sensitive device information unnecessarily.

The device ID should be generated/assigned during setup.

---

# 17. Backend API Design

Adapt endpoint names to the existing API conventions.

Suggested APIs:

```text
GET /api/verification/sync
```

Purpose:

Return the minimum transport data required by the PWA.

---

```text
POST /api/verification/offline-scans
```

Purpose:

Synchronize locally stored offline scans.

---

```text
POST /api/verification/verify
```

Purpose:

Optional online verification endpoint.

---

```text
GET /api/verification/public-key
```

Purpose:

Optional endpoint for retrieving the current public key.

However, the public key should preferably be bundled/configured safely inside the PWA and versioned.

---

# 18. Public QR Verification

Do NOT remove the existing public verification functionality.

There should be two possible flows.

## Normal public user

```text
Google Lens / Phone Camera
        |
        v
Existing QR URL
        |
        v
Transport Website
        |
        v
Backend
        |
        v
Online Verification
```

## Authorized offline verifier

```text
Verification PWA
        |
        v
Camera
        |
        v
Signed QR
        |
        v
Offline Verification
```

Both flows must coexist.

---

# 19. PWA Offline Caching

Use a service worker to cache the application shell.

Cache:

* HTML
* JavaScript
* CSS
* icons
* QR scanner dependencies
* verification code
* public key/configuration

Do NOT blindly cache:

* authenticated API responses
* sensitive backend responses
* dynamic user-specific pages

Transport data should be stored explicitly in IndexedDB.

---

# 20. Connectivity Handling

The UI must clearly show the current state.

Example:

```text
🟢 Online
```

or:

```text
🟠 Offline
```

Example:

```text
--------------------------------
Transport Verify

🟠 Offline

Last Sync:
24-Aug-2026 08:15 AM

[ Scan QR ]
--------------------------------
```

When internet returns:

```text
🟢 Online

Synchronizing...

Sync completed
Last Sync:
24-Aug-2026 09:02 AM
```

---

# 21. Error Handling

The following cases must have explicit handling.

## Invalid QR

```text
❌ Invalid QR
```

## Tampered QR

```text
❌ QR verification failed
The QR signature is invalid.
```

## Expired QR

```text
❌ QR expired
```

## Unsupported QR version

```text
❌ Unsupported QR version
Please update the verification application.
```

## Student not found locally

```text
⚠ Student data unavailable offline

Connect to the internet and synchronize data.
```

## No internet

Do not show a generic API error.

Show:

```text
🟠 Device is offline

Offline verification is being used.
```

---

# 22. Security Requirements

These requirements are mandatory.

* [ ] Private key must exist only on backend.
* [ ] Never expose private key in frontend.
* [ ] Never commit private key to Git.
* [ ] Use environment/secret management for private key.
* [ ] Use HTTPS for all online communication.
* [ ] Validate every QR payload.
* [ ] Validate signature before trusting payload fields.
* [ ] Validate expiration.
* [ ] Validate QR version.
* [ ] Support key rotation.
* [ ] Use a key ID (`kid`) in the payload.
* [ ] Prevent replay where appropriate.
* [ ] Do not store unnecessary sensitive information in QR.
* [ ] Do not trust client-provided verification results on the backend.
* [ ] Authenticate the offline-scan synchronization endpoint appropriately.
* [ ] Validate uploaded offline scan records server-side.

---

# 23. Key Rotation

Do not design the system assuming the signing key will never change.

Use:

```text
kid = "2026-01"
```

For example:

```text
QR
 |
 +-- kid = 2026-01
 |
 +-- signature
```

The PWA can contain:

```text
Public Keys
|
+-- 2026-01
+-- 2026-02
```

When a new private key is introduced:

```text
Old QR
 ↓
Old public key
 ↓
Still valid
```

New QR:

```text
New QR
 ↓
New public key
 ↓
Valid
```

Define a safe retirement policy for old keys.

---

# 24. Database/API Efficiency

Do not download the entire student database to every device.

The synchronization API should return only the required records.

If the Transport database contains hundreds of thousands of students, design synchronization carefully.

Possible approaches:

### Option A — Device-specific data

Download only students assigned to a particular bus/device.

### Option B — Route-specific data

Download only students belonging to selected routes.

### Option C — Full transport dataset

Only use this if the dataset is sufficiently small.

Prefer incremental synchronization:

```text
lastSyncAt
     |
     v
Return records changed after lastSyncAt
```

---

# 25. Recommended PWA Screens

The Verification PWA should be intentionally simple.

## Screen 1 — Home

```text
Transport Verification

🟢 Online

Last Sync:
24-Aug-2026 08:15 AM

[ Scan QR ]

[ Sync Now ]
```

## Screen 2 — Scanner

```text
Scan Transport QR

+----------------------+
|                      |
|      CAMERA          |
|                      |
|                      |
+----------------------+

Point camera at QR code
```

## Screen 3 — Result

```text
✓ VALID QR

Student:
Durga Prasad

Admission No:
12345

Route:
R12

Bus:
AP05XX1234

Status:
ACTIVE

Verification:
OFFLINE

Last Sync:
08:15 AM
```

## Screen 4 — Settings

```text
Device ID
BUS-07

Last Sync
08:15 AM

Data Records
1,245

[ Sync Now ]

Application Version
1.0.0
```

---

# 26. Recommended Development Sequence

Implement in this exact order.

## Step 1 — Understand Existing QR System

* [ ] Inspect current QR generation.
* [ ] Identify current QR payload.
* [ ] Identify current verification URL.
* [ ] Identify current verification API.
* [ ] Identify student/transport tables.
* [ ] Identify current frontend structure.
* [ ] Identify authentication/authorization requirements.
* [ ] Do not modify existing behavior yet.

## Step 2 — Create Verification Module

* [ ] Create `/verify` route/module.
* [ ] Create dedicated verification UI.
* [ ] Make it mobile-friendly.
* [ ] Add PWA configuration.

## Step 3 — Add QR Scanner

* [ ] Camera access.
* [ ] QR detection.
* [ ] Payload parsing.
* [ ] Error handling.

## Step 4 — Implement Signing

Backend:

```text
Generate Key Pair
       ↓
Private Key → Backend
Public Key → PWA
```

Then:

```text
Payload
 ↓
Sign
 ↓
QR
```

## Step 5 — Implement Offline Signature Verification

PWA:

```text
QR
 ↓
Decode
 ↓
Public Key
 ↓
Verify
 ↓
VALID / INVALID
```

At this point, cryptographic verification should work without internet.

## Step 6 — Implement IndexedDB

* [ ] Create local schema.
* [ ] Store required transport data.
* [ ] Read records locally.
* [ ] Display local information.

## Step 7 — Implement Synchronization

* [ ] Initial sync.
* [ ] Incremental sync.
* [ ] Manual sync.
* [ ] Automatic sync.
* [ ] Last sync timestamp.

## Step 8 — Offline Scan Logs

* [ ] Local scan storage.
* [ ] Sync queue.
* [ ] Backend upload.
* [ ] Retry mechanism.
* [ ] Duplicate prevention.

## Step 9 — Testing

Test:

* [ ] Internet available.
* [ ] Internet disconnected.
* [ ] Wi-Fi disconnected.
* [ ] Mobile data disconnected.
* [ ] Valid QR.
* [ ] Modified QR.
* [ ] Expired QR.
* [ ] Unknown QR.
* [ ] Old QR.
* [ ] New QR.
* [ ] Missing local student data.
* [ ] Stale local data.
* [ ] Failed synchronization.
* [ ] Application restart while offline.
* [ ] Device restart while offline.
* [ ] Multiple scans offline.
* [ ] Sync after reconnecting.

---

# 27. Acceptance Criteria

The implementation is considered complete only when all of the following work.

### AC-01 — Online Verification

A user can scan a valid QR and verify the student through the existing online system.

### AC-02 — PWA Installation

An authorized verifier can install the Verification PWA on a supported mobile device.

### AC-03 — Offline Application

After installation and initial loading, the Verification PWA opens without internet.

### AC-04 — Offline QR Scan

A QR can be scanned without internet.

### AC-05 — Offline Signature Verification

The PWA can determine whether the QR signature is valid without contacting the backend.

### AC-06 — Tamper Detection

Changing any signed field causes verification to fail.

### AC-07 — Local Student Data

The PWA can display locally synchronized transport/student information while offline.

### AC-08 — Last Sync

The UI displays when the local data was last synchronized.

### AC-09 — Offline Logging

Offline scans are stored locally.

### AC-10 — Automatic Synchronization

Offline scan records are uploaded when connectivity returns.

### AC-11 — Existing System Compatibility

Existing online QR verification must continue working.

### AC-12 — Security

The private signing key is never exposed to the frontend or included in the client build.

---

# 28. Important Development Rules for the Coding Agent

Before modifying code:

1. Inspect the existing project structure.
2. Identify the existing QR generation implementation.
3. Identify the existing QR verification implementation.
4. Identify the relevant database tables/models.
5. Identify the existing API conventions.
6. Identify the existing authentication mechanism.
7. Identify the existing frontend build system.
8. Identify whether the project uses Vite, CRA, Next.js, or another setup.

Do NOT blindly create duplicate systems.

Reuse existing:

* API utilities
* authentication
* database models
* UI components
* validation utilities
* QR generation code
* existing transport entities

where appropriate.

---

# 29. Do Not Break Existing Functionality

The existing Transport Application must continue functioning.

Do not:

* remove existing QR URLs
* remove existing verification pages
* modify unrelated modules
* change production database schemas unnecessarily
* expose private keys
* introduce unnecessary dependencies
* download the entire database without evaluating data size
* store sensitive information unnecessarily
* assume internet availability

Implement the new functionality incrementally.

---

# 30. Expected Final Architecture

The final system should provide:

```text
                    QR GENERATION
                         |
                         v
                  Signed QR Code
                         |
          +--------------+--------------+
          |                             |
          v                             v
    Public User                    Staff/Verifier
          |                             |
    Google Lens                   Verification PWA
          |                             |
       Internet                   Online / Offline
          |                             |
          v                    +--------+--------+
    Existing Website           |                 |
          |                 Online            Offline
          v                    |                 |
       Backend                 v                 v
          |              Backend Verify    Public Key +
          v                              IndexedDB
        MySQL                                  |
                                               v
                                      Offline Verification
```

The final goal is **not simply "make the website work offline."**

The goal is to create a **secure offline verification capability** consisting of:

```text
Signed QR
+
Verification PWA
+
Public-key cryptography
+
IndexedDB
+
Synchronization
+
Offline scan queue
+
Existing online verification
```

This architecture allows the Transport Application to continue working normally online while authorized verification devices can verify QR codes even when there is no internet connection.
