/**
 * 豆包语音大模型双向流式识别（WebSocket v3 sauc）
 */

const zlib = require("zlib");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

const WS_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel";

const ProtocolVersion = { V1: 0b0001 };
const MessageType = {
	CLIENT_FULL_REQUEST: 0b0001,
	CLIENT_AUDIO_ONLY_REQUEST: 0b0010,
	SERVER_FULL_RESPONSE: 0b1001,
	SERVER_ERROR_RESPONSE: 0b1111,
};
/** 部分环境仍可能下发 0x0b，与 FULL 按同一套 body 解析 */
const SERVER_ACK_LEGACY = 0x0b;

const MessageTypeSpecificFlags = {
	POS_SEQUENCE: 0b0001,
	NEG_WITH_SEQUENCE: 0b0011,
};

const SerializationType = { JSON: 0b0001 };
const CompressionType = { GZIP: 0b0001 };

function safeJsonParse(str, ctx) {
	const s = typeof str === "string" ? str.trim() : "";
	if (!s) {
		return null;
	}
	try {
		return JSON.parse(s);
	} catch (e) {
		console.warn(
			`[ASR] JSON 解析失败${ctx ? ` (${ctx})` : ""}:`,
			e.message,
			s.slice(0, 240)
		);
		return null;
	}
}

/**
 * 与 AsrRequestHeader.to_bytes + 默认 JSON+gzip 一致
 * @param {number} messageType
 * @param {number} messageTypeSpecificFlags
 */
function buildRequestHeaderBytes(messageType, messageTypeSpecificFlags) {
	return Buffer.from([
		(ProtocolVersion.V1 << 4) | 1,
		(messageType << 4) | messageTypeSpecificFlags,
		(SerializationType.JSON << 4) | CompressionType.GZIP,
		0x00,
	]);
}

/**
 * @param {number} seq 有符号序号，首包一般为 1
 * @param {object} initBody
 */
function buildFullClientRequest(seq, initBody) {
	const header = buildRequestHeaderBytes(
		MessageType.CLIENT_FULL_REQUEST,
		MessageTypeSpecificFlags.POS_SEQUENCE
	);
	const payload = zlib.gzipSync(
		Buffer.from(JSON.stringify(initBody), "utf8")
	);
	const seqBuf = Buffer.alloc(4);
	seqBuf.writeInt32BE(seq, 0);
	const sizeBuf = Buffer.alloc(4);
	sizeBuf.writeUInt32BE(payload.length, 0);
	return Buffer.concat([header, seqBuf, sizeBuf, payload]);
}

/**
 * @param {number} seq 末包会为负值
 * @param {Buffer} segment
 * @param {boolean} isLast
 */
function buildAudioOnlyRequest(seq, segment, isLast) {
	const flags = isLast
		? MessageTypeSpecificFlags.NEG_WITH_SEQUENCE
		: MessageTypeSpecificFlags.POS_SEQUENCE;
	const seqVal = isLast ? -Math.abs(seq) : seq;
	const header = buildRequestHeaderBytes(
		MessageType.CLIENT_AUDIO_ONLY_REQUEST,
		flags
	);
	const seqBuf = Buffer.alloc(4);
	seqBuf.writeInt32BE(seqVal, 0);
	const pcm = Buffer.isBuffer(segment) ? segment : Buffer.from(segment);
	const compressed = zlib.gzipSync(pcm);
	const sizeBuf = Buffer.alloc(4);
	sizeBuf.writeUInt32BE(compressed.length, 0);
	return Buffer.concat([header, seqBuf, sizeBuf, compressed]);
}

/**
 * 对齐 ResponseParser.parse_response
 * @param {Buffer} msg
 */
