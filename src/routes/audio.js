const express = require('express');
const router = express.Router();
const { runAsrWorkflow } = require('../services/doubaoAsrService');

router.post("/", (req, res) => {
	const { callback, data } = req.body;

	if (callback === "AUDIO_INFORM" && Array.isArray(data)) {
		setImmediate(() => {
			data.forEach(item => {
				runAsrWorkflow(item)
					.then(result => {
						// 可以在这里通过 WebSocket 推送给前端或存库
						console.log("ASR 数据包处理完毕");
					})
					.catch(err => {
						console.error("ASR 流程异常:", err);
					});
			});
		});
	}

	res.json({ status: "success", message: "任务已接收，后台处理中" });
});

module.exports = router;
