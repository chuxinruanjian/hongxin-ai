const express = require('express');
const dayjs = require('dayjs');
const {getMqtt} = require('../mqtt');

const router = express.Router();

router.post('/', (req, res) => {
	const {exhibition_id} = req.body;

	const mqtt = getMqtt();

	const message = JSON.stringify({
		type: 'SWITCH_EXHIBITION',
		exhibition_id,
		operator: 'system',
		time: dayjs().format('YYYY-MM-DD HH:mm:ss'),
		timestamp: dayjs().valueOf()
	});

	mqtt.publish({
		topic: 'device/all/event',
		payload: message,
		qos: 1,
		retain: true
	});

	res.json({status: 'success'});
});

module.exports = router;
