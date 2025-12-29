const axios = require("axios");
const dayjs = require("dayjs");

// 模块级别的 Token 缓存（所有实例共享）
// key: `${apiKey}_${secretKey}`, value: { token, expireTime }
const tokenCache = new Map();

/**
 * 获取百度 Access Token（模块级别共享）
 * @param {string} apiKey - API Key
 * @param {string} secretKey - Secret Key
 * @returns {Promise<string>} Access Token
 */
async function getSharedAccessToken(apiKey, secretKey) {
  const cacheKey = `${apiKey}_${secretKey}`;
  const cached = tokenCache.get(cacheKey);

  // 如果 token 还在有效期内，直接返回
  if (
    cached &&
    cached.token &&
    cached.expireTime &&
    dayjs().isBefore(cached.expireTime)
  ) {
    console.log(
      `使用缓存的 Access Token，过期时间: ${cached.expireTime.format(
        "YYYY-MM-DD HH:mm:ss"
      )}`
    );
    return cached.token;
  }

  try {
    const url = "https://aip.baidubce.com/oauth/2.0/token";
    const params = {
      grant_type: "client_credentials",
      client_id: apiKey,
      client_secret: secretKey,
    };

    console.log(`正在获取百度 Access Token...`);
    const response = await axios.get(url, { params });

    if (response.data.access_token) {
      const token = response.data.access_token;
      // Token 有效期 30 天，我们提前 1 天更新
      const expireTime = dayjs().add(29, "day");

      // 更新缓存
      tokenCache.set(cacheKey, {
        token: token,
        expireTime: expireTime,
      });

      console.log(
        `✅ Access Token 获取成功，过期时间: ${expireTime.format(
          "YYYY-MM-DD HH:mm:ss"
        )}`
      );
      return token;
    } else {
      throw new Error(
        "获取 Access Token 失败: " + JSON.stringify(response.data)
      );
    }
  } catch (error) {
    console.error("❌ 获取百度 Access Token 失败:", error.message);
    throw error;
  }
}

/**
 * 百度短语音识别极速版服务
 * 参考文档: https://cloud.baidu.com/doc/SPEECH/s/4lbxdz34z
 */
class BaiduShortAsrService {
  constructor(config) {
    this.config = {
      apiKey: config.apiKey,
      secretKey: config.secretKey,
      devPid: config.devPid || 80001,
      format: config.format || "pcm", // 音频格式
      rate: config.rate || 16000, // 采样率
      cuid: config.cuid || `hongxinos-${Date.now()}`,
    };
  }

  /**
   * 识别音频数据
   * @param {Buffer} audioBuffer - PCM 音频数据
   * @returns {Object} 识别结果
   */
  async recognize(audioBuffer) {
    try {
      // 获取 Access Token（使用共享缓存）
      const token = await getSharedAccessToken(
        this.config.apiKey,
        this.config.secretKey
      );

      // 将音频数据转换为 base64
      const audioBase64 = audioBuffer.toString("base64");

      // 构建请求 URL（根据百度文档）
      const baseUrl = "https://vop.baidu.com/pro_api";

      const bodyParams = {
        format: this.config.format,
        rate: this.config.rate,
        channel: 1,
        token: token,
        dev_pid: this.config.devPid,
        len: audioBuffer.length,
        speech: audioBase64,
        cuid: this.config.cuid,
      };

      console.log(
        `正在调用百度短语音识别极速版 API，音频大小: ${audioBuffer.length} bytes`
      );

      const response = await axios.post(baseUrl, bodyParams, {
        timeout: 10000,
      });

      if (response.data.err_no === 0) {
        console.log(`✅ 识别成功: ${response.data.result[0]}`);
        return {
          success: true,
          result: response.data.result[0],
          fullResult: response.data,
        };
      } else {
        console.error(
          `❌ 识别失败: err_no=${response.data.err_no}, err_msg=${response.data.err_msg}`
        );
        return {
          success: false,
          error: response.data.err_msg,
          errNo: response.data.err_no,
        };
      }
    } catch (error) {
      console.error("❌ 调用百度短语音识别 API 失败:", error.message);
      if (error.response) {
        console.error("响应数据:", error.response.data);
      }
      throw error;
    }
  }
}

module.exports = { BaiduShortAsrService };

