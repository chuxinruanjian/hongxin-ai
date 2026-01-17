const dayjs = require("dayjs");
const redisService = require("./redisService");

/**
 * MQTT 消息存储服务
 * 负责将 MQTT 消息保存到 Redis（用于切换当前展厅）
 */
class MqttMessageService {
	constructor() {
		this.currentExhibitionKey = 'current_exhibition';
	}

	/**
	 * 保存 MQTT 消息到 Redis（更新当前展厅信息）
	 * @param {Object} messageData - 已解析的消息数据（必须包含 exhibition_id）
	 * @param {string} topic - MQTT 主题
	 * @param {string} clientId - 客户端 ID
	 */
	async saveMessage(messageData, topic, clientId) {
		try {
			const redis = redisService.getClient();
			if (!redis || !redisService.isConnected) {
				console.warn("Redis 未连接，跳过消息保存");
				return;
			}

			const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
			const unixTimestamp = Date.now();

			// 构建展厅数据
			const exhibitionData = {
				exhibition_id: messageData.exhibition_id,
				client_id: clientId,
				topic: topic,
				message: JSON.stringify(messageData),
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
	 * 获取当前展厅信息
	 * @returns {Object|null} 当前展厅信息，如果不存在返回 null
	 */
	async getCurrentExhibition() {
		try {
			const redis = redisService.getClient();
			if (!redis || !redisService.isConnected) {
				return null;
			}

			const data = await redis.get(this.currentExhibitionKey);
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
	 */
	getCurrentExhibitionKey() {
		return this.currentExhibitionKey;
	}
}

// 单例模式
const mqttMessageService = new MqttMessageService();

module.exports = mqttMessageService;
