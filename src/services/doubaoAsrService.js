const axios = require("axios");
const {v4: uuidv4} = require("uuid");
const {wssNotice} = require("../handlers/socketRouter");

const doubaoAppId = process.env.DOUBAO_APP_ID;
const doubaoAccessToken = process.env.DOUBAO_ACCESS_TOKEN;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 提交 ASR 任务
 */
async function submitAsrTask(item, requestId) {
	const res = await axios.post("https://openspeech.bytedance.com/api/v3/auc/lark/submit", {
		"Input": {"Offline": {"FileURL": item.fileUrl, "FileType": "audio"}}, "Params": {
			"AllActivate": true,
			"SourceLang": "zh_cn",
			"AudioTranscriptionEnable": true,
			"AudioTranscriptionParams": {"SpeakerIdentification": true, "NumberOfSpeaker": 0},
			"InformationExtractionEnabled": true,
			"InformationExtractionParams": {"Types": ["todo_list", "question_answer"]},
			"SummarizationEnabled": true,
			"SummarizationParams": {"Types": ["summary"]},
			"ChapterEnabled": true
		}
	}, {
		headers: {
			"X-Api-App-Key": doubaoAppId,
			"X-Api-Access-Key": doubaoAccessToken,
			"X-Api-Resource-Id": "volc.lark.minutes",
			"X-Api-Request-Id": requestId,
			"X-Api-Sequence": -1
		}
	});

	if (res.data && res.data.Data) {
		return res.data.Data.TaskID;
	}
	throw new Error(`提交失败: ${JSON.stringify(res.data)}`);
}

/**
 * 轮询并下载 JSON
 */
async function pollAndFetchResult(taskId, requestId) {
	let retryCount = 0;
	const maxRetries = 30;

	while (retryCount < maxRetries) {
		const queryRes = await axios.post("https://openspeech.bytedance.com/api/v3/auc/lark/query", {
			"TaskID": taskId
		}, {
			headers: {
				"X-Api-App-Key": doubaoAppId,
				"X-Api-Access-Key": doubaoAccessToken,
				"X-Api-Resource-Id": "volc.lark.minutes",
				"X-Api-Request-Id": requestId
			}
		});

		const data = queryRes.data.Data;

		if (data.Status === "success") {
			const fileUrls = data.Result;
			const finalData = {};

			const downloadPromises = Object.keys(fileUrls).map(async (key) => {
				const url = fileUrls[key];
				if (url && url.startsWith("http")) {
					try {
						const fileRes = await axios.get(url);
						finalData[key] = fileRes.data;
					} catch (err) {
						console.error(`下载文件 ${key} 失败:`, err.message);
					}
				}
			});

			await Promise.all(downloadPromises);
			return finalData;
		} else if (data.Status === "failed") {
			throw new Error(`字节处理失败: ${data.ErrMessage}`);
		}

		await sleep(5000);
		retryCount++;
	}
	throw new Error("轮询超时");
}

/**
 * 核心工作流入口
 */
async function runAsrWorkflow(item) {
	if (!item.fileUrl) return;
	const requestId = uuidv4();
	console.log(`开始处理任务, UUID: ${requestId}`);

	const taskId = await submitAsrTask(item, requestId);
	const finalData = await pollAndFetchResult(taskId, requestId);

	const result = {
		title: finalData.SummarizationFile.title,
		body: finalData.SummarizationFile.paragraph,
		original: Array.isArray(finalData?.AudioTranscriptionFile)
			? finalData.AudioTranscriptionFile
				.map(item => item?.content)
				.filter(Boolean)
				.join('\n')
			: ''
	}

	console.log(`任务 ${requestId} 完成，结果已获取`);
	// 如果是云端，则广播给所有连接的客户端（包括你的本地机器）
	if (process.env.IS_CLOUD === 'true') {
		const payload = JSON.stringify({
			type: 'ASR_COMPLETE',
			taskId: taskId,
			data: result
		});

		wssNotice.clients.forEach(client => {
			if (client.readyState === 1) { // WebSocket.OPEN
				client.send(payload);
			}
		});
	}
	return finalData;
}

module.exports = {
	runAsrWorkflow
};
