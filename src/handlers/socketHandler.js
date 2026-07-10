const dayjs = require("dayjs");
const fs = require("fs");
const path = require("path");
const { default: axios } = require("axios");
const { v4: uuidv4 } = require("uuid");
const ConfigService = require("../services/configService");
const mqttMessageService = require("../services/mqttMessageService");
const { DoubaoStreamingSession } = require("../services/doubaoStreamingSession");
const {
	buildDoubaoAsrRequestBase,
	loadAsrOptionsFromConfig,
} = require("../services/doubaoAsrRequest");

// --- 常量配置 ---
const AUDIO_SAVE_DIR = path.join(process.cwd(), "uploads", "records");
const TIME_FORMAT = "YYYY-MM-DD HH:mm:ss";
const BYTEDANCE_ASR_URL =
	"https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";

/**
 * 语音识别后端切换（二选一，注释掉另一行）
 * - flash：HTTP 极速识别，stop 时整段识别
 * - streaming：豆包双向流式，start 建连，二进制 PCM 实时转发；asr_partial / stopped 仅带 text（或 error）
 */
const DOUBAO_ASR_BACKEND = "flash";
// const DOUBAO_ASR_BACKEND = "streaming";

// 确保存储目录存在
if (!fs.existsSync(AUDIO_SAVE_DIR)) {
	fs.mkdirSync(AUDIO_SAVE_DIR, { recursive: true });
}

/**
 * 统一发送 WS 消息的方法
 */
const sendMessage = (ws, payload) => {
	if (ws.readyState === 1) {
		ws.send(
			JSON.stringify({
				...payload,
				time: dayjs().format(TIME_FORMAT),
			})
		);
	}
};

const handleSocketConnection = (ws, wss, req) => {
	const clientIp = req.socket.remoteAddress;
	const u = new URL(req.url || "/speech", "http://127.0.0.1");
	const divideParam = u.searchParams.get("divide_id");
	const connectionDivideId =
		divideParam === null || divideParam === "" ? undefined : divideParam;

	let audioChunks = [];
	let sessionData = { divideId: connectionDivideId };
	let streamingSession = null;
	let streamingFeedPromise = Promise.resolve();
	let recordingId = 0;
	let chunkSeq = 0;
	let stopInProgress = false;
	let recordingActive = false;

	ws.on("message", async (data, isBinary) => {
		if (isBinary) {
			const buf = Buffer.from(data);
			// stop 之后到下一次 start 之前，丢弃所有二进制帧，避免串入下一轮/污染 stop 识别缓冲
			if (!recordingActive) {
				return;
			}

			audioChunks.push(buf);
			chunkSeq += 1;
			if (DOUBAO_ASR_BACKEND === "streaming" && streamingSession) {
				streamingFeedPromise = streamingFeedPromise
					.then(() =>
						streamingSession.feedPcm(buf, (text) => {
							sendMessage(ws, { type: "asr_partial", text });
						})
					)
					.catch((e) => {
						console.error("[WS] 流式推 PCM 失败:", e.message);
						sendMessage(ws, { type: "ERROR", message: e.message });
					});
			}
			return;
		}

		try {
			const message = data.toString().trim();
			if (!message) {
				return;
			}
			const command = JSON.parse(message);
			if (!command.type) return;

			const commandType = command.type.toLowerCase();

			switch (commandType) {
				case "start":
					console.log("start", '开始录音');
					audioChunks = [];
					sessionData.name = command.name;
					sessionData.divideId = connectionDivideId;
					streamingFeedPromise = Promise.resolve();
					recordingId += 1;
					chunkSeq = 0;
					stopInProgress = false;
					recordingActive = true;

					if (DOUBAO_ASR_BACKEND === "streaming") {
						if (streamingSession) {
							streamingSession.close();
							streamingSession = null;
						}
						const speechKey = ConfigService.get("doubao_speech_key");
						const speechToken = ConfigService.get("doubao_speech_token");
						const asrCfg = loadAsrOptionsFromConfig(ConfigService);
						const streamingResourceId = "volc.bigasr.sauc.duration";
						const initBody = buildDoubaoAsrRequestBase({
							...asrCfg,
							audioFormat: "pcm",
							audioCodec: "raw",
							showUtterances: true,
							enableNonstream: false,
						});
						streamingSession = new DoubaoStreamingSession({
							appKey: speechKey,
							accessKey: speechToken,
							resourceId: streamingResourceId,
							initBody,
						});
						try {
							await streamingSession.connect();
							sendMessage(ws, {
								type: "started",
								message: `语音识别已启动（流式），用户: ${sessionData.name || ""}`,
							});
						} catch (e) {
							console.error("流式 ASR 建连失败:", e.message);
							streamingSession.close();
							streamingSession = null;
							sendMessage(ws, { type: "ERROR", message: e.message });
							break;
						}
					} else {
						sendMessage(ws, {
							type: "started",
							message: `语音识别已启动，用户: ${sessionData.name}`,
						});
					}
					mqttMessageService
						.sendToThink(command, sessionData.divideId)
						.catch(() => {});
					break;

				case "stop":
					console.log("stop", '停止录音');
					// 先冻结当前轮的音频缓冲，避免 stop 识别过程中被继续 push（并发污染）
					const stopAudioChunks = audioChunks;
					audioChunks = [];
					recordingActive = false;
					stopInProgress = true;
					if (DOUBAO_ASR_BACKEND === "streaming" && streamingSession) {
						await streamingFeedPromise.catch(() => {});
						const pcmAll = Buffer.concat(audioChunks);
						const wavBuffer = pcmToWav(pcmAll);
						const bigModelSession = { ...sessionData };
						const sess = streamingSession;
						streamingSession = null;
						audioChunks = [];
						sessionData = { divideId: connectionDivideId };
						try {
							await sess.finalize((text) => {
								sendMessage(ws, { type: "asr_partial", text });
							});
							const text = sess.getLastText();
							sess.close();

							sendMessage(ws, {
								type: "stopped",
								text,
							});
							if (pcmAll.length > 0) {
								saveAudioFile(wavBuffer).catch(console.error);
							}
							mqttMessageService
								.sendToBigModel(text, bigModelSession)
								.catch(() => {});
						} catch (error) {
							console.error("ASR处理失败:", error.message);
							sess.close();
							sendMessage(ws, {
								type: "stopped",
								error: `ASR服务异常: ${error.message}`,
							});
						}
					} else if (DOUBAO_ASR_BACKEND === "streaming") {
						sendMessage(ws, {
							type: "stopped",
							error: "流式会话未建立，请先发送 start",
						});
					} else {
						const stopSession = { ...sessionData };
						await handleStopCommand(ws, stopAudioChunks, stopSession);
						sessionData = { divideId: connectionDivideId };
					}
					stopInProgress = false;
					break;

				case "ping":
					sendMessage(ws, { type: "pong" });
					break;

				default:
					console.warn(`[WS] 未知指令: ${commandType} from ${clientIp}`);
			}
		} catch (error) {
			sendMessage(ws, { type: "ERROR", message: error.message });
		}
	});

	ws.on("close", () => {
		if (streamingSession) {
			streamingSession.close();
			streamingSession = null;
		}
		console.log(`[WS] 连接断开: ${clientIp}`);
	});
	ws.on("error", (err) => console.error("[WS] 异常:", err));
};

