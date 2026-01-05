const { Setting } = require('../../models');

class ConfigService {
	static cache = {};
	static loaded = false;

	/**
	 * 加载所有配置
	 */
	static async load() {
		try {
			const list = await Setting.findAll({
				attributes: ['slot', 'body']
			});

			const map = {};
			for (const item of list) {
				map[item.slot] = item.body;
			}

			this.cache = map;
			this.loaded = true;

			console.log('[ConfigService] settings loaded');
		} catch (err) {
			console.error('[ConfigService] load failed:', err.message);
		}
	}

	/**
	 * 获取配置
	 */
	static get(key, defaultValue = null) {
		if (!this.loaded) {
			console.warn('[ConfigService] not loaded yet:', key);
		}
		return this.cache[key] ?? defaultValue;
	}
}

module.exports = ConfigService;
