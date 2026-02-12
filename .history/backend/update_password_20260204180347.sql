-- Cập nhật mật khẩu admin thành Admin123@
UPDATE users 
SET password_hash = '$2b$10$TupJ3XSzzraQGzMqKi1bFeVnXLMox57AWr4h5SgCDx/aR0RrP8b4i' 
WHERE username = 'admin';

-- Kiểm tra kết quả
SELECT username, full_name, role, updated_at 
FROM users 
WHERE username = 'admin';
