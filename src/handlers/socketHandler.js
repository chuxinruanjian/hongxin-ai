const dayjs = require("dayjs");
const fs = require("fs");
const path = require("path");
const {default: axios} = require("axios");
const {v4: uuidv4} = require("uuid");
const ConfigService = require('../services/configService');

// --- 常量配置 ---
const AUDIO_SAVE_DIR = path.join(process.cwd(), "uploads", "records");
const TIME_FORMAT = "YYYY-MM-DD HH:mm:ss";
const BYTEDANCE_ASR_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";

// 确保存储目录存在
if (!fs.existsSync(AUDIO_SAVE_DIR)) {
	fs.mkdirSync(AUDIO_SAVE_DIR, {recursive: true});
}

/**
 * 统一发送 WS 消息的方法
 */
const sendMessage = (ws, payload) => {
	if (ws.readyState === 1) { // OPEN
		ws.send(JSON.stringify({
			...payload,
			time: dayjs().format(TIME_FORMAT)
		}));
	}
};

const handleSocketConnection = (ws, wss, req) => {
	const clientIp = req.socket.remoteAddress;
	let audioChunks = [];
	let sessionData = {};

	ws.on("message", async (data, isBinary) => {
		if (isBinary) {
			audioChunks.push(Buffer.from(data));
			return;
		}

		try {
			const message = data.toString();
			const command = JSON.parse(message);
			if (!command.type) return;

			const commandType = command.type.toLowerCase();

			switch (commandType) {
				case "start":
					audioChunks = [];
					sessionData.name = command.name
					sendMessage(ws, {
						type: "started",
						message: `语音识别已启动，用户: ${sessionData.name}`
					});
					// 异步触发，不阻塞主流程
					sendToThink(command).catch(() => {
					});
					break;

				case "stop":
					await handleStopCommand(ws, audioChunks, sessionData);
					audioChunks = [];
					sessionData = {};
					break;

				case "ping":
					sendMessage(ws, {type: "pong"});
					break;

				default:
					console.warn(`[WS] 未知指令: ${commandType} from ${clientIp}`);
			}
		} catch (error) {
			sendMessage(ws, {type: "ERROR", message: error.message});
		}
	});

	ws.on("close", () => console.log(`[WS] 连接断开: ${clientIp}`));
	ws.on("error", (err) => console.error("[WS] 异常:", err));
};

/**
 * 专门处理 STOP 指令及 ASR 逻辑
 */
async function handleStopCommand(ws, audioChunks, command) {
	console.log("停止语音识别并处理音频");

	if (audioChunks.length === 0) {
		sendMessage(ws, {type: "stopped", hasResult: false, error: "没有音频数据"});
		return;
	}

	try {
		const audioBuffer = Buffer.concat(audioChunks);
		const wavBuffer = pcmToWav(audioBuffer); // 使用默认参数

		// 1. 调用豆包 ASR
		const speechKey = ConfigService.get('doubao_speech_key');
		const speechToken = ConfigService.get('doubao_speech_token');

		const res = await axios.post(BYTEDANCE_ASR_URL, {
			user: {uid: speechKey},
			audio: {data: wavBuffer.toString("base64")},
			request: {model_name: "bigmodel"}
		}, {
			headers: {
				'X-Api-App-Key': speechKey,
				'X-Api-Access-Key': speechToken,
				'X-Api-Resource-Id': 'volc.bigasr.auc_turbo',
				'X-Api-Request-Id': uuidv4(),
				'X-Api-Sequence': -1
			},
			timeout: 10000 // ASR 超时限制
		});

		const text = res.data?.result?.text || "";
		console.log(text)
		// 2. 响应客户端
		sendMessage(ws, {
			type: "stopped",
			message: "语音识别已停止",
			hasResult: true,
			result: {source: "short_asr", text}
		});

		// 3. 异步触发后续逻辑（保存文件 & 大模型处理）
		saveAudioFile(wavBuffer).catch(console.error);
		sendToBigModel(text, command).catch(() => {
		});

	} catch (error) {
		console.error("ASR处理失败:", error.message);
		sendMessage(ws, {
			type: "stopped",
			hasResult: false,
			error: `ASR服务异常: ${error.message}`
		});
	}
}

/**
 * 持久化音频文件
 */
async function saveAudioFile(buffer) {
	const fileName = `${dayjs().format("YYYYMMDD_HHmmss")}_${uuidv4().slice(0, 8)}.wav`;
	const filePath = path.join(AUDIO_SAVE_DIR, fileName);
	await fs.promises.writeFile(filePath, buffer);
}

async function sendToThink(command) {
	const url = ConfigService.get('digital_start');
	if (!url) return null;

	try {
		const res = await axios.post(url, {
			user: {name: command.name || ''}
		}, {timeout: 5000});
		return res.data;
	} catch (err) {
		logAxiosError('ThinkAPI', err);
		return null;
	}
}

async function sendToBigModel(text, sessionData) {
	const url = ConfigService.get('digital_url');
	if (!url) return null;
	console.log(sessionData)
	try {
		const res = await axios.post(url, {
			text: text,
			type: 1,
			user: {name: sessionData.name || '通通'}
		}, {timeout: 5000});
		return res.data;
	} catch (err) {
		logAxiosError('BigModelAPI', err);
		return null;
	}
}

function logAxiosError(label, err) {
	if (err.response) {
		console.error(`[${label}] 响应错误:`, err.response.status);
	} else {
		console.error(`[${label}] 网络错误:`, err.message);
	}
}

/**
 * PCM 转 WAV 头部封装
 */
function pcmToWav(pcmBuffer, sampleRate = 16000, numChannels = 1, bitsPerSample = 16) {
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + pcmBuffer.length, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20); // PCM format
	header.writeUInt16LE(numChannels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
	header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write('data', 36);
	header.writeUInt32LE(pcmBuffer.length, 40);

	return Buffer.concat([header, pcmBuffer]);
}

module.exports = {handleSocketConnection};
