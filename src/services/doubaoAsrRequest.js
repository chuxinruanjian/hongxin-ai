/**
 * 豆包大模型 ASR 请求体（极速 flash / 流式 sauc 首包）统一结构
 * 参考：user、audio(wav + language)、request(model_name、enable_*、corpus、context)
 */

/**
 * @param {string|boolean|null|undefined} val
 * @param {boolean} defaultVal
 */
function parseBoolSetting(val, defaultVal = false) {
	if (val == null || val === "") {
		return defaultVal;
	}
	if (typeof val === "boolean") {
		return val;
	}
	const s = String(val).toLowerCase();
	return s === "true" || s === "1" || s === "yes";
}

/**
 * Setting 中存 JSON 数组，如 [{"text":"上一句"},{"text":"..."}]
 * @param {string|null|undefined} raw
 * @returns {Array<{text?: string}>|null}
 */
function parseContextData(raw) {
	if (!raw || typeof raw !== "string") {
		return null;
	}
	try {
		const arr = JSON.parse(raw);
		return Array.isArray(arr) ? arr : null;
	} catch {
		return null;
	}
}

/**
 * @param {Object} options
 * @param {string} options.uid - user.uid（业务用户标识，非必填为 AppKey）
 * @param {string} [options.language]
 * @param {string} [options.audioFormat] - flash 多为 wav；实时流式首包多为 pcm
 * @param {string} [options.audioCodec] - 流式 raw pcm 时传 raw
 * @param {string} [options.modelName]
 * @param {boolean} [options.enableItn]
 * @param {boolean} [options.enableDdc]
 * @param {boolean} [options.enablePunc]
 * @param {string} [options.boostingTableId]
 * @param {string} [options.correctTableId]
 * @param {string} [options.contextType] - 如 dialog_ctx
 * @param {Array<{text?: string}>} [options.contextData]
 * @param {string} [options.reqid] - 流式等场景
 * @param {number} [options.sequence]
 * @param {boolean} [options.showUtterances] - sauc 流式官方示例 request.show_utterances
 * @param {boolean} [options.enableNonstream] - request.enable_nonstream
 * @returns {{ user: object, audio: object, request: object }}
 */
function buildDoubaoAsrRequestBase(options) {
	const {
		uid,
		language = "zh-CN",
		audioFormat = "wav",
		audioCodec,
		modelName = "bigmodel",
		enableItn = false,
		enableDdc = false,
		enablePunc = false,
		boostingTableId,
		correctTableId,
		contextType = "dialog_ctx",
		contextData,
		reqid,
		sequence,
		showUtterances,
		enableNonstream,
	} = options;

	const corpus = {};
	if (boostingTableId) {
		corpus.boosting_table_id = boostingTableId;
	}
	if (correctTableId) {
		corpus.correct_table_id = correctTableId;
	}

	const request = {
		model_name: modelName,
		enable_itn: !!enableItn,
		enable_ddc: !!enableDdc,
		enable_punc: !!enablePunc,
	};

	if (Object.keys(corpus).length > 0) {
		request.corpus = corpus;
	}

	if (
		contextType &&
		Array.isArray(contextData) &&
		contextData.length > 0
	) {
		request.context = {
			context_type: contextType,
			context_data: contextData,
		};
	}

	if (reqid != null && reqid !== "") {
		request.reqid = reqid;
	}
	if (sequence != null) {
		request.sequence = sequence;
	}
	if (showUtterances != null) {
		request.show_utterances = !!showUtterances;
	}
	if (enableNonstream != null) {
		request.enable_nonstream = !!enableNonstream;
	}

	const audio = {
		format: audioFormat,
		rate: 16000,
		bits: 16,
		channel: 1,
		language,
	};
	if (audioCodec) {
		audio.codec = audioCodec;
	}
	return {
		user: { uid: String(uid) },
		audio,
		request,
	};
}

/**
 * 从 Setting 表加载 ASR 公共参数（不含 reqid / 音频）
 * @param {{ get: (key: string, defaultValue?: unknown) => unknown }} ConfigService
 */
function loadAsrOptionsFromConfig(ConfigService) {
	const speechKey = ConfigService.get("doubao_speech_key");
	const uid = ConfigService.get("doubao_speech_uid") || speechKey;
	const language = ConfigService.get("doubao_asr_language") || "zh-CN";
	const modelName = ConfigService.get("doubao_asr_model_name") || "bigmodel";

	return {
		uid,
		language,
		audioFormat: "wav",
		modelName,
		enableItn: parseBoolSetting(ConfigService.get("doubao_asr_enable_itn"), false),
		enableDdc: parseBoolSetting(ConfigService.get("doubao_asr_enable_ddc"), false),
		enablePunc: parseBoolSetting(ConfigService.get("doubao_asr_enable_punc"), false),
		boostingTableId: ConfigService.get("doubao_boosting_table_id") || undefined,
		correctTableId: ConfigService.get("doubao_correct_table_id") || undefined,
		contextType: ConfigService.get("doubao_asr_context_type") || "dialog_ctx",
		contextData:
			parseContextData(ConfigService.get("doubao_asr_context_data")) || undefined,
	};
}

module.exports = {
	buildDoubaoAsrRequestBase,
	loadAsrOptionsFromConfig,
	parseBoolSetting,
	parseContextData,
};
