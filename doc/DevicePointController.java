package com.chiebot.robot.admin.controller.devicePoint;

import cn.hutool.core.collection.CollUtil;
import com.chiebot.robot.admin.api.domain.PageResponse;
import com.chiebot.robot.admin.api.dto.devicePoint.BatchUpdateDevicePointDTO;
import com.chiebot.robot.admin.api.dto.devicePoint.DevicePointDTO;
import com.chiebot.robot.admin.api.dto.devicePoint.DevicePointPageDTO;
import com.chiebot.robot.admin.api.dto.devicePoint.DeviceTreeDTO;
import com.chiebot.robot.admin.api.feign.DevicePointService;
import com.chiebot.robot.admin.api.vo.EnumTypeVO;
import com.chiebot.robot.admin.api.vo.devicePoint.*;
import com.chiebot.robot.admin.api.vo.deviceproperty.DevicePropertyVO;
import com.chiebot.robot.admin.api.feign.deviceproperty.DevicePropertyService;
import com.chiebot.robot.admin.service.system.SysFileService;
import com.chiebot.robot.common.core.constant.DigitalConstant;
import com.chiebot.robot.common.core.constant.OperationEventConstants;
import com.chiebot.robot.common.core.constant.enums.*;
import com.chiebot.robot.common.core.log.annotation.OperationEventLog;
import com.chiebot.robot.common.core.util.R;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 点位管理前端控制器
 *
 * @Author wangzw
 * @Date 2023/1/29 10:48
 */
@RestController
@RequestMapping("/devicePoint")
@Api(value = "devicePoint", tags = "点位管理")
public class DevicePointController {

	@Resource
	private DevicePointService devicePointService;

	@Resource
	private DevicePropertyService devicePropertyService;

	@Resource
	private SysFileService sysFileService;

	@ApiOperation(value = "点位模型下发", notes = "权限:robot_devicePoint_distributePoint")
	@GetMapping("/distributePoint")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_distributePoint')")
	@OperationEventLog(eventType = OperationEventConstants.RobotSelf.DISTRIBUTE_POINT)
	public R<Boolean> distributePoint(@RequestParam("facId") Long facId, @RequestParam("robotId") Long robotId) {
		devicePointService.distributePoint(facId, robotId);
		return R.ok(true);
	}

	@ApiOperation(value = "标定数据同步申请", notes = "权限:robot_devicePoint_distributePoint")
	@GetMapping("/synCalibratePoint")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_synCalibratePoint')")
	@OperationEventLog(eventType = OperationEventConstants.RobotSelf.SYNC_CALIBRATE_POINT)
	public R synCalibratePoint(@RequestParam("stationCode") String stationCode, @RequestParam("robotCode") String robotCode, @RequestParam("syncType") Integer syncType) {
		R<String> success = devicePointService.synCalibratePoint(stationCode, robotCode, syncType);
		if (success.isSuccess()) {
			return R.ok(true, "下发成功");
		} else {
			return R.failed("下发失败");
		}
	}

	@ApiOperation(value = "新增点位", notes = "新增点位:(robot_devicePoint_add)")
	@PostMapping("/add")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_add')")
	public R<Boolean> add(@RequestBody @Validated(DevicePointDTO.add.class) DevicePointDTO devicePointDTO) {
		return devicePointService.saveDevicePoint(devicePointDTO);
	}

	@ApiOperation(value = "批量编辑点位", notes = "编辑点位")
	@PostMapping("/batchEdit")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_batchEdit')" )
	public R<Boolean> batchEdit(@RequestBody BatchUpdateDevicePointDTO batchUpdateDevicePointDTO) {
		return devicePointService.batchEdit(batchUpdateDevicePointDTO);
	}

