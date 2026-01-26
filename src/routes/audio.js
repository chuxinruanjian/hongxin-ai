const express = require("express");
const fs = require("fs");
const path = require("path");
const dayjs = require("dayjs");
const {v4: uuidv4} = require("uuid");
const router = express.Router();
const { runAsrWorkflow } = require("../services/doubaoAsrService");

const AUDIO_UPLOAD_DIR = path.join(process.cwd(), "uploads", "audio");
if (!fs.existsSync(AUDIO_UPLOAD_DIR)) {
	fs.mkdirSync(AUDIO_UPLOAD_DIR, {recursive: true});
}

function parseBase64Audio(input) {
	if (input.startsWith("data:")) {
		const match = input.match(/^data:([^;]+);base64,(.+)$/);
		if (match) {
			return match[2];
		}
	}
	return input;
}

router.post("/base64", async (req, res) => {
	const {base64} = req.body || {};
	if (!base64 || typeof base64 !== "string") {
		return res.status(400).json({status: "error", message: "base64 is required"});
	}

	try {
		const data = parseBase64Audio(base64);
		const fileSafeName = `${dayjs().format("YYYYMMDD_HHmmss")}_${uuidv4().slice(0, 8)}.wav`;
		const filePath = path.join(AUDIO_UPLOAD_DIR, fileSafeName);
		const buffer = Buffer.from(data, "base64");
		await fs.promises.writeFile(filePath, buffer);
		return res.json({
			status: "success",
			fileName: fileSafeName,
			url: `/uploads/audio/${fileSafeName}`,
		});
	} catch (error) {
		console.error("保存音频失败:", error);
		return res.status(500).json({status: "error", message: "保存音频失败"});
	}
});

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
