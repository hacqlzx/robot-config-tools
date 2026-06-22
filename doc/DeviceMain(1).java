package com.chiebot.robot.admin.api.entity.pointconfig;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.activerecord.Model;
import com.fasterxml.jackson.annotation.JsonFormat;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import org.hibernate.validator.constraints.Length;

import jakarta.validation.constraints.Pattern;
import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * @author QianZhiQiang
 * @since 2024-01-09 15:54
 */
@EqualsAndHashCode(callSuper = true)
@Data
@ApiModel(value = "主设备表")
@TableName("device_main")
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class DeviceMain extends Model<DeviceMain> {

	private static final long serialVersionUID = 1L;

	/**
	 * 主键id
	 */
	@TableId(value = "id", type = IdType.AUTO)
	@ApiModelProperty(value = "主键id")
	private Long id;

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
	 * 相位类型：0-主体，1-A相，2-B相，3-C相
	 */
	@ApiModelProperty(value = "相位类型：0-主体，1-A相，2-B相，3-C相")
	@TableField("phase_type")
	private Integer phaseType;

	/**
	 * 是否是三相设备的标识，0-否，1-是
	 */
	@ApiModelProperty(value = "是否是三相设备的标识，0-否，1-是")
	@TableField("three_phase_flag")
	private Integer threePhaseFlag;

	/**
	 * 三相设备关联id
	 */
	@ApiModelProperty(value = "三相设备关联id")
	@TableField("three_phase_associate_id")
	private String threePhaseAssociateId;

	/**
	 * 实物id
	 */
	@ApiModelProperty(value = "实物id")
	@TableField("entity_id")
	private String entityId;

	/**
	 * 告警等级，0：正常，1：预警，2：一般告警，3：严重告警，4：危急告警
	 */
	@ApiModelProperty(value = "告警等级，0：正常，1：预警，2：一般告警，3：严重告警，4：危急告警")
	@TableField("alarm_level")
	private Integer alarmLevel;

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
	 * 设备型号
	 */
	@ApiModelProperty(value="设备型号")
	@TableField("device_model")
	private String deviceModel;

	/**
	 * 设备来源
	 */
	@ApiModelProperty(value="设备来源")
	@TableField("device_source")
	private String deviceSource;

	/**
	 * 生产厂家
	 */
	@ApiModelProperty(value="生产厂家")
	@TableField("manufacturer")
	private String manufacturer;

	/**
	 * 出厂编号
	 */
	@ApiModelProperty(value="出厂编号")
	@TableField("production_code")
	private String productionCode;

	/**
	 * 使用单位
	 */
	@ApiModelProperty(value="使用单位")
	@TableField("use_company")
	private String useCompany;

	/**
	 * 生产日期
	 */
	@ApiModelProperty(value="生产日期")
	@TableField("production_date")
	@JsonFormat(shape = JsonFormat.Shape.STRING,pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
	private LocalDateTime productionDate;

	/**
	 * 出厂日期
	 */
	@ApiModelProperty(value="投运日期")
	@TableField("commissioning_date")
	@JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
	private LocalDateTime commissioningDate;

	/**
	 * 备注信息
	 */
	@ApiModelProperty(value = "备注信息")
	@TableField("remark_info")
	private String remarkInfo;

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
