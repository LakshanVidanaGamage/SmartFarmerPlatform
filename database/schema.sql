-- Fresh-install schema for the Smart Farmer Platform.
-- Run this file against a MySQL account with CREATE DATABASE privileges.

CREATE DATABASE IF NOT EXISTS smart_farmer_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE smart_farmer_db;

-- Accounts are created only after registration email verification.
CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    full_name VARCHAR(151) NOT NULL,
    email VARCHAR(254) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('farmer', 'buyer', 'admin') NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_users_email (email),
    UNIQUE KEY uq_users_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Temporary registration records do not become users until OTP verification.
CREATE TABLE IF NOT EXISTS pending_registrations (
    registration_id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(254) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('farmer', 'buyer') NOT NULL,
    otp_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    otp_expires_at DATETIME NOT NULL,
    otp_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    last_otp_sent_at DATETIME NOT NULL,

    UNIQUE KEY uq_pending_registrations_email (email),
    UNIQUE KEY uq_pending_registrations_phone (phone),
    KEY idx_pending_registrations_expiry (otp_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One current password-reset OTP/token record per account.
CREATE TABLE IF NOT EXISTS password_reset_otps (
    reset_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    otp_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    otp_expires_at DATETIME NOT NULL,
    otp_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    last_otp_sent_at DATETIME NOT NULL,
    reset_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    reset_token_expires_at DATETIME NULL,

    UNIQUE KEY uq_password_reset_user (user_id),
    UNIQUE KEY uq_password_reset_token (reset_token_hash),
    CONSTRAINT fk_password_reset_user
        FOREIGN KEY (user_id) REFERENCES users(user_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Crop categories are optional on a produce listing in the current app.
CREATE TABLE IF NOT EXISTS categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    category_name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Produce listings created by farmers.
CREATE TABLE IF NOT EXISTS produce (
    produce_id INT AUTO_INCREMENT PRIMARY KEY,
    farmer_id INT NOT NULL,
    category_id INT,
    produce_name VARCHAR(100) NOT NULL,
    description TEXT,
    quantity DECIMAL(10,2) NOT NULL,
    unit VARCHAR(20) NOT NULL DEFAULT 'kg',
    price_per_unit DECIMAL(10,2) NOT NULL,
    district VARCHAR(100) NOT NULL,
    available TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_produce_farmer
        FOREIGN KEY (farmer_id) REFERENCES users(user_id),
    CONSTRAINT fk_produce_category
        FOREIGN KEY (category_id) REFERENCES categories(category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daily market prices.
CREATE TABLE IF NOT EXISTS market_prices (
    price_id INT AUTO_INCREMENT PRIMARY KEY,
    produce_name VARCHAR(100) NOT NULL,
    market_name VARCHAR(100) NOT NULL,
    district VARCHAR(100),
    price_per_kg DECIMAL(10,2) NOT NULL,
    price_date DATE NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Offers sent by buyers to farmers.
CREATE TABLE IF NOT EXISTS offers (
    offer_id INT AUTO_INCREMENT PRIMARY KEY,
    produce_id INT NOT NULL,
    buyer_id INT NOT NULL,
    farmer_id INT NOT NULL,
    offered_price DECIMAL(10,2) NOT NULL,
    quantity DECIMAL(10,2) NOT NULL,
    status ENUM(
        'pending',
        'accepted',
        'rejected',
        'cancelled'
    ) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_offers_produce
        FOREIGN KEY (produce_id) REFERENCES produce(produce_id),
    CONSTRAINT fk_offers_buyer
        FOREIGN KEY (buyer_id) REFERENCES users(user_id),
    CONSTRAINT fk_offers_farmer
        FOREIGN KEY (farmer_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Orders are created when a farmer accepts a buyer's offer.
CREATE TABLE IF NOT EXISTS orders (
    order_id INT AUTO_INCREMENT PRIMARY KEY,
    produce_id INT NOT NULL,
    buyer_id INT NOT NULL,
    farmer_id INT NOT NULL,
    quantity DECIMAL(10,2) NOT NULL,
    total_amount DECIMAL(12,2) NOT NULL,
    status ENUM(
        'pending',
        'confirmed',
        'completed',
        'cancelled'
    ) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_orders_produce
        FOREIGN KEY (produce_id) REFERENCES produce(produce_id),
    CONSTRAINT fk_orders_buyer
        FOREIGN KEY (buyer_id) REFERENCES users(user_id),
    CONSTRAINT fk_orders_farmer
        FOREIGN KEY (farmer_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Durable transactional email events. The worker claims rows using SKIP LOCKED.
CREATE TABLE IF NOT EXISTS email_notification_outbox (
    outbox_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idempotency_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_name VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    recipient_user_id INT NOT NULL,
    other_party_user_id INT NULL,
    payload_json JSON NOT NULL,
    status ENUM('pending', 'processing', 'delivered', 'failed')
        NOT NULL DEFAULT 'pending',
    attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
    available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at DATETIME NULL,
    locked_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    last_error_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    delivered_at DATETIME NULL,

    UNIQUE KEY uq_email_outbox_idempotency (idempotency_key),
    KEY idx_email_outbox_delivery (status, available_at, outbox_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;