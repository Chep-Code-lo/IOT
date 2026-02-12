CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    role ENUM('admin', 'user') DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login TIMESTAMP NULL,
    is_active BOOLEAN DEFAULT TRUE,
    INDEX idx_username (username),
    INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type ENUM('system', 'unlock', 'lock', 'rfid', 'ping', 'buzz', 'door', 'motion', 'bell') NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(500),
    user_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSON,
    is_deleted BOOLEAN DEFAULT FALSE,
    INDEX idx_type (type),
    INDEX idx_created_at (created_at),
    INDEX idx_user_id (user_id),
    INDEX idx_is_deleted (is_deleted),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rfid_cards (
    id INT AUTO_INCREMENT PRIMARY KEY,
    uid VARCHAR(50) UNIQUE NOT NULL,
    owner_name VARCHAR(100),
    description TEXT,
    status ENUM('active', 'inactive', 'blocked') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_used TIMESTAMP NULL,
    user_id INT NULL,
    INDEX idx_uid (uid),
    INDEX idx_status (status),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    log_type ENUM('mqtt', 'system', 'error', 'info', 'warning') NOT NULL,
    topic VARCHAR(255),
    message TEXT NOT NULL,
    payload JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_log_type (log_type),
    INDEX idx_created_at (created_at),
    INDEX idx_topic (topic)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO users (username, password_hash, full_name, role) 
VALUES ('admin', '$2b$10$TupJ3XSzzraQGzMqKi1bFeVnXLMox57AWr4h5SgCDx/aR0RrP8b4i', 'Administrator', 'admin')
ON DUPLICATE KEY UPDATE username=username;

INSERT INTO rfid_cards (uid, owner_name, description, status) VALUES
('A1B2C3D4', 'Admin Card', 'Thẻ quản trị viên', 'active'),
('E5F6G7H8', 'User Card 1', 'Thẻ người dùng 1', 'active')
ON DUPLICATE KEY UPDATE uid=uid;

-- =====================================================
-- MIGRATION: Fix for existing databases
-- =====================================================
-- Dành cho database đã tồn tại, cần chạy các lệnh sau:

-- Set giá trị mặc định cho dữ liệu cũ
UPDATE activity_history 
SET is_deleted = FALSE 
WHERE is_deleted IS NULL;

-- Kiểm tra kết quả
SELECT COUNT(*) as total_records, 
       SUM(CASE WHEN is_deleted = FALSE THEN 1 ELSE 0 END) as visible_records,
       SUM(CASE WHEN is_deleted = TRUE THEN 1 ELSE 0 END) as deleted_records
FROM activity_history;
