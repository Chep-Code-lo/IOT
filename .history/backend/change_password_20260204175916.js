const bcrypt = require('bcrypt');
const db = require('./config/database');

async function changePassword() {
    try {
        const username = 'admin';
        const newPassword = 'Admin123@';
        
        console.log('Đang hash mật khẩu mới...');
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(newPassword, saltRounds);
        
        console.log('Đang cập nhật mật khẩu vào database...');
        const [result] = await db.query(
            'UPDATE users SET password_hash = ? WHERE username = ?',
            [passwordHash, username]
        );
        
        if (result.affectedRows > 0) {
            console.log('✓ Đổi mật khẩu thành công!');
            console.log(`Username: ${username}`);
            console.log(`Mật khẩu mới: ${newPassword}`);
            console.log(`Hash: ${passwordHash}`);
        } else {
            console.log('✗ Không tìm thấy user để cập nhật');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('Lỗi:', error.message);
        process.exit(1);
    }
}

changePassword();
