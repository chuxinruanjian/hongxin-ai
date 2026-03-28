const mqttMessageService = require("../services/mqttMessageService");

/**
 * App WebSocket 连接处理：连接后立即推送当前展项（按 query divide_id 读对应 Redis 槽），
 * 展项切换时由 switchExhibitionService 向同分组客户端广播。
 * 连接示例：ws://host/app?divide_id=1 ，不传则读全局 current_exhibition。
 */
async function handleAppConnection(ws, req) {
  const u = new URL(req.url || "/app", "http://127.0.0.1");
  const divideParam = u.searchParams.get("divide_id");
  const divideId =
    divideParam === null || divideParam === "" ? undefined : divideParam;
  ws._divideId = divideId;

  try {
    const current = await mqttMessageService.getCurrentExhibition(divideId);
    let detail = null;
    if (current?.exhibition_id) {
      detail = await mqttMessageService.getExhibitionByIdNoError(
        current.exhibition_id
      );
    }
    const payload = {
      type: "currentExhibition",
      data: {
        exhibition_id: current?.exhibition_id,
        exhibition_name: detail?.title,
        client_id: current?.client_id,
        updated_at: current?.updated_at,
        divide_id: current?.divide_id ?? divideId ?? null,
      },
    };
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
    }
  } catch (err) {
    console.error("App 连接时获取当前展项失败:", err.message);
    if (ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          type: "currentExhibition",
          data: null,
          error: err.message,
        }),
      );
    }
  }
}

module.exports = { handleAppConnection };