function parseAsrBinaryMessage(msg) {
	const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
	if (!buf.length) {
		return null;
	}

	const headerSize = buf[0] & 0x0f;
	const messageType = buf[1] >> 4;
	const messageTypeSpecificFlags = buf[1] & 0x0f;
	const serializationMethod = buf[2] >> 4;
	const messageCompression = buf[2] & 0x0f;

	let payload = buf.subarray(headerSize * 4);

	const out = {
		messageType,
		messageTypeSpecificFlags,
		code: 0,
		event: 0,
		isLastPackage: false,
		payloadSequence: 0,
		payloadSize: 0,
		payloadMsg: null,
	};

	if (messageTypeSpecificFlags & 0x01) {
		out.payloadSequence = payload.readInt32BE(0);
		payload = payload.subarray(4);
	}
	if (messageTypeSpecificFlags & 0x02) {
		out.isLastPackage = true;
	}
	if (messageTypeSpecificFlags & 0x04) {
		out.event = payload.readInt32BE(0);
		payload = payload.subarray(4);
	}

	const isFullLike =
		messageType === MessageType.SERVER_FULL_RESPONSE ||
		messageType === SERVER_ACK_LEGACY;

	if (isFullLike) {
		if (payload.length < 4) {
			return out;
		}
		out.payloadSize = payload.readUInt32BE(0);
		payload = payload.subarray(4);
	} else if (messageType === MessageType.SERVER_ERROR_RESPONSE) {
		if (payload.length < 8) {
			return out;
		}
		out.code = payload.readInt32BE(0);
		out.payloadSize = payload.readUInt32BE(4);
		payload = payload.subarray(8);
	} else {
		return out;
	}

	if (!payload.length) {
		return out;
	}

	let body = payload;
	if (messageCompression === CompressionType.GZIP) {
		try {
			body = zlib.gunzipSync(body);
		} catch (e) {
			console.warn("[ASR] gunzip 失败:", e.message);
			return out;
		}
	} else if (body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b) {
		try {
			body = zlib.gunzipSync(body);
		} catch (_) {
			/* keep */
		}
	}

	if (serializationMethod === SerializationType.JSON) {
		out.payloadMsg = safeJsonParse(body.toString("utf8"), "binary-payload");
	}

	return out;
}

/**
 * @param {Buffer} msg
 * @returns {Object|null} payload_msg（JSON），与历史 API 一致
 */
function parseBinaryResponse(msg) {
	const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
	if (!buf.length) {
		return null;
	}

	const asUtf8 = buf.toString("utf8").trim();
	if (asUtf8.startsWith("{") || asUtf8.startsWith("[")) {
		const parsed = safeJsonParse(asUtf8, "raw-utf8");
		if (parsed) {
			return parsed;
		}
	}

	const parsed = parseAsrBinaryMessage(buf);
	if (!parsed) {
		return null;
	}
	if (parsed.messageType === MessageType.SERVER_ERROR_RESPONSE) {
		const detail =
			parsed.payloadMsg != null
				? JSON.stringify(parsed.payloadMsg)
				: "";
		throw new Error(
			`ASR 错误 ${parsed.code}${detail ? `: ${detail}` : ""}`
		);
	}
	if (
		parsed.messageType !== MessageType.SERVER_FULL_RESPONSE &&
		parsed.messageType !== SERVER_ACK_LEGACY
	) {
		return null;
	}
	return parsed.payloadMsg;
}

/**
 * 从流式 JSON 响应中尽量提取文本（兼容多种字段形态）
 */
function extractTextFromPayload(parsed) {
	if (!parsed || typeof parsed !== "object") {
		return "";
	}
	if (parsed.result) {
		const r = parsed.result;
		if (typeof r === "string") {
			return r;
		}
		if (r.text) {
			return String(r.text);
		}
		if (Array.isArray(r)) {
			return r.map((x) => x?.text || "").join("");
		}
	}
	if (Array.isArray(parsed.results)) {
		return parsed.results.map((x) => x?.text || "").join("");
	}
	if (Array.isArray(parsed.utterances)) {
		return parsed.utterances.map((u) => u?.text || "").join("");
	}
	return "";
}

/** 环境变量 DOUBAO_ASR_LOG_RESPONSE=0 时关闭控制台识别文本打印 */
const LOG_ASR_SERVER_RESPONSE = process.env.DOUBAO_ASR_LOG_RESPONSE !== "0";

/**
 * 仅打印识别出的文本（不打印完整 JSON 帧）
 * @param {string} phase - 如 init、audio、audio_last
 * @param {Buffer|ArrayBuffer|Uint8Array|string} raw
 */
function logDoubaoAsrServerResponse(phase, raw) {
	if (!LOG_ASR_SERVER_RESPONSE) {
		return;
	}
	try {
		if (raw == null) {
			return;
		}
		let text = "";
		if (typeof raw === "string") {
			const p = safeJsonParse(raw, "");
			text = p ? extractTextFromPayload(p) : raw.trim();
		} else {
			const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
			if (!buf.length) {
				return;
			}
			const asUtf8 = buf.toString("utf8").trim();
			if (asUtf8.startsWith("{") || asUtf8.startsWith("[")) {
				const p = safeJsonParse(asUtf8, "");
				text = p ? extractTextFromPayload(p) : "";
			} else {
				const meta = parseAsrBinaryMessage(buf);
				if (!meta) {
					return;
				}
				if (meta.messageType === MessageType.SERVER_ERROR_RESPONSE) {
					const errStr =
						meta.payloadMsg?.error != null
							? String(meta.payloadMsg.error)
							: JSON.stringify(meta.payloadMsg || {});
					console.log("[ASR 文本]", phase, `(错误 ${meta.code})`, errStr);
					return;
				}
				text = extractTextFromPayload(meta.payloadMsg);
			}
		}
		if (text) {
			console.log("[ASR 文本]", phase, text);
		}
	} catch (e) {
		console.warn("[ASR 文本]", phase, e.message);
	}
}