	@ApiOperation(value = "获取巡视类型", notes = "获取巡视类型(权限:robot_devicePoint_getInspectionType)")
	@GetMapping("/getInspectionType")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_getInspectionType')")
	public R<List<InspectionTypeVO>> getInspectionType() {
		List<InspectionTypeVO> inspectionTypeVOList = new ArrayList<>();
		Map<Integer, List<InspectionTypeEnum>> inspectionTypeMap = Arrays.stream(InspectionTypeEnum.values()).collect(Collectors.groupingBy(InspectionTypeEnum::getInspectionType));
		inspectionTypeMap.forEach((k, v) -> {
			String inspectionTypeDesc = InspectionTypeEnum.getDescByCode(k);
			List<InspectionTypeVO> subLevel = v.stream().map(i -> InspectionTypeVO.builder().inspectionType(i.getInspectionSubType())
					.inspectionTypeDesc(i.getInspectionSubTypeDesc()).build()).collect(Collectors.toList());
			inspectionTypeVOList.add(InspectionTypeVO.builder().inspectionType(k).inspectionTypeDesc(inspectionTypeDesc).subLevel(subLevel).build());
		});
		return R.ok(inspectionTypeVOList);
	}

	@ApiOperation(value = "点位信息分页查询", notes = "点位信息分页查询(robot_devicePoint_page)")
	@PostMapping("/page")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_page')")
	public R<PageResponse<DevicePointVO>> page(@RequestBody DevicePointPageDTO devicePointPageDTO) {
		return devicePointService.page(devicePointPageDTO);
	}

	@ApiOperation(value = "任务保存-标定点位信息分页查询(robot_devicePoint_calibration)")
	@PostMapping("/calibrationPage")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_calibration')")
	public R<PageResponse<DevicePointVO>> calibrationPage(@RequestBody DevicePointPageDTO devicePointPageDTO) {
		// 标定点位查询
		devicePointPageDTO.setDemarcateState(DigitalConstant.ONE);
		return devicePointService.page(devicePointPageDTO);
	}

	@ApiOperation(value = "三相点位列表", notes = "三相点位列表(robot_devicePoint_threePhasePointList)")
	@PostMapping("/threePhasePointList")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_threePhasePointList')")
	public R<PageResponse<ThreePhasePointVO>> threePhasePointList(@RequestBody DevicePointPageDTO devicePointPageDTO) {
		return devicePointService.threePhasePointList(devicePointPageDTO);
	}

	@ApiOperation(value = "编辑点位", notes = "编辑点位:(robot_devicePoint_edit)")
	@PostMapping("/edit")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_edit')")
	public R<Boolean> edit(@RequestBody @Validated(DevicePointDTO.edit.class) DevicePointDTO devicePointDTO) {
		return devicePointService.edit(devicePointDTO);
	}

	@ApiOperation(value = "详情点位", notes = "详情点位:(robot_devicePoint_detail)")
	@GetMapping("/detail")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_detail')")
	public R<DevicePointVO> detail(@RequestParam("pointId") Long pointId) {
		return devicePointService.detail(pointId);
	}

	@ApiOperation(value = "点位批量删除", notes = "点位批量删除:(robot_devicePoint_batchDelete)")
	@PostMapping("/batchDelete")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_batchDelete')")
	public R<Boolean> batchDelete(@RequestBody @Validated(DevicePointDTO.batchDelete.class) DevicePointDTO devicePointDTO) {
		return devicePointService.batchDelete(devicePointDTO);
	}

	@ApiOperation(value = "关联三相点位", notes = "关联三相点位:(robot_devicePoint_bindThreePhasePoint)")
	@PostMapping("/bindThreePhasePoint")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_bindThreePhasePoint')")
	public R<Boolean> bindThreePhasePoint(@RequestBody @Validated(DevicePointDTO.threePhasePoint.class) DevicePointDTO devicePointDTO) {
		return devicePointService.bindThreePhasePoint(devicePointDTO);
	}

	@ApiOperation(value = "取消关联三相点位", notes = "取消关联三相点位:(robot_devicePoint_unbindThreePhasePoint)")
	@PostMapping("/unbindThreePhasePoint")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_unbindThreePhasePoint')")
	public R<Boolean> unbindThreePhasePoint(@RequestBody @Validated(DevicePointDTO.threePhasePoint.class) DevicePointDTO devicePointDTO) {
		return devicePointService.unbindThreePhasePoint(devicePointDTO);
	}

