require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const WebSocket = require("ws");
const {initMqttBroker} = require("./src/handlers/mqttBroker");
const {handleSocketConnection} = require("./src/handlers/socketHandler");
const dayjs = require("dayjs");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // 添加静态文件服务

const server = http.createServer(app);

// 1. 启动 MQTT Broker
const aedesInstance = initMqttBroker();

// 2. 启动 WebSocket Server
// 这里将 WebSocket 挂载到同一个 HTTP 服务上
const wss = new WebSocket.Server({server, path: "/speech"});

wss.on("connection", (ws, req) => {
	handleSocketConnection(ws, wss, req);
});

// 3. 广播消息方法（通过 API 触发广播）
app.post("/api/broadcast", (req, res) => {
	const {exhibition_id} = req.body;

	const broadcastMessage = JSON.stringify({
		type: "SWITCH_EXHIBITION",
		exhibition_id: exhibition_id,
		operator: "system",
		time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
		timestamp: dayjs().valueOf(),
	});

	aedesInstance.publish({
		topic: "device/all/event",
		payload: broadcastMessage,
		qos: 1,
		retain: true,
	});

	res.json({status: "success", message: "广播已发送"});
});

app.post("/api/audio", (req, res) => {
	console.log(req.body);
	res.json({status: "success", message: "发送成功"});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
	console.log(`Web Server & WS 运行在: http://localhost:${PORT}`);
});
