const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middleware/auth');

router.get('/cards', authMiddleware, async (req, res) => {
    try {
        const { status } = req.query;
        let query = 'SELECT * FROM rfid_cards';
        let params = [];
        if (status) {
            query += ' WHERE status = ?';
            params.push(status);
        }
        query += ' ORDER BY created_at DESC';
        const [cards] = await db.query(query, params);
        res.json({
            success: true,
            data: cards
        });
    } catch (error) {
        console.error('Get RFID cards error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách thẻ'
        });
    }
});

router.post('/cards', authMiddleware, async (req, res) => {
    try {
        const { uid, ownerName, description, status = 'active' } = req.body;
        if (!uid) {
            return res.status(400).json({
                success: false,
                message: 'UID thẻ là bắt buộc'
            });
        }
        const [existing] = await db.query('SELECT id FROM rfid_cards WHERE uid = ?', [uid]);
        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Thẻ này đã tồn tại trong hệ thống'
            });
        }
        const [result] = await db.query(
            `INSERT INTO rfid_cards (uid, owner_name, description, status, user_id) 
             VALUES (?, ?, ?, ?, ?)`,
            [uid, ownerName || '', description || '', status, req.user.id]
        );
        res.json({
            success: true,
            message: 'Đã thêm thẻ mới',
            data: {
                id: result.insertId,
                uid,
                ownerName,
                description,
                status
            }
        });
    } catch (error) {
        console.error('Add RFID card error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi thêm thẻ'
        });
    }
});

router.put('/cards/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { ownerName, description, status } = req.body;
        const updates = [];
        const params = [];
        if (ownerName !== undefined) {
            updates.push('owner_name = ?');
            params.push(ownerName);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description);
        }
        if (status !== undefined) {
            updates.push('status = ?');
            params.push(status);
        }
        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Không có thông tin cần cập nhật'
            });
        }
        params.push(id);
        await db.query(
            `UPDATE rfid_cards SET ${updates.join(', ')} WHERE id = ?`,
            params
        );
        res.json({
            success: true,
            message: 'Đã cập nhật thẻ'
        });
    } catch (error) {
        console.error('Update RFID card error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi cập nhật thẻ'
        });
    }
});

router.delete('/cards/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM rfid_cards WHERE id = ?', [id]);
        res.json({
            success: true,
            message: 'Đã xóa thẻ'
        });
    } catch (error) {
        console.error('Delete RFID card error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi xóa thẻ'
        });
    }
});

router.post('/verify', async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) {
            return res.status(400).json({
                success: false,
                message: 'UID là bắt buộc'
            });
        }
        const [cards] = await db.query(
            'SELECT * FROM rfid_cards WHERE uid = ? AND status = ?',
            [uid, 'active']
        );
        if (cards.length === 0) {
            return res.json({
                success: true,
                valid: false,
                message: 'Thẻ không hợp lệ'
            });
        }
        const card = cards[0];
        await db.query(
            'UPDATE rfid_cards SET last_used = NOW() WHERE id = ?',
            [card.id]
        );
        res.json({
            success: true,
            valid: true,
            message: 'Thẻ hợp lệ',
            data: {
                uid: card.uid,
                ownerName: card.owner_name,
                description: card.description
            }
        });
    } catch (error) {
        console.error('Verify RFID error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi xác thực thẻ'
        });
    }
});

module.exports = router;
