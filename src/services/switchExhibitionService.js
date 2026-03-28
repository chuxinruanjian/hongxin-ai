const mqttMessageService = require("./mqttMessageService");
const normalizeDivideId = mqttMessageService.normalizeDivideId;

/**
 * WebSocket 客户端分组与当前切换分组是否一致（含全局 undefined）
 */
function wsMatchesDivide(wsDivideId, effectiveDivideId) {
	return (
		normalizeDivideId(wsDivideId) === normalizeDivideId(effectiveDivideId)
	);
}

/**
 * 执行展项切换（与 MQTT 收到切换消息时的逻辑一致）
 * @param {number|string} exhibitionId - 目标展项 ID
 * @param {string} clientId - 客户端 ID
 * @param {string} [deviceId] - 设备 ID，用于广播；不传则用 clientId
 * @param {string} [sourceTopic] - 来源主题，用于存 Redis；如 'api/switch'
 * @returns {Promise<{switched: boolean, reason?: string}>}
 */
async function switchExhibition(exhibitionId, clientId, deviceId, sourceTopic) {
	const newExhibitionRow = await mqttMessageService.getExhibitionByIdNoError(
		exhibitionId
	);
	if (!newExhibitionRow) {
		console.error("切换失败：展项不存在", exhibitionId);
		return { switched: false, reason: "exhibition_not_found" };
	}

	const effectiveDivideId = normalizeDivideId(newExhibitionRow.divideId);

	const currentExhibition = await mqttMessageService.getCurrentExhibition(
		effectiveDivideId
	);

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
				oldExhibition = await mqttMessageService.getExhibitionByIdNoError(
					currentExhibition.exhibition_id
				);
			}

			const newExhibition = await mqttMessageService.getExhibitionByIdNoError(
				exhibitionId
			);

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

	const broadcastTopic = mqttMessageService.switchBroadcastTopic(effectiveDivideId);
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
		clientId,
		effectiveDivideId
	);

	// 通知同一分组下连接 wssApp 的客户端
	try {
		const { wssApp } = require("../handlers/socketRouter");
		const current = await mqttMessageService.getCurrentExhibition(
			effectiveDivideId
		);
		let detail = null;
		if (current?.exhibition_id) {
			detail = await mqttMessageService.getExhibitionByIdNoError(
				current.exhibition_id
			);
		}
		const payload = JSON.stringify({
			type: "switchExhibition",
			data: {
				exhibition_id: current?.exhibition_id,
				exhibition_name: detail?.title,
				client_id: current?.client_id,
				updated_at: current?.updated_at,
				divide_id: current?.divide_id ?? null,
			},
		});
		wssApp.clients.forEach((client) => {
			if (client.readyState !== 1) {
				return;
			}
			if (!wsMatchesDivide(client._divideId, effectiveDivideId)) {
				return;
			}
			client.send(payload);
		});
	} catch (e) {
		// 忽略：可能 socketRouter 未加载（如单测场景）
	}

	return { switched: true };
}

module.exports = { switchExhibition };
