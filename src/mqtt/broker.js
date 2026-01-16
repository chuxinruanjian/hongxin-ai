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
		if (client) {
			const message = packet.payload.toString();
			const topic = packet.topic;
			const clientId = client.id;

			console.log(
				`收到来自 [${clientId}] 的消息: ${message} (主题: ${topic})`
			);

			// 保存消息到 Redis（使用消息存储服务）
			await mqttMessageService.saveMessage(packet, client);
		}
	});

	return aedes;
};

module.exports = { initMqttBroker };
