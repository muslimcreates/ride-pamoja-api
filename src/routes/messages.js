const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getMessages, sendMessage, markRead, getUnreadTotal } = require('../controllers/messagesController');

const router = express.Router();
router.use(requireAuth);

router.get('/unread-count', getUnreadTotal);          // GET  /api/messages/unread-count
router.post('/mark-read',   markRead);                // POST /api/messages/mark-read
router.get('/',             getMessages);             // GET  /api/messages?booking_id=X
router.post('/',            sendMessage);             // POST /api/messages

module.exports = router;