/** @deprecated 使用 buildFullClientRequest / buildAudioOnlyRequest */
function buildBinaryMessage(header, jsonOrAudio) {
	const payload = zlib.gzipSync(jsonOrAudio);
	const sizeBuf = Buffer.alloc(4);
	sizeBuf.writeUInt32BE(payload.length, 0);
	return Buffer.concat([header, sizeBuf, payload]);
}

function buildSaucUpgradeHeaders(appKey, accessKey, resourceId) {
	return {
		"X-Api-Resource-Id": resourceId,
		"X-Api-Request-Id": uuidv4(),
		"X-Api-Access-Key": accessKey,
		"X-Api-App-Key": appKey,
	};
}

/**
 * @param {Object} options
 * @param {string} options.appKey - X-Api-App-Key
 * @param {string} options.accessKey - X-Api-Access-Key
 * @param {string} options.resourceId
 * @param {Object} options.initBody - buildDoubaoAsrRequestBase 的返回值 { user, audio, request }
 * @param {Buffer} options.audioBuffer - WAV 整段字节（与 initBody.audio.format 一致，一般为 wav）
 * @param {number} [options.segmentSize]
 * @param {number} [options.readTimeoutMs]
 * @returns {Promise<string>}
 */
async function recognizeStreamingPcm(options) {
	const {
		appKey,
		accessKey,
		resourceId,
		initBody,
		audioBuffer,
		segmentSize = 32000,
		readTimeoutMs = 60000,
	} = options;

	if (!initBody || !initBody.user || !initBody.audio || !initBody.request) {
		throw new Error("流式 ASR 缺少 initBody（user/audio/request）");
	}

	if (!audioBuffer || audioBuffer.length === 0) {
		return "";
	}

	const ws = new WebSocket(WS_URL, {
		headers: buildSaucUpgradeHeaders(appKey, accessKey, resourceId),
	});

	ws.once("unexpected-response", (_req, res) => {
		const chunks = [];
		res.on("data", (c) => chunks.push(c));
		res.on("end", () => {
			console.error(
				"[recognizeStreamingPcm] 握手失败",
				res.statusCode,
				Buffer.concat(chunks).toString("utf8").slice(0, 1500)
			);
		});
	});

	await new Promise((resolve, reject) => {
		ws.once("open", resolve);
		ws.once("error", reject);
		ws.once("unexpected-response", (_req, res) => {
			reject(new Error(`豆包 WebSocket 握手 HTTP ${res.statusCode}`));
		});
	});

	const timeoutMs = Math.max(1, Number(readTimeoutMs) || 0);
	const readOne = () =>
		new Promise((resolve, reject) => {
			const t = setTimeout(() => {
				reject(new Error("豆包流式 ASR 读超时"));
			}, timeoutMs);
			ws.once("message", (data) => {
				clearTimeout(t);
				resolve(data);
			});
			ws.once("error", (e) => {
				clearTimeout(t);
				reject(e);
			});
		});

	let lastText = "";
	let seq = 1;

	try {
		ws.send(buildFullClientRequest(seq, initBody));
		seq += 1;

		const initRaw = await readOne();
		logDoubaoAsrServerResponse("init", initRaw);
		const initParsed = parseBinaryResponse(initRaw);
		if (initParsed) {
			lastText = extractTextFromPayload(initParsed) || lastText;
		}

		let offset = 0;
		while (offset < audioBuffer.length) {
			const isLast = offset + segmentSize >= audioBuffer.length;
			const chunk = audioBuffer.subarray(
				offset,
				Math.min(offset + segmentSize, audioBuffer.length)
			);
			offset += chunk.length;

			ws.send(buildAudioOnlyRequest(seq, chunk, isLast));
			if (!isLast) {
				seq += 1;
			}

			const raw = await readOne();
			logDoubaoAsrServerResponse(isLast ? "audio_last" : "audio", raw);
			const parsed = parseBinaryResponse(raw);
			if (parsed) {
				const t = extractTextFromPayload(parsed);
				if (t) {
					lastText = t;
				}
			}
		}

		return lastText;
	} finally {
		try {
			ws.close();
		} catch (_) {
			/* ignore */
		}
	}
}

module.exports = {
	recognizeStreamingPcm,
	WS_URL,
	parseBinaryResponse,
	parseAsrBinaryMessage,
	logDoubaoAsrServerResponse,
	extractTextFromPayload,
	buildFullClientRequest,
	buildAudioOnlyRequest,
	buildSaucUpgradeHeaders,
	buildBinaryMessage,
	MessageType,
};
