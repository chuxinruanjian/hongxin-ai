const dayjs = require("dayjs");
const { default: axios } = require("axios");
const redisService = require("./redisService");
const db = require("../../models");

/**
 * @param {string|number|null|undefined} divideId
 * @returns {string|undefined} 有分组时返回字符串，否则 undefined（走全局 current_exhibition）
 */
function normalizeDivideId(divideId) {
	if (divideId === null || divideId === undefined || divideId === "") {
		return undefined;
	}
	return String(divideId);
}

/**
 * MQTT 消息存储服务
 * 负责将 MQTT 消息保存到 Redis（用于切换当前展厅）
 */
class MqttMessageService {
	constructor() {
		this.settingsCache = null;
	}

	/**
	 * Redis key：无 divide_id 时为 current_exhibition，否则 current_exhibition_{divideId}
	 * @param {string|number|null|undefined} divideId
	 * @returns {string}
	 */
	currentExhibitionRedisKey(divideId) {
		const n = normalizeDivideId(divideId);
		return n ? `current_exhibition_${n}` : "current_exhibition";
	}

	/**
	 * 展项切换 MQTT 广播主题
	 * @param {string|number|null|undefined} divideId
	 * @returns {string}
	 */
	switchBroadcastTopic(divideId) {
		const n = normalizeDivideId(divideId);
		return n ? `device/all/${n}/event` : "device/all/event";
	}

	/**
	 * 保存 MQTT 消息到 Redis（更新当前展厅信息）
	 * @param {Object} messageData - 已解析的消息数据（必须包含 exhibition_id）
	 * @param {string} topic - MQTT 主题
	 * @param {string} clientId - 客户端 ID
	 * @param {string|number|null|undefined} [divideId] - 分组 ID，决定 Redis key
	 */
	async saveMessage(messageData, topic, clientId, divideId) {
		try {
			const redis = redisService.getClient();
			if (!redis || !redisService.isConnected) {
				console.warn("Redis 未连接，跳过消息保存");
				return;
			}

			const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
			const unixTimestamp = Date.now();
			const n = normalizeDivideId(divideId);

			// 构建展厅数据
			const exhibitionData = {
				exhibition_id: messageData.exhibition_id,
				client_id: clientId,
				topic: topic,
				message: JSON.stringify(messageData),
				unix_timestamp: unixTimestamp,
				updated_at: timestamp,
				divide_id: n ?? null,
			};

			const redisKey = this.currentExhibitionRedisKey(divideId);
			await redis.set(redisKey, JSON.stringify(exhibitionData));

			console.log(
				`当前展厅信息已更新到 Redis: ${redisKey}, 展厅ID: ${exhibitionData.exhibition_id}`
			);
		} catch (error) {
			console.error("保存 MQTT 消息到 Redis 失败:", error.message);
		}
	}

	/**
	 * 获取当前展厅信息
	 * @param {string|number|null|undefined} [divideId] - 不传则读全局 current_exhibition
	 * @returns {Object|null} 当前展厅信息，如果不存在返回 null
	 */
	async getCurrentExhibition(divideId) {
		try {
			const redis = redisService.getClient();
			if (!redis || !redisService.isConnected) {
				return null;
			}

			const redisKey = this.currentExhibitionRedisKey(divideId);
			const data = await redis.get(redisKey);
			if (!data) {
				return null;
			}

			return JSON.parse(data);
		} catch (error) {
			console.error("获取当前展厅信息失败:", error.message);
			return null;
		}
	}

	/**
	 * 获取当前展厅的 Redis key
	 * @param {string|number|null|undefined} [divideId]
	 */
	getCurrentExhibitionKey(divideId) {
		return this.currentExhibitionRedisKey(divideId);
	}

