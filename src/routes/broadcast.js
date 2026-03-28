const express = require("express");
const dayjs = require("dayjs");
const { getMqtt } = require("../mqtt");
const mqttMessageService = require("../services/mqttMessageService");

const router = express.Router();

router.post("/", async (req, res) => {
	try {
		const { exhibition_id } = req.body;

		const exhibition = await mqttMessageService.getExhibitionByIdNoError(
			exhibition_id
		);
		const topic = mqttMessageService.switchBroadcastTopic(
			exhibition?.divideId
		);

		const mqtt = getMqtt();

		const message = JSON.stringify({
			type: "SWITCH_EXHIBITION",
			exhibition_id,
			operator: "system",
			time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
			timestamp: dayjs().valueOf(),
		});

		mqtt.publish({
			topic,
			payload: message,
			qos: 1,
			retain: true,
		});

		res.json({ status: "success", topic });
	} catch (error) {
		console.error("广播失败:", error.message);
		res.status(500).json({ status: "error", message: error.message });
	}
});

module.exports = router;
