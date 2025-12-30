const WebSocket = require('ws');
const db = require('../../models/index');

/**
 * 本地端调用的：连接云端 WebSocket 监听通知
 */
function connectToCloud() {
	if (process.env.IS_CLOUD === 'true') return; // 云端不需要连接自己

	const wsUrl = process.env.CLOUD_WS_URL || 'ws://localhost:3000/notice';
	const ws = new WebSocket(wsUrl);

	ws.on('open', () => {
		console.log('已成功连接云端通知中心');
	});

	ws.on('message', (data) => {
		try {
			const message = JSON.parse(data);
			if (message.type === 'ASR_COMPLETE') {
				console.log('收到云端 ASR 完成通知:', message);
				// 在这里触发本地逻辑，比如：
				saveAsrToMysql(message)
			}
		} catch (e) {
			console.error('解析云端消息失败:', e);
		}
	});

	ws.on('close', () => {
		console.log('与云端连接断开，5秒后尝试重连...');
		setTimeout(connectToCloud, 5000); // 自动重连
	});

	ws.on('error', (err) => {
		console.error('WS 客户端错误:', err.message);
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
