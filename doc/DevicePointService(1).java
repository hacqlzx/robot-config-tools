package com.chiebot.robot.admin.api.feign;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import com.chiebot.robot.admin.api.bo.devicePoint.DevicePointBO;
import com.chiebot.robot.admin.api.domain.PageResponse;
import com.chiebot.robot.admin.api.dto.StandardPointLibrary.standpointlib.StandardPointModel2HigherDTO;
import com.chiebot.robot.admin.api.dto.devicePoint.*;
import com.chiebot.robot.admin.api.dto.devicealarm.DevicePointForAlarmPageDTO;
import com.chiebot.robot.admin.api.dto.task.UpdateTaskFeignDTO;
import com.chiebot.robot.admin.api.entity.devicePoint.DevicePoint;
import com.chiebot.robot.admin.api.vo.devicePoint.DevicePointVO;
import com.chiebot.robot.admin.api.vo.devicePoint.DeviceTreeVO;
import com.chiebot.robot.admin.api.vo.devicePoint.ImportCalibrationVO;
import com.chiebot.robot.admin.api.vo.devicePoint.ThreePhasePointVO;
import com.chiebot.robot.admin.api.vo.devicealarm.DeviceForAlarmPointVO;
import com.chiebot.robot.common.core.constant.enums.DeviceTreeNodeLevelEnum;
import com.chiebot.robot.common.core.util.R;
import com.chiebot.robot.protocol.api.vo.DeviceModelItemFromHigherVO;
import org.springframework.web.multipart.MultipartFile;

import jakarta.servlet.http.HttpServletResponse;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 点位
 *
 * @author ls
 */
public interface DevicePointService extends IService<DevicePoint> {

	/**
	 * 根据标定ID（对应机器人本体的拍照点ID）查询点位信息集合
	 *
	 * @param calibrationId
	 * @return
	 */
	List<DevicePoint> queryDevicePointListByCalibrationId(String calibrationId);

	List<DevicePoint> queryDevicePointListByCalibrationIds(List<String> calibrationIds);

	boolean updateBatchPointInfoByCalibrateId(List<DevicePointBO> devicePointBOS);

	/**
	 * 获取厂站下的所有点位
	 */
	List<DevicePoint> getPointByFacCodeAndRobotCode(String stationCode, Long robotId);

	List<DevicePointBO> queryPointExecutionListByPointIds(List<Long> pointIds);

	List<DevicePointBO> queryPointListByPointIds(List<Long> pointIds);

	DevicePointBO queryPointListByPointCode(String pointCode);


	/**
	 * 根据点位id查询点位信息
	 *
	 * @param pointId
	 * @return
	 */
	DevicePointBO queryPointByPointId(Long pointId);

	/**
	 * 根据标定ID查询点位信息集合
	 * 存在多个结果原因：一图多点
	 * @param calibrationId
	 * @return
	 */
	List<DevicePointBO> queryDevicePointBOListByCalibrationId(String calibrationId);

	/**
	 * 点位信息分页查询
	 *
	 * @param devicePointPageDTO 查询条件
	 * @return 结果集
	 */
	R<PageResponse<DevicePointVO>> page(DevicePointPageDTO devicePointPageDTO);

	/**
	 * 保存点位
	 *
	 * @param devicePointDTO 前端传输体
	 * @return 操作结果
	 */
	R<Boolean> saveDevicePoint(DevicePointDTO devicePointDTO);

	/**
	 * 编辑点位
	 *
	 * @param devicePointDTO 前端传输体
	 * @return 操作结果
	 */
	R<Boolean> edit(DevicePointDTO devicePointDTO);

	/**
	 * 删除点位
	 *
	 * @param devicePointDTO 传输体
	 * @return 操作结果
	 */
	R<Boolean> batchDelete(DevicePointDTO devicePointDTO);

	/**
	 * 详情查询
	 *
	 * @param id
	 * @return
	 */
	R<DevicePointVO> detail(Long id);

	/**
	 * 关联三相点位
	 *
	 * @param devicePointDTO 传输体
	 * @return 操作结果
	 */
	R<Boolean> bindThreePhasePoint(DevicePointDTO devicePointDTO);

