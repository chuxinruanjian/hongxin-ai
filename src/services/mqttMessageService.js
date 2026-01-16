const dayjs = require("dayjs");
const redisService = require("./redisService");

/**
 * MQTT 消息存储服务
 * 负责将 MQTT 消息保存到 Redis（用于切换当前展厅）
 */
class MqttMessageService {
	constructor() {
		// Redis key 前缀（兼容 Laravel，Laravel 默认使用 laravel_database: 前缀）
		this.redisPrefix = process.env.REDIS_PREFIX || "laravel_database:";
		// 固定的 Redis key（用于存储当前展厅信息）
		this.currentExhibitionKey = `${this.redisPrefix}current_exhibition`;
	}

	/**
	 * 保存 MQTT 消息到 Redis（更新当前展厅信息）
	 * @param {Object} packet - MQTT 消息包
	 * @param {Object} client - MQTT 客户端对象
	 */
	async saveMessage(packet, client) {
		if (!client) {
			return;
		}

		try {
			const redis = redisService.getClient();
			if (!redis || !redisService.isConnected) {
				console.warn("Redis 未连接，跳过消息保存");
				return;
			}

			const message = packet.payload.toString();
			const topic = packet.topic;
			const clientId = client.id;

			// 解析消息内容（假设是 JSON 格式）
			let messageData = {};
			try {
				messageData = JSON.parse(message);
			} catch (e) {
				// 如果不是 JSON，直接返回，不保存
				console.log("消息不是 JSON 格式，跳过保存");
				return;
			}

			// 判断是否有 exhibition_id，没有就不保存
			if (!messageData.hasOwnProperty("exhibition_id") || messageData.exhibition_id === null || messageData.exhibition_id === undefined) {
				console.log("消息中没有 exhibition_id，跳过保存");
				return;
			}

			const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
			const unixTimestamp = Date.now();

			// 构建展厅数据
			const exhibitionData = {
				exhibition_id: messageData.exhibition_id,
				client_id: clientId,
				topic: topic,
				message: message,
				timestamp: timestamp,
				unix_timestamp: unixTimestamp,
				updated_at: timestamp,
			};

			// 使用固定的 key，如果不存在就创建，存在就更新
			await redis.set(
				this.currentExhibitionKey,
				JSON.stringify(exhibitionData)
			);

			console.log(
				`当前展厅信息已更新到 Redis: ${this.currentExhibitionKey}, 展厅ID: ${exhibitionData.exhibition_id}`
			);
		} catch (error) {
			console.error("保存 MQTT 消息到 Redis 失败:", error.message);
		}
	}

	/**
	 * 获取 Redis key 前缀
	 */
	getPrefix() {
		return this.redisPrefix;
	}

	/**
	 * 获取当前展厅的 Redis key
	 */
	getCurrentExhibitionKey() {
		return this.currentExhibitionKey;
	}
}

// 单例模式
const mqttMessageService = new MqttMessageService();

module.exports = mqttMessageService;
