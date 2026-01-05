const { initMqttBroker } = require('./broker');

let aedesInstance = null;

function startMqtt() {
	if (!aedesInstance) {
		aedesInstance = initMqttBroker();
	}
	return aedesInstance;
}

function getMqtt() {
	if (!aedesInstance) {
		throw new Error('MQTT broker not initialized');
	}
	return aedesInstance;
}

module.exports = {
	startMqtt,
	getMqtt
};
