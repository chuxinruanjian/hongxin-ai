'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
	class Exhibition extends Model {
		static associate(models) {
			// 自关联：父级展厅
			Exhibition.belongsTo(models.Exhibition, {
				foreignKey: 'parent_id',
				as: 'parent'
			});
			// 自关联：子展厅
			Exhibition.hasMany(models.Exhibition, {
				foreignKey: 'parent_id',
				as: 'children'
			});
		}
	}

	Exhibition.init({
		id: {
			type: DataTypes.BIGINT.UNSIGNED,
			primaryKey: true,
			autoIncrement: true
		},
		title: {
			type: DataTypes.STRING,
			allowNull: false,
			comment: '展厅标题'
		},
		order: {
			type: DataTypes.INTEGER,
			allowNull: true,
			defaultValue: 0,
			comment: '排序'
		},
		parentId: {
			field: 'parent_id',
			type: DataTypes.BIGINT.UNSIGNED,
			allowNull: true,
			comment: '父级展厅ID',
			references: {
				model: 'exhibitions',
				key: 'id'
			}
		},
		depth: {
			type: DataTypes.INTEGER,
			allowNull: true,
			defaultValue: 0,
			comment: '层级深度'
		},
		type: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: '类型'
		},
		active: {
			type: DataTypes.BOOLEAN,
			allowNull: true,
			defaultValue: true,
			comment: '是否激活'
		},
		ip: {
			type: DataTypes.STRING,
			allowNull: true,
			comment: 'IP地址'
		},
		stayDuration: {
			field: 'stay_duration',
			type: DataTypes.INTEGER,
			allowNull: true,
			defaultValue: 0,
			comment: '停留时长（秒）'
		}
	}, {
		sequelize,
		modelName: 'Exhibition',
		tableName: 'exhibitions',
		underscored: true,
		timestamps: true
	});

	return Exhibition;
};