	@ApiOperation(value = "获取识别类型信息集合", notes = "获取识别类型信息集合:(robot_devicePoint_queryRecTypeList)")
	@GetMapping("/queryRecTypeList")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_queryRecTypeList')")
	public R<List<EnumTypeVO>> queryRecTypeList() {
		List<EnumTypeVO> enumTypeVOList = Stream.of(RecTypeEnum.values())
				.map(recTypeEnum -> EnumTypeVO.builder()
						.type(recTypeEnum.getType()).desc(recTypeEnum.getDesc()).build()).collect(Collectors.toList());
		return R.ok(enumTypeVOList);
	}

	@ApiOperation(value = "获取采集类型信息集合", notes = "获取采集类型信息集合:(robot_devicePoint_queryCollectTypeList)")
	@GetMapping("/queryCollectTypeList")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_queryCollectTypeList')")
	public R<List<EnumTypeVO>> queryCollectTypeList() {
		List<EnumTypeVO> enumTypeVOList = Stream.of(CollectTypeEnum.values())
				.map(collectTypeEnum -> EnumTypeVO.builder()
						.type(collectTypeEnum.getCode()).desc(collectTypeEnum.getDesc()).build()).collect(Collectors.toList());
		return R.ok(enumTypeVOList);
	}

	@ApiOperation(value = "获取表计类型信息集合", notes = "获取表计类型信息集合:(robot_devicePoint_queryMeterTypeList)")
	@GetMapping("/queryMeterTypeList")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_queryMeterTypeList')")
	public R<List<EnumTypeVO>> queryMeterTypeList() {
		List<EnumTypeVO> enumTypeVOList = Stream.of(MeterTypeEnum.values())
				.map(meterTypeEnum -> EnumTypeVO.builder()
						.type(meterTypeEnum.getType()).desc(meterTypeEnum.getDesc()).build()).collect(Collectors.toList());
		return R.ok(enumTypeVOList);
	}

	@ApiOperation(value = "获取位置状态信息集合", notes = "获取位置状态信息集合(robot_devicePoint_queryPositionStateTypeList)")
	@GetMapping("/queryPositionStateTypeList")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_queryPositionStateTypeList')")
	public R<List<EnumTypeVO>> queryPositionStateTypeList() {
		List<DevicePropertyVO> positionList = devicePropertyService.getPositionList();
		if (CollUtil.isEmpty(positionList)) {
			return R.ok(Collections.emptyList());
		}
		List<EnumTypeVO> enumTypeVOList = positionList.stream().map(position -> EnumTypeVO.builder()
				.type(position.getType())
				.desc(position.getValue())
				.build()).collect(Collectors.toList());
		return R.ok(enumTypeVOList);
	}


	@ApiOperation(value = "获取辅助设施类型信息集合", notes = "获取辅助设施类型信息集合(robot_devicePoint_queryAssistFacilityTypeList)")
	@GetMapping("/queryAssistFacilityTypeList")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_queryAssistFacilityTypeList')")
	public R<List<EnumTypeVO>> queryAssistFacilityTypeList() {
		List<EnumTypeVO> enumTypeVOList = Stream.of(AssistFacilityTypeEnum.values())
				.map(assistFacilityTypeEnum -> EnumTypeVO.builder()
						.type(assistFacilityTypeEnum.getType()).desc(assistFacilityTypeEnum.getDesc()).build()).collect(Collectors.toList());
		return R.ok(enumTypeVOList);
	}

	@ApiOperation(value = "获取缺陷识别信息集合", notes = "获取缺陷识别信息集合(robot_devicePoint_queryDefectRecTypeList)")
	@GetMapping("/queryDefectRecTypeList")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_queryDefectRecTypeList')")
	public R<Map<String, String>> queryDefectRecTypeList() {
		Map<String, String> collect = Stream.of(DefectAppearanceRecTypeEnum.values())
				.collect(Collectors.toMap(DefectAppearanceRecTypeEnum::getType, DefectAppearanceRecTypeEnum::getDesc, (v1, v2) -> v2));
		return R.ok(collect);
	}

	@ApiOperation(value = "点位信息列表查询", notes = "点位信息列表查询(权限:robot_devicePoint_devicePointList)")
	@GetMapping("/devicePointList")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_devicePointList')")
	public R deviceMainList(@RequestParam("deviceMainId") Long deviceMainId, @RequestParam("pageNum") Integer pageNum, @RequestParam("pageSize") Integer pageSize, @RequestParam(value = "pointName", required = false) String pointName) {
		return R.ok(devicePointService.devicePointList(deviceMainId, pageNum, pageSize, pointName));
	}