	/**
	 * 取消关联三相点位
	 *
	 * @param devicePointDTO 传输体
	 * @return 操作结果
	 */
	R<Boolean> unbindThreePhasePoint(DevicePointDTO devicePointDTO);

	/**
	 * 点位信息的删除逻辑（供其他层级删除点位信息时调用）
	 *
	 * @param devicePointIdList
	 */
	void deleteDevicePointInfo(List<Long> devicePointIdList);

	/**
	 * 查询设备点位模型数据
	 *
	 * @param stationId 变电站id
	 * @return 设备点位模型数据集合
	 */
	List<DeviceModelItemFromHigherVO> queryDeviceModelItemList(Long stationId);

	/**
	 * 三相点位信息分页查询
	 *
	 * @param devicePointPageDTO
	 * @return
	 */
	R<PageResponse<ThreePhasePointVO>> threePhasePointList(DevicePointPageDTO devicePointPageDTO);

	/**
	 * （修改上层节点前）判断是否同名
	 *
	 * @param deviceTreeDTO
	 * @return
	 */
	R<Boolean> checkNameByChangeParentNode(DeviceTreeDTO deviceTreeDTO);

	/**
	 * 删除点位三相关联信息
	 *
	 * @param associateIdList 三相关联id集合
	 */
	void deleteThreePhaseInfo(List<String> associateIdList);

	/**
	 * 修改上层节点
	 *
	 * @param devicePointDTO
	 * @return
	 */
	R<Boolean> changeParentNode(DevicePointDTO devicePointDTO);

	/**
	 * 导出基础数据
	 *
	 * @param stationId
	 * @param exportPointType 导出点位文件类型，1-标定点表 2-基础点表 3-导入点表
	 * @param response
	 */
	R<Boolean> export(Long stationId, Integer exportPointType, HttpServletResponse response);

	/**
	 * 标定图片导入
	 *
	 * @param file    zip文件
	 * @param robotId 机器人id
	 * @param facId   厂站id
	 * @return 返回包装类
	 */
	ImportCalibrationVO importCalibrationImg(MultipartFile file, Long robotId, Long facId);

	/**
	 * 导入更新点位名称excel
	 *
	 * @param file
	 * @param stationId
	 * @return
	 */
	R<String> importUpdateDevicePointNameExcel(MultipartFile file, Long stationId);

	/**
	 * Excel模板下载
	 *
	 * @param fileType 0 本地点位excel模板类型 1:更新点位名称的台账excel模板类型
	 * @param response response响应
	 */
	void downLoadExcelTemplate(Integer fileType, HttpServletResponse response);

	/**
	 * Excel导入
	 *
	 * @param file      excel文件
	 * @param stationId 变电站id
	 * @param robotId   机器人id
	 * @return 错误会返回错误的excel标注路径
	 */
	R<String> importDeviceExcel(MultipartFile file, Long stationId, Long robotId);

    /**
     * xml导入
     *
     * @param file excel文件
     */
	boolean importDevicePointByXML(MultipartFile file, Long robotId);

	/**
	 * 获取指定厂站下所有的点位数据
	 *
	 * @param stationId 变电站id
	 * @return 点位数据集合
	 */
	List<DevicePoint> queryByStationId(Long stationId);

	/**
	 * 清空一些必要信息
	 *
	 * @param pointId
	 */
	void clearPointInfo(Long pointId);

	/**
	 * 根据厂站id集合查询点位信息集合
	 *
	 * @param facId 厂站id
	 * @return 点位信息集合
	 */
	List<DevicePointBO> queryPointListByFacId(Long facId);

	/**
	 * 根据修改任务的参数获取巡检点集合
	 *
	 * @param updateTaskFeignDTO 修改任务的参数
	 * @return 巡检点集合
	 */
	List<DevicePointBO> getUpdateTaskPoints(UpdateTaskFeignDTO updateTaskFeignDTO);

	/**
	 * feign-根据设备层级节点集合获取其下面的所有已标定的点位集合(点位数据会出现重复，因为点位冗余，可以能是本地也可能是下级系统的其他设备)
	 *
	 * @param dto 设备层级节点集合
	 * @return 所有已标定的点位集合
	 */
	List<DevicePointBO> converseNodeInfoListToPointList(DevicePointFeignDTO dto);

