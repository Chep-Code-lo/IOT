const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

const promisePool = pool.promise();

pool.getConnection((err, connection) => {
    if (err) {
        console.error('MySQL Connection Error:', err.message);
        console.error('Please check your .env file and MySQL server');
        return;
    }
    console.log('MySQL Connected Successfully');
    console.log(`Database: ${process.env.DB_NAME}`);
    connection.release();
});

pool.on('error', (err) => {
    console.error('MySQL Pool Error:', err.message);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        console.log('Reconnecting to database...');
    }
});

module.exports = promisePool;
