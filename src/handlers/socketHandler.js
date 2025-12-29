const dayjs = require("dayjs");
const fs = require("fs");
const path = require("path");
const { BaiduShortAsrService } = require("../services/baiduShortAsrService");
const { default: axios } = require("axios");

// 确保存储目录存在
const AUDIO_SAVE_DIR = path.join(process.cwd(), "uploads", "records");
if (!fs.existsSync(AUDIO_SAVE_DIR)) {
  fs.mkdirSync(AUDIO_SAVE_DIR, { recursive: true });
}

const handleSocketConnection = (ws, wss, req) => {
  const clientIp = req.socket.remoteAddress;

  // 用于收集音频数据（用于短语音识别）
  const audioChunks = [];

  // 监听客户端发来的消息
  ws.on("message", async (data, isBinary) => {
    if (isBinary) {
      // 收集音频数据（用于短语音识别）
      audioChunks.push(Buffer.from(data));
    } else {
      // 这是普通的文本消息 (String)
      const message = data.toString();

      try {
        const command = JSON.parse(message);

        // 处理不同的指令（支持设备的小写指令格式）
        const commandType = command.type.toLowerCase();

        switch (commandType) {
          case "start":
            // 启动语音识别（开始收集音频数据）
            // 清空之前收集的音频数据
            audioChunks.length = 0;

            ws.send(
              JSON.stringify({
                type: "started",
                message: "语音识别已启动，开始收集音频数据",
                time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
              })
            );
            break;

          case "stop":
            // 停止语音识别并调用短语音识别
            console.log("停止语音识别");

            // 构建响应消息
            const response = {
              type: "stopped",
              message: "语音识别已停止",
              time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
            };

            // 组合收集的音频数据并调用短语音识别
            if (audioChunks.length > 0) {
              try {
                // 组合所有音频数据
                const audioBuffer = Buffer.concat(audioChunks);

                // 创建短语音识别服务
                const apiKey = process.env.BAIDU_API_KEY;
                const secretKey = process.env.BAIDU_SECRET_KEY;

                if (apiKey && secretKey) {
                  const shortAsrService = new BaiduShortAsrService({
                    apiKey: apiKey,
                    secretKey: secretKey,
                  });

                  // 调用短语音识别
                  const shortAsrResult = await shortAsrService.recognize(
                    audioBuffer
                  );

                  if (shortAsrResult.success) {
                    response.hasResult = true;
                    response.result = {
                      source: "short_asr",
                      text: shortAsrResult.result,
                      fullText: shortAsrResult.result,
                    };

                    // 异步发送到大模型（不等待响应，立即通知客户端）
                    sendToBigModel(
                      {
                        fullText: shortAsrResult.result,
                        count: 1,
                        texts: [shortAsrResult.result],
                      },
                      command
                    ).catch((error) => {
                      // 异步请求的错误不影响主流程，只记录日志
                      console.error("大模型请求失败（异步）:", error.message);
                    });
                  } else {
                    response.hasResult = false;
                    response.result = null;
                    response.error = shortAsrResult.error;
                  }
                } else {
                  console.warn(
                    "未配置 BAIDU_API_KEY 和 BAIDU_SECRET_KEY，无法进行短语音识别"
                  );
                  response.hasResult = false;
                  response.result = null;
                  response.error = "未配置百度 API 密钥";
                }

                // 1. 转换成 WAV (百度识别通常用 16000 采样率)
                const wavBuffer = pcmToWav(audioBuffer, 16000, 1, 16);

                // 2. 准备路径和文件名
                const fileName = `${dayjs().format("YYYYMMDD_HHmmss")}.wav`;
                const filePath = path.join(AUDIO_SAVE_DIR, fileName);
                fs.writeFileSync(filePath, wavBuffer);
              } catch (error) {
                console.error("短语音识别失败:", error.message);
                response.hasResult = false;
                response.result = null;
                response.error = error.message;
              }
            } else {
              console.warn("没有收集到音频数据");
              response.hasResult = false;
              response.result = null;
              response.error = "没有音频数据";
            }

            // 清空音频数据
            audioChunks.length = 0;

            ws.send(JSON.stringify(response));
            break;

          case "ping":
            // 心跳检测
            ws.send(
              JSON.stringify({
                type: "pong",
                time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
              })
            );
            break;

          default:
            console.warn(`未知的指令类型: ${command.type}`);
        }
      } catch (error) {
        ws.send(
          JSON.stringify({
            type: "ERROR",
            message: error.message,
            time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
          })
        );
      }
    }
  });

  ws.on("close", () => {
    console.log(`WS 连接已断开 (${clientIp})`);
  });

  ws.on("error", (err) => {
    console.error("WS 错误:", err);
  });
};

async function sendToBigModel(result, command) {
  try {
    const res = await axios.post(
      "http://192.168.0.100:8888/api/bigmodel",
      {
        text: result.fullText,
        type: command.num || 1,
        user: { name: command.name || "通通" },
      },
      {
        timeout: 5000, // 一定要加，防止卡死
      }
    );

    console.log("请求成功:", res.data);
    return res.data;
  } catch (err) {
    // ❗错误被捕获，Node 不会崩
    if (err.response) {
      console.error("接口返回错误:", err.response.status, err.response.data);
    } else if (err.request) {
      console.error("请求已发送但无响应（网络/服务未启动）");
    } else {
      console.error("请求配置错误:", err.message);
    }

    return null;
  }
}

/**
 * 将 PCM 数据封装成 WAV 格式
 * @param {Buffer} pcmBuffer 原始PCM数据
 * @param {number} sampleRate 采样率 (百度通常是 16000)
 * @param {number} numChannels 声道数 (通常是 1)
 * @param {number} bitsPerSample 位深 (通常是 16)
 */
function pcmToWav(pcmBuffer, sampleRate = 16000, numChannels = 1, bitsPerSample = 16) {
  const header = Buffer.alloc(44);

  // RIFF identifier 'RIFF'
  header.write('RIFF', 0);
  // file length
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  // RIFF type 'WAVE'
  header.write('WAVE', 8);
  // format chunk identifier 'fmt '
  header.write('fmt ', 12);
  // format chunk length
  header.writeUInt32LE(16, 16);
  // sample format (raw)
  header.writeUInt16LE(1, 20);
  // channel count
  header.writeUInt16LE(numChannels, 22);
  // sample rate
  header.writeUInt32LE(sampleRate, 24);
  // byte rate (sample rate * block align)
  header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  // block align (channel count * bytes per sample)
  header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  // bits per sample
  header.writeUInt16LE(bitsPerSample, 34);
  // data chunk identifier 'data'
  header.write('data', 36);
  // data chunk length
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

module.exports = { handleSocketConnection };
