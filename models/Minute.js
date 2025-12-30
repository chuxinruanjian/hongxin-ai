'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
	class Minute extends Model {
		static associate(models) {
			// this.belongsTo(models.User);
		}
	}

	Minute.init({
		id: {
			type: DataTypes.BIGINT.UNSIGNED,
			primaryKey: true,
			autoIncrement: true
		},
		title: {
			type: DataTypes.STRING,
			allowNull: false,
			comment: '标题'
		},
		taskId: {
			field: 'task_id',
			type: DataTypes.STRING,
			allowNull: true,
			unique: true
		},
		original: {
			type: DataTypes.TEXT('long'),
			allowNull: true,
			comment: '全文转写数据'
		},
		body: {
			type: DataTypes.TEXT('long'),
			allowNull: true,
			comment: '智能摘要'
		},
		audio: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: '音频URL'
		},
		status: {
			type: DataTypes.INTEGER,
			allowNull: true,
			defaultValue: 0,
			comment: '状态'
		}
	}, {
		sequelize,
		modelName: 'Minute',
		tableName: 'minutes',
		underscored: true,
		timestamps: true
	});

	return Minute;
};
