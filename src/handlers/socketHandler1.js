const dayjs = require("dayjs");
const { BaiduAsrService } = require("../services/baiduAsrService");
const { default: axios } = require("axios");

const handleSocketConnection = (ws, wss, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[${dayjs().format("HH:mm:ss")}] 新 WS 连接来自: ${clientIp}`);

  // 为每个客户端创建一个百度 ASR 服务实例
  let asrService = null;

  // 监听客户端发来的消息
  ws.on("message", async (data, isBinary) => {
    if (isBinary) {
      // 如果 ASR 服务已启动，发送音频数据
      if (asrService && asrService.isRecording) {
        asrService.sendAudioData(data);
      }
    } else {
      // 这是普通的文本消息 (String)
      const message = data.toString();

      try {
        const command = JSON.parse(message);

        // 处理不同的指令（支持设备的小写指令格式）
        const commandType = command.type.toLowerCase();

        switch (commandType) {
          case "start":
            // 启动语音识别
            // 从环境变量读取 appId 和 appKey
            const appId = process.env.BAIDU_APP_ID;
            const appKey = process.env.BAIDU_API_KEY;

            if (!appId || !appKey) {
              const errorMsg =
                "缺少百度配置：请设置 BAIDU_APP_ID 和 BAIDU_API_KEY";
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  message: errorMsg,
                  time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
                })
              );
              break;
            }

            if (!asrService) {
              // 创建 ASR 服务实例
              asrService = new BaiduAsrService({
                appId: appId,
                appKey: appKey,
                cuid: `device-${command.num || Date.now()}`,
              });
            }

            try {
              await asrService.startRecognition(ws);
              ws.send(
                JSON.stringify({
                  type: "started",
                  message: "语音识别已启动",
                  time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
                })
              );
            } catch (error) {
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  message: `启动失败: ${error.message}`,
                  time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
                })
              );
            }
            break;

          case "stop":
            // 停止语音识别
            console.log("停止语音识别");

            if (asrService) {
              // 停止识别并获取结果
              const result = asrService.stopRecognition();

              // 构建响应消息
              const response = {
                type: "stopped",
                message: "语音识别已停止",
                time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
              };

              // 判断是否有最终结果
              if (result && result.hasResult) {
                response.hasResult = true;
                response.result = {
                  count: result.count,
                  texts: result.texts,
                  fullText: result.fullText,
                };
               
                await sendToBigModel(result, command);
              } else {
                response.hasResult = false;
                response.result = null;
              }

              ws.send(JSON.stringify(response));
            } else {
              // 如果没有 ASR 服务，直接返回停止消息
              ws.send(
                JSON.stringify({
                  type: "stopped",
                  message: "语音识别已停止",
                  hasResult: false,
                  result: null,
                  time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
                })
              );
            }
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
    // 清理 ASR 服务
    if (asrService) {
      asrService.cancelRecognition();
      asrService = null;
    }
  });

  ws.on("error", (err) => {
    // 清理 ASR 服务
    if (asrService) {
      asrService.cancelRecognition();
      asrService = null;
    }
  });
};

async function sendToBigModel(result, command) {
  try {
    const res = await axios.post(
      "http://192.168.0.106:8888/api/bigmodel",
      {
        text: result.fullText,
        type: command.num || 1,
        user: {
          id: 1,
          username: "admin",
          name: "通通",
          avatar: "images/sgdYCmSoTojTAXEWORaDq7rBQqCRMWoIQor8WZR0.png",
          login_unique_changed_at: "2025-12-28 22:56:03",
          word1: null,
          word2: null,
        }
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

module.exports = { handleSocketConnection };
