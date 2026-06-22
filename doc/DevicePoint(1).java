package com.chiebot.robot.admin.api.entity.devicePoint;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.activerecord.Model;
import com.chiebot.robot.admin.api.enums.PositionStateTypeEnum;
import com.chiebot.robot.admin.api.enums.devicePoint.DemarcateStateEnum;
import com.chiebot.robot.common.core.constant.enums.*;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.*;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * @Author wangzw
 * @Date 2023/1/29 13:47
 */
@EqualsAndHashCode(callSuper = true)
@Data
@ApiModel(value = "点位表")
@TableName("device_point")
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class DevicePoint extends Model<DevicePoint> {

	private static final long serialVersionUID = 1L;

	/**
	 * 主键id
	 */
	@TableId(value = "id", type = IdType.AUTO)
	@ApiModelProperty(value = "主键id")
	private Long id;

	/**
	 * 点位名称
	 */
	@ApiModelProperty(value = "点位名称")
	@TableField("point_name")
	private String pointName;

	/**
	 * 点位编码
	 */
	@ApiModelProperty(value = "点位编码")
	@TableField("point_code")
	private String pointCode;

	/**
	 * 告警等级
	 */
	@ApiModelProperty(value = "告警等级")
	@TableField("alarm_level")
	private Integer alarmLevel;

	/**
	 * 识别类型，多个用逗号分隔
	 * {@link RecTypeEnum}
	 */
	@ApiModelProperty(value = "识别类型，多个用逗号分隔")
	@TableField("recognition_type_list")
	private String recognitionTypeList;

	/**
	 * 配置状态 1、已配置 2、未配置
	 */
	@ApiModelProperty(value = "配置状态 1、已配置 2、未配置")
	@TableField(exist = false)
	private Integer analysisSettingState;

	/**
	 * 采集类型
	 * {@link CollectTypeEnum}
	 */
	@ApiModelProperty(value = "采集类型")
	@TableField("save_type_list")
	private Integer saveTypeList;

	/**
	 * 表计类型
	 * {@link MeterTypeEnum}
	 */
	@ApiModelProperty(value = "表计类型")
	@TableField("meter_type")
	private Integer meterType;

	/**
	 * 位置状态类型
	 * {@link PositionStateTypeEnum}
	 */
	@ApiModelProperty(value = "位置状态类型")
	@TableField("position_state_type")
	private Integer positionStateType;

	/**
	 * 辅助设施类型
	 * {@link AssistFacilityTypeEnum}
	 */
	@ApiModelProperty(value = "辅助设施类型")
	@TableField("appearance_type")
	private Integer appearanceType;

	/**
	 * 缺陷识别类型，多个用逗号分隔
	 * {@link DefectAppearanceRecTypeEnum}
	 */
	@ApiModelProperty(value = "缺陷识别类型，多个用逗号分隔")
	@TableField("defect_rec_type")
	private String defectRecType;

	/**
	 * 点位标签编码，多个用,拼接
	 */
	@ApiModelProperty(value = "点位标签编码，多个用,拼接")
	@TableField("point_tags_code_list")
	private String pointTagsCodeList;

	/**
	 * 点位标签名称 多个用,拼接
	 */
	@ApiModelProperty(value = "点位标签名称 多个用,拼接")
	@TableField(exist = false)
	private String pointTagsNameList;

	/**
	 * 是否是缺陷判别，0-否，1-是
	 */
	@ApiModelProperty(value = "是否是缺陷判别，0-否，1-是")
	@TableField("defect_judge_type")
	private Integer defectJudgeType;

	/**
	 * 重要等级
	 */
	@ApiModelProperty(value = "重要等级，1-Ⅰ类，2-Ⅱ类，3-Ⅲ类")
	@TableField("important_level")
	private Integer importantLevel;

	/**
	 * 是否是三相关联点位，0-否，1-是
	 */
	@ApiModelProperty(value = "是否是三相关联点位，0-否，1-是")
	@TableField("three_phase_flag")
	private Integer threePhaseFlag;

	/**
	 * 三相关联id
	 */
	@ApiModelProperty(value = "三相关联id")
	@TableField("three_phase_associate_id")
	private String threePhaseAssociateId;

	/**
	 * 标定状态，0-未标定，1-已标定
	 * {@link DemarcateStateEnum}
	 */
	@ApiModelProperty(value = "标定状态，0-未标定，1-已标定")
	@TableField("demarcate_state")
	private Integer demarcateState;

	/**
	 * 机器人id
	 */
	@ApiModelProperty(value = "机器人id")
	@TableField("robot_id")
	private Long robotId;

	/**
	 * 机器人名称
	 */
	@ApiModelProperty(value = "机器人名称")
	@TableField("robot_name")
	private String robotName;

	/**
	 * 巡检点ID，用于和图像系统交互
	 */
	@ApiModelProperty(value = "巡检点ID，用于和图像系统交互")
	@TableField("cruise_id")
	private String cruiseId;

	/**
	 * 原始标定文件路径
	 */
	@ApiModelProperty(value = "原始标定文件路径")
	@TableField("origin_calibration_path")
	private String originCalibrationPath;

	/**
	 * 扩展标定文件路径
	 */
	@ApiModelProperty(value = "扩展标定文件路径")
	@TableField("extend_calibration_path")
	private String extendCalibrationPath;

	/**
	 * 可见光标定图片路径
	 */
	@ApiModelProperty(value = "可见光标定图片路径")
	@TableField("visible_calibration_path")
	private String visibleCalibrationPath;

	/**
	 * 粗糙框
	 */
	@ApiModelProperty(value = "粗糙框")
	@TableField("thermal_region")
	private String thermalRegion;

	/**
	 * 标定id，用于和机器人本体交互
	 * 一图多点情况下：calibration_id会重复
	 */
	@ApiModelProperty(value = "标定id，用于和机器人本体交互")
	@TableField("calibration_id")
	private String calibrationId;


	/**
	 * 部件id
	 */
	@ApiModelProperty(value = "部件id")
	@TableField("component_id")
	private Long componentId;

	/**
	 * 部件类型
	 */
	@ApiModelProperty(value = "部件类型")
	@TableField("component_type")
	private String componentType;

	/**
	 * 部件名称
	 */
	@ApiModelProperty(value = "部件名称")
	@TableField("component_name")
	private String componentName;

	/**
	 * 部件编码
	 */
	@ApiModelProperty(value = "部件编码")
	@TableField("component_code")
	private String componentCode;

	/**
	 * 主设备id
	 */
	@ApiModelProperty(value = "主设备id")
	@TableField("main_device_id")
	private Long mainDeviceId;

	/**
	 * 主设备类型
	 */
	@ApiModelProperty(value = "主设备类型")
	@TableField("main_device_type")
	private Integer mainDeviceType;

	/**
	 * 主设备名称
	 */
	@ApiModelProperty(value = "主设备名称")
	@TableField("main_device_name")
	private String mainDeviceName;

	/**
	 * 主设备编码
	 */
	@ApiModelProperty(value = "主设备编码")
	@TableField("main_device_code")
	private String mainDeviceCode;

	/**
	 * 主设备相位类型，0-主体，1-A相，2-B相，3-C相
	 */
	@ApiModelProperty(value = "主设备相位类型，0-主体，1-A相，2-B相，3-C相")
	@TableField("phase_type")
	private Integer phaseType;

	/**
	 * 间隔id
	 */
	@ApiModelProperty(value = "间隔id")
	@TableField("bay_id")
	private Long bayId;

	/**
	 * 间隔类型
	 */
	@ApiModelProperty(value = "间隔类型")
	@TableField("bay_type")
	private String bayType;

	/**
	 * 间隔名称
	 */
	@ApiModelProperty(value = "间隔名称")
	@TableField("bay_name")
	private String bayName;

	/**
	 * 间隔编码
	 */
	@ApiModelProperty(value = "间隔编码")
	@TableField("bay_code")
	private String bayCode;

	/**
	 * 电压id
	 */
	@ApiModelProperty(value = "电压id")
	@TableField("volt_id")
	private Long voltId;

	/**
	 * 电压名称
	 */
	@ApiModelProperty(value = "电压名称")
	@TableField("volt_name")
	private String voltName;

	/**
	 * 电压编码
	 */
	@ApiModelProperty(value = "电压编码")
	@TableField("volt_code")
	private String voltCode;

	/**
	 * 厂站id
	 */
	@ApiModelProperty(value = "厂站id")
	@TableField("station_id")
	private Long stationId;

	/**
	 * 厂站名称
	 */
	@ApiModelProperty(value = "厂站名称")
	@TableField("station_name")
	private String stationName;

	/**
	 * 厂站编码
	 */
	@ApiModelProperty(value = "厂站编码")
	@TableField("station_code")
	private String stationCode;

	/**
	 * 巡视子类型 {@link InspectionTypeEnum} 的 inspectionSubType,逗号分隔
	 */
	@ApiModelProperty(value = "巡视子类型,逗号分隔(101:例行巡视, 201:气温骤变特巡, 202:高温特巡, 203:雾霾特巡, 204:大风特巡, 205:下雪特巡," +
			" 206:覆冰特巡, 207:雷暴特巡, 208:大（过）负荷特巡, 209:雨后特巡, 210:冰雹特巡, 211:沙尘暴特巡, 212:雪后特巡, 213:缺陷跟踪," +
			" 214:新设备投运, 215:重新投运, 216:远方异常告警确认, 217:协助应急事故处理, 218:安防联动, 219:保供电任务, 220:远方状态确认," +
			" 221:鸟巢特巡, 301:设备红外测温, 302:油位油温表抄录, 303:避雷器表计抄录, 304:SF6压力表抄录, 305:液压表抄录, 306:位置状态识别," +
			" 307:调压档位、次数抄录, 401:自定义巡视, 501:熄灯巡视)")
	private String inspectionSubType;

	/**
	 * 创建人
	 */
	@ApiModelProperty(value = "创建人")
	@TableField("create_by")
	private String createBy;

	/**
	 * 创建时间
	 */
	@ApiModelProperty(value = "创建时间")
	@TableField("create_time")
	private LocalDateTime createTime;

	/**
	 * 更新人
	 */
	@ApiModelProperty(value = "更新人")
	@TableField("update_by")
	private String updateBy;

	/**
	 * 更新时间
	 */
	@ApiModelProperty(value = "更新时间")
	@TableField("update_time")
	private LocalDateTime updateTime;

	/**
	 * 位置状态类型描述
	 */
	@ApiModelProperty(value = "位置状态类型描述")
	@TableField(exist = false)
	private String positionStateTypeDesc;

	/**
	 * 设备顺序
	 */
	@ApiModelProperty(value = "设备顺序")
	@TableField("sort_num")
	private Integer sortNum;

	/**
	 * 巡检点所在地图
	 */
	@ApiModelProperty(value = "巡检点所在地图")
	private String mapCode;

	/**
	 * 检修状态
	 */
	@ApiModelProperty(value = "检修状态")
	private Integer repairFlag;

	@ApiModelProperty(value = "备注")
	private String remark;

	@Override
	public Serializable pkVal() {
		return this.id;
	}

}
