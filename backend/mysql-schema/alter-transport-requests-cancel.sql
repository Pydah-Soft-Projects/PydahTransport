-- Add cancellation support to transport_requests.
-- Run once on MySQL student_database.

USE student_database;

ALTER TABLE transport_requests
  MODIFY COLUMN status ENUM('pending', 'approved', 'rejected', 'cancelled') DEFAULT 'pending';

ALTER TABLE transport_requests
  ADD COLUMN cancellation_reason TEXT NULL AFTER status,
  ADD COLUMN cancelled_at TIMESTAMP NULL AFTER cancellation_reason;
