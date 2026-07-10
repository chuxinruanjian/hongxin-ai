/**
 * 豆包 v3 sauc 双向流式会话：建连后持续发 PCM，按包读回识别并回调（供 /speech 实时结果）
 * 序号与帧格式与 sauc_websocket_demo.py 一致。
 */

const WebSocket = require("ws");
const {
	WS_URL,
	parseBinaryResponse,
	logDoubaoAsrServerResponse,
	extractTextFromPayload,
	buildFullClientRequest,
	buildAudioOnlyRequest,
	buildSaucUpgradeHeaders,
} = require("./doubaoStreamingAsr");

function buildUpgradeHeaders(appKey, accessKey, resourceId) {
	return buildSaucUpgradeHeaders(appKey, accessKey, resourceId);
}

class DoubaoStreamingSession {
	/**
	 * @param {Object} opts
	 * @param {string} opts.appKey
	 * @param {string} opts.accessKey
	 * @param {string} opts.resourceId
	 * @param {Object} opts.initBody - { user, audio, request }
	 * @param {number} [opts.segmentBytes] - 每包 PCM 约 100–200ms：3200≈100ms
	 * @param {number} [opts.readTimeoutMs]
	 */
	constructor(opts) {
		this.appKey = opts.appKey;
		this.accessKey = opts.accessKey;
		this.resourceId = opts.resourceId;
		this.initBody = opts.initBody;
		this.segmentBytes = opts.segmentBytes ?? 6400;
		this.readTimeoutMs = Math.max(1, Number(opts.readTimeoutMs ?? 12000) || 0);

		/** @type {import("ws")|null} */
		this.ws = null;
		this.pcmPending = Buffer.alloc(0);
		this.lastText = "";
		this.bytesSent = 0;
		/** 与 Python AsrWsClient：首帧 full 用 1，发送后自增 */
		this.seq = 1;
		this._msgQueue = [];
		/** @type {{ resolve: (b: Buffer) => void, reject: (e: Error) => void, timer: NodeJS.Timeout } | null} */
		this._currentWaiter = null;
		this._closed = false;
	}

	_logUpgradeFailure(_req, res) {
		const chunks = [];
		res.on("data", (c) => chunks.push(c));
		res.on("end", () => {
			const body = Buffer.concat(chunks).toString("utf8").slice(0, 2000);
			console.error(
				"[DoubaoStreamingSession] WebSocket 握手失败 HTTP",
				res.statusCode,
				body
			);
		});
	}

	_waitMessage() {
		return new Promise((resolve, reject) => {
			if (this._closed) {
				reject(new Error("流式会话已关闭"));
				return;
			}
			if (this._msgQueue.length > 0) {
				resolve(this._msgQueue.shift());
				return;
			}
			const waiter = { resolve, reject, timer: null };
			waiter.timer = setTimeout(() => {
				if (this._currentWaiter === waiter) {
					this._currentWaiter = null;
					reject(new Error("豆包流式读超时"));
				}
			}, this.readTimeoutMs);
			this._currentWaiter = waiter;
		});
	}

	_enqueueMessage(data) {
		const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
		if (this._currentWaiter) {
			clearTimeout(this._currentWaiter.timer);
			const { resolve } = this._currentWaiter;
			this._currentWaiter = null;
			resolve(buf);
		} else {
			this._msgQueue.push(buf);
		}
	}

	_rejectWaiter(err) {
		if (this._currentWaiter) {
			clearTimeout(this._currentWaiter.timer);
			const { reject: rej } = this._currentWaiter;
			this._currentWaiter = null;
			rej(err);
		}
	}

	async connect() {
		this.seq = 1;
		const headers = buildUpgradeHeaders(
			this.appKey,
			this.accessKey,
			this.resourceId
		);

		this.ws = new WebSocket(WS_URL, { headers });

		this.ws.on("unexpected-response", (req, res) => {
			this._logUpgradeFailure(req, res);
		});

		this.ws.on("message", (data) => {
			this._enqueueMessage(data);
		});

		this.ws.on("close", () => {
			this._closed = true;
			this._rejectWaiter(new Error("豆包连接已断开"));
		});

		await new Promise((resolve, reject) => {
			const done = () => {
				this.ws.off("error", onErr);
				this.ws.off("unexpected-response", onUnexpected);
			};
			const onErr = (err) => {
				done();
				reject(err);
			};
			const onUnexpected = (_req, res) => {
				done();
				reject(
					new Error(
						`豆包 WebSocket 握手 HTTP ${res.statusCode}：请核对控制台开通的流式 Resource-Id（常用 volc.bigasr.sauc.duration），并与 X-Api-App-Key 同属一应用`
					)
				);
			};
			this.ws.once("open", () => {
				done();
				resolve();
			});
			this.ws.once("error", onErr);
			this.ws.once("unexpected-response", onUnexpected);
		});

		this.ws.send(buildFullClientRequest(this.seq, this.initBody));
		this.seq += 1;

		const initRaw = await this._waitMessage();
		logDoubaoAsrServerResponse("init", initRaw);
		const initParsed = parseBinaryResponse(initRaw);
		if (initParsed) {
			const t = extractTextFromPayload(initParsed);
			if (t) {
				this.lastText = t;
			}
		}
	}

	async _sendPcmChunk(pcm, isLast, onPartial) {
		if (!this.ws || this.ws.readyState !== 1) {
			throw new Error("豆包 WebSocket 未连接");
		}
		if (pcm.length) {
			this.bytesSent += pcm.length;
		}
		const frame = buildAudioOnlyRequest(this.seq, pcm, isLast);
		this.ws.send(frame);
		if (!isLast) {
			this.seq += 1;
		}
		const raw = await this._waitMessage();
		logDoubaoAsrServerResponse(isLast ? "audio_last" : "audio", raw);
		const parsed = parseBinaryResponse(raw);
		if (parsed) {
			const t = extractTextFromPayload(parsed);
			if (t) {
				this.lastText = t;
				if (onPartial) {
					onPartial(t);
				}
			}
		}
	}

	/**
	 * @param {Buffer} chunk
	 * @param {(text: string) => void} [onPartial]
	 */
	async feedPcm(chunk, onPartial) {
		this.pcmPending = Buffer.concat([this.pcmPending, chunk]);
		while (this.pcmPending.length >= this.segmentBytes) {
			const slice = this.pcmPending.subarray(0, this.segmentBytes);
			this.pcmPending = this.pcmPending.subarray(this.segmentBytes);
			await this._sendPcmChunk(slice, false, onPartial);
		}
	}

	/**
	 * @param {(text: string) => void} [onPartial]
	 */
	async finalize(onPartial) {
		if (this.pcmPending.length > 0) {
			await this._sendPcmChunk(this.pcmPending, true, onPartial);
			this.pcmPending = Buffer.alloc(0);
		} else if (this.bytesSent > 0) {
			await this._sendPcmChunk(Buffer.alloc(0), true, onPartial);
		}
	}

	getLastText() {
		return this.lastText;
	}

	close() {
		this._closed = true;
		try {
			if (this.ws) {
				this.ws.close();
			}
		} catch (_) {
			/* ignore */
		}
		this.ws = null;
	}
}

module.exports = { DoubaoStreamingSession, buildUpgradeHeaders };