	/**
	 * 获取当前展项详情（包含 IP）
	 * @param {string|number|null|undefined} [divideId] - 不传则读全局槽（语音等沿用）
	 * @returns {Object} 展项模型
	 */
	async getCurrentExhibitionDetail(divideId) {
		const data = await this.getCurrentExhibition(divideId);

		if (!data || !data.exhibition_id) {
			throw new Error("无当前展项");
		}

		return this.getExhibitionById(data.exhibition_id);
	}

	/**
	 * 获取数字人接口 URL
	 * @param {string} ip
	 * @param {string} slot
	 * @returns {string}
	 */
	async getDigitalUrl(ip, slot) {
		if (!this.settingsCache) {
			const settings = await db.Setting.findAll();
			this.settingsCache = {};
			settings.forEach((setting) => {
				this.settingsCache[setting.slot] = setting.body;
			});
		}

		const settingBody = this.settingsCache[slot];
		if (!settingBody) {
			throw new Error(`未配置接口地址：${slot}`);
		}

		return `http://${ip}${settingBody}`;
	}

	/**
	 * 根据展项 ID 获取展项详情（包含 IP）
	 * @param {number|string} exhibitionId
	 * @returns {Object}
	 */
	async getExhibitionById(exhibitionId) {
		const exhibition = await db.Exhibition.findByPk(exhibitionId);
		if (!exhibition) {
			throw new Error("展项不存在");
		}

		if (!exhibition.ip) {
			throw new Error("该展项未配置IP");
		}

		return exhibition;
	}

	/**
	 * 根据展项 ID 获取展项详情
	 * @param {number|string} exhibitionId
	 * @returns {Object}
	 */
	async getExhibitionByIdNoError(exhibitionId) {
		const exhibition = await db.Exhibition.findByPk(exhibitionId);

		return exhibition;
	}

	/**
	 * 统一向当前展项发送请求
	 * @param {string} slot
	 * @param {Object} payload
	 * @param {string|number|null|undefined} [divideId] - 有值则读该分组 Redis 槽，否则读全局 current_exhibition
	 */
	async sendToExhibition(slot, payload, divideId) {
		const exhibition = await this.getCurrentExhibitionDetail(divideId);
		return this.sendToExhibitionByIp(slot, exhibition.ip, payload, exhibition.id);
	}

	/**
	 * 向指定 IP 的展项发送请求
	 * @param {string} slot
	 * @param {string} ip
	 * @param {Object} payload
	 * @param {number|string} exhibitionId
	 */
	async sendToExhibitionByIp(slot, ip, payload, exhibitionId) {
		const url = await this.getDigitalUrl(ip, slot);

		console.log("Digital request send", {
			slot,
			exhibition_id: exhibitionId,
			ip: ip,
			url,
			payload,
		});

		await axios.post(url, payload, { timeout: 3000 });
	}

	/**
	 * 数字人启动
	 * @param {Object} command
	 * @param {string|number|null|undefined} [divideId] - 与 /speech?divide_id= 一致，无则全局槽
	 */
	async sendToThink(command, divideId) {
		try {
			await this.sendToExhibition(
				"digital_start",
				{
					user: { name: command.name || "" },
				},
				divideId
			);
			return { message: "发送成功" };
		} catch (error) {
			console.error("Digital request failed", {
				slot: "digital_start",
				error: error.message,
			});
			return null;
		}
	}

	/**
	 * 数字人发送 URL / 文本
	 * @param {string} text
	 * @param {Object} sessionData - 可含 divideId（与语音 WS URL 分组一致）
	 */
	async sendToBigModel(text, sessionData) {
		try {
			await this.sendToExhibition(
				"digital_url",
				{
					text: text,
					type: 1,
					user: { name: sessionData.name || "通通" },
				},
				sessionData?.divideId
			);
			return { message: "发送成功" };
		} catch (error) {
			console.error("Digital request failed", {
				slot: "digital_url",
				error: error.message,
			});
			return null;
		}
	}
}

// 单例模式
const mqttMessageService = new MqttMessageService();

module.exports = mqttMessageService;
module.exports.normalizeDivideId = normalizeDivideId;
