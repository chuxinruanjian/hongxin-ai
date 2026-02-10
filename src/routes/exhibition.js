const express = require("express");
const { switchExhibition } = require("../services/switchExhibitionService");

const router = express.Router();

/**
 * POST /api/exhibition/switch
 * 切换展项，逻辑与 MQTT 收到切换消息一致
 * Body: { exhibition_id, client_id }
 */
router.post("/switch", async (req, res) => {
	try {
		const { exhibition_id: exhibitionId, client_id: clientId } = req.body;

		if (
			exhibitionId === undefined ||
			exhibitionId === null ||
			clientId === undefined ||
			clientId === null ||
			clientId === ""
		) {
			return res.status(400).json({
				success: false,
				message: "缺少 exhibition_id 或 client_id",
			});
		}

		const result = await switchExhibition(
			exhibitionId,
			String(clientId),
			undefined,
			"api/switch"
		);

		return res.json({
			success: true,
			switched: result.switched,
			...(result.reason && { reason: result.reason }),
		});
	} catch (error) {
		console.error("切换展项失败:", error.message);
		return res.status(500).json({
			success: false,
			message: error.message || "切换展项失败",
		});
	}
});

module.exports = router;
