require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const dayjs = require("dayjs");
const db = require("./models/index");

const { initMqttBroker } = require("./src/handlers/mqttBroker");
const { handleUpgrade } = require("./src/handlers/socketRouter");
const { connectToCloud } = require("./src/services/cloudNotifier");
const audioRouter = require("./src/routes/audio");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const server = http.createServer(app);

// 1. MQTT
const aedesInstance = initMqttBroker();

// 2. WebSocket
// 监听所有 WebSocket 升级请求
server.on("upgrade", handleUpgrade);

// 3. 业务路由挂载
app.use("/api/audio", audioRouter);

// 广播 API (也可以抽离到单独的 routes 文件)
app.post("/api/broadcast", (req, res) => {
	const { exhibition_id } = req.body;
	const broadcastMessage = JSON.stringify({
		type: "SWITCH_EXHIBITION",
		exhibition_id,
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
	res.json({ status: "success", message: "广播已发送" });
});

const PORT = process.env.PORT || 3000;

// 启动
async function startServer() {
	try {
		// 测试数据库连接是否正常
		await db.sequelize.authenticate();
		console.log('MySQL 连接成功');

		// 只有数据库连接成功后，才启动 HTTP 服务
		server.listen(PORT, () => {
			console.log(`服务运行在: http://localhost:${PORT}`);

			// 如果是本地环境，启动 WS 客户端连接云端
			if (process.env.IS_CLOUD !== 'true') {
				console.log("检测为本地环境，正在连接云端...");
				connectToCloud();
			}
		});
	} catch (error) {
		console.error('❌ 无法启动服务器:', error);
		process.exit(1); // 启动失败，退出进程
	}
}

startServer();
