const mqttMessageService = require("./mqttMessageService");

/**
 * 执行展项切换（与 MQTT 收到切换消息时的逻辑一致）
 * @param {number|string} exhibitionId - 目标展项 ID
 * @param {string} clientId - 客户端 ID
 * @param {string} [deviceId] - 设备 ID，用于广播；不传则用 clientId
 * @param {string} [sourceTopic] - 来源主题，用于存 Redis；如 'api/switch'
 * @returns {Promise<{switched: boolean, reason?: string}>}
 */
async function switchExhibition(exhibitionId, clientId, deviceId, sourceTopic) {
	const currentExhibition = await mqttMessageService.getCurrentExhibition();

	if (
		currentExhibition &&
		String(currentExhibition.exhibition_id) === String(exhibitionId)
	) {
		console.log(
			`展厅ID ${exhibitionId} 与当前展厅一致，跳过后续操作`
		);
		return { switched: false, reason: "same_exhibition" };
	}

	// 数字人激活/停用（仅在切换时触发，异步不阻塞）
	Promise.resolve()
		.then(async () => {
			let oldExhibition = null;
			if (currentExhibition && currentExhibition.exhibition_id) {
				try {
					oldExhibition = await mqttMessageService.getExhibitionById(
						currentExhibition.exhibition_id
					);
				} catch (e) {
					// 旧展项可能已删除，忽略
				}
			}

			let newExhibition = null;
			try {
				newExhibition = await mqttMessageService.getExhibitionById(
					exhibitionId
				);
			} catch (e) {
				console.error("目标展项不存在或未配置:", e.message);
				return;
			}

			if (newExhibition && newExhibition.ip) {
				await mqttMessageService.sendToExhibitionByIp(
					"digital_activate",
					newExhibition.ip,
					{ exhibition_id: exhibitionId },
					exhibitionId
				);
			}

			if (oldExhibition && oldExhibition.ip) {
				await mqttMessageService.sendToExhibitionByIp(
					"digital_deactivate",
					oldExhibition.ip,
					{ exhibition_id: oldExhibition.id },
					oldExhibition.id
				);
			}
		})
		.catch((error) => {
			console.error("Digital activate/deactivate failed:", error.message);
		});

	console.log(
		`展厅ID 发生变化: ${currentExhibition?.exhibition_id || "无"} -> ${exhibitionId}，执行切换操作`
	);

	const broadcastTopic = "device/all/event";
	const broadcastMessage = JSON.stringify({
		type: "SWITCH_EXHIBITION",
		exhibition_id: exhibitionId,
		device_id: deviceId || clientId,
		timestamp: Date.now(),
	});

	// 惰性 require，避免 broker → switchExhibitionService → mqtt → broker 循环依赖
	const { getMqtt } = require("../mqtt");
	const aedes = getMqtt();
	aedes.publish(
		{
			topic: broadcastTopic,
			payload: Buffer.from(broadcastMessage),
			qos: 1,
			retain: true,
		},
		(err) => {
			if (err) {
				console.error("发布广播消息失败:", err.message);
			} else {
				console.log(
					`已发布广播消息到 ${broadcastTopic}: ${broadcastMessage}`
				);
			}
		}
	);

	const topic = sourceTopic || "api/switch";
	await mqttMessageService.saveMessage(
		{ exhibition_id: exhibitionId },
		topic,
		clientId
	);

	return { switched: true };
}

module.exports = { switchExhibition };
