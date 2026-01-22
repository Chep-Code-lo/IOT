const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middleware/auth');

router.get('/', authMiddleware, async (req, res) => {
    try {
        const { type, limit = 100, offset = 0 } = req.query;
        let query = 'SELECT * FROM activity_history';
        let params = [];
        if (type && type !== 'all') {
            query += ' WHERE type = ?';
            params.push(type);
        }
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        const [history] = await db.query(query, params);
        const formattedHistory = history.map(item => ({
            id: item.id,
            type: item.type,
            title: item.title,
            desc: item.description,
            icon: item.icon,
            timestamp: new Date(item.created_at).getTime(),
            metadata: item.metadata
        }));
        res.json({
            success: true,
            data: formattedHistory
        });
    } catch (error) {
        console.error('Get history error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy lịch sử'
        });
    }
});

router.post('/', authMiddleware, async (req, res) => {
    try {
        const { type, title, desc, icon, metadata } = req.body;
        if (!type || !title) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu thông tin bắt buộc'
            });
        }
        const [result] = await db.query(
            `INSERT INTO activity_history (type, title, description, icon, user_id, metadata) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [type, title, desc || '', icon || '', req.user.id, JSON.stringify(metadata || {})]
        );
        res.json({
            success: true,
            message: 'Đã thêm vào lịch sử',
            data: {
                id: result.insertId,
                type,
                title,
                desc,
                icon,
                timestamp: Date.now()
            }
        });
    } catch (error) {
        console.error('Add history error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi thêm lịch sử'
        });
    }
});

router.delete('/', authMiddleware, async (req, res) => {
    try {
        await db.query('DELETE FROM activity_history');
        res.json({
            success: true,
            message: 'Đã xóa toàn bộ lịch sử'
        });
    } catch (error) {
        console.error('Clear history error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi xóa lịch sử'
        });
    }
});

router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM activity_history WHERE id = ?', [id]);
        res.json({
            success: true,
            message: 'Đã xóa mục lịch sử'
        });
    } catch (error) {
        console.error('Delete history error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi xóa mục lịch sử'
        });
    }
});

module.exports = router;