/**
 * 专门处理 STOP 指令及 ASR 逻辑（仅 flash；与流式 init 参数分离）
 */
async function handleStopCommand(ws, audioChunks, command) {
	if (audioChunks.length === 0) {
		sendMessage(ws, {
			type: "stopped",
			hasResult: false,
			error: "没有音频数据",
		});
		return;
	}

	try {
		const audioBuffer = Buffer.concat(audioChunks);
		const wavBuffer = pcmToWav(audioBuffer);

		const speechKey = ConfigService.get("doubao_speech_key");
		const speechToken = ConfigService.get("doubao_speech_token");
		const doubaoBoostingTableId = ConfigService.get("doubao_boosting_table_id");

		const res = await axios.post(
			BYTEDANCE_ASR_URL,
			{
				user: { uid: speechKey },
				audio: { data: wavBuffer.toString("base64") },
				request: {
					model_name: "bigmodel",
					boosting_table_id: doubaoBoostingTableId,
				},
			},
			{
				headers: {
					"X-Api-App-Key": speechKey,
					"X-Api-Access-Key": speechToken,
					"X-Api-Resource-Id": "volc.bigasr.auc_turbo",
					"X-Api-Request-Id": uuidv4(),
					"X-Api-Sequence": -1,
				},
				timeout: 10000,
			}
		);

		const text = res.data?.result?.text || "";
		console.log(text);

		sendMessage(ws, {
			type: "stopped",
			message: "语音识别已停止",
			hasResult: true,
			result: { source: "short_asr", text },
		});

		saveAudioFile(wavBuffer).catch(console.error);
		mqttMessageService.sendToBigModel(text, command).catch(() => {});
	} catch (error) {
		console.error("ASR处理失败:", error.message);
		sendMessage(ws, {
			type: "stopped",
			hasResult: false,
			error: `ASR服务异常: ${error.message}`,
		});
	}
}

async function saveAudioFile(buffer) {
	const fileName = `${dayjs().format("YYYYMMDD_HHmmss")}_${uuidv4().slice(0, 8)}.wav`;
	const filePath = path.join(AUDIO_SAVE_DIR, fileName);
	await fs.promises.writeFile(filePath, buffer);
}

function pcmToWav(pcmBuffer, sampleRate = 16000, numChannels = 1, bitsPerSample = 16) {
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + pcmBuffer.length, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(numChannels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
	header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write("data", 36);
	header.writeUInt32LE(pcmBuffer.length, 40);
	return Buffer.concat([header, pcmBuffer]);
}

module.exports = { handleSocketConnection };
