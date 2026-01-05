'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
	class Setting extends Model {}

	Setting.init({
		id: {
			type: DataTypes.BIGINT.UNSIGNED,
			primaryKey: true,
			autoIncrement: true
		},
		slot: {
			type: DataTypes.STRING,
			allowNull: false,
			comment: 'key'
		},
		body: {
			type: DataTypes.TEXT,
			allowNull: true,
			comment: 'value'
		}
	}, {
		sequelize,
		modelName: 'Setting',
		tableName: 'settings',
		underscored: true,
		timestamps: true
	});

	return Setting;
};