	@ApiOperation(value = "修改上层节点同名校验", notes = "修改上层节点同名校验(robot_deviceTree_checkNameByChangeParentNode)")
	@PostMapping("/checkNameByChangeParentNode")
	@PreAuthorize("@pms.hasPermission('robot_deviceTree_checkNameByChangeParentNode')")
	public R<Boolean> checkNameByChangeParentNode(@RequestBody @Validated(DeviceTreeDTO.checkNameByChangeParentNode.class) DeviceTreeDTO deviceTreeDTO) {
		return devicePointService.checkNameByChangeParentNode(deviceTreeDTO);
	}

	@ApiOperation(value = "修改上层节点", notes = "修改上层节点:(robot_devicePoint_changeParentNode)")
	@PostMapping("/changeParentNode")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_changeParentNode')")
	public R<Boolean> changeParentNode(@RequestBody @Validated(DevicePointDTO.changeParentNode.class) DevicePointDTO devicePointDTO) {
		return devicePointService.changeParentNode(devicePointDTO);
	}

	/**
	 * 导出基础数据
	 *
	 * @param stationId
	 * @param exportPointType 导出点位文件类型，1-标定点表 2-基础点表 3-导入点表
	 * @param response
	 */
	@ApiOperation(value = "导出基础数据", notes = "导出基础数据(权限:robot_devicePoint_exportBasicData)")
	@GetMapping("/exportBasicData")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_exportBasicData')")
	public void exportBasicData(@RequestParam("stationId") Long stationId, @RequestParam(required = false, defaultValue = "2") Integer exportPointType, HttpServletResponse response) {
		devicePointService.export(stationId, exportPointType, response);
	}

	@ApiOperation(value = "标定图片导入", notes = "标定图片导入(权限:robot_devicePoint_importCalibrationImg)")
	@PostMapping("/importCalibrationImg")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_importCalibrationImg')")
	public R<String> importCalibrationImg(@RequestParam("file") MultipartFile file,
										  @RequestParam("robotId") Long robotId,
										  @RequestParam("facId") Long facId) {
		ImportCalibrationVO returnVO = devicePointService.importCalibrationImg(file, robotId, facId);
		if (Objects.isNull(returnVO)) {
			return R.failed("执行设备类型错误，导入失败");
		}
		return R.ok(returnVO.getReturnPath(), "导入完成，共导入" + returnVO.getTotalImg() + "张图片，导入成功" +
				returnVO.getSuccessImg() + "张，导入失败" + returnVO.getFailImg() + "张");
	}

	/**
	 * 导入更新点位名称 Excel
	 *
	 * @param file
	 * @param stationId
	 * @return
	 */
	@PostMapping("/importUpdateDevicePointNameExcel")
	@PreAuthorize("@pms.hasPermission('robot_deviceTree_importUpdateDevicePointNameExcel')")
	public R<String> importUpdateDevicePointNameExcel(@RequestParam(value = "file") MultipartFile file,
													  @RequestParam(value = "stationId", required = false) Long stationId) {
		return devicePointService.importUpdateDevicePointNameExcel(file, stationId);
	}

	@ApiOperation(value = "Excel模板下载", notes = "Excel模板下载(权限:robot_devicePoint_downLoadExcelTemplate)")
	@PostMapping("/downLoadExcelTemplate")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_downLoadExcelTemplate')")
	public void downLoadExcelTemplate(HttpServletResponse response, @RequestParam("fileType") Integer fileType) {
		devicePointService.downLoadExcelTemplate(fileType, response);
	}

	@ApiOperation(value = "设备导入", notes = "设备导入，" +
			"参数说明：file（必填）- 导入的Excel文件；" +
			"stationId（必填）：变电站id" +
			"返回说明：code为500时，则说明是系统错误，code为1时，说明是excel文件本身错误（携带标注的excel路径），code为200时，无错误，导入成功:(robot_devicePoint_importDeviceExcel)")
	@PostMapping("/importDeviceExcel")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_importDeviceExcel')")
	public R<String> importDeviceExcel(@RequestParam(value = "file") MultipartFile file,
									   @RequestParam(value = "stationId") Long stationId,
									   @RequestParam(value = "robotId") Long robotId) {
		return devicePointService.importDeviceExcel(file, stationId, robotId);
	}

