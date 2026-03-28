const WebSocket = require("ws");
const { handleSocketConnection } = require("./socketHandler");
const { handleAppConnection } = require("./appSocketHandler");

// 创建实例
const wssSpeech = new WebSocket.Server({ noServer: true });
const wssNotice = new WebSocket.Server({ noServer: true });
const wssApp = new WebSocket.Server({ noServer: true });

// 绑定语音逻辑
wssSpeech.on("connection", (ws, req) => {
  handleSocketConnection(ws, wssSpeech, req);
});

// 绑定通知逻辑
wssNotice.on("connection", (ws, req) => {
  console.log("Notice 业务已连接");
});

// 绑定 app 连接逻辑
wssApp.on("connection", (ws, req) => {
  handleAppConnection(ws, req);
});

/**
 * 统一的 Upgrade 处理函数
 */
const handleUpgrade = (request, socket, head) => {
  const pathname = request.url.split("?")[0];

  if (pathname === "/speech") {
    wssSpeech.handleUpgrade(request, socket, head, (ws) => {
      wssSpeech.emit("connection", ws, request);
    });
  } else if (pathname === "/notice") {
    wssNotice.handleUpgrade(request, socket, head, (ws) => {
      wssNotice.emit("connection", ws, request);
    });
  } else if (pathname === "/app") {
    wssApp.handleUpgrade(request, socket, head, (ws) => {
      wssApp.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
};

module.exports = {
  handleUpgrade,
  wssNotice,
  wssSpeech,
  wssApp,
};
