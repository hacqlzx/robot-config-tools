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
@ApiModel(value = "间隔表")
@TableName("device_bay")
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class DeviceBay extends Model<DeviceBay> {

	private static final long serialVersionUID = 1L;

	/**
	 * 主键id
	 */
	@TableId(value = "id", type = IdType.AUTO)
	@ApiModelProperty(value = "主键id")
	private Long id;

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
	 * 告警等级，0：正常，1：预警，2：一般告警，3：严重告警，4：危急告警
	 */
	@ApiModelProperty(value = "告警等级，0：正常，1：预警，2：一般告警，3：严重告警，4：危急告警")
	@TableField("alarm_level")
	private Integer alarmLevel;

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
	@ApiModelProperty(value="创建人")
	@TableField("create_by")
	private String createBy;

	/**
	 * 创建时间
	 */
	@ApiModelProperty(value="创建时间")
	@TableField("create_time")
	private LocalDateTime createTime;

	/**
	 * 更新人
	 */
	@ApiModelProperty(value="更新人")
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