	@ApiOperation(value = "设备树查询（厂站到间隔）", notes = "设备树查询（厂站到间隔）参数：orderType，0-默认，1-创建时间正序:(robot_devicePoint_queryDeviceTree)")
	@GetMapping("/queryDeviceTree")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_queryDeviceTree')")
	R<DeviceTreeVO> queryDeviceTree(@RequestParam("orderType") Integer orderType, @RequestParam(value = "stationId", required = false) Long stationId) {
		return devicePointService.queryDeviceTree(orderType, stationId);
	}

	@ApiOperation(value = "根据节点id和层级查询下级节点信息（懒加载点查）", notes = "根据节点id和层级查询下级节点信息（懒加载点查）:(robot_devicePoint_queryByNodeIdAndLevel)")
	@GetMapping("/queryByNodeIdAndLevel")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_queryByNodeIdAndLevel')")
	public R<List<DeviceTreeVO>> queryByNodeIdAndLevel(@RequestParam("nodeId") Long nodeId, @RequestParam("level") Integer level, @RequestParam("orderType") Integer orderType) {
		return devicePointService.queryByNodeIdAndLevel(nodeId, level, orderType);
	}

	@ApiOperation("任务编辑-任务点位回显分页(account_devicePoint_editTaskPointPage)")
	@PostMapping("/editTaskPointPage")
	@PreAuthorize("@pms.hasPermission('account_devicePoint_editTaskPointPage')")
	public R<PageResponse<DevicePointVO>> editTaskPointPage(@RequestBody DevicePointPageDTO devicePointPageDTO) {
		return devicePointService.editTaskPointPage(devicePointPageDTO);
	}


	@ApiOperation("标定文件上传(robot_devicePoint_uploadCalibrationPath)")
	@PostMapping("/uploadCalibrationPath")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_uploadCalibrationPath')")
	public R uploadCalibrationPath(@RequestPart("file") MultipartFile file) {
		return sysFileService.uploadCalibrationPath(file);
	}

	@ApiOperation("解析json点表(robot_devicePoint_insertFacNodeByJson)")
	@PostMapping("/insertFacNodeByJson")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_insertFacNodeByJson')")
	@OperationEventLog(eventType = OperationEventConstants.RobotSelf.IMPORT_JSON)
	public R<String> insertFacNodeByJson(@RequestPart("file") MultipartFile file, @RequestParam("operationId") String operationId) {
		return devicePointService.insertFacNodeByJson(file, operationId);
	}

	/**
	 * 导出所有标定文件
	 *
	 * @param stationId       场站ID
	 * @param pictureNameType 1:点位名称 2:点位编码
	 * @param response
	 */
	@ApiOperation("导出所有标定文件")
	@PostMapping("/exportCalibrateFile")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_exportCalibrateFile')")
	public void exportCalibrateFile(@RequestParam("stationId") Long stationId, @RequestParam(required = false, defaultValue = "2") Long pictureNameType, HttpServletResponse response) {
		devicePointService.exportCalibrateFile(stationId, pictureNameType, response);
	}

	@ApiOperation("结束未结束的标定同步")
	@GetMapping("/finishSyncPoint")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_finishSyncPoint')")
	public R finishSyncPoint(@RequestParam("stationCode") String stationCode, @RequestParam("robotCode") String robotCode) {
		devicePointService.finishSyncPoint(stationCode, robotCode);
		return R.ok();
	}

	@ApiOperation("xml导入点表")
	@PostMapping("/importDevicePointByXML")
	@PreAuthorize("@pms.hasPermission('robot_devicePoint_importDevicePointByXML')")
	public R importDevicePointByXML(@RequestPart("file") MultipartFile file, @RequestParam("robotId") Long robotId) {
		devicePointService.importDevicePointByXML(file, robotId);
		return R.ok();
	}

}
