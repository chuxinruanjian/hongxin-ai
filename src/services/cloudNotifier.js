const WebSocket = require('ws');
const db = require('../../models/index');

/**
 * 本地端调用的：连接云端 WebSocket 监听通知
 */
function connectToCloud() {
	if (process.env.IS_CLOUD === 'true') return; // 云端不需要连接自己

	const wsUrl = process.env.CLOUD_WS_URL || 'ws://localhost:3000/notice';
	const ws = new WebSocket(wsUrl);

	// 定义心跳定时器
	let heartbeatInterval;

	ws.on('open', () => {
		console.log('已成功连接云端通知中心');

		// --- 启动心跳 ---
		// 每 30 秒发送一次 ping 包
		heartbeatInterval = setInterval(() => {
			if (ws.readyState === WebSocket.OPEN) {
				ws.ping();
			}
		}, 30000);
	});

	ws.on('message', (data) => {
		try {
			const msgString = data.toString();
			const message = JSON.parse(msgString);

			if (message.type === 'ASR_COMPLETE') {
				console.log('收到云端 ASR 完成通知:', message);
				saveAsrToMysql(message);
			}
		} catch (e) {
			console.error('解析云端消息失败:', e);
		}
	});

	const handleClose = () => {
		console.log('与云端连接断开，清理资源并重连...');

		// 清除心跳定时器，防止内存泄漏
		clearInterval(heartbeatInterval);

		// 5秒后重连
		setTimeout(connectToCloud, 5000);
	};

	ws.on('close', handleClose);

	ws.on('error', (err) => {
		console.error('WS 客户端错误:', err.message);
		ws.terminate();
	});
}

async function saveAsrToMysql(message) {
	const { taskId, data } = message;

	return await db.Minute.upsert({
		taskId: taskId,
		original: data.original,
		body: data.body,
		title: data.title,
		status: 1
	});
}

module.exports = { connectToCloud };
