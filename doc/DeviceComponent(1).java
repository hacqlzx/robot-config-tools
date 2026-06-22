package com.chiebot.robot.admin.api.entity.pointconfig;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.activerecord.Model;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * @author QianZhiQiang
 * @since 2024-01-09 15:54
 */
@EqualsAndHashCode(callSuper = true)
@Data
@ApiModel(value = "部件表")
@TableName("device_component")
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class DeviceComponent extends Model<DeviceComponent> {

	private static final long serialVersionUID = 1L;

	/**
	 * 主键id
	 */
	@TableId(value = "id", type = IdType.AUTO)
	@ApiModelProperty(value = "主键id")
	private Long id;

	/**
	 * 部件名称
	 */
	@ApiModelProperty(value = "部件名称")
	@TableField("component_name")
	private String componentName;

	/**
	 * 部件类型
	 */
	@ApiModelProperty(value = "部件类型")
	@TableField("component_type")
	private String componentType;

	/**
	 * 部件编码
	 */
	@ApiModelProperty(value = "部件编码")
	@TableField("component_code")
	private String componentCode;

	/**
	 * 告警等级，0：正常，1：预警，2：一般告警，3：严重告警，4：危急告警
	 */
	@ApiModelProperty(value = "告警等级，0：正常，1：预警，2：一般告警，3：严重告警，4：危急告警")
	@TableField("alarm_level")
	private Integer alarmLevel;

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
	 * 设备顺序
	 */
	@ApiModelProperty(value = "设备顺序")
	@TableField("sort_num")
	private Integer sortNum;

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
	 * 检修状态
	 */
	@ApiModelProperty(value = "检修状态")
	private Integer repairFlag;

	@Override
	public Serializable pkVal() {
		return this.id;
	}


}
