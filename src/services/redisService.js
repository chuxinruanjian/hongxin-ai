const Redis = require("ioredis");

/**
 * Redis 服务
 * 提供 Redis 连接实例
 */
class RedisService {
	constructor() {
		this.client = null;
		this.isConnected = false;
	}

	/**
	 * 初始化 Redis 连接
	 */
	init() {
		if (this.client) {
			return this.client;
		}

		this.client = new Redis({
			host: process.env.REDIS_HOST || "127.0.0.1",
			port: process.env.REDIS_PORT || 6379,
			password: process.env.REDIS_PASSWORD || null,
			db: process.env.REDIS_DB || 0,
			retryStrategy: (times) => {
				const delay = Math.min(times * 50, 2000);
				return delay;
			},
		});

		this.client.on("connect", () => {
			this.isConnected = true;
			console.log("✅ Redis 连接成功");
		});

		this.client.on("error", (err) => {
			this.isConnected = false;
			console.error("❌ Redis 连接错误:", err.message);
		});

		this.client.on("close", () => {
			this.isConnected = false;
			console.log("Redis 连接已关闭");
		});

		return this.client;
	}

	/**
	 * 获取 Redis 客户端实例
	 */
	getClient() {
		if (!this.client) {
			this.init();
		}
		return this.client;
	}

	/**
	 * 关闭 Redis 连接
	 */
	async close() {
		if (this.client) {
			await this.client.quit();
			this.client = null;
			this.isConnected = false;
		}
	}
}

// 单例模式
const redisService = new RedisService();

module.exports = redisService;
