-- ====================================================================
-- IDH / NIID SMART HOSPITAL SYSTEM - EXTENDED SCHEMA
-- Compatible with MySQL 5.7+ / MariaDB 10.4+ / XAMPP phpMyAdmin
-- ====================================================================

CREATE DATABASE IF NOT EXISTS `hospital_queue_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `hospital_queue_db`;

-- 1. Departments
CREATE TABLE IF NOT EXISTS `departments` (
  `id` VARCHAR(64) PRIMARY KEY,
  `code` VARCHAR(32) UNIQUE NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `description` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Clinics
CREATE TABLE IF NOT EXISTS `clinics` (
  `id` VARCHAR(64) PRIMARY KEY,
  `department_id` VARCHAR(64) NOT NULL,
  `code` VARCHAR(32) UNIQUE NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `clinic_head_doctor_id` VARCHAR(64) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Consultation / Examination Rooms
CREATE TABLE IF NOT EXISTS `rooms` (
  `id` VARCHAR(64) PRIMARY KEY,
  `room_number` VARCHAR(32) UNIQUE NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `department_id` VARCHAR(64) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Patients (Longitudinal Hospital Record)
CREATE TABLE IF NOT EXISTS `patients` (
  `id` VARCHAR(64) PRIMARY KEY,
  `hospital_number` VARCHAR(32) UNIQUE NOT NULL, -- e.g. PAT-000123
  `name` VARCHAR(128) NOT NULL,
  `dob` DATE NOT NULL,
  `gender` VARCHAR(16) NOT NULL,
  `phone` VARCHAR(32) NOT NULL,
  `blood_group` VARCHAR(8) DEFAULT NULL,
  `allergies` TEXT DEFAULT NULL,
  `address` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. System Users (Admin, Doctor, Patient, Receptionist, Records, Lab)
CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(64) PRIMARY KEY,
  `username` VARCHAR(64) UNIQUE NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `full_name` VARCHAR(128) NOT NULL,
  `role` ENUM('admin', 'doctor', 'patient', 'receptionist', 'records', 'lab') NOT NULL,
  `patient_id` VARCHAR(64) NULL,
  `doctor_id` VARCHAR(64) NULL,
  `status` ENUM('ACTIVE', 'INACTIVE') DEFAULT 'ACTIVE',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. Doctors
CREATE TABLE IF NOT EXISTS `doctors` (
  `id` VARCHAR(64) PRIMARY KEY,
  `user_id` VARCHAR(64) UNIQUE NULL,
  `name` VARCHAR(128) NOT NULL,
  `specialization` VARCHAR(128) NOT NULL,
  `department_id` VARCHAR(64) NOT NULL,
  `default_room_id` VARCHAR(64) NULL,
  `duty_status` ENUM('ON_DUTY', 'ON_BREAK', 'OFF_DUTY') DEFAULT 'OFF_DUTY',
  `current_room_id` VARCHAR(64) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`default_room_id`) REFERENCES `rooms`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`current_room_id`) REFERENCES `rooms`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. Patient Barcodes (Existing Hospital Cards)
CREATE TABLE IF NOT EXISTS `patient_barcodes` (
  `id` VARCHAR(64) PRIMARY KEY,
  `patient_id` VARCHAR(64) NOT NULL,
  `barcode_value` VARCHAR(64) UNIQUE NOT NULL,
  `status` VARCHAR(16) DEFAULT 'ACTIVE',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. Clinic Sessions (Dated Operational Sessions)
CREATE TABLE IF NOT EXISTS `clinic_sessions` (
  `id` VARCHAR(64) PRIMARY KEY,
  `clinic_id` VARCHAR(64) NOT NULL,
  `session_name` VARCHAR(128) NOT NULL,
  `session_code` VARCHAR(32) NOT NULL, -- 'OPD', 'CL-A', etc.
  `session_date` DATE NOT NULL,
  `start_time` VARCHAR(16) NOT NULL,
  `end_time` VARCHAR(16) NOT NULL,
  `capacity` INT DEFAULT 150,
  `state` ENUM('ACTIVE', 'PAUSED', 'COMPLETED') DEFAULT 'ACTIVE',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9. Advance Appointments (Mobile / Staff-Assisted Booking)
CREATE TABLE IF NOT EXISTS `appointments` (
  `id` VARCHAR(64) PRIMARY KEY,
  `reference` VARCHAR(64) UNIQUE NOT NULL, -- APT-20261016-0081
  `patient_id` VARCHAR(64) NOT NULL,
  `session_id` VARCHAR(64) NOT NULL,
  `doctor_id` VARCHAR(64) NULL,
  `source` ENUM('MOBILE', 'PHONE', 'WALK_IN') DEFAULT 'MOBILE',
  `status` ENUM('APPOINTED', 'CHECKED_IN', 'CANCELLED', 'MISSED', 'RESCHEDULED') DEFAULT 'APPOINTED',
  `cancellation_reason` TEXT NULL,
  `scheduled_time` VARCHAR(16) DEFAULT '09:00',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`session_id`) REFERENCES `clinic_sessions`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 10. Hospital Visits / Encounters
CREATE TABLE IF NOT EXISTS `visits` (
  `id` VARCHAR(64) PRIMARY KEY,
  `visit_reference` VARCHAR(64) UNIQUE NOT NULL, -- VIS-0001
  `patient_id` VARCHAR(64) NOT NULL,
  `appointment_id` VARCHAR(64) NULL,
  `session_id` VARCHAR(64) NOT NULL,
  `arrival_time` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`session_id`) REFERENCES `clinic_sessions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 11. Queue Tokens (Single Active Token Per Visit Per Session)
