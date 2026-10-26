# HOSPITAL QUEUE MANAGEMENT SYSTEM
### Modern Private Hospital Queue Management & Clinical Portal
*(Inspired by the clean healthcare design aesthetics of Asiri Health)*

An enterprise-grade smart hospital queue routing, multi-doctor concurrent outpatient management, and longitudinal clinical records platform designed for modern private healthcare facilities.

---

## 1. Design & Architecture Overview

### Visual Theme & Navigation (Asiri Health Inspired)
- **Official Brand Heading**: Exactly **`HOSPITAL QUEUE MANAGEMENT SYSTEM`**.
- **Palette**: Clean clinical white (`#ffffff`), deep healthcare navy (`#0e305d`), and modern surgical teal (`#009ca6`).
- **Typography**: Google Font **Plus Jakarta Sans** for modern legibility and **JetBrains Mono** for clear token and barcode rendering.
- **Top Utility Bar**: Hotline, Emergency Care (1990), and 24/7 OPD operating hours.
- **Hero Section**: Photorealistic hospital reception lobby photography, clear value proposition (*"Smarter Hospital Visits, Less Waiting"*), and direct action buttons (*"Book an Appointment"*, *"Check Queue Status"*).
- **Service Cards**: 6 interactive service cards with smooth hover micro-animations and direct page routing:
  1. Doctor Appointments
  2. Patient Registration
  3. Queue Token Generation
  4. Live Queue Status
  5. Doctor Consultation Information
  6. Clinic Information
- **Live Queue Status Section**: Clean interactive board displaying sample and real-time database queue statuses across OPD and specialist clinics.
- **How It Works**: 5-step visual patient journey from hospital card scanning to room entry.

---

## 2. Minimal Thermal Queue Token Printing (Section 7)

When a receptionist checks in a patient, the system formats a clean thermal receipt for **58 mm or 80 mm printers**.

As strictly required, the printed ticket contains **ONLY**:
1. **The queue token number** in large, bold, clearly readable text (e.g. `OPD-001`).
2. **A machine-readable Code 128 barcode** generated specifically for that queue token using `JsBarcode`.

> [!IMPORTANT]
> The print layout completely strips away hospital names, logos, patient names, patient IDs, dates, times, room numbers, and navigation elements using print-specific CSS media queries (`@media print`).

---

## 3. Separate User Roles & Authentication

Passwords are encrypted with **`bcryptjs`**, and API endpoints enforce server-side **JWT role-based access control (RBAC)**:

| Role Portal | Sample Account | Password | Scope & Permitted Actions |
| :--- | :--- | :--- | :--- |
| **Admin Hub** | `admin` | `Admin@123` | Hospital-wide management: register patients, update demographic info, schedule/reschedule/cancel appointments, manage doctor duty rosters, view operational metrics, and review immutable audit logs. |
| **Doctor Console** | `doctor1` to `doctor5` | `Doctor@123` | Scan patient token barcode (USB or keyboard), consultation workspace (record clinical observations, diagnoses, Rx with dosage/frequency, lab requests, recommendations, home advice, care tasks), and review before finalizing. Doctors are strictly restricted from directly modifying protected core identity details (Name, DOB, NIC, Contact). |
| **Patient Portal** | `patient1` | `Patient@123` | Personal active queue token, live wait time calculation, notifications centre, chronological medical history, and **Care Plan / My Tasks** (mark tasks as completed with status advancing to `PATIENT_MARKED_COMPLETED` awaiting staff verification). Patients can never edit diagnoses, prescriptions, or lab results. |
| **Laboratory Station** | `labstaff` | `Staff@123` | Diagnostic pathology station: view doctor test orders, record specimen status, enter official investigation findings, and release verified laboratory results (automatically updating patient care tasks to `VERIFIED_COMPLETED`). |
| **Reception Desk** | `reception` | `Staff@123` | Front-desk card barcode scanner, advance booking check-in, walk-in token issuance, and minimal thermal receipt printing. |

---

## 4. End-to-End Clinical & Investigation Workflow

1. **Doctor Orders Investigation**: During consultation, the doctor orders a diagnostic test (e.g., *Full Blood Count*) and creates follow-up care tasks.
2. **Synchronization**: The care task appears in the authenticated patient's portal, and an in-app notification is dispatched.
3. **Patient Action**: The patient attends the laboratory and marks the task as completed. Per hospital safety rules, the status transitions to `PATIENT_MARKED_COMPLETED` (or `AWAITING_VERIFICATION`), never directly to an official verified result.
4. **Laboratory Verification & Release**: Authorized laboratory personnel (`labstaff`) enter numerical parameters and release the official result (`RESULT_RELEASED`).
5. **Care Plan Verification**: The related care-plan task automatically transitions to `VERIFIED_COMPLETED`, and the patient and doctor portals reflect the released findings with verified pathologist metadata.
6. **Audit Trail**: Every action (patient registration, doctor note, task mark, lab verification, appointment rescheduling) is permanently recorded in `audit_logs`.

---

## 5. Local XAMPP Setup & Database Instructions

### Step 1: Start XAMPP Services
1. Open the **XAMPP Control Panel**.
2. Click **Start** for **Apache** and **MySQL**.
3. Verify that MySQL is running on port `3306`.

### Step 2: Database Schema & Migration
The complete SQL schema is located at:
[`c:\xampp\htdocs\HospitalQueue\database\schema.sql`](file:///c:/xampp/htdocs/HospitalQueue/database/schema.sql)

Database tables include:
- `users`, `departments`, `rooms`, `doctors`, `patients`, `patient_barcodes`
- `clinic_sessions`, `appointments`, `queue_tokens`
- `consultations`, `prescriptions`, `lab_requests`
- `care_tasks`, `notifications`, `audit_logs`

### Step 3: Run the Application
Open a terminal in the project directory:
```bash
npm start
```
Open your browser and visit:
- **Local Application**: `http://localhost:3000`
- **Ngrok Public Tunnel**: `https://crimson-player-sassy.ngrok-free.dev`

---

## 6. Verification & Acceptance Criteria Status

- [x] **Patient Portal & Medical History**: Authenticated dashboard displaying personal appointments, active token, chronological medical history, and care-plan tasks. Cross-patient data access is strictly blocked at the backend API layer.
- [x] **Care Plan & Task Completion**: Patients can mark eligible tasks as `PATIENT_MARKED_COMPLETED`. Result verification is restricted to authorized laboratory/medical personnel.
- [x] **Mobile In-App Notifications**: Real-time notifications for appointment changes, queue updates, new recommendations, lab test requests, and verification releases.
- [x] **Doctor Barcode Scanner**: Doctor workstation supports USB/keyboard barcode scanning of patient tokens (`OPD-001`), immediately loading the patient's verified records and allergies.
- [x] **Integrated Consultation Workspace**: Integrated interface for observations, diagnoses, prescriptions (item, dose, frequency, duration), lab orders, home recommendations, and follow-up advice with pre-finalization review.
- [x] **Doctor Role Security Boundary**: Medical staff are barred from editing core patient demographic details, with a controlled "Request Correction to Admin" workflow.
- [x] **Admin Operations Hub**: Patient registration, demographic profile editing, appointment rescheduling/cancellation with reason tracking, doctor duty rosters, and real-time operational overview metrics.
- [x] **Connected Laboratory Workflow**: Diagnostic pathology station where `labstaff` inputs and releases verified lab results, triggering automated task verification and patient notification.
- [x] **Thermal Printing Integrity**: Section 7 compliance strictly preserved (prints **ONLY** token number + Code 128 barcode).
