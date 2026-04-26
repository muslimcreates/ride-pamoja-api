const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getMessages, sendMessage } = require('../controllers/messagesController');

const router = express.Router();
router.use(requireAuth);

router.get('/',  getMessages);   // GET /api/messages?booking_id=X
router.post('/', sendMessage);   // POST /api/messages

module.exports = router;
