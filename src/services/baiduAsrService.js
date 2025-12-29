const WebSocket = require("ws");
const dayjs = require("dayjs");
const { v4: uuidv4 } = require("uuid");

/**
 * 百度语音识别服务
 * 使用 appId 和 appKey 直接认证
 */
class BaiduAsrService {
  constructor(config) {
    this.config = {
      appId: config.appId,
      appKey: config.appKey,
      devPid: config.devPid || 15372,
      format: config.format || "pcm",
      rate: config.rate || 16000,
      cuid: config.cuid || `hongxinos-${Date.now()}`,
    };

    this.baiduWs = null;
    this.clientWs = null;
    this.isRecording = false;
    this.recognizedTexts = []; // 累积本次识别的所有文字
  }

  /**
   * 启动实时语音识别
   * @param {WebSocket} clientWs - 客户端 WebSocket 连接
   */
  async startRecognition(clientWs) {
    if (this.isRecording) {
      console.warn("语音识别已在运行中");
      return;
    }

    try {
      this.clientWs = clientWs;
      
      // 清空之前的识别结果
      this.recognizedTexts = [];

      // 连接百度 WebSocket 服务
      await this.connectBaiduWs();

      console.log(`✅ 百度语音识别服务已启动`);
    } catch (error) {
      console.error("❌ 启动语音识别失败:", error.message);
      this.isRecording = false;
      throw error;
    }
  }

  /**
   * 连接百度 WebSocket 服务
   */
  connectBaiduWs() {
    return new Promise((resolve, reject) => {
      let resolved = false;

      const uuid = uuidv4();
      // 百度实时语音识别 WebSocket 地址
      const wsUrl = "wss://vop.baidu.com/realtime_asr?sn=" + uuid;

      console.log(`正在连接百度 WebSocket: ${wsUrl}`);
      this.baiduWs = new WebSocket(wsUrl);

      // 连接成功
      this.baiduWs.on("open", () => {
        console.log(`✅ 已连接到百度语音识别服务`);

        // 发送 START 指令（按照百度文档格式）
        const startMessage = this.buildStartMessage();
        console.log(`发送 START 消息:`, JSON.stringify(startMessage, null, 2));
        this.baiduWs.send(JSON.stringify(startMessage));

        // 发送 START 后立即设置 isRecording，开始接收音频数据
        // 百度会在收到音频数据后返回结果，不需要等待确认消息
        if (!resolved) {
          resolved = true;
          this.isRecording = true;
          console.log(`✅ 百度语音识别已启动，等待音频数据...`);
          resolve();
        }
      });

      // 接收百度返回的识别结果
      this.baiduWs.on("message", (data) => {
        const message = this.handleBaiduMessage(data);

        // 如果收到错误消息，记录错误
        if (message && message.err_no && message.err_no !== 0) {
          console.error(`[百度错误] err_no=${message.err_no}, err_msg=${message.err_msg}`);
          
          // -3101: wait audio over time (等待音频超时)
          // 这通常是因为音频数据发送不及时，但现在应该已经修复
          if (message.err_no === -3101) {
            console.warn(`音频超时错误，可能是音频数据发送延迟`);
          }
          
          // 其他严重错误（认证失败等），关闭连接
          if (message.err_no < -3000 && message.err_no !== -3101) {
            console.error(`严重错误 (err_no=${message.err_no})，关闭连接`);
            this.isRecording = false;
            if (this.baiduWs) {
              this.baiduWs.close();
            }
          }
        }
      });

      // 连接关闭
      this.baiduWs.on("close", (code, reason) => {
        console.log(
          `百度 WebSocket 连接已关闭: code=${code}, reason=${
            reason?.toString() || "未知"
          }`
        );
        this.isRecording = false;
        if (!resolved) {
          resolved = true;
          reject(new Error(`连接关闭: code=${code}`));
        }
      });

      // 连接错误
      this.baiduWs.on("error", (error) => {
        console.error("百度 WebSocket 错误:", error.message);
        this.isRecording = false;
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      });
    });
  }

  /**
   * 构建 START 消息（按照百度文档格式）
   */
  buildStartMessage() {
    const data = {
      appid: parseInt(this.config.appId),
      appkey: this.config.appKey,
      dev_pid: this.config.devPid,
      format: this.config.format,
      sample: this.config.rate,
      cuid: this.config.cuid,
    };

    // 如果使用中文多方言模型（15376），需要添加 user 参数
    if (this.config.devPid === 15376) {
      data.user = "hongxinos";
    }
    console.log(data);
    return {
      type: "START",
      data: data,
    };
  }

