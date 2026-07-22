-- Add expired status support to transport_requests.
-- Run once on MySQL student_database.

USE student_database;

ALTER TABLE transport_requests
  MODIFY COLUMN status ENUM('pending', 'approved', 'rejected', 'cancelled', 'expired') DEFAULT 'pending';
