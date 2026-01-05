const aedes = require("aedes")();
const net = require("net");

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
	aedes.on("publish", (packet, client) => {
		if (client) {
			console.log(
				`收到来自 [${client.id}] 的消息: ${packet.payload.toString()}`
			);
		}
	});

	return aedes;
};

module.exports = { initMqttBroker };