  /**
   * 处理百度返回的消息
   * @returns {Object} 解析后的消息对象
   */
  handleBaiduMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      console.log(`百度识别结果:`, JSON.stringify(message, null, 2));

      // 处理不同类型的消息
      if (message.type === "MID_TEXT") {
        // 中间识别结果
        console.log(`[中间结果] ${message.result}`);
      } else if (message.type === "FIN_TEXT") {
        // 最终识别结果
        console.log(`[最终结果] ${message.result}`);
        
        // 累积识别结果
        if (message.result && message.result.trim()) {
          this.recognizedTexts.push(message.result.trim());
        }
      } else if (message.type === "ERROR") {
        // 错误信息
        console.error(
          `[识别错误] ${message.error_msg || JSON.stringify(message)}`
        );
      } else {
        // 其他类型的消息（如状态消息）
        console.log(`[百度消息] type=${message.type}`);
      }

      // 返回识别结果给客户端
      if (this.clientWs && this.clientWs.readyState === WebSocket.OPEN) {
        this.clientWs.send(
          JSON.stringify({
            type: "ASR_RESULT",
            data: message,
            time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
          })
        );
      }

      return message;
    } catch (error) {
      console.error("解析百度消息失败:", error.message);
      console.error("原始数据:", data.toString());
      return null;
    }
  }

  /**
   * 发送音频数据到百度
   * @param {Buffer} audioData - 音频数据
   */
  sendAudioData(audioData) {
    if (!this.isRecording) {
      console.warn("❌ isRecording=false，无法发送音频");
      return;
    }
    
    if (!this.baiduWs) {
      console.warn("❌ baiduWs 未初始化，无法发送音频");
      return;
    }
    
    if (this.baiduWs.readyState !== WebSocket.OPEN) {
      console.warn(`❌ baiduWs 状态=${this.baiduWs.readyState}，无法发送音频`);
      return;
    }

    // 直接发送二进制音频数据
    this.baiduWs.send(audioData);
  }

  /**
   * 停止语音识别
   * @returns {Object} 识别结果信息
   */
  stopRecognition() {
    if (!this.isRecording) {
      return {
        hasResult: false,
        count: 0,
        texts: [],
        fullText: "",
      };
    }

    console.log(`正在停止语音识别...`);

    // 获取识别结果
    const result = this.getRecognizedTexts();

    // 打印本次识别的所有文字
    this.printRecognizedTexts();

    // 发送 FINISH 指令
    if (this.baiduWs && this.baiduWs.readyState === WebSocket.OPEN) {
      this.baiduWs.send(
        JSON.stringify({
          type: "FINISH",
        })
      );

      // 延迟关闭，等待最后的识别结果
      setTimeout(() => {
        if (this.baiduWs) {
          this.baiduWs.close();
          this.baiduWs = null;
        }
      }, 1000);
    }

    this.isRecording = false;
    console.log(`✅ 语音识别已停止`);
    
    return result;
  }

  /**
   * 获取本次识别的所有文字
   * @returns {Object} 包含识别结果的对象
   */
  getRecognizedTexts() {
    return {
      hasResult: this.recognizedTexts.length > 0,
      count: this.recognizedTexts.length,
      texts: [...this.recognizedTexts], // 返回副本
      fullText: this.recognizedTexts.join(" "),
    };
  }

  /**
   * 打印本次识别的所有文字
   */
  printRecognizedTexts() {
    if (this.recognizedTexts.length === 0) {
      console.log(`\n📝 本次识别结果：无`);
      return;
    }

    const fullText = this.recognizedTexts.join(" ");
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📝 本次识别结果（共 ${this.recognizedTexts.length} 句）：`);
    console.log(`${"=".repeat(60)}`);
    console.log(fullText);
    console.log(`${"=".repeat(60)}\n`);
    
    // 同时打印每句话
    this.recognizedTexts.forEach((text, index) => {
      console.log(`  ${index + 1}. ${text}`);
    });
    console.log(`${"=".repeat(60)}\n`);
  }

  /**
   * 取消语音识别（立即关闭）
   */
  cancelRecognition() {
    // 打印已识别的文字（如果有）
    if (this.recognizedTexts.length > 0) {
      this.printRecognizedTexts();
    }
    
    if (this.baiduWs) {
      this.baiduWs.close();
      this.baiduWs = null;
    }
    this.isRecording = false;
    console.log(`❌ 语音识别已取消`);
  }
}

module.exports = { BaiduAsrService };