	/**
	 * 根据保存任务的点位 tab 的查询条件获取所有已标定的点位集合
	 *
	 * @param dto 任务的点位 tab 的查询条件
	 * @return 所有已标定的点位集合
	 */
	List<DevicePointBO> queryPointListFromSaveTaskWithPointTab(SaveTaskWithPointTabDTO dto);

	/**
	 * 设备树查询
	 *
	 * @param orderType 排序方式，0-默认排序，1-创建时间正序
	 * @return
	 */
	R<DeviceTreeVO> queryDeviceTree(Integer orderType, Long stationId);

	/**
	 * 根据节点id和节点层级获取设备树下级节点信息
	 *
	 * @param nodeId    节点id
	 * @param level     节点层级 {@link DeviceTreeNodeLevelEnum}
	 * @param orderType 排序方式，0-默认排序，1-创建时间正序
	 * @return
	 */
	R<List<DeviceTreeVO>> queryByNodeIdAndLevel(Long nodeId, Integer level, Integer orderType);

	/**
	 * 获取指定厂站下所有的点位数据（自定义排序）
	 *
	 * @param componentId    部件ID
	 * @param orderType      0-默认排序 1-时间升序
	 * @param demarcateState 0-未标定 1-已标定 null-不过滤
	 */
	List<DevicePoint> listByCustomSort(Long componentId, Integer orderType, Integer demarcateState);


	/**
	 * 根据点位编码查询点位信息
	 *
	 * @param pointCodes 点位编码集合
	 * @return 所有查询到的点位集合
	 */
	List<DevicePointBO> queryPointListByPointCodes(Set<String> pointCodes);

	/**
	 * 任务编辑-任务点位回显分页
	 *
	 * @param devicePointPageDTO dto
	 * @return result
	 */
	R<PageResponse<DevicePointVO>> editTaskPointPage(DevicePointPageDTO devicePointPageDTO);

	/**
	 * 根据点位code查询点位名称
	 *
	 * @param pointCode
	 * @return
	 */
	DevicePointBO queryPointByPointCode(String pointCode);

	/**
	 * 根据三相groupId查询点位信息
	 *
	 * @param groupId
	 * @return
	 */
	List<DevicePointBO> queryPointByGroupId(String groupId);

	R<PageResponse<DeviceForAlarmPointVO>> pageForAlarm(DevicePointForAlarmPageDTO devicePointPageDTO);

	/**
	 * 根据主设备类型/电压区域/间隔名称/主设备名称查询点位信息
	 *
	 * @param dto 任务报表查询的点位信息
	 * @return 所有查询到的点位id集合
	 */
	List<Long> queryPointListFromTaskPatrolledPagePoint(TaskPatrolledPagePointDTO dto);

    void distributePoint(Long facId, Long robotId);

    R<String> synCalibratePoint(String stationCode, String robotCode, Integer syncType);

	boolean updatePointInfoByPointCode(DevicePointBO devicePointBO);

	List<DevicePoint> getPointByFacCode(String stationCode, Long robotId);

	/**
	 * 将巡检点插入到数据库中
	 */
	R<String> insertFacNodeByJson(MultipartFile file, String operationId);

	/**
	 * 导出所有标定文件
	 *
	 * @param stationId     场站ID
	 * @param pictureNameType 1:点位名称 2:点位编码
	 */
	void exportCalibrateFile(Long stationId, Long pictureNameType, HttpServletResponse response);

	void processFacility(List<Map> dataList, List<String> notExistRobot, Map<String, String> robotFac);

	void finishSyncPoint(String stationCode, String robotCode);

	DevicePointBO findMapCodeByCodeAndLevel(String nodeCode, Integer nodeLevel);

	DevicePointBO findDeviceNameByIdAndLevel(String nodeCode, Integer nodeLevel);

	List<DevicePointBO> findPointByIdAndLevel(Integer nodeLevel, List<Long> nodeIds);

	List<DevicePointBO> findPointByCodeAndLevel(Integer nodeLevel, List<String> nodeCodes);

	R<Boolean> batchEdit(BatchUpdateDevicePointDTO batchUpdateDevicePointDTO);

	Page<DevicePoint> devicePointList(Long deviceMainId, Integer pageNum, Integer pageSize, String pointName);

	void batchBindThreePhasePoint(Collection<DevicePoint> devicePoints);
}