CREATE TABLE IF NOT EXISTS `queue_tokens` (
  `id` VARCHAR(64) PRIMARY KEY,
  `token_number` VARCHAR(32) NOT NULL, -- OPD-001, CL-A-001
  `token_seq` INT NOT NULL,
  `session_id` VARCHAR(64) NOT NULL,
  `visit_id` VARCHAR(64) NOT NULL,
  `patient_id` VARCHAR(64) NOT NULL,
  `priority` INT DEFAULT 1, -- 1=standard, 2=priority, 3=emergency
  `status` ENUM('WAITING', 'ASSIGNED', 'CALLED', 'IN_CONSULTATION', 'COMPLETED', 'MISSED', 'DEFERRED', 'CANCELLED') DEFAULT 'WAITING',
  `doctor_id` VARCHAR(64) NULL,
  `room_id` VARCHAR(64) NULL,
  `issued_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `assigned_at` DATETIME NULL,
  `called_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `reprint_count` INT DEFAULT 0,
  UNIQUE KEY `uk_session_seq` (`session_id`, `token_seq`),
  FOREIGN KEY (`session_id`) REFERENCES `clinic_sessions`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 12. Queue Events & Audit Trail
CREATE TABLE IF NOT EXISTS `queue_events` (
  `id` VARCHAR(64) PRIMARY KEY,
  `token_id` VARCHAR(64) NOT NULL,
  `session_id` VARCHAR(64) NOT NULL,
  `actor_id` VARCHAR(64) NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `reason` TEXT NULL,
  `timestamp` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`token_id`) REFERENCES `queue_tokens`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 13. Clinical Consultations
CREATE TABLE IF NOT EXISTS `consultations` (
  `id` VARCHAR(64) PRIMARY KEY,
  `visit_id` VARCHAR(64) NOT NULL,
  `patient_id` VARCHAR(64) NOT NULL,
  `doctor_id` VARCHAR(64) NOT NULL,
  `symptoms` TEXT,
  `diagnosis` VARCHAR(255),
  `clinical_notes` TEXT,
  `recommendations` TEXT,
  `follow_up_advice` TEXT,
  `started_at` DATETIME NULL,
  `completed_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 14. Prescriptions
CREATE TABLE IF NOT EXISTS `prescriptions` (
  `id` VARCHAR(64) PRIMARY KEY,
  `consultation_id` VARCHAR(64) NOT NULL,
  `item_name` VARCHAR(128) NOT NULL,
  `dosage` VARCHAR(64) NOT NULL,
  `frequency` VARCHAR(64) NOT NULL,
  `duration` VARCHAR(64) NOT NULL,
  `instructions` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`consultation_id`) REFERENCES `consultations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 15. Laboratory Requests & Results Workflow
CREATE TABLE IF NOT EXISTS `lab_requests` (
  `id` VARCHAR(64) PRIMARY KEY,
  `consultation_id` VARCHAR(64) NOT NULL,
  `patient_id` VARCHAR(64) NOT NULL,
  `doctor_id` VARCHAR(64) NOT NULL,
  `test_name` VARCHAR(128) NOT NULL,
  `urgency` ENUM('ROUTINE', 'URGENT', 'STAT') DEFAULT 'ROUTINE',
  `status` ENUM('REQUESTED', 'SCHEDULED', 'SAMPLE_COLLECTED', 'IN_PROGRESS', 'RESULT_PENDING_REVIEW', 'RESULT_RELEASED', 'CANCELLED') DEFAULT 'REQUESTED',
  `results` TEXT NULL,
  `verified_by` VARCHAR(64) NULL,
  `verified_at` DATETIME NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`consultation_id`) REFERENCES `consultations`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 16. Patient Care Tasks & Care Plan (Section 1.C)
CREATE TABLE IF NOT EXISTS `care_tasks` (
  `id` VARCHAR(64) PRIMARY KEY,
  `patient_id` VARCHAR(64) NOT NULL,
  `doctor_id` VARCHAR(64) NOT NULL,
  `consultation_id` VARCHAR(64) NULL,
  `lab_request_id` VARCHAR(64) NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `task_type` ENUM('LAB_TEST', 'FOLLOW_UP_APPT', 'MEDICATION_REVIEW', 'RECOMMENDATION_ACK', 'OTHER') NOT NULL,
  `due_date` DATE NULL,
  `status` ENUM('PENDING', 'IN_PROGRESS', 'PATIENT_MARKED_COMPLETED', 'AWAITING_VERIFICATION', 'VERIFIED_COMPLETED', 'OVERDUE', 'CANCELLED') DEFAULT 'PENDING',
  `completed_at` DATETIME NULL,
  `verified_by` VARCHAR(64) NULL,
  `verified_at` DATETIME NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`consultation_id`) REFERENCES `consultations`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`lab_request_id`) REFERENCES `lab_requests`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 17. In-App & Mobile Notifications (Section 1.D)
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` VARCHAR(64) PRIMARY KEY,
  `patient_id` VARCHAR(64) NOT NULL,
  `title` VARCHAR(128) NOT NULL,
  `message` TEXT NOT NULL,
  `category` ENUM('APPOINTMENT', 'QUEUE', 'CARE_TASK', 'LAB_RESULT', 'RECOMMENDATION', 'GENERAL') DEFAULT 'GENERAL',
  `reference_id` VARCHAR(64) NULL,
  `is_read` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 18. Audit Logs
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` VARCHAR(64) PRIMARY KEY,
  `actor_id` VARCHAR(64) NOT NULL,
  `actor_role` VARCHAR(32) NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `target_type` VARCHAR(64),
  `target_id` VARCHAR(64),
  `details` TEXT,
  `timestamp` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
