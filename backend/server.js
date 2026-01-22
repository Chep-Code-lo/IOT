const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);

    if (allowedOrigins.length === 0) return cb(null, true);
    return cb(null, allowedOrigins.includes(origin));
  },
  credentials: true
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

const authRoutes = require('./routes/auth');
const historyRoutes = require('./routes/history');
const rfidRoutes = require('./routes/rfid');

app.use('/api/auth', authRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/rfid', rfidRoutes);

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'IoT Smart Door API is running',
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'IoT Smart Door Backend API',
        version: '1.0.0',
        endpoints: {
            health: '/api/health',
            auth: {
                login: 'POST /api/auth/login',
                verify: 'GET /api/auth/verify',
                logout: 'POST /api/auth/logout'
            },
            history: {
                get: 'GET /api/history',
                add: 'POST /api/history',
                clear: 'DELETE /api/history',
                delete: 'DELETE /api/history/:id'
            },
            rfid: {
                getCards: 'GET /api/rfid/cards',
                addCard: 'POST /api/rfid/cards',
                updateCard: 'PUT /api/rfid/cards/:id',
                deleteCard: 'DELETE /api/rfid/cards/:id',
                verify: 'POST /api/rfid/verify'
            }
        }
    });
});

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint không tồn tại'
    });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        message: 'Lỗi server',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

app.listen(PORT, () => {
    console.log('╔════════════════════════════════════════════╗');
    console.log('║   IoT Smart Door Backend API Server       ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log(`Server running on port ${PORT}`);
    console.log(`API URL: http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('');
    console.log('Available endpoints:');
    console.log(`  - Health Check: http://localhost:${PORT}/api/health`);
    console.log(`  - Auth: http://localhost:${PORT}/api/auth/*`);
    console.log(`  - History: http://localhost:${PORT}/api/history`);
    console.log(`  - RFID: http://localhost:${PORT}/api/rfid/*`);
    console.log('');
});

module.exports = app;
