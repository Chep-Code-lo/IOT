const mysql = require('mysql2/promise');
require('dotenv').config();

async function updateDatabase() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('✅ Connected to database');

        // Check if column exists
        const [columns] = await connection.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'activity_history' AND COLUMN_NAME = 'is_deleted'`,
            [process.env.DB_NAME]
        );

        if (columns.length === 0) {
            console.log('➕ Adding is_deleted column...');
            await connection.query('ALTER TABLE activity_history ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE');
            console.log('✅ Column is_deleted added successfully');
            
            console.log('➕ Adding index...');
            await connection.query('ALTER TABLE activity_history ADD INDEX idx_is_deleted (is_deleted)');
            console.log('✅ Index added successfully');
            
            console.log('🔄 Setting default values...');
            await connection.query('UPDATE activity_history SET is_deleted = FALSE WHERE is_deleted IS NULL');
            console.log('✅ Default values set');
        } else {
            console.log('ℹ️  Column is_deleted already exists');
        }

        const [result] = await connection.query('SELECT COUNT(*) as total FROM activity_history');
        console.log(`\n📊 Total records: ${result[0].total}`);

        await connection.end();
        console.log('\n✅ Database update completed!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

updateDatabase();
