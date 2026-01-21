const aedes = require("aedes")();
const net = require("net");
const mqttMessageService = require("../services/mqttMessageService");

const initMqttBroker = () => {
	const port = process.env.MQTT_PORT || 1883;
	const server = net.createServer(aedes.handle);

	server.listen(port, () => {
		console.log(`MQTT Broker 已启动，监听端口: ${port}`);
	});

	// 监听客户端连接
	aedes.on("client", (client) => {
		console.log(`设备连接: ${client ? client.id : "未知ID"}`);
	});

	// 监听订阅请求
	aedes.on("subscribe", (subscriptions, client) => {
		console.log(
			`设备 [${client.id}] 订阅了主题: ${subscriptions
				.map((s) => s.topic)
				.join(", ")}`
		);
	});

	// 监听消息发布（核心：话筒请求在这里捕获）
	aedes.on("publish", async (packet, client) => {
		if (!client) {
			return;
		}

		const message = packet.payload.toString();
		const topic = packet.topic;
		const clientId = client.id;

		console.log(
			`收到来自 [${clientId}] 的消息: ${message} (主题: ${topic})`
		);

		// 1. 解析消息，获取 exhibition_id
		let messageData = {};
		try {
			messageData = JSON.parse(message);
		} catch (e) {
			console.log("消息不是 JSON 格式，跳过处理");
			return;
		}

		// 2. 判断是否有 exhibition_id
		if (
			!messageData.hasOwnProperty("exhibition_id") ||
			messageData.exhibition_id === null ||
			messageData.exhibition_id === undefined
		) {
			console.log("消息中没有 exhibition_id，跳过处理");
			return;
		}

		const newExhibitionId = messageData.exhibition_id;

		// 3. 查询 Redis 中的当前展厅信息
		const currentExhibition = await mqttMessageService.getCurrentExhibition();

		// 4. 比较 exhibition_id
		if (
			currentExhibition &&
			currentExhibition.exhibition_id === newExhibitionId
		) {
			console.log(
				`展厅ID ${newExhibitionId} 与当前展厅一致，跳过后续操作`
			);
			return;
		}

		// 数字人激活/停用（仅在切换时触发，异步不阻塞）
		Promise.resolve()
			.then(async () => {
				let oldExhibition = null;
				if (currentExhibition && currentExhibition.exhibition_id) {
					oldExhibition = await mqttMessageService.getExhibitionById(
						currentExhibition.exhibition_id
					);
				}

				const newExhibition = await mqttMessageService.getExhibitionById(
					newExhibitionId
				);

				if (newExhibition && newExhibition.ip) {
					await mqttMessageService.sendToExhibitionByIp(
						"digital_activate",
						newExhibition.ip,
						{ exhibition_id: newExhibitionId },
						newExhibitionId
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

		// 5. 如果不一致，发布广播并保存
		console.log(
			`展厅ID 发生变化: ${currentExhibition?.exhibition_id || "无"} -> ${newExhibitionId}，执行切换操作`
		);

		// 5.1 发布广播到 device/all/event 频道
		const broadcastTopic = "device/all/event";
		const broadcastMessage = JSON.stringify({
			type: "SWITCH_EXHIBITION",
			exhibition_id: newExhibitionId,
			device_id: messageData.device_id || clientId,
			timestamp: Date.now(),
		});

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

		// 5.2 保存到 Redis（传入已解析的数据）
		await mqttMessageService.saveMessage(messageData, topic, clientId);
	});

	return aedes;
};

module.exports = { initMqttBroker };
