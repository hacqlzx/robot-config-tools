package com.chiebot.robot.admin.service.devicePoint.impl;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.date.DatePattern;
import cn.hutool.core.date.DateUtil;
import cn.hutool.core.io.FileUtil;
import cn.hutool.core.map.MapUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.poi.excel.ExcelUtil;
import cn.hutool.poi.excel.WorkbookUtil;
import com.alibaba.excel.EasyExcel;
import com.alibaba.excel.ExcelWriter;
import com.alibaba.excel.write.metadata.WriteSheet;
import com.alibaba.excel.write.style.column.LongestMatchColumnWidthStyleStrategy;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.dynamic.datasource.annotation.DS;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.chiebot.robot.admin.api.bo.devicePoint.DeviceInfoExcelBO;
import com.chiebot.robot.admin.api.bo.devicePoint.*;
import com.chiebot.robot.admin.api.domain.PageResponse;
import com.chiebot.robot.admin.api.domain.ReturnWrapper;
import com.chiebot.robot.admin.api.dto.devicePoint.*;
import com.chiebot.robot.admin.api.dto.devicealarm.DevicePointForAlarmPageDTO;
import com.chiebot.robot.admin.api.dto.facinfo.FacInfoDTO;
import com.chiebot.robot.admin.api.dto.task.UpdateTaskFeignDTO;
import com.chiebot.robot.admin.api.entity.devicePoint.CalibrationPointJson;
import com.chiebot.robot.admin.api.entity.devicePoint.DevicePoint;
import com.chiebot.robot.admin.api.entity.devicePoint.PointTags;
import com.chiebot.robot.admin.api.entity.facinfo.FacInfo;
import com.chiebot.robot.admin.api.entity.pointconfig.DeviceBay;
import com.chiebot.robot.admin.api.entity.pointconfig.DeviceComponent;
import com.chiebot.robot.admin.api.entity.pointconfig.DeviceMain;
import com.chiebot.robot.admin.api.entity.pointconfig.DeviceVoltage;
import com.chiebot.robot.admin.api.entity.robot.Robot;
import com.chiebot.robot.admin.api.entity.robotInfo.RobotHost;
import com.chiebot.robot.admin.api.enums.IntervalTypeEnum;
import com.chiebot.robot.admin.api.enums.LocalPointExcelEnum;
import com.chiebot.robot.admin.api.enums.PositionStateTypeEnum;
import com.chiebot.robot.admin.api.enums.devicePoint.BatchUpdateDevicePointTypeEnum;
import com.chiebot.robot.admin.api.enums.devicePoint.DemarcateStateEnum;
import com.chiebot.robot.admin.api.enums.devicePoint.UpdateLocalPointExcelEnum;
import com.chiebot.robot.admin.api.feign.DevicePointService;
import com.chiebot.robot.admin.api.feign.FacInfoService;
import com.chiebot.robot.admin.api.feign.robotinfo.RobotHostService;
import com.chiebot.robot.admin.api.vo.devicePoint.*;
import com.chiebot.robot.admin.api.vo.devicealarm.DeviceForAlarmPointVO;
import com.chiebot.robot.admin.api.vo.deviceproperty.DevicePropertyVO;
import com.chiebot.robot.admin.api.vo.grpc.GrpcResponse;
import com.chiebot.robot.admin.config.ExcelTemplateConfig;
import com.chiebot.robot.admin.mapper.devicePoint.DevicePointMapper;
import com.chiebot.robot.admin.mapper.facinfo.FacInfoMapper;
import com.chiebot.robot.admin.service.analysismachineinfo.AnalysisMachineInfoService;
import com.chiebot.robot.admin.service.analysissettineg.AnalysisSettingService;
import com.chiebot.robot.admin.service.devicePoint.PointTagsService;
import com.chiebot.robot.admin.api.feign.deviceproperty.DevicePropertyService;
import com.chiebot.robot.admin.service.grpc.GrpcSendServiceImpl;
import com.chiebot.robot.admin.service.pointconfig.DeviceBayService;
import com.chiebot.robot.admin.service.pointconfig.DeviceComponentService;
import com.chiebot.robot.admin.service.pointconfig.DeviceMainService;
import com.chiebot.robot.admin.service.pointconfig.DeviceVoltageService;
import com.chiebot.robot.admin.service.robot.CalibrationPointJsonService;
import com.chiebot.robot.admin.api.feign.robot.RobotService;
import com.chiebot.robot.admin.api.feign.TaskService;
import com.chiebot.robot.admin.utils.ExcelUtils;
import com.chiebot.robot.admin.utils.ExecutorUtils;
import com.chiebot.robot.admin.utils.XmlUtils;
import com.chiebot.robot.auth.util.SecurityUtils;
import com.chiebot.robot.common.core.constant.*;
import com.chiebot.robot.common.core.constant.enums.*;
import com.chiebot.robot.common.core.exception.RobotException;
import com.chiebot.robot.common.core.util.*;
import com.chiebot.robot.common.file.util.FilePathManagerUtil;
import com.chiebot.robot.common.file.util.FileUtils;
import com.chiebot.robot.common.websocket.utils.WebSocketUtils;
import com.chiebot.robot.protocol.api.enums.MessageType;
import com.chiebot.robot.protocol.api.vo.DeviceModelItemFromHigherVO;
import com.chiebot.robot.protocol.biz.bean.protocol2higher.modelsynchronize.VideoPosEntity2Higher;
import com.chiebot.robot.protocol.biz.grpc.protobuf.RobotControlProto;
import com.github.liaochong.myexcel.core.DefaultExcelBuilder;
import com.google.common.collect.Lists;
import lombok.Cleanup;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.compress.archivers.zip.ZipArchiveInputStream;
import org.apache.commons.compress.utils.IOUtils;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.exception.ExceptionUtils;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import java.io.*;
import java.nio.file.Files;
import java.time.LocalDateTime;
import java.util.UUID;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * 点位管理业务层实现类
 *
 * @Author wangzw
 * @Date 2023/1/29 10:45
 */
@Service
@Slf4j(topic = "点位管理业务层实现类")
@DS("mysql")
public class DevicePointServiceImpl extends ServiceImpl<DevicePointMapper, DevicePoint> implements DevicePointService {

    @Resource
    private DevicePropertyService devicePropertyService;

    @Resource
    private DeviceMainService deviceMainService;

    @Resource
    private DeviceComponentService deviceComponentService;

    @Resource
    private DeviceBayService deviceBayService;

    @Resource
    private DevicePointService devicePointService;

    @Resource
    private FacInfoService facInfoService;

    @Resource
    private FacInfoMapper facInfoMapper;

    @Resource
    private ExcelTemplateConfig excelTemplateConfig;

    @Resource
    private DeviceVoltageService deviceVoltageService;

    @Resource
    private RedisTemplate redisTemplate;

    @Resource
    private RobotService robotService;

    @Resource
    private GrpcSendServiceImpl grpcSendServiceImpl;

    @Resource
    private AnalysisSettingService analysisSettingService;

    @Resource
    private RobotHostService robotHostService;

    @Resource
    private CalibrationPointJsonService calibrationPointJsonService;

    @Resource
    private TaskService taskService;

    @Resource
    private AnalysisMachineInfoService analysisMachineInfoService;

    @Resource
    private StringRedisTemplate stringRedisTemplate;

    @Resource
    private PointTagsService pointTagsService;

    /**
     * 新增
     */
    private static final String OPERATE_ADD = "新增";

    /**
     * 编辑
     */
    private static final String OPERATE_EDIT = "编辑";

    /**
     * Excel的文件格式类型
     */
    public static final List<String> EXCEL_FILE_TYPE_LIST = Lists.newArrayList("xlsx", "xls");

    /**
     * Excel的文件大小
     */
    public static final long EXCEL_FILE_SIZE = 50L * 1024 * 1024;

    private static final ConcurrentHashMap<String, String> pointCodeMap = new ConcurrentHashMap<String, String>();
    private static final ConcurrentHashMap<String, String> componentCodeMap = new ConcurrentHashMap<String, String>();
    private static final ConcurrentHashMap<String, String> mainDeviceCodeMap = new ConcurrentHashMap<String, String>();
    private static final ConcurrentHashMap<String, String> bayCodeMap = new ConcurrentHashMap<String, String>();
    private static final ConcurrentHashMap<String, String> voltCodeMap = new ConcurrentHashMap<String, String>();


    @Value("${point.threadNum:6}")
    private Integer pointThreadNum;

    private static final Integer CAPACITY = 100000;

    private static final Integer BATCH_SIZE = 10000;

    /**
     * 本地点位excel模板类型
     */
    private static final Integer LOCAL_POINT_EXCEL_TEMPLATE_TYPE = 0;

    /**
     * 更新点位名称的台账excel模板类型
     */
    private static final Integer UPDATE_POINT_NAME_DEVICE_ACCOUNT_EXCEL_TEMPLATE_TYPE = 1;

    /**
     * account模块标定图片文件
     */
    private static final String ACCOUNT_IMAGE_CALIBRATION_FILE = FilePathManagerUtil.getFtpsDockerPath("/model/");

    /**
     * account模块临时文件
     */
    private static final String ACCOUNT_TEMP_FILE = FilePathManagerUtil.getFtpsDockerPath("/temp/");

    /**
     * Zip的文件格式类型
     */
    public static final String ZIP_FILE_TYPE = "zip";

    /**
     * Zip的文件大小
     */
    public static final long ZIP_FILE_SIZE = 3L * 1024 * 1024 * 1024;

    /**
     * Zip的文件格式类型
     */
    public static final String JPG_FILE_TYPE = "jpg";

    /**
     * 错误的excel表头描述信息
     */
    public static final String ERROR_EXCEL_TABLE_HEAD_DESC = "1 、下表中数据存在错误，请修改后直接以该表格导入；\n" +
            "2 、错误的字段已附注错误说明（红色角标），请参照说明修改；";

    /**
     * 默认排序
     */
    private static final int DEFAULT_ORDER = 0;

    /**
     * 点表下发的excel与csv文件路径
     */
    public static final String EXCEL_PATH = "/robot/data/patrol-common/cruise_file/csvPoint/";

    @Override
    public List<DevicePoint> queryDevicePointListByCalibrationId(String calibrationId) {
        return devicePointService.list(Wrappers.query(DevicePoint.builder().calibrationId(calibrationId).build()));
    }

    @Override
    public List<DevicePoint> queryDevicePointListByCalibrationIds(List<String> calibrationIds) {
        return devicePointService.list(new LambdaQueryWrapper<DevicePoint>()
                .in(DevicePoint::getCalibrationId, calibrationIds));
    }

    @Override
    public boolean updateBatchPointInfoByCalibrateId(List<DevicePointBO> devicePointBOS) {
        devicePointBOS.forEach(devicePointBO -> {
            devicePointService.update(new LambdaUpdateWrapper<DevicePoint>()
                    .eq(DevicePoint::getCalibrationId, devicePointBO.getCalibrationPointId())
                    .set(DevicePoint::getThermalRegion, devicePointBO.getThermalRegion())
                    .set(DevicePoint::getMapCode, devicePointBO.getMapCode())
            );
        });
        return true;
    }

    @Override
    public List<DevicePoint> getPointByFacCodeAndRobotCode(String stationCode, Long robotId) {
        return devicePointService.getPointByFacCode(stationCode, robotId);
    }

    @Override
    public List<DevicePointBO> queryPointExecutionListByPointIds(List<Long> pointIds) {
        return null;
    }


    @Override
    public DevicePointBO queryPointListByPointCode(String pointCode) {
        DevicePoint devicePoint = devicePointService.getOne(new LambdaQueryWrapper<DevicePoint>()
                .eq(DevicePoint::getPointCode, pointCode));
        if (Objects.isNull(devicePoint)) {
            return new DevicePointBO();
        }
        return ChiebotBeanUtils.copyProperties(devicePoint, DevicePointBO.class);
    }


    @Override
    public DevicePointBO queryPointByPointId(Long pointId) {
        return this.baseMapper.queryPointByPointId(pointId);
    }

    @Override
    public List<DevicePointBO> queryDevicePointBOListByCalibrationId(String calibrationId) {
        List<DevicePoint> devicePointList = this.baseMapper.selectList(new QueryWrapper<DevicePoint>().lambda()
                .eq(DevicePoint::getCalibrationId, calibrationId));
        if (CollectionUtils.isEmpty(devicePointList)) {
            return new ArrayList<>();
        }

        return ChiebotBeanUtils.convertList(devicePointList, DevicePointBO.class);
    }

    @Override
    public R<PageResponse<DevicePointVO>> page(DevicePointPageDTO devicePointPageDTO) {
        // 找到所有的位置状态类型信息
        List<DevicePropertyVO> positionList = devicePropertyService.getPositionList();
        Map<Integer, String> positionType2DescMap = positionList.stream()
                .collect(Collectors.toMap(DevicePropertyVO::getType, DevicePropertyVO::getValue, (v1, v2) -> v2));
        Page<DevicePointVO> page = Page.of(devicePointPageDTO.getPageNum(), devicePointPageDTO.getPageSize());
        IPage<DevicePointVO> pageVO = this.baseMapper.page(page, devicePointPageDTO);
        List<DevicePointVO> devicePointList = pageVO.getRecords();

        List<PointTags> pointTagsListInDb = pointTagsService.list();
        devicePointList.forEach(devicePointVO -> {
            // 处理点位标签名称
            devicePointVO.setPointTagsNameList(buildPointTagsNameList(devicePointVO.getPointTagsCodeList(), pointTagsListInDb));

            // 处理巡视类型
            List<Integer> inspectionSubTypeList = devicePointPageDTO.getInspectionSubTypeList();
            if (CollUtil.isNotEmpty(inspectionSubTypeList)) {
                if (StrUtil.isNotBlank(devicePointVO.getInspectionSubType())) {
                    String[] inspectionSubTypeArr = devicePointVO.getInspectionSubType().split(StrUtil.COMMA);
                    for (String inspectionSubTypeStr : inspectionSubTypeArr) {
                        if (!Pattern.compile("^[0-9]+$").matcher(inspectionSubTypeStr).matches()) {
                            log.info("存在巡视类型不正确的点位,点位id:{}", devicePointVO.getId());
                            devicePointList.remove(devicePointVO);
                            return;
                        }
                    }
                    List<Integer> inspectionSubTypes = Arrays.stream(inspectionSubTypeArr).map(Integer::valueOf).collect(Collectors.toList());
                    inspectionSubTypes.retainAll(inspectionSubTypeList);
                    if (inspectionSubTypes.isEmpty()) {
                        devicePointList.remove(devicePointVO);
                        return;
                    }
                } else {
                    devicePointList.remove(devicePointVO);
                    return;
                }
            }
            if (StrUtil.isNotBlank(devicePointVO.getInspectionSubType())) {
                List<Integer> inspectionTypeList = Arrays.stream(devicePointVO.getInspectionSubType().split(StrUtil.COMMA)).map(Integer::valueOf).toList();
                List<InspectionTypeEnum> inspectionTypeEnumList = new ArrayList<>();
                List<String> inspectionTypes = new ArrayList<>();
                List<InspectionTypeVO> inspectionTypeVOList = new ArrayList<>();
                inspectionTypeList.forEach(i -> {
                    InspectionTypeEnum inspectionTypeEnum = InspectionTypeEnum.getEnumBySubType(i);
                    if (Objects.nonNull(inspectionTypeEnum)) {
                        inspectionTypeEnumList.add(inspectionTypeEnum);
                        inspectionTypes.add(inspectionTypeEnum.getInspectionSubTypeDesc());
                    }
                });
                Map<Integer, List<InspectionTypeEnum>> inspectionTypeMap = inspectionTypeEnumList.stream().collect(Collectors.groupingBy(InspectionTypeEnum::getInspectionType));
                inspectionTypeMap.forEach((k, v) -> {
                    String inspectionTypeDesc = InspectionTypeEnum.getDescByCode(k);
                    List<InspectionTypeVO> subLevel = v.stream().map(i -> InspectionTypeVO.builder().inspectionType(i.getInspectionSubType())
                            .inspectionTypeDesc(i.getInspectionSubTypeDesc()).build()).collect(Collectors.toList());
                    inspectionTypeVOList.add(InspectionTypeVO.builder().inspectionType(k).inspectionTypeDesc(inspectionTypeDesc).subLevel(subLevel).build());
                });
                devicePointVO.setInspectionSubTypeList(inspectionTypeVOList);
                devicePointVO.setInspectionSubTypes(inspectionTypes);
            }
            // 处理识别类型
            String recTypeList = devicePointVO.getRecognitionTypeList();
            List<String> recTypeSplitList = Arrays.asList(recTypeList.split(StrUtil.COMMA));
            List<String> recTypeDescList = recTypeSplitList.stream()
                    .map(rec -> RecTypeEnum.valueOf(Integer.valueOf(rec)).getDesc()).collect(Collectors.toList());
            devicePointVO.setRecognitionTypeListDesc(String.join(CommonConstants.LONG_STRING, recTypeDescList));

            // 处理表计类型
            Integer meterType = devicePointVO.getMeterType();
            MeterTypeEnum meterTypeEnum = MeterTypeEnum.valueOf(meterType);
            devicePointVO.setMeterTypeDesc(Objects.nonNull(meterTypeEnum) ? meterTypeEnum.getDesc() : null);

            // 处理采集类型
            Integer saveTypeList = devicePointVO.getSaveTypeList();
            CollectTypeEnum collectTypeEnum = CollectTypeEnum.getEnumByCode(saveTypeList);
            devicePointVO.setSaveTypeListDesc(Objects.nonNull(collectTypeEnum) ? collectTypeEnum.getDesc() : null);

            // 处理辅助设施类型
            Integer appearanceType = devicePointVO.getAppearanceType();
            AssistFacilityTypeEnum assistFacilityTypeEnum = AssistFacilityTypeEnum.valueOf(appearanceType);
            devicePointVO.setAppearanceTypeDesc(Objects.nonNull(assistFacilityTypeEnum) ? assistFacilityTypeEnum.getDesc() : null);

            // 处理缺陷识别类型
            String defectRecType = devicePointVO.getDefectRecType();
            if (StrUtil.isNotBlank(defectRecType)) {
                List<String> defectRecTypeList = Arrays.asList(defectRecType.split(StrUtil.COMMA));
                String defectRecTypeDesc = defectRecTypeList.stream()
                        .map(d -> {
                            DefectAppearanceRecTypeEnum enumByType = DefectAppearanceRecTypeEnum.getEnumByType(d);
                            if (Objects.nonNull(enumByType)) {
                                return enumByType.getDesc();
                            } else {
                                return StrUtil.EMPTY;
                            }
                        })
                        .collect(Collectors.joining(StrUtil.COMMA));
                devicePointVO.setDefectRecTypeDesc(defectRecTypeDesc);
            }

            // 处理位置状态类型
            Integer positionStateType = devicePointVO.getPositionStateType();
            if (Objects.nonNull(positionStateType)) {
                String positionStateTypeDesc = positionType2DescMap.get(positionStateType);
                devicePointVO.setPositionStateTypeDesc(positionStateTypeDesc);
            }

            // 处理主设备类型
            Integer mainDeviceType = devicePointVO.getMainDeviceType();
            MainDeviceTypeEnum mainDeviceTypeEnum = MainDeviceTypeEnum.valueOf(mainDeviceType);
            devicePointVO.setMainDeviceTypeDesc(Objects.nonNull(mainDeviceTypeEnum) ? mainDeviceTypeEnum.getDesc() : null);
        });

        return R.ok(new PageResponse<>(pageVO.getCurrent(), pageVO.getSize(), devicePointList, pageVO.getTotal()));
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public R<Boolean> saveDevicePoint(DevicePointDTO devicePointDTO) {
        String pointName = devicePointDTO.getPointName();
        String pointCode = devicePointDTO.getPointCode();
        String recognitionTypeList = devicePointDTO.getRecognitionTypeList();
        Integer meterType = devicePointDTO.getMeterType();
        Integer positionStateType = devicePointDTO.getPositionStateType();
        Integer saveTypeList = devicePointDTO.getSaveTypeList();
        Integer appearanceType = devicePointDTO.getAppearanceType();
        String defectRecType = devicePointDTO.getDefectRecType();
        Integer defectJudgeType = Objects.nonNull(devicePointDTO.getDefectJudgeType()) ? devicePointDTO.getDefectJudgeType() : CommonConstants.NON_DEFECT_JUDGE;
        Integer importantLevel = devicePointDTO.getImportantLevel();
        Long robotId = devicePointDTO.getRobotId();
        List<Integer> inspectionSubTypeList = devicePointDTO.getInspectionSubTypeList();
        R<Boolean> checkResult = checkDevicePointParams(pointName, recognitionTypeList, meterType,
                positionStateType, saveTypeList, appearanceType, defectRecType, defectJudgeType, OPERATE_ADD, importantLevel, inspectionSubTypeList, devicePointDTO.getRemark());
        if (!checkResult.getData()) {
            return checkResult;
        }
        Long componentId = devicePointDTO.getComponentId();
        DeviceComponent deviceComponent = deviceComponentService.getById(componentId);
        // 点位编码同厂站下唯一性校验
        Long stationId = deviceComponent.getStationId();
        List<DevicePoint> devicePoints = this.baseMapper.selectList(Wrappers.<DevicePoint>lambdaQuery()
                .eq(DevicePoint::getStationId, stationId)
                .eq(DevicePoint::getPointCode, pointCode)
        );
        if (CollUtil.isNotEmpty(devicePoints)) {
            throw new RobotException("保存失败，厂站下点位编码已存在！");
        }
        Robot robot = robotService.getById(robotId);
        if (Objects.isNull(robot)) {
            throw new RobotException("机器人不存在");
        }
        DevicePoint devicePoint = DevicePoint.builder()
                .pointName(pointName)
                .pointCode(pointCode)
                .cruiseId(DeviceUtils.generateCruiseId())
                .alarmLevel(AlarmLevelEnum.NORMAL.getValue())
                .recognitionTypeList(recognitionTypeList)
                .saveTypeList(saveTypeList)
                .meterType(meterType)
                .positionStateType(positionStateType)
                .appearanceType(appearanceType)
                .defectRecType(defectRecType)
                .defectJudgeType(defectJudgeType)
                .importantLevel(importantLevel)
                .threePhaseFlag(CommonConstants.NON_THREE_PHASE_FLAG)
                .demarcateState(CommonConstants.NON_DEMARCATE)
                .robotId(robotId)
                .robotName(robot.getRobotName())
                .pointTagsCodeList(devicePointDTO.getPointTagsCodeList())
                // 部件信息
                .componentId(componentId)
                .componentType(deviceComponent.getComponentType())
                .componentName(deviceComponent.getComponentName())
                .componentCode(deviceComponent.getComponentCode())
                // 主设备信息
                .mainDeviceId(deviceComponent.getMainDeviceId())
                .mainDeviceType(deviceComponent.getMainDeviceType())
                .mainDeviceName(deviceComponent.getMainDeviceName())
                .mainDeviceCode(deviceComponent.getMainDeviceCode())
                .phaseType(deviceComponent.getPhaseType())
                // 间隔信息
                .bayId(deviceComponent.getBayId())
                .bayType(deviceComponent.getBayType())
                .bayName(deviceComponent.getBayName())
                .bayCode(deviceComponent.getBayCode())
                // 电压信息
                .voltId(deviceComponent.getVoltId())
                .voltName(deviceComponent.getVoltName())
                .voltCode(deviceComponent.getVoltCode())
                .stationId(stationId)
                .stationName(deviceComponent.getStationName())
                .stationCode(deviceComponent.getStationCode())
                .inspectionSubType(StrUtil.join(StrUtil.COMMA, inspectionSubTypeList))
                .createBy(SecurityUtils.getUsername())
                .createTime(LocalDateTime.now())
                .updateBy(SecurityUtils.getUsername())
                .updateTime(LocalDateTime.now())
                .remark(devicePointDTO.getRemark())
                .build();

        this.baseMapper.insert(devicePoint);
//
//		if (Objects.equals(recognitionType, RecTypeEnum.APPEARANCE.getType())) {
//			AnalysisSettingDTO analysisSettingDTO = AnalysisSettingDTO.builder()
//					.devicePointId(devicePoint.getId())
//					.devicePointName(pointName)
//					.facId(stationId)
//					.devicePointCode(pointCode)
//					.pointRecognitionTypeList(recognitionType)
//					.pointMeterType(meterType)
//					.positionStateType(positionStateType)
//					.build();
//			analysisSettingService.addAnalysisSettingByFacade(analysisSettingDTO);
//		}
        // 自动关联三项点位
        List<DevicePoint> devicePointList = this.baseMapper.selectList(Wrappers.<DevicePoint>lambdaQuery().in(DevicePoint::getPointName, allPhaseName(pointName)));
        if (CollUtil.isNotEmpty(devicePointList)) {
            List<Long> pointIds = devicePointList.stream().map(DevicePoint::getId).collect(Collectors.toList());
            try {
                bindThreePhasePoint(DevicePointDTO.builder().devicePointIdList(pointIds).build());
            } catch (Exception e) {
                log.error("自动关联三项点位【{}】异常！{}", pointName, e.getMessage());
            }
        }
        return R.ok(Boolean.TRUE, "保存成功");
    }

    @Override
    public R<Boolean> edit(DevicePointDTO devicePointDTO) {
        Long id = devicePointDTO.getId();
        DevicePoint devicePoint = this.baseMapper.selectById(id);
        if (Objects.isNull(devicePoint)) {
            return R.failed(Boolean.FALSE, "编辑失败，点位信息不存在");
        }
        String pointCode = devicePointDTO.getPointCode();
        // 点位编码同厂站下唯一性校验
        if (!StrUtil.equals(devicePoint.getPointCode(), pointCode)) {
            List<DevicePoint> devicePoints = this.baseMapper.selectList(Wrappers.<DevicePoint>lambdaQuery()
                    .eq(DevicePoint::getStationId, devicePoint.getStationId())
                    .eq(DevicePoint::getPointCode, pointCode)
            );
            if (CollUtil.isNotEmpty(devicePoints)) {
                return R.failed("保存失败，厂站下点位编码已存在！");
            }
        }
        String pointName = devicePointDTO.getPointName();
        String recognitionTypeList = devicePointDTO.getRecognitionTypeList();
        Integer positionStateType = devicePointDTO.getPositionStateType();
        Integer meterType = devicePointDTO.getMeterType();
        Integer saveTypeList = devicePointDTO.getSaveTypeList();
        String defectRecType = devicePointDTO.getDefectRecType();
        Integer defectJudgeType = Objects.nonNull(devicePointDTO.getDefectJudgeType()) ? devicePointDTO.getDefectJudgeType() : CommonConstants.NON_DEFECT_JUDGE;
        Integer appearanceType = devicePointDTO.getAppearanceType();
        Integer importantLevel = devicePointDTO.getImportantLevel();
        List<Integer> inspectionSubTypeList = devicePointDTO.getInspectionSubTypeList();
        R<Boolean> checkResult = checkDevicePointParams(pointName, recognitionTypeList, meterType,
                positionStateType, saveTypeList, appearanceType, defectRecType, defectJudgeType, OPERATE_EDIT, importantLevel, inspectionSubTypeList, devicePointDTO.getRemark());
        if (!checkResult.getData()) {
            return checkResult;
        }
        this.baseMapper.clearDevicePointInfo(id);
        DevicePoint point = DevicePoint.builder()
                .id(id)
                .pointName(pointName)
                .pointCode(pointCode)
                .recognitionTypeList(recognitionTypeList)
                .saveTypeList(saveTypeList)
                .meterType(meterType)
                .robotId(devicePointDTO.getRobotId())
                .robotName(devicePointDTO.getRobotName())
                .originCalibrationPath(devicePointDTO.getOriginCalibrationPath())
                .positionStateType(positionStateType)
                .appearanceType(appearanceType)
                .defectRecType(defectRecType)
                .pointTagsCodeList(devicePointDTO.getPointTagsCodeList())
                .defectJudgeType(defectJudgeType)
                .importantLevel(importantLevel)
                .inspectionSubType(StrUtil.join(StrUtil.COMMA, inspectionSubTypeList))
                .updateTime(LocalDateTime.now())
                .updateBy(SecurityUtils.getUsername())
                .remark(devicePointDTO.getRemark())
                .build();

        if (StringUtils.isEmpty(devicePointDTO.getRobotName())) {
            this.baseMapper.update(null, Wrappers.<DevicePoint>lambdaUpdate()
                    .eq(DevicePoint::getId, id)
                    .set(DevicePoint::getRobotId, null));
        }
        this.baseMapper.updateById(point);

        // 编辑三相点位时，若修改了表计类型、识别类型、位置状态类型、采集类型，三个点位同步更改
        if (Objects.equals(DigitalConstant.ONE, devicePoint.getThreePhaseFlag()) || StrUtil.isNotBlank(devicePoint.getThreePhaseAssociateId())) {
            if (!StrUtil.equals(devicePoint.getRecognitionTypeList(), devicePointDTO.getRecognitionTypeList()) ||
                    !Objects.equals(devicePoint.getMeterType(), devicePointDTO.getMeterType()) ||
                    !Objects.equals(devicePoint.getPositionStateType(), devicePointDTO.getPositionStateType()) ||
                    !Objects.equals(devicePoint.getSaveTypeList(), devicePointDTO.getSaveTypeList())) {
                List<Long> threePhasePointIdList = baseMapper.selectList(Wrappers.lambdaQuery(DevicePoint.class)
                        .select(DevicePoint::getId).eq(DevicePoint::getThreePhaseFlag, DigitalConstant.ONE)
                        .eq(DevicePoint::getThreePhaseAssociateId, devicePoint.getThreePhaseAssociateId())
                        .ne(DevicePoint::getId, devicePoint.getId())).stream().map(DevicePoint::getId).collect(Collectors.toList());

                if (CollUtil.isNotEmpty(threePhasePointIdList)) {
                    baseMapper.update(null, Wrappers.lambdaUpdate(DevicePoint.class).in(DevicePoint::getId, threePhasePointIdList)
                            .set(DevicePoint::getRecognitionTypeList, devicePointDTO.getRecognitionTypeList())
                            .set(DevicePoint::getMeterType, devicePointDTO.getMeterType())
                            .set(DevicePoint::getPositionStateType, devicePointDTO.getPositionStateType())
                            .set(DevicePoint::getSaveTypeList, devicePointDTO.getSaveTypeList()));
                }
            }
        }

        taskService.asyncRefreshCache();
        return R.ok(Boolean.TRUE, "编辑成功");
    }

    @Override
    public R<Boolean> batchDelete(DevicePointDTO devicePointDTO) {
        deleteDevicePointInfo(devicePointDTO.getDevicePointIdList());
        return R.ok(Boolean.TRUE, "删除成功");
    }

    @Override
    public R<DevicePointVO> detail(Long id) {
        DevicePoint devicePoint = this.baseMapper.selectById(id);
        if (Objects.isNull(devicePoint)) {
            return R.failed("查询失败，未获取到点位信息");
        }
        DevicePointVO devicePointVO = ChiebotBeanUtils.copyProperties(devicePoint, DevicePointVO.class);

        // 处理巡视类型
        if (StringUtils.isNotEmpty(devicePointVO.getInspectionSubType())) {
            List<Integer> inspectionTypeList = Arrays.stream(devicePointVO.getInspectionSubType().split(StrUtil.COMMA)).map(Integer::valueOf).collect(Collectors.toList());
            List<InspectionTypeEnum> inspectionTypeEnumList = new ArrayList<>();
            List<InspectionTypeVO> inspectionTypeVOList = new ArrayList<>();
            inspectionTypeList.forEach(i -> {
                InspectionTypeEnum inspectionTypeEnum = InspectionTypeEnum.getEnumBySubType(i);
                if (Objects.nonNull(inspectionTypeEnum)) {
                    inspectionTypeEnumList.add(inspectionTypeEnum);
                }
            });

            Map<Integer, List<InspectionTypeEnum>> inspectionTypeMap = inspectionTypeEnumList.stream().collect(Collectors.groupingBy(InspectionTypeEnum::getInspectionType));
            inspectionTypeMap.forEach((k, v) -> {
                String inspectionTypeDesc = InspectionTypeEnum.getDescByCode(k);
                List<InspectionTypeVO> subLevel = v.stream().map(i -> InspectionTypeVO.builder().inspectionType(i.getInspectionSubType())
                        .inspectionTypeDesc(i.getInspectionSubTypeDesc()).build()).collect(Collectors.toList());
                inspectionTypeVOList.add(InspectionTypeVO.builder().inspectionType(k).inspectionTypeDesc(inspectionTypeDesc).subLevel(subLevel).build());
            });
            devicePointVO.setInspectionSubTypeList(inspectionTypeVOList);
        }

        String recognitionTypeList = devicePoint.getRecognitionTypeList();
        // 处理识别类型描述
        String recTypeDesc = Arrays.stream(recognitionTypeList.split(StrUtil.COMMA))
                .map(recType -> RecTypeEnum.valueOf(Integer.valueOf(recType)).getDesc())
                .collect(Collectors.joining(StrUtil.COMMA));
        devicePointVO.setRecognitionTypeListDesc(recTypeDesc);

        // 处理辅助设施类型
        Integer appearanceType = devicePoint.getAppearanceType();
        AssistFacilityTypeEnum assistFacilityTypeEnum = AssistFacilityTypeEnum.valueOf(appearanceType);
        devicePointVO.setAppearanceTypeDesc(Objects.nonNull(assistFacilityTypeEnum) ? assistFacilityTypeEnum.getDesc() : null);

        // 处理缺陷识别类型
        String defectRecType = devicePoint.getDefectRecType();
        if (StrUtil.isNotBlank(defectRecType)) {
            List<String> defectRecTypeList = Arrays.asList(defectRecType.split(StrUtil.COMMA));
            String defectRecTypeDesc = defectRecTypeList.stream()
                    .map(d -> DefectAppearanceRecTypeEnum.getEnumByType(d).getDesc())
                    .collect(Collectors.joining(StrUtil.COMMA));
            devicePointVO.setDefectRecTypeDesc(defectRecTypeDesc);
        }

        // 处理采集类型描述
        CollectTypeEnum collectTypeEnum = CollectTypeEnum.getEnumByCode(devicePoint.getSaveTypeList());
        devicePointVO.setSaveTypeListDesc(Objects.nonNull(collectTypeEnum) ? collectTypeEnum.getDesc() : null);

        // 处理表计类型
        Integer meterType = devicePoint.getMeterType();
        MeterTypeEnum meterTypeEnum = MeterTypeEnum.valueOf(meterType);
        devicePointVO.setMeterTypeDesc(Objects.nonNull(meterTypeEnum) ? meterTypeEnum.getDesc() : null);

        // 处理位置状态类型
        Integer positionStateType = devicePoint.getPositionStateType();
        DevicePropertyVO devicePropertyVO = devicePropertyService.getPositionByPositionType(positionStateType);
        devicePointVO.setPositionStateTypeDesc(Objects.nonNull(devicePropertyVO) ? devicePropertyVO.getValue() : null);

        // 处理主设备类型
        Integer mainDeviceType = devicePoint.getMainDeviceType();
        MainDeviceTypeEnum mainDeviceTypeEnum = MainDeviceTypeEnum.valueOf(mainDeviceType);
        devicePointVO.setMainDeviceTypeDesc(Objects.nonNull(mainDeviceTypeEnum) ? mainDeviceTypeEnum.getDesc() : null);

        // 主设备相位类型
        Integer phaseType = devicePoint.getPhaseType();
        PhaseTypeEnum phaseTypeEnum = PhaseTypeEnum.valueOf(phaseType);
        devicePointVO.setPhaseTypeDesc(Objects.nonNull(phaseTypeEnum) ? phaseTypeEnum.getDescription() : null);

        devicePointVO.setCreateTime(DateUtil.formatLocalDateTime(devicePoint.getCreateTime()));
        devicePointVO.setUpdateTime(DateUtil.formatLocalDateTime(devicePoint.getUpdateTime()));

        // 处理关联信息
        handleAssociateInfo(devicePointVO, devicePoint);

        // 处理重要等级
        devicePointVO.setImportantLevelDesc(ImportantLevelEnum.descByLevel(devicePointVO.getImportantLevel()));

        // 处理阈值信息
        Map<String, String> alarmThresholdByPointId = analysisSettingService.getAlarmThresholdByPointId(id);
        devicePointVO.setThresholdMap(alarmThresholdByPointId);

        // 处理标签名称
        String pointTagsCodeList = devicePointVO.getPointTagsCodeList();
        if (StringUtils.isNotBlank(pointTagsCodeList)) {
            QueryWrapper<PointTags> pointTagsQueryWrapper = new QueryWrapper<>();
            pointTagsQueryWrapper.lambda().in(PointTags::getTagsCode, Arrays.asList(pointTagsCodeList.split(StrUtil.COMMA)));
            List<PointTags> pointTagsList = pointTagsService.list(pointTagsQueryWrapper);
            if (CollectionUtils.isNotEmpty(pointTagsList)) {
                String pointTagsNameList = pointTagsList.stream().map(PointTags::getTagsName).collect(Collectors.joining(StrUtil.COMMA));
                devicePointVO.setPointTagsNameList(pointTagsNameList);
            }
        }

        return R.ok(devicePointVO);
    }

    @Override
    public R<Boolean> bindThreePhasePoint(DevicePointDTO devicePointDTO) {
        List<Long> devicePointIdList = devicePointDTO.getDevicePointIdList();
        List<DevicePoint> devicePointList = this.baseMapper.selectBatchIds(devicePointIdList);
        if (CollUtil.isEmpty(devicePointList)) {
            throw new RobotException("关联失败，点位信息不存在");
        }
        if (DigitalConstant.THREE != devicePointList.size()) {
            throw new RobotException("关联失败，需勾选三个点位信息");
        }
        long bayCount = devicePointList.stream().map(DevicePoint::getBayId).distinct().count();
        if (1L != bayCount) {
            throw new RobotException("关联失败，关联的三相点位需要在同一个间隔下");
        }
        // 获取主设备信息
        long mainDeviceTypeCount = devicePointList.stream().map(DevicePoint::getMainDeviceType).distinct().count();
        if (1L != mainDeviceTypeCount) {
            throw new RobotException("关联失败，关联的三相点位需要相同的主设备类型");
        }
        List<Integer> phaseTypeList = devicePointList.stream().map(DevicePoint::getPhaseType).collect(Collectors.toList());
        boolean containsPhaseABC = phaseTypeList.contains(PhaseTypeEnum.PHASE_A.getType())
                && phaseTypeList.contains(PhaseTypeEnum.PHASE_B.getType()) && phaseTypeList.contains(PhaseTypeEnum.PHASE_C.getType());
        if (!containsPhaseABC) {
            throw new RobotException("关联失败，主设备相位类型需要包含A相、B相、C相");
        }
        sortedRecognitionTypeList(devicePointList);
        long recognitionTypeListCount = devicePointList.stream().map(DevicePoint::getRecognitionTypeList).distinct().count();
        if (1L != recognitionTypeListCount) {
            throw new RobotException("关联失败，关联的点位需是相同的识别类型");
        }

        boolean threePhaseFlag = devicePointList.stream()
                .anyMatch(devicePoint -> Objects.equals(CommonConstants.THREE_PHASE_FLAG, devicePoint.getThreePhaseFlag()));
        if (threePhaseFlag) {
            throw new RobotException("关联失败，勾选的点位已经是三相关联点位");
        }

        String threePhaseAssociateId = UUID.randomUUID().toString();
        List<DevicePoint> devicePoints = devicePointIdList.stream()
                .map(devicePointId -> DevicePoint.builder().id(devicePointId).threePhaseFlag(CommonConstants.THREE_PHASE_FLAG).threePhaseAssociateId(threePhaseAssociateId).build()).collect(Collectors.toList());
        this.updateBatchById(devicePoints);

        // 判断选择的主设备是否是三相关联设备，若不是，则将主设备更新为三相关联设备
        List<Long> mainDeviceIdList = devicePointList.stream().map(DevicePoint::getMainDeviceId).collect(Collectors.toList());
        List<DeviceMain> deviceMainList = deviceMainService.listByIds(mainDeviceIdList);
        boolean mainNotThreePhaseFlag = deviceMainList.stream()
                .noneMatch(deviceMain -> Objects.equals(CommonConstants.THREE_PHASE_FLAG, deviceMain.getThreePhaseFlag()));
        if (mainNotThreePhaseFlag) {
            // 需要将关联的主设备设置为三相设备
            String associateId = UUID.randomUUID().toString();
            deviceMainList.forEach(deviceMain -> {
                deviceMain.setThreePhaseFlag(CommonConstants.THREE_PHASE_FLAG);
                deviceMain.setThreePhaseAssociateId(associateId);
            });
            deviceMainService.updateBatchById(deviceMainList);
        }

        taskService.asyncRefreshCache();
        return R.ok(Boolean.TRUE, "关联成功");
    }

    private void sortedRecognitionTypeList(List<DevicePoint> devicePointList) {
        devicePointList.forEach(devicePoint -> {
            String recognitionTypeList = devicePoint.getRecognitionTypeList();
            List<String> recTypeList = new ArrayList<>(Arrays.asList(recognitionTypeList.split(StrUtil.COMMA)));
            devicePoint.setRecognitionTypeList(recTypeList.stream().sorted().collect(Collectors.joining(StrUtil.COMMA)));
        });
    }

    @Override
    public R<Boolean> unbindThreePhasePoint(DevicePointDTO devicePointDTO) {
        List<Long> devicePointIdList = devicePointDTO.getDevicePointIdList();
        List<DevicePoint> devicePointList = this.baseMapper.selectBatchIds(devicePointIdList);
        if (CollUtil.isEmpty(devicePointList)) {
            return R.failed(Boolean.FALSE, "取消关联失败，点位信息不存在");
        }
        // 找到所有关联了三相设备的点位信息
        devicePointList = devicePointList.stream()
                .filter(devicePoint -> Objects.equals(CommonConstants.THREE_PHASE_FLAG, devicePoint.getThreePhaseFlag()))
                .collect(Collectors.toList());
        if (CollUtil.isEmpty(devicePointList)) {
            return R.failed(Boolean.FALSE, "请选择三相点位");
        }
        List<String> threePhaseAssociateIdList = devicePointList.stream()
                .map(DevicePoint::getThreePhaseAssociateId).collect(Collectors.toList());
        LambdaUpdateWrapper<DevicePoint> wrapper = Wrappers.lambdaUpdate(DevicePoint.class)
                .set(DevicePoint::getThreePhaseFlag, CommonConstants.NON_THREE_PHASE_FLAG)
                .set(DevicePoint::getThreePhaseAssociateId, null).in(DevicePoint::getThreePhaseAssociateId, threePhaseAssociateIdList);
        this.update(wrapper);

        taskService.asyncRefreshCache();
        return R.ok(Boolean.TRUE, "取消关联成功");
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteDevicePointInfo(List<Long> devicePointIdList) {
        if (CollUtil.isEmpty(devicePointIdList)) {
            return;
        }
        List<DevicePoint> devicePointList = this.baseMapper.selectBatchIds(devicePointIdList);
        // 处理三相
        List<DevicePoint> threePhasePointList = devicePointList.stream()
                .filter(devicePoint -> Objects.equals(CommonConstants.THREE_PHASE_FLAG, devicePoint.getThreePhaseFlag()))
                .collect(Collectors.toList());

        if (CollUtil.isNotEmpty(threePhasePointList)) {
            List<String> associateIdList = threePhasePointList.stream()
                    .map(DevicePoint::getThreePhaseAssociateId).collect(Collectors.toList());
            this.baseMapper.deleteThreePhaseInfo(associateIdList);
        }
        this.removeBatchByIds(devicePointIdList);

        taskService.asyncRefreshCache();
    }

    @Override
    public List<DeviceModelItemFromHigherVO> queryDeviceModelItemList(Long stationId) {
        ThreadPoolExecutor executor = null;
        List<DeviceModelItemFromHigherVO> deviceModelItemFromHigherVOS = new CopyOnWriteArrayList<>();

        if (!Objects.isNull(stationId)) {
            try {
                executor = ExecutorUtils.customizeThreadExecutor(
                        Runtime.getRuntime().availableProcessors() * 2,
                        Runtime.getRuntime().availableProcessors() * 2,
                        CAPACITY,
                        ThreadNameConstant.Point.MODEL_SYNC,
                        new ThreadPoolExecutor.CallerRunsPolicy());

                // 查询点位总数&&计算迭代查询次数
                Long totalCount = this.baseMapper.selectCount(
                        new QueryWrapper<DevicePoint>()
                                .lambda()
                                .eq(DevicePoint::getStationId, stationId)
                                .ne(DevicePoint::getSaveTypeList, CollectTypeEnum.OIL.getCode()));
                if (0L == totalCount) {
                    log.warn("[巡视主机模型同步 点位为空] stationId:{}", stationId);
                    return new ArrayList<>();
                }
                int iterations = (int) Math.ceil((double) totalCount / BATCH_SIZE);

                // 多线程分批查询数据,每次查询数据量为 BATCH_SIZE
                List<CompletableFuture<Void>> futures = new ArrayList<>();
                List<DevicePointModelSyncVO> devicePointModelSyncVOS = new ArrayList<>();
                for (int i = 0; i < iterations; i++) {
                    int finalI = i;
                    CompletableFuture<Void> future = CompletableFuture.runAsync(() -> {
                        int offset = finalI * BATCH_SIZE;
                        List<DevicePointModelSyncVO> batchList = this.baseMapper.queryDeviceModelListWithOffset(stationId, offset, BATCH_SIZE);
                        devicePointModelSyncVOS.addAll(batchList);
                    }, executor);
                    futures.add(future);
                }
                CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
                if (CollectionUtils.isNotEmpty(devicePointModelSyncVOS)) {

                    // 根据点位id分组
                    Map<Long, List<DevicePointModelSyncVO>> devicePointFullInfoVOSMap = devicePointModelSyncVOS.parallelStream().collect(Collectors.groupingBy(DevicePointModelSyncVO::getDevicePointId));
                    // 多线程封装数据
                    futures.clear();
                    for (Long pointId : devicePointFullInfoVOSMap.keySet()) {
                        CompletableFuture<Void> future = CompletableFuture.runAsync(() -> {
                            List<DevicePointModelSyncVO> devicePointModelSyncVOSList = devicePointFullInfoVOSMap.get(pointId);
                            DevicePointModelSyncVO devicePointModelSyncVO = devicePointModelSyncVOSList.get(0);
                            if (null != devicePointModelSyncVO) {
                                deviceModelItemFromHigherVOS.add(buildDeviceModelItem2HigherVO(devicePointModelSyncVO));
                            }
                        }, executor);
                        futures.add(future);
                    }
                    CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
                }
            } catch (Exception e) {
                log.error("定位模型同步失败");
                log.error(e.getMessage(), e);
            } finally {
                ExecutorUtils.shutdown(executor);
            }
        }
        return deviceModelItemFromHigherVOS;
    }

    @Override
    public R<PageResponse<ThreePhasePointVO>> threePhasePointList(DevicePointPageDTO devicePointPageDTO) {
        Page<ThreePhasePointVO> page = Page.of(devicePointPageDTO.getPageNum(), devicePointPageDTO.getPageSize());
        IPage<ThreePhasePointVO> pageVO = this.baseMapper.threePhasePointList(page, devicePointPageDTO);
        List<ThreePhasePointVO> threePhasePointVOS = pageVO.getRecords();
        threePhasePointVOS.forEach(devicePoint -> {
            // 处理主设备类型
            Integer mainDeviceType = devicePoint.getMainDeviceType();
            MainDeviceTypeEnum mainDeviceTypeEnum = MainDeviceTypeEnum.valueOf(mainDeviceType);
            devicePoint.setMainDeviceTypeDesc(Objects.nonNull(mainDeviceTypeEnum) ? mainDeviceTypeEnum.getDesc() : null);
        });
        if (CollectionUtils.isEmpty(threePhasePointVOS)) {
            return R.ok(new PageResponse<>(pageVO.getCurrent(), pageVO.getSize(), null, pageVO.getTotal()));
        }
        Map<String, List<ThreePhasePointVO>> threePhaseAssociateIdMap = threePhasePointVOS.stream()
                .filter(vo ->  StringUtils.isNotBlank(vo.getThreePhaseAssociateId()))
                .collect(Collectors.groupingBy(ThreePhasePointVO::getThreePhaseAssociateId));
        List<ThreePhasePointVO> finalThreePhasePointVOS = new ArrayList<>();
        for (String threePhaseAssociateId : threePhaseAssociateIdMap.keySet()) {
            List<ThreePhasePointVO> threePhasePointVOList = threePhaseAssociateIdMap.get(threePhaseAssociateId);
            if (!Objects.equals(threePhasePointVOList.size(), 3)) {
                log.warn("三相分组id:{},个数:{},不正确", threePhaseAssociateId, threePhasePointVOList.size());
                continue;
            }
            ThreePhasePointVO threePhasePointVOA = threePhasePointVOList.stream().filter(threePhasePointVO -> Objects.equals(threePhasePointVO.getPhaseType(), PhaseTypeEnum.PHASE_A.getType())).findFirst().orElse(null);
            ThreePhasePointVO threePhasePointVOB = threePhasePointVOList.stream().filter(threePhasePointVO -> Objects.equals(threePhasePointVO.getPhaseType(), PhaseTypeEnum.PHASE_B.getType())).findFirst().orElse(null);
            ThreePhasePointVO threePhasePointVOC = threePhasePointVOList.stream().filter(threePhasePointVO -> Objects.equals(threePhasePointVO.getPhaseType(), PhaseTypeEnum.PHASE_C.getType())).findFirst().orElse(null);
            if (Objects.isNull(threePhasePointVOA) || Objects.isNull(threePhasePointVOB) || Objects.isNull(threePhasePointVOC)) {
                log.warn("三相相位有缺失");
                continue;
            }
            ThreePhasePointVO threePhasePointVO = ThreePhasePointVO.builder().aId(threePhasePointVOA.getId())
                    .aName(threePhasePointVOA.getName())
                    .bId(threePhasePointVOB.getId())
                    .bName(threePhasePointVOB.getName())
                    .cId(threePhasePointVOC.getId())
                    .cName(threePhasePointVOC.getName())
                    .mainDeviceTypeDesc(threePhasePointVOA.getMainDeviceTypeDesc())
                    .bayName(threePhasePointVOA.getBayName())
                    .voltName(threePhasePointVOA.getVoltName())
                    .build();
            finalThreePhasePointVOS.add(threePhasePointVO);
        }

        return R.ok(new PageResponse<>(pageVO.getCurrent(), pageVO.getSize(), finalThreePhasePointVOS, pageVO.getTotal() / 3));
    }

    @Override
    public R<Boolean> checkNameByChangeParentNode(DeviceTreeDTO deviceTreeDTO) {
        Long parentNodeId = deviceTreeDTO.getParentNodeId();
        Integer parentNodeLevel = deviceTreeDTO.getParentNodeLevel();
        List<DeviceNodeDetailDTO> deviceNodeList = deviceTreeDTO.getDeviceNodeList();
        List<String> nameList = deviceNodeList.stream().map(DeviceNodeDetailDTO::getCurrentNodeName).collect(Collectors.toList());
        Long currentNodeId = deviceNodeList.get(0).getCurrentNodeId();
        DeviceTreeNodeLevelEnum deviceTreeNodeLevelEnum = DeviceTreeNodeLevelEnum.valueOf(parentNodeLevel);
        if (Objects.isNull(deviceTreeNodeLevelEnum)) {
            return R.failed(Boolean.FALSE, "节点层级信息错误");
        }
        switch (deviceTreeNodeLevelEnum) {
            case VOLTAGE_NODE:
                // 处理间隔
                List<DeviceBay> deviceBayList = deviceBayService.list(Wrappers.lambdaQuery(DeviceBay.class)
                        .eq(DeviceBay::getVoltId, parentNodeId));
                if (CollUtil.isEmpty(deviceBayList)) {
                    return R.ok(Boolean.FALSE);
                }
                DeviceBay deviceBay = deviceBayService.getById(currentNodeId);
                if (Objects.equals(deviceBay.getVoltId(), parentNodeId)) {
                    return R.ok(Boolean.FALSE);
                }
                boolean flag = deviceBayList.stream().anyMatch(bay -> nameList.contains(bay.getBayName()));
                return R.ok(flag);
            case BAY_NODE:
                // 处理主设备
                List<DeviceMain> deviceMainList = deviceMainService.list(Wrappers.lambdaQuery(DeviceMain.class)
                        .eq(DeviceMain::getBayId, parentNodeId));
                if (CollUtil.isEmpty(deviceMainList)) {
                    return R.ok(Boolean.FALSE);
                }
                DeviceMain deviceMain = deviceMainService.getById(currentNodeId);
                if (Objects.equals(deviceMain.getBayId(), parentNodeId)) {
                    return R.ok(Boolean.FALSE);
                }
                boolean f = false;
                for (DeviceMain main : deviceMainList) {
                    f = deviceNodeList.stream().anyMatch(d -> d.getCurrentNodeName().equals(main.getMainDeviceName())
                            && Objects.equals(main.getPhaseType(), d.getPhaseType()) && Objects.equals(main.getMainDeviceType(), d.getMainDeviceType()));
                    if (f) {
                        break;
                    }
                }
                return R.ok(f);
            case MAIN_DEVICE_NODE:
                // 处理部件
                List<DeviceComponent> deviceComponentList = deviceComponentService.list(Wrappers.lambdaQuery(DeviceComponent.class)
                        .eq(DeviceComponent::getMainDeviceId, parentNodeId));
                if (CollUtil.isEmpty(deviceComponentList)) {
                    return R.ok(Boolean.FALSE);
                }
                DeviceComponent deviceComponent = deviceComponentService.getById(currentNodeId);
                if (Objects.equals(deviceComponent.getMainDeviceId(), parentNodeId)) {
                    return R.ok(Boolean.FALSE);
                }
                return R.ok(deviceComponentList.stream().anyMatch(component -> nameList.contains(component.getComponentName())));
            default:
                break;
        }
        return R.ok(Boolean.FALSE);
    }

    @Override
    public void deleteThreePhaseInfo(List<String> associateIdList) {
        if (CollUtil.isEmpty(associateIdList)) {
            return;
        }
        this.baseMapper.deleteThreePhaseInfo(associateIdList);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public R<Boolean> changeParentNode(DevicePointDTO devicePointDTO) {
        List<Long> devicePointIdList = devicePointDTO.getDevicePointIdList();
        Long targetComponentId = devicePointDTO.getComponentId();

        List<DevicePoint> devicePointList = this.baseMapper.selectBatchIds(devicePointIdList);
        if (CollUtil.isEmpty(devicePointList)) {
            return R.failed(Boolean.FALSE, "勾选的巡检点信息不存在");
        }
        long conditionCount = devicePointList.stream().map(point -> point.getStationId()
                + StrUtil.UNDERLINE + point.getVoltId() + StrUtil.UNDERLINE
                + point.getBayId() + StrUtil.UNDERLINE + point.getMainDeviceId() + StrUtil.UNDERLINE + point.getComponentId()).distinct().count();

        if (conditionCount > 1L) {
            return R.failed(Boolean.FALSE, "勾选的点位需为同一厂站下相同层级的设备");
        }
        DevicePoint point = devicePointList.get(DigitalConstant.ZERO);
        Long currentComponentId = point.getComponentId();
        if (Objects.equals(currentComponentId, targetComponentId)) {
            return R.failed(Boolean.FALSE, "修改失败，勾选的点位的上级节点与要合并的上级节点须是不同节点");
        }

        DeviceComponent component = deviceComponentService.getById(targetComponentId);
        if (Objects.isNull(component)) {
            return R.failed(Boolean.FALSE, "修改失败，部件信息不存在");
        }

        if (!Objects.equals(component.getStationId(), point.getStationId())) {
            return R.failed(Boolean.FALSE, "修改失败，上级节点与所选节点不在同一厂站下");
        }

        DeviceComponent deviceComponent = deviceComponentService.getById(targetComponentId);
        // 更新巡检点的电压、间隔、主设备id、部件id
        this.update(Wrappers.lambdaUpdate(DevicePoint.class)
                .set(DevicePoint::getVoltId, deviceComponent.getVoltId())
                .set(DevicePoint::getVoltName, deviceComponent.getVoltName())
                .set(DevicePoint::getBayId, deviceComponent.getBayId())
                .set(DevicePoint::getBayName, deviceComponent.getBayName())
                .set(DevicePoint::getMainDeviceId, deviceComponent.getMainDeviceId())
                .set(DevicePoint::getMainDeviceName, deviceComponent.getMainDeviceName())
                .set(DevicePoint::getComponentId, deviceComponent.getId())
                .set(DevicePoint::getComponentName, deviceComponent.getComponentName())
                .set(DevicePoint::getMainDeviceType, deviceComponent.getMainDeviceType())
                .set(DevicePoint::getPhaseType, deviceComponent.getPhaseType())
                .in(DevicePoint::getId, devicePointIdList));

        taskService.asyncRefreshCache();
        return R.ok(Boolean.TRUE, "修改成功");
    }

    @Override
    public List<DevicePointBO> queryPointListByFacId(Long facId) {
        return this.baseMapper.queryPointListByFacId(facId);
    }

    /**
     * 根据修改任务的参数获取巡检点集合
     *
     * @param updateTaskFeignDTO 修改任务的参数
     * @return 巡检点集合
     */
    @Override
    public List<DevicePointBO> getUpdateTaskPoints(UpdateTaskFeignDTO updateTaskFeignDTO) {
        SaveTaskModeEnum saveTaskModeEnum = SaveTaskModeEnum.valueOf(updateTaskFeignDTO.getSaveTaskMode());
        if (Objects.isNull(saveTaskModeEnum)) {
            return null;
        }

        // 任务关联的巡检点集合
        List<DevicePointBO> taskPointBOList = this.baseMapper.getPointBOListByTaskIdList(updateTaskFeignDTO.getTaskIdList());

        // 删除设备层级
        List<NodeInfoFeignDTO> removeNodeInfoList = new ArrayList<>();

        // 补充设备层级
        List<NodeInfoFeignDTO> addNodeInfoList = new ArrayList<>();

        switch (saveTaskModeEnum) {
            case DEVICE_TREE_TAB:
            case POINT_TAB:
                if (CollectionUtils.isNotEmpty(updateTaskFeignDTO.getDeleteNodeIdList())) {
                    updateTaskFeignDTO.getDeleteNodeIdList()
                            .forEach(id -> removeNodeInfoList.add(new NodeInfoFeignDTO(id, DeviceTreeNodeLevelEnum.POINT_NODE.getLevel())));
                }
                if (CollectionUtils.isNotEmpty(updateTaskFeignDTO.getAddNodeIdList())) {
                    updateTaskFeignDTO.getAddNodeIdList()
                            .forEach(id -> addNodeInfoList.add(new NodeInfoFeignDTO(id, DeviceTreeNodeLevelEnum.POINT_NODE.getLevel())));
                }
                break;
            case COMPONENT_TAB:
                if (CollectionUtils.isNotEmpty(updateTaskFeignDTO.getDeleteNodeIdList())) {
                    updateTaskFeignDTO.getDeleteNodeIdList()
                            .forEach(id -> removeNodeInfoList.add(new NodeInfoFeignDTO(id, DeviceTreeNodeLevelEnum.COMPONENT_NODE.getLevel())));
                }
                if (CollectionUtils.isNotEmpty(updateTaskFeignDTO.getAddNodeIdList())) {
                    updateTaskFeignDTO.getAddNodeIdList()
                            .forEach(id -> addNodeInfoList.add(new NodeInfoFeignDTO(id, DeviceTreeNodeLevelEnum.COMPONENT_NODE.getLevel())));
                }
                break;
            case MAIN_TAB:
                if (CollectionUtils.isNotEmpty(updateTaskFeignDTO.getDeleteNodeIdList())) {
                    updateTaskFeignDTO.getDeleteNodeIdList()
                            .forEach(id -> removeNodeInfoList.add(new NodeInfoFeignDTO(id, DeviceTreeNodeLevelEnum.MAIN_DEVICE_NODE.getLevel())));
                }
                if (CollectionUtils.isNotEmpty(updateTaskFeignDTO.getAddNodeIdList())) {
                    updateTaskFeignDTO.getAddNodeIdList()
                            .forEach(id -> addNodeInfoList.add(new NodeInfoFeignDTO(id, DeviceTreeNodeLevelEnum.MAIN_DEVICE_NODE.getLevel())));
                }
                break;
            case BAY_TAB:
                if (CollectionUtils.isNotEmpty(updateTaskFeignDTO.getDeleteNodeIdList())) {
                    updateTaskFeignDTO.getDeleteNodeIdList()
                            .forEach(id -> removeNodeInfoList.add(new NodeInfoFeignDTO(id, DeviceTreeNodeLevelEnum.BAY_NODE.getLevel())));
                }
                if (CollectionUtils.isNotEmpty(updateTaskFeignDTO.getAddNodeIdList())) {
                    updateTaskFeignDTO.getAddNodeIdList()
                            .forEach(id -> addNodeInfoList.add(new NodeInfoFeignDTO(id, DeviceTreeNodeLevelEnum.BAY_NODE.getLevel())));
                }
                break;
            default:
                break;
        }

        // 删除巡检点集合
        DevicePointFeignDTO removeDTO = DevicePointFeignDTO.builder().nodeInfoList(removeNodeInfoList).build();
        List<DevicePointBO> removePointBOList = this.converseNodeInfoListToPointList(removeDTO);

        // 补充巡检点集合
        DevicePointFeignDTO addDTO = DevicePointFeignDTO.builder().nodeInfoList(addNodeInfoList).build();
        List<DevicePointBO> addPointBOList = this.converseNodeInfoListToPointList(addDTO);

        if (CollectionUtils.isNotEmpty(addPointBOList)) {
            taskPointBOList.addAll(addPointBOList);
        }
        if (CollectionUtils.isNotEmpty(removePointBOList)) {
            Set<Long> idsToRemove = removePointBOList.stream()
                    .map(DevicePointBO::getId)
                    .collect(Collectors.toSet());
            taskPointBOList = taskPointBOList.stream()
                    .filter(item -> !idsToRemove.contains(item.getId()))
                    .collect(Collectors.toList());
        }
        return taskPointBOList;
    }

    /**
     * feign-根据设备层级节点集合获取其下面的所有已标定的点位集合(点位数据会出现重复，因为点位冗余，可以能是本地也可能是下级系统的其他设备)
     *
     * @param dto 设备层级节点集合
     * @return 所有已标定的点位集合
     */
    @Override
    public List<DevicePointBO> converseNodeInfoListToPointList(DevicePointFeignDTO dto) {
        if (CollectionUtils.isEmpty(dto.getNodeInfoList())) {
            return null;
        }
        List<DevicePointBO> list = new ArrayList<>();

        // 根据层级分组
        Map<Integer, List<NodeInfoFeignDTO>> nodeLevelMap = dto.getNodeInfoList().stream()
                .collect(Collectors.groupingBy(NodeInfoFeignDTO::getNodeLevel));
        nodeLevelMap.forEach((nodeLevel, nodeList) -> {
            DeviceTreeNodeLevelEnum deviceTreeNodeLevelEnum = DeviceTreeNodeLevelEnum.valueOf(nodeLevel);
            if (Objects.isNull(deviceTreeNodeLevelEnum)) {
                log.error("==========>该设备层级: {} 不存在！", nodeLevel);
                return;
            }

            List<Long> ids = nodeList.stream().map(NodeInfoFeignDTO::getNodeId).collect(Collectors.toList());

            // 前提是标定过的点位
            EquipmentLevelDTO equipmentLevelDTO = new EquipmentLevelDTO();
            switch (deviceTreeNodeLevelEnum) {
                case STATION_NODE:
                    equipmentLevelDTO.setStationNodeIds(ids);
                    break;
                case VOLTAGE_NODE:
                    equipmentLevelDTO.setVoltageNodeIds(ids);
                    break;
                case BAY_NODE:
                    equipmentLevelDTO.setBayNodeIds(ids);
                    break;
                case MAIN_DEVICE_NODE:
                    equipmentLevelDTO.setMainDeviceNodeIds(ids);
                    break;
                case COMPONENT_NODE:
                    equipmentLevelDTO.setComponentNodeIds(ids);
                    break;
                case POINT_NODE:
                    equipmentLevelDTO.setPointNodeIds(ids);
                    break;
                default:
                    break;
            }
            List<DevicePointBO> devicePointBOList = this.baseMapper.queryByEquipmentLevel(equipmentLevelDTO);
            list.addAll(devicePointBOList);
        });
        return list.parallelStream().distinct().collect(Collectors.toList());
    }

    /**
     * 根据保存任务的点位 tab 的查询条件获取所有已标定的点位集合
     *
     * @param dto 任务的点位 tab 的查询条件
     * @return 所有已标定的点位集合
     */
    @Override
    public List<DevicePointBO> queryPointListFromSaveTaskWithPointTab(SaveTaskWithPointTabDTO dto) {
        return this.baseMapper.queryPointListFromSaveTaskWithPointTab(dto).parallelStream().distinct().collect(Collectors.toList());
    }

    @Override
    public R<DeviceTreeVO> queryDeviceTree(Integer orderType, Long stationId) {
        FacInfo facInfo;
        if (Objects.isNull(stationId)) {
            facInfo = facInfoService.getDefaultOrFirst();
        } else {
            facInfo = facInfoService.getById(stationId);
        }
        if (Objects.isNull(facInfo)) {
            return R.ok();
        }
        stationId = facInfo.getId();
        // 构建厂站节点信息
        DeviceTreeVO facTreeVO = DeviceTreeVO.builder()
                .nodeId(stationId)
                .nodeLevel(DeviceTreeNodeLevelEnum.STATION_NODE.getLevel())
                .nodeName(facInfo.getStationName())
                .uniqueId(stationId + StrUtil.DASHED + DeviceTreeNodeLevelEnum.STATION_NODE.getLevel())
                .build();
        // 构建电压等级信息
        List<DeviceVoltage> deviceVoltageList = deviceVoltageService.listByCustomSort(stationId, orderType);
        if (CollUtil.isEmpty(deviceVoltageList)) {
            return R.ok(facTreeVO);
        }
        List<Long> voltIds = deviceVoltageList.stream().map(DeviceVoltage::getId).collect(Collectors.toList());
        // 根据电压获取到所有的间隔信息
        List<DeviceBay> deviceBayList = deviceBayService.listByCustomSort(voltIds, orderType);
        Map<Long, List<DeviceBay>> voltageId2DeviceBayMap = deviceBayList.stream()
                .collect(Collectors.groupingBy(DeviceBay::getVoltId));
        List<DeviceTreeVO> childrenList = deviceVoltageList.stream().map(deviceVoltage -> {
            // 构建间隔子节点信息
            List<DeviceBay> deviceBays = voltageId2DeviceBayMap.get(deviceVoltage.getId());
            List<DeviceTreeVO> bayChildrenList = null;
            if (CollUtil.isNotEmpty(deviceBays)) {
                bayChildrenList = deviceBays.stream().map(deviceBay -> DeviceTreeVO.builder()
                        .nodeId(deviceBay.getId())
                        .nodeLevel(DeviceTreeNodeLevelEnum.BAY_NODE.getLevel())
                        .nodeName(deviceBay.getBayName())
                        .uniqueId(deviceBay.getId() + StrUtil.DASHED + DeviceTreeNodeLevelEnum.BAY_NODE.getLevel())
                        .build()).collect(Collectors.toList());
                for (DeviceTreeVO deviceTreeVO : bayChildrenList) {
                    List<DeviceMain> deviceMainList = deviceMainService.list(new LambdaQueryWrapper<DeviceMain>()
                            .eq(DeviceMain::getBayId, deviceTreeVO.getNodeId())
                            .last("limit 1")
                    );
                    deviceTreeVO.setHasChildren(CollUtil.isNotEmpty(deviceMainList));
                }
            }
            return DeviceTreeVO.builder()
                    .nodeId(deviceVoltage.getId())
                    .nodeLevel(DeviceTreeNodeLevelEnum.VOLTAGE_NODE.getLevel())
                    .nodeName(deviceVoltage.getVoltName())
                    .uniqueId(deviceVoltage.getId() + StrUtil.DASHED + DeviceTreeNodeLevelEnum.VOLTAGE_NODE.getLevel())
                    .childrenList(bayChildrenList)
                    .hasChildren(CollUtil.isNotEmpty(deviceBays))
                    .build();
        }).collect(Collectors.toList());
        facTreeVO.setChildrenList(childrenList);
        facTreeVO.setHasChildren(CollUtil.isNotEmpty(childrenList));
        return R.ok(facTreeVO);
    }

    @Override
    public R<List<DeviceTreeVO>> queryByNodeIdAndLevel(Long nodeId, Integer level, Integer orderType) {
        if (Objects.isNull(nodeId) || Objects.isNull(level)) {
            log.error("[懒加载查询树节点]失败，参数错误，nodeId:{}, level:{}", nodeId, level);
            return R.ok();
        }
        DeviceTreeNodeLevelEnum deviceTreeNodeLevelEnum = DeviceTreeNodeLevelEnum.valueOf(level);
        if (Objects.isNull(deviceTreeNodeLevelEnum)) {
            log.error("[懒加载查询树节点]失败，节点层级错误，level:{}", level);
            return R.ok();
        }
        switch (deviceTreeNodeLevelEnum) {
            case STATION_NODE:
                List<DeviceVoltage> deviceVoltageList = deviceVoltageService.listByCustomSort(nodeId, orderType);
                List<DeviceTreeVO> voltageChildrenList = null;
                if (CollUtil.isNotEmpty(deviceVoltageList)) {
                    voltageChildrenList = deviceVoltageList.stream().map(deviceVoltage -> DeviceTreeVO.builder()
                            .nodeId(deviceVoltage.getId())
                            .nodeLevel(DeviceTreeNodeLevelEnum.VOLTAGE_NODE.getLevel())
                            .nodeName(deviceVoltage.getVoltName())
                            .uniqueId(deviceVoltage.getId() + StrUtil.DASHED + DeviceTreeNodeLevelEnum.VOLTAGE_NODE.getLevel())
                            .build()).collect(Collectors.toList());
                    for (DeviceTreeVO deviceTreeVO : voltageChildrenList) {
                        DeviceBay deviceBay = deviceBayService.getOne(Wrappers.<DeviceBay>lambdaQuery()
                                .eq(DeviceBay::getVoltId, deviceTreeVO.getNodeId())
                                .last("limit 1")
                        );
                        deviceTreeVO.setHasChildren(Objects.nonNull(deviceBay));
                    }
                }
                return R.ok(voltageChildrenList);
            case VOLTAGE_NODE:
                // 根据电压获取到所有的间隔信息
                List<DeviceBay> deviceBayList = deviceBayService.listByCustomSort(Collections.singletonList(nodeId), orderType);
                List<DeviceTreeVO> bayChildrenList = null;
                if (CollUtil.isNotEmpty(deviceBayList)) {
                    bayChildrenList = deviceBayList.stream().map(deviceBay -> DeviceTreeVO.builder()
                            .nodeId(deviceBay.getId())
                            .nodeLevel(DeviceTreeNodeLevelEnum.BAY_NODE.getLevel())
                            .nodeName(deviceBay.getBayName())
                            .uniqueId(deviceBay.getId() + StrUtil.DASHED + DeviceTreeNodeLevelEnum.BAY_NODE.getLevel())
                            .build()).collect(Collectors.toList());
                    for (DeviceTreeVO deviceTreeVO : bayChildrenList) {
                        DeviceMain deviceMain = deviceMainService.getOne(Wrappers.<DeviceMain>lambdaQuery()
                                .eq(DeviceMain::getBayId, deviceTreeVO.getNodeId())
                                .last("limit 1")
                        );
                        deviceTreeVO.setHasChildren(Objects.nonNull(deviceMain));
                    }
                }
                return R.ok(bayChildrenList);
            case BAY_NODE:
                // 主设备信息
                List<DeviceMain> deviceMainList = deviceMainService.listByCustomSort(nodeId, orderType);
                if (CollUtil.isEmpty(deviceMainList)) {
                    return R.ok();
                }
                List<DeviceComponent> deviceComponents = deviceComponentService.list(Wrappers.lambdaQuery(DeviceComponent.class).select(DeviceComponent::getId, DeviceComponent::getMainDeviceId).eq(DeviceComponent::getBayId, nodeId));
                List<DeviceTreeVO> deviceMainVOList = deviceMainList.stream()
                        .map(deviceMain -> DeviceTreeVO.builder()
                                .nodeId(deviceMain.getId())
                                .nodeLevel(DeviceTreeNodeLevelEnum.MAIN_DEVICE_NODE.getLevel())
                                .nodeName(deviceMain.getMainDeviceName())
                                .uniqueId(deviceMain.getId() + StrUtil.DASHED + DeviceTreeNodeLevelEnum.MAIN_DEVICE_NODE.getLevel())
                                .mainDeviceType(deviceMain.getMainDeviceType())
                                .phaseType(deviceMain.getPhaseType())
                                .parentNodeId(deviceMain.getBayId())
                                .parentNodeLevel(DeviceTreeNodeLevelEnum.MAIN_DEVICE_NODE.getLevel() - 1)
                                .build())
                        .collect(Collectors.toList());
                if (CollUtil.isNotEmpty(deviceComponents)) {
                    deviceMainVOList.forEach(d -> d.setHasChildren(deviceComponents.stream().anyMatch(c -> d.getNodeId().equals(c.getMainDeviceId()))));
                }
                return R.ok(deviceMainVOList);
            case MAIN_DEVICE_NODE:
                // 部件信息
                List<DeviceComponent> deviceComponentList = deviceComponentService.listByCustomSort(nodeId, orderType);
                if (CollUtil.isEmpty(deviceComponentList)) {
                    return R.ok();
                }
                List<DevicePoint> devicePoints = this.list(Wrappers.lambdaQuery(DevicePoint.class).select(DevicePoint::getId, DevicePoint::getComponentId).eq(DevicePoint::getMainDeviceId, nodeId));
                List<DeviceTreeVO> deviceComponentVOList = deviceComponentList.stream()
                        .map(deviceComponent -> DeviceTreeVO.builder()
                                .nodeId(deviceComponent.getId())
                                .nodeName(deviceComponent.getComponentName())
                                .nodeLevel(DeviceTreeNodeLevelEnum.COMPONENT_NODE.getLevel())
                                .uniqueId(deviceComponent.getId() + StrUtil.DASHED + DeviceTreeNodeLevelEnum.COMPONENT_NODE.getLevel())
                                .parentNodeId(deviceComponent.getMainDeviceId())
                                .parentNodeLevel(DeviceTreeNodeLevelEnum.COMPONENT_NODE.getLevel() - 1)
                                .build()).collect(Collectors.toList());
                if (CollUtil.isNotEmpty(devicePoints)) {
                    deviceComponentVOList.forEach(d -> d.setHasChildren(devicePoints.stream().anyMatch(p -> d.getNodeId().equals(p.getComponentId()))));
                }
                return R.ok(deviceComponentVOList);
            case COMPONENT_NODE:
                // 巡视点位信息
                List<DevicePoint> devicePointList = this.listByCustomSort(nodeId, orderType, null);
                return R.ok(buildDevicePointVOListWithComponent(devicePointList));
            default:
                break;
        }
        return R.ok();
    }

    private List<DeviceTreeVO> buildDevicePointVOListWithComponent(List<DevicePoint> devicePointList) {
        return devicePointList.stream()
                .map(devicePoint -> DeviceTreeVO.builder()
                        .nodeId(devicePoint.getId())
                        .nodeName(devicePoint.getPointName())
                        .uniqueId(devicePoint.getId() + StrUtil.DASHED + DeviceTreeNodeLevelEnum.POINT_NODE.getLevel())
                        .componentName(devicePoint.getComponentName())
                        .mainDeviceName(devicePoint.getMainDeviceName())
                        .nodeLevel(DeviceTreeNodeLevelEnum.POINT_NODE.getLevel())
                        .collectType(devicePoint.getSaveTypeList())
                        .threePhaseFlag(devicePoint.getThreePhaseFlag())
                        .demarcateState(devicePoint.getDemarcateState())
                        .stationId(devicePoint.getStationId())
                        .createTime(devicePoint.getCreateTime())
                        .parentNodeId(devicePoint.getComponentId())
                        .parentNodeLevel(DeviceTreeNodeLevelEnum.POINT_NODE.getLevel() - 1)
                        .build())
                .collect(Collectors.toList());
    }

    @Override
    public List<DevicePoint> listByCustomSort(Long componentId, Integer orderType, Integer demarcateState) {
        return this.baseMapper.listByCustomSort(componentId, orderType, demarcateState);
    }

    @Override
    public List<DevicePointBO> queryPointListByPointIds(List<Long> pointIds) {
        return this.baseMapper.queryPointListByPointIds(pointIds);
    }

    @Override
    public List<DevicePointBO> queryPointListByPointCodes(Set<String> pointCodes) {
        return this.baseMapper.queryPointListByPointCodes(pointCodes);
    }

    /**
     * 任务编辑-任务点位回显分页
     *
     * @param devicePointPageDTO dto
     * @return result
     */
    @Override
    public R<PageResponse<DevicePointVO>> editTaskPointPage(DevicePointPageDTO devicePointPageDTO) {

        // 标定点位查询
        devicePointPageDTO.setDemarcateState(DigitalConstant.ONE);
        Page<DevicePointVO> page = Page.of(devicePointPageDTO.getPageNum(), devicePointPageDTO.getPageSize());
        List<Integer> recognitionTypeList = devicePointPageDTO.getRecognitionTypeList();
        if (CollUtil.isNotEmpty(recognitionTypeList)) {
            String regxRecTypeStr = recognitionTypeList.stream()
                    .map(String::valueOf).collect(Collectors.joining(CommonConstants.LONG_STRING));
            devicePointPageDTO.setRecognitionTypeListStr(regxRecTypeStr);
        }

        IPage<DevicePointVO> pageVO = this.baseMapper.editTaskPointPage(page, devicePointPageDTO);
        List<DevicePointVO> devicePointList = pageVO.getRecords();

        devicePointList.forEach(devicePoint -> {

            // 处理识别类型
            String recTypeList = devicePoint.getRecognitionTypeList();
            List<String> recTypeSplitList = Arrays.asList(recTypeList.split(StrUtil.COMMA));
            List<String> recTypeDescList = recTypeSplitList.stream()
                    .map(rec -> RecTypeEnum.valueOf(Integer.valueOf(rec)).getDesc()).collect(Collectors.toList());
            devicePoint.setRecognitionTypeListDesc(String.join(CommonConstants.LONG_STRING, recTypeDescList));

            // 处理表计类型
            Integer meterType = devicePoint.getMeterType();
            MeterTypeEnum meterTypeEnum = MeterTypeEnum.valueOf(meterType);
            devicePoint.setMeterTypeDesc(Objects.nonNull(meterTypeEnum) ? meterTypeEnum.getDesc() : null);

            // 处理位置状态类型
            Integer positionStateType = devicePoint.getPositionStateType();
            PositionStateTypeEnum positionStateTypeEnum = PositionStateTypeEnum.getByType(positionStateType);
            devicePoint.setPositionStateTypeDesc(Objects.nonNull(positionStateTypeEnum) ? positionStateTypeEnum.getPositionType() : null);

            // 处理采集类型
            Integer saveTypeList = devicePoint.getSaveTypeList();
            CollectTypeEnum collectTypeEnum = CollectTypeEnum.getEnumByCode(saveTypeList);
            devicePoint.setSaveTypeListDesc(Objects.nonNull(collectTypeEnum) ? collectTypeEnum.getDesc() : null);

            // 处理辅助设施类型
            Integer appearanceType = devicePoint.getAppearanceType();
            AssistFacilityTypeEnum assistFacilityTypeEnum = AssistFacilityTypeEnum.valueOf(appearanceType);
            devicePoint.setAppearanceTypeDesc(Objects.nonNull(assistFacilityTypeEnum) ? assistFacilityTypeEnum.getDesc() : null);

            // 处理缺陷识别类型
            String defectRecType = devicePoint.getDefectRecType();
            if (StrUtil.isNotBlank(defectRecType)) {
                List<String> defectRecTypeList = Arrays.asList(defectRecType.split(StrUtil.COMMA));
                String defectRecTypeDesc = defectRecTypeList.stream()
                        .map(d -> {
                            DefectAppearanceRecTypeEnum defectAppearanceRecTypeEnum = DefectAppearanceRecTypeEnum.getEnumByType(d);
                            if (Objects.nonNull(defectAppearanceRecTypeEnum)) {
                                return defectAppearanceRecTypeEnum.getDesc();
                            } else {
                                return StringUtils.EMPTY;
                            }
                        })
                        .collect(Collectors.joining(StrUtil.COMMA));
                devicePoint.setDefectRecTypeDesc(defectRecTypeDesc);
            }
        });
        return R.ok(new PageResponse<>(pageVO.getCurrent(), pageVO.getSize(), devicePointList, pageVO.getTotal()));
    }

    @Override
    public DevicePointBO queryPointByPointCode(String pointCode) {
        List<DevicePointBO> devicePointBOList = this.baseMapper.queryPointByPointCode(pointCode);
        if (CollectionUtils.isEmpty(devicePointBOList)) {
            return null;
        }
        return devicePointBOList.getFirst();
    }

    @Override
    public List<DevicePointBO> queryPointByGroupId(String groupId) {
        return this.baseMapper.queryPointByGroupId(groupId);
    }

    @Override
    public List<Long> queryPointListFromTaskPatrolledPagePoint(TaskPatrolledPagePointDTO dto) {
        return this.baseMapper.queryPointListFromTaskPatrolledPagePoint(dto);
    }


    @Override
    public void distributePoint(Long facId, Long robotId) {
        FacInfo facInfo = facInfoService.getOne(new LambdaQueryWrapper<FacInfo>().eq(FacInfo::getId, facId));
        Robot robot = robotService.getById(robotId);
        if (Objects.isNull(robot)) {
            throw new RobotException("点表下发失败，机器人不存在 robotId:{}",robotId);
        }
        String robotCode = robot.getRobotCode();
        if (StrUtil.isBlank(robotCode)) {
            throw new RobotException("点表下发失败，机器人编码为空 robot:{}",JSONObject.toJSON(robot));
        }

        // 构建PointDistributeExcelBO
        List<DevicePoint> devicePointList = baseMapper.selectList(Wrappers.lambdaQuery(DevicePoint.class).eq(DevicePoint::getStationId, facId).eq(DevicePoint::getRobotId, robotId));
        List<PointDistributeExcelBO> pointExcelBOList = devicePointList.stream().map(devicePoint -> {
            PointDistributeExcelBO pointDistributeExcelBO = ChiebotBeanUtils.copyProperties(devicePoint, PointDistributeExcelBO.class);
            pointDistributeExcelBO.setDeviceId(devicePoint.getPointCode());
            pointDistributeExcelBO.setDeviceName(devicePoint.getPointName());
            pointDistributeExcelBO.setComponentId(devicePoint.getComponentCode());
            pointDistributeExcelBO.setBayId(devicePoint.getBayCode());
            pointDistributeExcelBO.setMainDeviceId(devicePoint.getMainDeviceCode());
            pointDistributeExcelBO.setDeviceType(Objects.nonNull(devicePoint.getMainDeviceType()) ? String.valueOf(devicePoint.getMainDeviceType()) : "");
            pointDistributeExcelBO.setMeterType(Objects.nonNull(devicePoint.getMeterType()) ? String.valueOf(devicePoint.getMeterType()) : "");
            pointDistributeExcelBO.setAppearanceType(Objects.nonNull(devicePoint.getAppearanceType()) ? String.valueOf(devicePoint.getAppearanceType()) : "");
            pointDistributeExcelBO.setSaveTypeList(Objects.nonNull(devicePoint.getSaveTypeList()) ? String.valueOf(devicePoint.getSaveTypeList()) : "");
            pointDistributeExcelBO.setPhase(Objects.nonNull(devicePoint.getPhaseType()) ? String.valueOf(devicePoint.getPhaseType()) : "");
            pointDistributeExcelBO.setCalibrationId(StringUtils.isNotBlank(devicePoint.getCalibrationId()) ? String.valueOf(devicePoint.getCalibrationId()) : "");
            pointDistributeExcelBO.setRecognitionTypeList("");
            return pointDistributeExcelBO;
        }).collect(Collectors.toList());

        // 删除历史的点位文件
        FileUtils.deleteFolder(new File(FilePathManagerUtil.getDockerPathByFtpPath("/csvPoint/")));
        log.info("【点表下发到机器人】删除成功历史的点位文件csvPoint");

        String filePath = EXCEL_PATH;
        File parentFile = new File(filePath);
        if (!parentFile.exists()) {
            parentFile.mkdirs();
        }

        String fileFullPath = filePath + facInfo.getStationName() + "_" + robot.getRobotName() + "_" + DateUtils.nowDateTime() + ".xlsx";
        File file = new File(fileFullPath);
        try {
            file.createNewFile();
        } catch (IOException e) {
            throw new RobotException(e, "点表下发创建父文件夹失败 文件路径:{}", fileFullPath);
        }

        try (ExcelWriter excelWriter = EasyExcel.write(file).build()) {
            WriteSheet writeSheet = EasyExcel.writerSheet("sheet1").head(PointDistributeExcelBO.class)
                    .registerWriteHandler(new LongestMatchColumnWidthStyleStrategy())
                    .build();
            excelWriter.write(pointExcelBOList, writeSheet);
            excelWriter.finish();
        } catch (Exception e) {
            throw new RobotException(e, "点表下发过程excel生成异常");
        }

        String csvPath = EXCEL_PATH;
        String csvFullPath = csvPath + facInfo.getStationName() + "_" + robot.getRobotName() + "_" + DateUtils.nowDateTime() + "_" + UUID.randomUUID() + ".csv";
        File csvFile = new File(csvPath);
        try {
            if (!csvFile.exists()) {
                csvFile.mkdirs();
            }
            csvFile = new File(csvFullPath);
            csvFile.createNewFile();
            ExcelUtils.getCSVByExcel(fileFullPath, csvFullPath);
        } catch (IOException e) {
            throw new RobotException(e, "点表下发生成csv格式文件失败");
        }

        RobotHost robotHost = robotHostService.getOne(null);
        RobotControlProto.PointTablesDeliveryRequest request = RobotControlProto.PointTablesDeliveryRequest.newBuilder()
                .setSendCode(robotHost.getDeviceCode())
                .setReceiveCode(robotCode)
                .setTime(DateUtil.format(new Date(), "yyyy-MM-dd HH:mm:ss"))
                .setFacId(facInfo.getStationCode())
                .setFilePath(FilePathManagerUtil.getFtpsRelativePath(csvFullPath))
                .build();
        GrpcResponse grpcResponse = grpcSendServiceImpl.send(MessageType.DISTRIBUTE_POINT_FILE, robotCode, request, FilePathManagerUtil.getFtpsRelativePath(csvFullPath), request.getTime());
        if (!grpcResponse.getSuccess()) {
            RobotControlProto.PointTablesDeliveryReply response = (RobotControlProto.PointTablesDeliveryReply) grpcResponse.getResponse();
            String message = Objects.nonNull(response) ? response.getMessage() : "";
            throw new RobotException("机器人返回错误,机器人编码:{},机器人响应message:{}", robotCode, message);
        }
    }

    /**
     * 从机器人同步标定数据 1全量同步  2同步未标定的
     *
     * @param syncType
     * @return
     */
    @Override
    public R<String> synCalibratePoint(String stationCode, String robotCode, Integer syncType) {
        FacInfo facInfo = facInfoService.getOne(new LambdaQueryWrapper<FacInfo>()
                .eq(FacInfo::getStationCode, stationCode));
        if (Objects.isNull(facInfo)) {
            throw new RobotException("厂站不存在, stationCode:{}", stationCode);
        }

        Set<String> isSyncNow = searchKeys(RedisConstants.SYNC_CALIBRATE_POINT_LIST + "*");
        if (CollectionUtils.isNotEmpty(isSyncNow)) {
            throw new RobotException("上次标定获取未结束，请等待或取消上次标定申请");
        }

        RobotHost robotHost = robotHostService.getOne(null);
        RobotControlProto.CaliDataSynchronizationRequest.Builder requestBuilder = RobotControlProto.CaliDataSynchronizationRequest.newBuilder()
                .setSendCode(robotHost.getDeviceCode())
                .setReceiveCode(robotCode)
                .setTime(DateUtil.format(new Date(), DatePattern.NORM_DATETIME_PATTERN))
                .setFacId(stationCode)
                .setOperateId(UUID.randomUUID().toString());

        // 1全量同步  2同步未标定的
        if (Objects.equals(2, syncType)) {
            Robot robotByRobotCode = robotService.getOne(new LambdaQueryWrapper<Robot>()
                    .eq(Robot::getRobotCode, robotCode));

            List<DevicePoint> devicePointList = devicePointService.list(new LambdaQueryWrapper<DevicePoint>()
                    .eq(DevicePoint::getStationCode, facInfo.getOutStationCode())
                    .eq(DevicePoint::getRobotId, robotByRobotCode.getId())
                    .eq(DevicePoint::getDemarcateState, DemarcateStateEnum.UNCALIBRATED.getType()));
            if (CollectionUtils.isEmpty(devicePointList)) {
                throw new RobotException("不存在未标定的点位，故无需同步, 机器人名称:{}", robotByRobotCode.getRobotName());
            }

            requestBuilder.addAllDeviceList(devicePointList.stream().map(DevicePoint::getPointCode)
                    .collect(Collectors.toList()));
        }

        RobotControlProto.CaliDataSynchronizationRequest request = requestBuilder.build();
        GrpcResponse grpcResponse = grpcSendServiceImpl.send(MessageType.CALIBRATION_POINT_REQUEST, robotCode, request, null, request.getTime());
        if (!grpcResponse.getSuccess()) {
            throw new RobotException("标定同步申请失败, 机器人编码:{}, 机器人响应:{}", robotCode, grpcResponse.getResponse());
        }
        RobotControlProto.CaliDataSynchronizationReply response = (RobotControlProto.CaliDataSynchronizationReply) grpcResponse.getResponse();
        if (!StrUtil.equals(robotCode, response.getSendCode())) {
            throw new RobotException("机器人对下编码不一致,机器人编码:{},机器人返回编码:{}", robotCode, response.getSendCode());
        }

        // 标定申请成功后，标定信息初始化缓存
        redisTemplate.opsForList().leftPush(RedisConstants.SYNC_CALIBRATE_POINT_LIST + request.getOperateId(), "");
        redisTemplate.opsForValue().set(RedisConstants.SYNC_CALIBRATE_TYPE, String.valueOf(syncType));

        // 标定同步业务可能超时或因一些其他原因导致结束不了，60分钟后自动结束
        ScheduledExecutorService scheduledExecutorService = Executors.newScheduledThreadPool(1);
        cancelCalibrationScheduledTask(facInfo.getStationCode(), robotCode, scheduledExecutorService, request.getOperateId());

        /**
         * 阻塞前端页面，直到 Redis 中指定的校准标志键不存在为止。
         * 该方法会持续检查 Redis 中是否存在特定的校准标志键，
         * 如果存在，则线程会进入休眠状态，每隔 5 秒检查一次，
         * 直到该键不存在，以此来实现前端页面的阻塞效果。
         * 进入一个 while 循环，只要 Redis 中存在指定的校准标志键，就会一直循环下去
         */
        log.info("标定获取操作 开始阻塞前端页面，操作 ID: {}", request.getOperateId());
        long startTime = System.currentTimeMillis();
        long maxWaitTime = 60 * 60 * 1000;
        while (redisTemplate.hasKey(RedisConstants.SYNC_CALIBRATE_POINT_LIST + request.getOperateId())) {
            try {
                if (System.currentTimeMillis() - startTime > maxWaitTime) {
                    log.error("\n\n============= 标定同步等待标定同步结束等待超时 最大超时时间:60分钟 强制进行标定取消动作， 操作ID:{}\n\n", request.getOperateId());
                    devicePointService.finishSyncPoint(facInfo.getStationCode(), robotCode);
                    break;
                }

                log.info("标定同步等待标定同步结束中... 最大等待60分钟, Redis中标定缓存还存在，间隔5秒轮询一次，同步操作ID: {}", request.getOperateId());
                Thread.sleep(5 * 1000);
            } catch (InterruptedException e) {
                log.error("线程休眠被中断，操作 ID: {}, 异常信息: {}", request.getOperateId(), ExceptionUtils.getStackTrace(e));
                throw new RuntimeException(e);
            }
        }

        scheduledExecutorService.shutdown();
        return R.ok(RedisConstants.SYNC_CALIBRATE_POINT_LIST + request.getOperateId());
    }

    @Override
    public boolean updatePointInfoByPointCode(DevicePointBO devicePointBO) {
        LambdaUpdateWrapper<DevicePoint> wrapper = Wrappers.lambdaUpdate(DevicePoint.class)
                .set(DevicePoint::getDemarcateState, devicePointBO.getDemarcateState())
                .set(DevicePoint::getOriginCalibrationPath, devicePointBO.getOriginCalibrationPath())
                .set(DevicePoint::getExtendCalibrationPath, devicePointBO.getExtendCalibrationPath())
                .set(DevicePoint::getVisibleCalibrationPath, devicePointBO.getVisibleCalibrationPath())
                .set(DevicePoint::getCalibrationId, devicePointBO.getCalibrationPointId())
                .eq(DevicePoint::getPointCode, devicePointBO.getPointCode());
        this.update(wrapper);
        return true;
    }

    @Override
    public List<DevicePoint> getPointByFacCode(String stationCode, Long robotId) {
        FacInfo facInfo = facInfoService.getOne(new LambdaQueryWrapper<FacInfo>()
                .eq(FacInfo::getStationCode, stationCode));
        return this.list(new LambdaQueryWrapper<DevicePoint>()
                .eq(DevicePoint::getStationCode, facInfo.getOutStationCode())
                .eq(DevicePoint::getRobotId, robotId));
    }

    @Override
    public R<String> insertFacNodeByJson(MultipartFile file, String operationId) {
        if (file.getSize() > 104857600) {
            // 文件大小超过限制的处理逻辑
            throw new RobotException("文件大小不得超过10Mb");
        }
        // 获取 JSON 文件内容
        List<Map> dataList = readJsonFile(file);
        if (dataList == null) throw new RobotException("文件解析失败");

        List<String> notExistRobot = new ArrayList<>();
        Map<String, String> robotFac = new HashMap<>();
        checkIsLegal(dataList);
        devicePointService.processFacility(dataList, notExistRobot, robotFac);
        WebSocketUtils.sendMessageByWsMonitor(WebSocketConstants.BasicAccountImportWebsocket.AUTOMATED_DEPLOYMENT,
                WebSocketConstants.BasicAccountImportWebsocket.IMPORT_JSON,
                JSONObject.toJSONString(operationId));
        if (!notExistRobot.isEmpty()) {
            throw new RobotException("机器人不存在请检查,{}", String.join(", ", notExistRobot));
        }
        //点表下发
        try {
            batchDistributePoint(dataList, operationId);
            Thread.sleep(5000);
            //从机器人本体获取标定数据
            batchSyncCalibratePoint(dataList, operationId);
            Thread.sleep(5000);
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        }

        //刷新任务缓存
        Set<String> taskKeys = stringRedisTemplate.keys(TaskCacheConstant.ROBOT_CACHE + "*");
        if (taskKeys != null) {
            stringRedisTemplate.delete(taskKeys);
        }
        //模型同步到图像系统
        modelSync(operationId);
        //后台标准任务创建
        quickTaskCreate(dataList, operationId);
        return R.ok();
    }

    /**
     * 导出所有标定文件
     *
     * @param stationId     场站ID
     * @param pictureNameType 1:点位名称 2:点位编码
     */
    @Override
    public void exportCalibrateFile(Long stationId, Long pictureNameType, HttpServletResponse response) {
        List<DevicePoint> demarcatedDevicePointList = devicePointService.list(new LambdaQueryWrapper<DevicePoint>()
                .eq(DevicePoint::getStationId, stationId)
                .eq(DevicePoint::getDemarcateState, 1));
        if (CollectionUtils.isEmpty(demarcatedDevicePointList)) {
            throw new RobotException("该厂站下没有需要导出的标定文件");
        }
        List<InputStream> streamList = new ArrayList<>();
        List<String> fileNameList = new ArrayList<>();
        for (DevicePoint devicePoint : demarcatedDevicePointList) {
            try {
                InputStream inputStream;
                inputStream = Files.newInputStream(new File(FilePathManagerUtil.getDockerPathByStaticPath(devicePoint.getOriginCalibrationPath())).toPath());
                streamList.add(inputStream);
                fileNameList.add(("1".equals(pictureNameType.toString())) ? devicePoint.getPointName() : devicePoint.getPointCode() + devicePoint.getOriginCalibrationPath().substring(devicePoint.getOriginCalibrationPath().lastIndexOf(".")));
            } catch (IOException e) {
                log.error("文件读取错误,文件路径{}", FilePathManagerUtil.getDockerPathByStaticPath(devicePoint.getOriginCalibrationPath()));
            }
        }
        ExcelUtils.responseZipFile("ExportCalibrateFile", fileNameList.toArray(new String[0]), streamList.toArray(new InputStream[0]), response);
    }


    /**
     * 标定同步业务可能超时或因一些其他原因导致结束不了，十分钟后主动结束
     */
    public void performScheduledTask(RobotControlProto.CaliDataSynchronizationRequest request, String stationCode, String robotCode) {
        //十分钟后无论是否结束，手动结束
        ScheduledExecutorService executor = Executors.newScheduledThreadPool(1);

        executor.schedule(() -> {
            try {
                redisTemplate.opsForList().remove(RedisConstants.SYNC_CALIBRATE_POINT_LIST + request.getOperateId(), 0, -1);
            } catch (Exception e) {
                log.error(ExceptionUtils.getStackTrace(e));
            } finally {
                executor.shutdown();
            }
        }, 10, TimeUnit.MINUTES);
    }


    private List<Map> readJsonFile(MultipartFile file) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(file.getInputStream()))) {
            StringBuilder stringBuffer = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                stringBuffer.append(line);
            }
            String json = stringBuffer.toString().replace(" ", "");
            return JSON.parseArray(json, Map.class);
        } catch (IOException e) {
            e.printStackTrace();
            return null;
        }
    }

    private void checkIsLegal(List<Map> dataList) {
        for (Map<String, Object> facMap : dataList) {
            String name = Objects.toString(facMap.get("fac_name"));
            String stationCode = Objects.toString(facMap.get("fac_id"));
            String robotCode = Objects.toString(facMap.get("robot_code"));
            String voltageName = Objects.toString(facMap.get("name"));
            if (StringUtils.isBlank(name)) {
                throw new RobotException("厂站名称不能为空!");
            }
            if (StringUtils.isBlank(stationCode)) {
                throw new RobotException("厂站编码不能为空!");
            }
            if (StringUtils.isBlank(robotCode)) {
                throw new RobotException("机器人编码不能为空!");
            }
            if (StringUtils.isBlank(voltageName)) {
                throw new RobotException("电压不能为空!");
            }
            List<Map> gapList = (List<Map>) facMap.get("children");
            if (CollUtil.isNotEmpty(gapList)) {
                gapList.forEach(bayMap -> {
                    String deviceBayName = Objects.toString(bayMap.get("name"));
                    if (StringUtils.isBlank(deviceBayName)) {
                        throw new RobotException("间隔名称不能为空!");
                    }
                    List<Map<String, Object>> roomList = (List<Map<String, Object>>) bayMap.get("children");
                    roomList.forEach(room -> {
                        String mainDeviceName = Objects.toString(room.get("name"));
                        if (StringUtils.isBlank(mainDeviceName)) {
                            throw new RobotException("主设备名称不能为空!");
                        }
                        List<Map<String, Object>> componentList = (List<Map<String, Object>>) room.get("children");
                        componentList.forEach(component -> {
                            String componentName = Objects.toString(component.get("name"));
                            if (StringUtils.isBlank(componentName)) {
                                throw new RobotException("部件名称不能为空!");
                            }
                            List<Map<String, Object>> pointList = (List<Map<String, Object>>) component.get("children");
                            pointList.forEach(point -> {
                                String assId = Objects.toString(point.get("ass_id"));
                                String pointName = Objects.toString(point.get("name"));
                                String ptType = Objects.toString(point.get("pt_type"));
                                String saveType = Objects.toString(point.get("impt_type"));
                                String cruiseId = Objects.toString(point.get("cruise_id"));
                                if (StringUtils.isAnyBlank(assId, pointName, ptType, cruiseId, saveType)) {
                                    throw new RobotException("点表参数有误请检查, point: {}", point);
                                }
                                if (Objects.isNull(CollectTypeEnum.getEnumByCode(Integer.parseInt(saveType)))) {
                                    throw new RobotException("采集类型不符合规范, 采集类型: {},点位名称:{}", saveType, pointName);
                                }
                                if (!RecTypeEnum.isLegalRecType(Integer.parseInt(saveType))) {
                                    throw new RobotException("识别类型不符合规范, 识别类型: {},点位名称:{}", ptType, pointName);
                                }
                            });
                        });
                    });
                });
            }

        }
    }


    @Override
    @Transactional(rollbackFor = Exception.class)
    public void processFacility(List<Map> dataList, List<String> notExistRobot, Map<String, String> robotFac) {
        List<String> repeatPointList = new ArrayList<>();
        for (Map facMap : dataList) {
            String name = Objects.toString(facMap.get("fac_name"));
            String stationCode = Objects.toString(facMap.get("fac_id"));
            String robotCode = Objects.toString(facMap.get("robot_code"));
            Robot robot = robotService.getOne(new LambdaQueryWrapper<Robot>().eq(Robot::getRobotCode, robotCode));
            if (robot == null) {
                notExistRobot.add(robotCode);
                return;
            }
            String voltageName = Objects.toString(facMap.get("name"));
            List<Map> gapList = (List<Map>) facMap.get("children");
            handleFacilityInfo(name, stationCode, voltageName);
            updateRobotFacilityMapping(robotCode, stationCode, robot, robotFac);
            handleDeviceVoltage(stationCode, voltageName, gapList, facMap, robot, repeatPointList);
        }
        if (CollectionUtils.isNotEmpty(repeatPointList)) {
            throw new RobotException("点位名称不能重复，重复点位:{}", String.join(StrUtil.COMMA, repeatPointList));
        }
        //绑定机器人和厂站
        bindRobotsToFacilities(robotFac);
    }

    /**
     * 取消标定获取操作
     * operate_id为空
     *
     * @param stationCode
     * @param robotCode
     */
    @Override
    public void finishSyncPoint(String stationCode, String robotCode) {
        RobotHost robotHost = robotHostService.getOne(null);
        RobotControlProto.CaliDataSynchronizationRequest request = RobotControlProto.CaliDataSynchronizationRequest.newBuilder()
                .setSendCode(robotHost.getDeviceCode())
                .setReceiveCode(robotCode)
                .setTime(DateUtil.format(new Date(), "yyyy-MM-dd HH:mm:ss"))
                .setFacId(stationCode)
                .build();
        grpcSendServiceImpl.send(MessageType.CALIBRATION_POINT_REQUEST, robotCode, request, null, request.getTime());

        // 删除相关redis
        redisTemplate.delete(RedisConstants.SYNC_CALIBRATE_TYPE);
        Set<String> keys = redisTemplate.keys(RedisConstants.SYNC_CALIBRATE_POINT_LIST + "*");
        if (CollectionUtils.isNotEmpty(keys)) {
            redisTemplate.delete(keys);
        }
    }

    @Override
    public DevicePointBO findMapCodeByCodeAndLevel(String nodeCode, Integer nodeLevel) {
        return this.baseMapper.queryMpCodeByCodeAndLevel(nodeCode, nodeLevel);
    }

    @Override
    public DevicePointBO findDeviceNameByIdAndLevel(String nodeCode, Integer nodeLevel) {
        return this.baseMapper.queryDeviceNameByIdAndLevel(nodeCode, nodeLevel);
    }

    @Override
    public List<DevicePointBO> findPointByIdAndLevel(Integer nodeLevel, List<Long> nodeIds) {
        return this.baseMapper.queryPointByIdAndLevel(nodeLevel, nodeIds);
    }

    @Override
    public List<DevicePointBO> findPointByCodeAndLevel(Integer nodeLevel, List<String> nodeCodes) {
        return this.baseMapper.queryPointByCodeAndLevel(nodeLevel, nodeCodes);
    }

    @Override
    public R<Boolean> batchEdit(BatchUpdateDevicePointDTO updateDevicePointDTO) {
        List<Long> devicePointIdList = updateDevicePointDTO.getDevicePointIdList();
        if (CollectionUtils.isEmpty(devicePointIdList)) {
            return R.failed(Boolean.FALSE, "编辑失败，点位信息为空");
        }

        List<DevicePoint> devicePointList = this.baseMapper.selectBatchIds(devicePointIdList);
        if (CollectionUtils.isEmpty(devicePointList)) {
            return R.failed(Boolean.FALSE, "编辑失败，点位信息不存在");
        }

        Integer updateType = updateDevicePointDTO.getUpdateType();
        for (DevicePoint devicePoint : devicePointList) {
            Long id = devicePoint.getId();

            // 三相更新处理
            if (Objects.equals(DigitalConstant.ONE, devicePoint.getThreePhaseFlag()) || StrUtil.isNotBlank(devicePoint.getThreePhaseAssociateId())) {
                if (!StrUtil.equals(devicePoint.getRecognitionTypeList(), updateDevicePointDTO.getRecognitionTypeList()) ||
                        !Objects.equals(devicePoint.getMeterType(), updateDevicePointDTO.getMeterType()) ||
                        !Objects.equals(devicePoint.getPositionStateType(), updateDevicePointDTO.getPositionStateType()) ||
                        !Objects.equals(devicePoint.getSaveTypeList(), updateDevicePointDTO.getSaveTypeList())) {
                    List<Long> threePhasePointIdList = baseMapper.selectList(Wrappers.lambdaQuery(DevicePoint.class)
                            .select(DevicePoint::getId).eq(DevicePoint::getThreePhaseFlag, DigitalConstant.ONE)
                            .eq(DevicePoint::getThreePhaseAssociateId, devicePoint.getThreePhaseAssociateId())
                            .ne(DevicePoint::getId, devicePoint.getId())).stream().map(DevicePoint::getId).collect(Collectors.toList());

                    if (CollUtil.isNotEmpty(threePhasePointIdList)) {
                        baseMapper.update(null, Wrappers.lambdaUpdate(DevicePoint.class).in(DevicePoint::getId, threePhasePointIdList)
                                .set(DevicePoint::getRecognitionTypeList, updateDevicePointDTO.getRecognitionTypeList())
                                .set(DevicePoint::getMeterType, updateDevicePointDTO.getMeterType())
                                .set(DevicePoint::getPositionStateType, updateDevicePointDTO.getPositionStateType())
                                .set(DevicePoint::getSaveTypeList, updateDevicePointDTO.getSaveTypeList()));
                    }
                }
            }

            String recognitionTypeList = updateDevicePointDTO.getRecognitionTypeList();
            Integer positionStateType = updateDevicePointDTO.getPositionStateType();
            Integer meterType = updateDevicePointDTO.getMeterType();
            Integer saveTypeList = updateDevicePointDTO.getSaveTypeList();
            String defectRecType = updateDevicePointDTO.getDefectRecType();
            Integer appearanceType = updateDevicePointDTO.getAppearanceType();
            Integer importantLevel = updateDevicePointDTO.getImportantLevel();

            // （点位批量编辑）参数校验
            R<Boolean> checkResult = checkBatchUpdateDevicePointParams(
                    updateType,
                    recognitionTypeList,
                    meterType,
                    positionStateType,
                    saveTypeList,
                    appearanceType,
                    defectRecType,
                    OPERATE_EDIT,
                    importantLevel,
                    updateDevicePointDTO
            );
            if (!checkResult.getData()) {
                return checkResult;
            }

            DevicePoint point = DevicePoint.builder()
                    .id(id)
                    .recognitionTypeList(recognitionTypeList)
                    .saveTypeList(saveTypeList)
                    .meterType(meterType)
                    .positionStateType(positionStateType)
                    .appearanceType(appearanceType)
                    .defectRecType(updateDevicePointDTO.getDefectRecType())
//                    .defectRecTypeOther(updateDevicePointDTO.getDefectRecTypeOther())
                    .defectJudgeType(updateDevicePointDTO.getDefectJudgeType())
//                    .presetJudgeType(updateDevicePointDTO.getPresetJudgeType())
                    .importantLevel(importantLevel)
                    .pointTagsCodeList(updateDevicePointDTO.getPointTagsCodeList())
                    .updateTime(LocalDateTime.now())
                    .updateBy(SecurityUtils.getUsername())
                    .build();
            this.baseMapper.updateById(point);

//            generateAnalyseConfig(devicePoint, ChiebotBeanUtils.copyProperties(updateDevicePointDTO, DevicePointDTO.class));
        }

        taskService.asyncRefreshCache();
        return R.ok(Boolean.TRUE, "编辑成功");
    }

    @Override
    public Page<DevicePoint> devicePointList(Long deviceMainId, Integer pageNum, Integer pageSize, String pointName) {
        Page<DevicePoint> page = Page.of(pageNum, pageSize);
        Page<DevicePoint> devicePointPage = devicePointService.page(page, new LambdaQueryWrapper<DevicePoint>()
                .eq(DevicePoint::getMainDeviceId, deviceMainId)
                .like(com.baomidou.mybatisplus.core.toolkit.StringUtils.isNotBlank(pointName), DevicePoint::getPointName, pointName));

        List<PointTags> pointTagsList = pointTagsService.list();
        List<DevicePoint> devicePointList = devicePointPage.getRecords();
        for (DevicePoint devicePoint : devicePointList) {
            devicePoint.getPointTagsCodeList();
            devicePoint.setPointTagsNameList(buildPointTagsNameList(devicePoint.getPointTagsCodeList(), pointTagsList));
        }

        return devicePointPage;
    }

    @Override
    public void batchBindThreePhasePoint(Collection<DevicePoint> devicePoints) {
        devicePoints = devicePoints.stream().filter(devicePoint -> Pattern.compile(".*[A-C]相.*").matcher(devicePoint.getPointName()).matches()).collect(Collectors.toList());
        if (CollUtil.isEmpty(devicePoints)) {
            return;
        }
        Set<String> phaseNames = new HashSet<>();
        devicePoints.forEach(devicePoint -> phaseNames.addAll(allPhaseName(devicePoint.getPointName())));
        List<DevicePoint> devicePointList = this.list(Wrappers.<DevicePoint>lambdaQuery()
                .in(DevicePoint::getPointName, phaseNames));
        if (CollUtil.isEmpty(devicePointList)) {
            return;
        }
        Set<String> threePhasePointNames = new HashSet<>();
        Map<String, DevicePoint> devicePointMap = devicePointList.stream().collect(Collectors.toMap(
                DevicePoint::getPointName,
                devicePoint -> devicePoint,
                (v1, v2) -> v1));
        Map<String, List<DevicePoint>> threePhasePointMap = new ConcurrentHashMap<>();
        for (String pointName : devicePointMap.keySet()) {
            List<String> pointNames = allPhaseName(pointName);
            if (!threePhasePointNames.containsAll(pointNames)) {
                threePhasePointNames.addAll(pointNames);
                List<DevicePoint> pointList = new ArrayList<>();
                for (String name : pointNames) {
                    DevicePoint devicePoint = devicePointMap.get(name);
                    if (Objects.isNull(devicePoint)) {
                        continue;
                    }
                    pointList.add(devicePoint);
                }
                threePhasePointMap.put(UUID.randomUUID().toString(), pointList);
            }
        }
        batchBindThreePhasePoint(threePhasePointMap);
    }

    private void batchBindThreePhasePoint(Map<String, List<DevicePoint>> threePhasePointMap) {
        List<DevicePoint> threePhasePointList = new ArrayList<>();
        for (String threePhaseAssociateId : threePhasePointMap.keySet()) {
            List<DevicePoint> devicePointList = threePhasePointMap.get(threePhaseAssociateId);
            if (DigitalConstant.THREE != devicePointList.size()) {
                log.warn("关联失败，需勾选三个点位信息 {}", devicePointList);
                continue;
            }
            long bayCount = 0;
            try {
                bayCount = devicePointList.stream().map(DevicePoint::getBayId).distinct().count();
            } catch (Exception e) {
                log.warn("关联失败，关联的三相点位有误 {}", devicePointList);
                continue;
            }
            if (1L != bayCount) {
                log.warn("关联失败，关联的三相点位需要在同一个间隔下 {}", devicePointList);
                continue;
            }
            // 获取主设备信息
            long mainDeviceTypeCount = devicePointList.stream().map(DevicePoint::getMainDeviceType).distinct().count();
            if (1L != mainDeviceTypeCount) {
                log.warn("关联失败，关联的三相点位需要相同的主设备类型 {}", devicePointList);
                continue;
            }
            List<Integer> phaseTypeList = devicePointList.stream().map(DevicePoint::getPhaseType).toList();
            boolean containsPhaseABC = phaseTypeList.contains(PhaseTypeEnum.PHASE_A.getType())
                    && phaseTypeList.contains(PhaseTypeEnum.PHASE_B.getType()) && phaseTypeList.contains(PhaseTypeEnum.PHASE_C.getType());
            if (!containsPhaseABC) {
                log.warn("关联失败，主设备相位类型需要包含A相、B相、C相 {}", devicePointList);
                continue;
            }
            sortedRecognitionTypeList(devicePointList);
            long recognitionTypeListCount = devicePointList.stream().map(DevicePoint::getRecognitionTypeList).distinct().count();
            if (1L != recognitionTypeListCount) {
                log.warn("关联失败，关联的点位需是相同的识别类型 {}", devicePointList);
                continue;
            }

            boolean threePhaseFlag = devicePointList.stream()
                    .anyMatch(devicePoint -> Objects.equals(CommonConstants.THREE_PHASE_FLAG, devicePoint.getThreePhaseFlag()));
            if (threePhaseFlag) {
                continue;
            }
            devicePointList.forEach(devicePoint -> {
                devicePoint.setThreePhaseFlag(CommonConstants.THREE_PHASE_FLAG);
                devicePoint.setThreePhaseAssociateId(threePhaseAssociateId);
            });
            threePhasePointList.addAll(devicePointList);
        }

        this.updateBatchById(threePhasePointList);

        // 判断选择的主设备是否是三相关联设备，若不是，则将主设备更新为三相关联设备
        Set<Long> mainDeviceIdList = threePhasePointList.stream().map(DevicePoint::getMainDeviceId).collect(Collectors.toSet());
        if (CollUtil.isEmpty(mainDeviceIdList)) {
            return;
        }
        List<DeviceMain> deviceMainList = deviceMainService.listByIds(mainDeviceIdList);
        boolean mainNotThreePhaseFlag = deviceMainList.stream()
                .noneMatch(deviceMain -> Objects.equals(CommonConstants.THREE_PHASE_FLAG, deviceMain.getThreePhaseFlag()));
        if (mainNotThreePhaseFlag) {
            // 需要将关联的主设备设置为三相设备
            deviceMainList.forEach(deviceMain -> {
                deviceMain.setThreePhaseFlag(CommonConstants.THREE_PHASE_FLAG);
                deviceMain.setThreePhaseAssociateId(UUID.randomUUID().toString());
            });
            deviceMainService.updateBatchById(deviceMainList);
        }
    }

    /**
     * （点位批量编辑）参数校验
     *
     * @param recognitionTypeList 识别类型集合
     * @param meterType           表计类型
     * @param positionStateType   位置状态类型
     * @param saveTypeList        采集类型
     * @param appearanceType      辅助设施类型
     * @param defectRecType       缺陷识别类型
     * @param operate             操作
     * @param importantLevel      重要等级
     * @return 校验结果
     */
    private R<Boolean> checkBatchUpdateDevicePointParams(Integer updateType, String recognitionTypeList, Integer meterType, Integer positionStateType, Integer saveTypeList,Integer appearanceType, String defectRecType, String operate, Integer importantLevel,BatchUpdateDevicePointDTO batchUpdateDevicePointDTO) {
        if (BatchUpdateDevicePointTypeEnum.REC_TYPE_UPDATE.getCode() == updateType) {
            List<String> recTypeList = new ArrayList<>(Arrays.asList(recognitionTypeList.split(StrUtil.COMMA)));

            // 表计读取的点位额外校验仪表类型合法
//            if (recTypeList.contains(RecTypeEnum.METER.getType().toString())
//                    && !MeterInstrumentEnum.isLegal(batchUpdateDevicePointDTO.getInstrumentType())) {
//                batchUpdateDevicePointDTO.setInstrumentType(MeterInstrumentEnum.METER.getType());
//            }

            boolean isIllegalRecType = recTypeList.stream()
                    .anyMatch(recType -> !RecTypeEnum.isLegalRecType(Integer.valueOf(recType)));
            if (isIllegalRecType) {
                return R.failed(Boolean.FALSE, operate + "失败，识别类型非法");
            }
            int recTypeSize = recTypeList.size();
            if (recTypeSize > DigitalConstant.TWO) {
                return R.failed(Boolean.FALSE, operate + "失败，表计读取和设备外观查看可同时选择、位置状态识别和设备外观查看可同时选择，其余不可同时选择");
            }
            boolean containsMeter = recTypeList.contains(String.valueOf(RecTypeEnum.METER.getType()));
            boolean containsPosition = recTypeList.contains(String.valueOf(RecTypeEnum.POSITION.getType()));
            boolean containsAppearance = recTypeList.contains(String.valueOf(RecTypeEnum.APPEARANCE.getType()));

            if (recTypeSize == DigitalConstant.TWO) {
                boolean isCorrectGroup = containsAppearance && (containsMeter || containsPosition);
                if (!isCorrectGroup) {
                    return R.failed(Boolean.FALSE, operate + "失败，表计读取和设备外观查看可同时选择、位置状态识别和设备外观查看可同时选择，其余不可同时选择");
                }
            }
            if (containsMeter && Objects.isNull(meterType)) {
                return R.failed(Boolean.FALSE, operate + "失败，识别类型包含表计读取，请选择表计类型");
            }

            if (containsPosition && Objects.isNull(positionStateType)) {
                return R.failed(Boolean.FALSE, operate + "失败，识别类型包含表计读取，请选择位置状态类型");
            }
            // 校验采集类型
            Boolean isLegalCollectType = CollectTypeEnum.isLegalCollectType(saveTypeList);
            if (!isLegalCollectType) {
                return R.failed(Boolean.FALSE, operate + "失败，采集类型非法");
            }

            //识别类型是实物ID时，采集类型只能为可见光
            if (recTypeList.contains(RecTypeEnum.ENTITY_ID.getType().toString())
                    && !saveTypeList.equals(CollectTypeEnum.PICTURE.getCode())) {
                return R.failed(Boolean.FALSE, operate + "失败，采集类型非法");
            }

            // 校验表计类型、位置状态类型，辅助设施类型，缺陷识别， 缺陷判别
            if (Objects.nonNull(meterType) && !MeterTypeEnum.isLegalMeterType(meterType)) {
                return R.failed(Boolean.FALSE, operate + "失败，表计类型非法");
            }
            if (Objects.nonNull(positionStateType)) {
                List<DevicePropertyVO> positionList = devicePropertyService.getPositionList();
                boolean isIllegalPositionType = positionList.stream().noneMatch(pos -> Objects.equals(pos.getType(), positionStateType));
                if (isIllegalPositionType) {
                    return R.failed(Boolean.FALSE, operate + "失败，位置状态类型非法");
                }
            }
            if (Objects.nonNull(appearanceType)) {
                if (!AssistFacilityTypeEnum.isLegalAssistFacilityType(appearanceType)) {
                    return R.failed(Boolean.FALSE, operate + "失败，辅助设施类型非法");
                }
            }
        } else if (BatchUpdateDevicePointTypeEnum.IMPORTANT_LEVEL_UPDATE.getCode() == updateType) {
            if (!ImportantLevelEnum.levelVerify(importantLevel)) {
                return R.failed(Boolean.FALSE, operate + "失败，重要等级不存在");
            }
        } else if (BatchUpdateDevicePointTypeEnum.DEFECT_REC_TYPE.getCode() == updateType) {
            if (StrUtil.isNotBlank(defectRecType)) {
//                Map<String, List<ValueDef>> analyseDefectMap = analyseDefectMap();
//                List<String> defectRecTypeList = new ArrayList<>(Arrays.asList(defectRecType.split(StrUtil.COMMA)));
//                boolean isIllegalDefectRecType = defectRecTypeList.stream().noneMatch(analyseDefectMap::containsKey);
//                if (isIllegalDefectRecType) {
//                    return R.failed(Boolean.FALSE, operate + "失败，缺陷识别类型不合法");
//                }
            }
        }
        return R.ok(Boolean.TRUE);
    }


    private void updateRobotFacilityMapping(String robotCode, String stationCode, Robot robot, Map<String, String> robotFac) {
        if (!robotFac.containsKey(robotCode)) {
            robotFac.put(robotCode, robot.getBelongFacId());
        }
        String belongFac = robotFac.get(robotCode);
        if (!belongFac.contains(stationCode)) {
            FacInfo facInfo = facInfoService.getOne(new LambdaQueryWrapper<FacInfo>()
                    .eq(FacInfo::getStationCode, stationCode));
            robotFac.put(robotCode, belongFac + "," + facInfo.getId());
        }
    }

    private void handleFacilityInfo(String name, String stationCode, String voltageName) {
        FacInfo facInfo = facInfoService.getOne(new LambdaQueryWrapper<FacInfo>().eq(FacInfo::getStationCode, stationCode));
        if (facInfo == null) {
            facInfoMapper.insertJsonFac(FacInfoDTO.builder()
                    .voltName(voltageName)
                    .stationName(name)
                    .stationCode(stationCode)
                    .facType("1")
                    .stationType("1")
                    .provinceName("110000")
                    .cityName("110100")
                    .areaName("110101")
                    .currentFac(1)
                    .build());
        } else {
            facInfoService.update(new LambdaUpdateWrapper<FacInfo>()
                    .eq(FacInfo::getStationCode, stationCode)
                    .set(FacInfo::getVoltName, voltageName)
                    .set(FacInfo::getStationName, name));
        }
    }

    private void handleDeviceVoltage(String stationCode, String voltageName, List<Map> gapList, Map<String, Object> facMap, Robot robot, List<String> repeatPointList) {
        FacInfo facInfo = facInfoService.getOne(new LambdaQueryWrapper<FacInfo>().eq(FacInfo::getStationCode, stationCode));
        DeviceVoltage deviceVoltage = deviceVoltageService.getOne(new LambdaQueryWrapper<DeviceVoltage>()
                .eq(DeviceVoltage::getVoltName, voltageName)
                .eq(DeviceVoltage::getStationId, facInfo.getId()));

        if (deviceVoltage == null) {
            deviceVoltageService.save(DeviceVoltage.builder()
                    .voltName(voltageName)
                    .voltCode(UUID.randomUUID().toString().replace("-", ""))
                    .stationId(facInfo.getId())
                    .stationName(facInfo.getStationName())
                    .stationCode(stationCode)
                    .build());
        }

        DeviceVoltage deviceVoltage1 = deviceVoltageService.getOne(new LambdaQueryWrapper<DeviceVoltage>()
                .eq(DeviceVoltage::getVoltName, voltageName)
                .eq(DeviceVoltage::getStationId, facInfo.getId()));

        if (CollUtil.isNotEmpty(gapList)) {
            gapList.forEach(bayMap -> handleDeviceBay(facInfo, deviceVoltage1, bayMap, robot, repeatPointList));
        }
    }

    private void handleDeviceBay(FacInfo facInfo, DeviceVoltage deviceVoltage1, Map<String, Object> bayMap, Robot robot, List<String> repeatPointList) {
        String deviceBayName = Objects.toString(bayMap.get("name"));
        DeviceBay deviceBay = deviceBayService.getOne(new LambdaQueryWrapper<DeviceBay>()
                .eq(DeviceBay::getBayName, deviceBayName)
                .eq(DeviceBay::getVoltId, deviceVoltage1.getId()));

        if (deviceBay == null) {
            deviceBayService.save(DeviceBay.builder()
                    .bayType("0")
                    .bayName(deviceBayName)
                    .bayCode(UUID.randomUUID().toString().replace("-", ""))
                    .alarmLevel(0)
                    .voltId(deviceVoltage1.getId())
                    .voltCode(deviceVoltage1.getVoltCode())
                    .stationId(facInfo.getId())
                    .stationName(facInfo.getStationName())
                    .stationCode(facInfo.getStationCode())
                    .build());
        }

        DeviceBay deviceBay1 = deviceBayService.getOne(new LambdaQueryWrapper<DeviceBay>()
                .eq(DeviceBay::getBayName, deviceBayName)
                .eq(DeviceBay::getVoltId, deviceVoltage1.getId()));

        List<Map<String, Object>> roomList = (List<Map<String, Object>>) bayMap.get("children");
        roomList.forEach(room -> handleDeviceMain(facInfo, deviceBay1, deviceVoltage1, room, robot, repeatPointList));
    }

    private void handleDeviceMain(FacInfo facInfo, DeviceBay deviceBay1, DeviceVoltage deviceVoltage1, Map<String, Object> room, Robot robot, List<String> repeatPointList) {
        String mainDeviceName = Objects.toString(room.get("name"));
        DeviceMain deviceMain = deviceMainService.getOne(new LambdaQueryWrapper<DeviceMain>()
                .eq(DeviceMain::getMainDeviceName, mainDeviceName)
                .eq(DeviceMain::getBayId, deviceBay1.getId()));

        if (deviceMain == null) {
            deviceMainService.save(DeviceMain.builder()
                    //默认为二次屏柜
                    .mainDeviceType(29)
                    .mainDeviceName(mainDeviceName)
                    .mainDeviceCode(UUID.randomUUID().toString().replace("-", ""))
                    .bayId(deviceBay1.getId())
                    .bayType("1")
                    .bayName(deviceBay1.getBayName())
                    .voltId(deviceVoltage1.getId())
                    .voltName(deviceVoltage1.getVoltName())
                    .voltCode(deviceVoltage1.getVoltCode())
                    .stationId(facInfo.getId())
                    .stationName(facInfo.getStationName())
                    .stationCode(facInfo.getStationCode())
                    .build());
        }

        DeviceMain deviceMain1 = deviceMainService.getOne(new LambdaQueryWrapper<DeviceMain>()
                .eq(DeviceMain::getMainDeviceName, mainDeviceName)
                .eq(DeviceMain::getBayId, deviceBay1.getId()));

        List<Map<String, Object>> componentList = (List<Map<String, Object>>) room.get("children");
        componentList.forEach(component -> handleDeviceComponent(facInfo, deviceBay1, deviceVoltage1, deviceMain1, component, robot, repeatPointList));
    }

    private void handleDeviceComponent(FacInfo facInfo, DeviceBay deviceBay1, DeviceVoltage deviceVoltage1, DeviceMain deviceMain1, Map<String, Object> component, Robot robot, List<String> repeatPointList) {
        String componentName = Objects.toString(component.get("name"));
        DeviceComponent deviceComponent = deviceComponentService.getOne(new LambdaQueryWrapper<DeviceComponent>()
                .eq(DeviceComponent::getComponentName, componentName)
                .eq(DeviceComponent::getMainDeviceId, deviceMain1.getId()));

        if (deviceComponent == null) {
            deviceComponentService.save(DeviceComponent.builder()
                    .componentName(componentName)
                    .componentType("1")
                    .componentCode(UUID.randomUUID().toString().replace("-", ""))
                    .alarmLevel(0)
                    .mainDeviceId(deviceMain1.getId())
                    .mainDeviceType(deviceMain1.getMainDeviceType())
                    .mainDeviceName(deviceMain1.getMainDeviceName())
                    .mainDeviceCode(deviceMain1.getMainDeviceCode())
                    .phaseType(0)
                    .bayId(deviceBay1.getId())
                    .bayType(deviceBay1.getBayType())
                    .bayName(deviceBay1.getBayName())
                    .bayCode(deviceBay1.getBayCode())
                    .voltId(deviceVoltage1.getId())
                    .voltCode(deviceVoltage1.getVoltCode())
                    .voltName(deviceVoltage1.getVoltName())
                    .stationId(facInfo.getId())
                    .stationCode(facInfo.getStationCode())
                    .stationName(facInfo.getStationName())
                    .build());
        }

        DeviceComponent deviceComponent1 = deviceComponentService.getOne(new LambdaQueryWrapper<DeviceComponent>()
                .eq(DeviceComponent::getComponentName, componentName)
                .eq(DeviceComponent::getMainDeviceId, deviceMain1.getId()));

        List<Map<String, Object>> pointList = (List<Map<String, Object>>) component.get("children");
        pointList.forEach(point -> handleDevicePoint(facInfo, deviceBay1, deviceVoltage1, deviceMain1, deviceComponent1, point, robot, repeatPointList));
    }

    private void handleDevicePoint(FacInfo facInfo, DeviceBay deviceBay1, DeviceVoltage deviceVoltage1, DeviceMain deviceMain1, DeviceComponent deviceComponent1, Map<String, Object> point, Robot robot, List<String> repeatPointList) {
        // 标定ID
        String assId = Objects.toString(point.get("ass_id"));
        // 点位名称
        String pointName = Objects.toString(point.get("name"));
        // 识别类型
        String ptType = Objects.toString(point.get("pt_type"));
        // 采集类型
        String saveType = Objects.toString(point.get("impt_type"));
        // 停靠点ID
        String stopId = Objects.toString(point.get("stop_id"));
        // 子类型 如表计类型或者位置状态类型
        String subPtType = Objects.toString(point.get("sub_pt_type"));
        // 巡检点ID，用于和图像系统交互
        String cruiseId = Objects.toString(point.get("cruise_id"));

        DevicePoint devicePoint = devicePointService.getOne(new LambdaQueryWrapper<DevicePoint>()
                .eq(DevicePoint::getCruiseId, cruiseId));

        if (devicePoint == null) {
            List<DevicePoint> exist = devicePointService.list(new LambdaQueryWrapper<DevicePoint>()
                    .eq(DevicePoint::getPointName, pointName));
            if (CollectionUtils.isNotEmpty(exist)) {
                repeatPointList.add(pointName);
                return;
            }
            devicePointService.save(buildDevicePoint(facInfo, deviceBay1, deviceVoltage1, deviceMain1, deviceComponent1, point, assId, pointName, ptType, saveType, subPtType, cruiseId, robot));
            saveCalibrationPointJson(assId, stopId);
        } else {
            //可能有脏数据，先查list
            List<DevicePoint> exist = devicePointService.list(new LambdaQueryWrapper<DevicePoint>()
                    .eq(DevicePoint::getPointName, pointName));
            if (CollectionUtils.isNotEmpty(exist) && !StringUtils.equals(exist.get(0).getCruiseId(), cruiseId)) {
                repeatPointList.add(pointName);
                return;
            }
            updateDevicePoint(facInfo, deviceBay1, deviceVoltage1, deviceMain1, deviceComponent1, devicePoint, pointName, ptType, assId, subPtType);
            saveCalibrationPointJson(assId, stopId);
        }
    }

    private DevicePoint buildDevicePoint(FacInfo facInfo, DeviceBay deviceBay1, DeviceVoltage deviceVoltage1, DeviceMain deviceMain1, DeviceComponent deviceComponent1, Map<String, Object> point, String assId, String pointName, String ptType, String saveType, String subPtType, String cruiseId, Robot robot) {
        DevicePoint.DevicePointBuilder builder = DevicePoint.builder()
                .pointName(pointName)
                .pointCode(UUID.randomUUID().toString().replace("-", ""))
                .recognitionTypeList(ptType)
                .alarmLevel(0)
                .saveTypeList(Integer.valueOf(saveType))
                .demarcateState(0)
                .appearanceType(1)
                .defectJudgeType(0)
                .importantLevel(1)
                .threePhaseFlag(0)
                .robotId(robot.getId())
                .robotName(robot.getRobotName())
                .cruiseId(cruiseId)
                .calibrationId(assId)
                .componentId(deviceComponent1.getId())
                .componentType(deviceComponent1.getComponentType())
                .componentCode(deviceComponent1.getComponentCode())
                .componentName(deviceComponent1.getComponentName())
                .mainDeviceId(deviceMain1.getId())
                .mainDeviceType(deviceMain1.getMainDeviceType())
                .mainDeviceName(deviceMain1.getMainDeviceName())
                .mainDeviceCode(deviceMain1.getMainDeviceCode())
                .phaseType(0)
                .bayId(deviceBay1.getId())
                .bayType(deviceBay1.getBayType())
                .bayName(deviceBay1.getBayName())
                .bayCode(deviceBay1.getBayCode())
                .voltId(deviceVoltage1.getId())
                .voltCode(deviceVoltage1.getVoltCode())
                .voltName(deviceVoltage1.getVoltName())
                .stationId(facInfo.getId())
                .stationCode(facInfo.getStationCode())
                .stationName(facInfo.getStationName())
                .createTime(LocalDateTime.now());

        if (RecTypeEnum.METER.getType().equals(Integer.valueOf(ptType))) {
            builder.meterType(StringUtils.isNotBlank(subPtType) && !StringUtils.equals("null", subPtType) ? Integer.valueOf(subPtType) : MeterTypeEnum.OILPOS.getType());
        }
        if (RecTypeEnum.POSITION.getType().equals(Integer.valueOf(ptType))) {
            builder.positionStateType(StringUtils.isNotBlank(subPtType) && !StringUtils.equals("null", subPtType) ? Integer.valueOf(subPtType) : PositionStateTypeEnum.CIRCUIT_BREAKER_STATUS.getType());
            builder.positionStateTypeDesc(StringUtils.isNotBlank(subPtType) && !StringUtils.equals("null", subPtType) ? PositionStateTypeEnum.getByType(Integer.valueOf(subPtType)).getPositionType() : PositionStateTypeEnum.CIRCUIT_BREAKER_STATUS.getPositionType());
        }
        if (RecTypeEnum.APPEARANCE.getType().equals(Integer.valueOf(ptType))) {
            builder.defectRecType(DefectAppearanceRecTypeEnum.getAllType());
        }

        return builder.build();
    }

    private void updateDevicePoint(FacInfo facInfo, DeviceBay deviceBay, DeviceVoltage deviceVoltage, DeviceMain deviceMain, DeviceComponent deviceComponent, DevicePoint devicePoint, String pointName, String ptType, String assId, String subPtType) {
        LambdaUpdateWrapper<DevicePoint> updateQuery = new LambdaUpdateWrapper<DevicePoint>()
                .eq(DevicePoint::getCruiseId, devicePoint.getCruiseId())
                .set(DevicePoint::getCalibrationId, assId)
                .set(DevicePoint::getPointName, pointName)
                .set(DevicePoint::getComponentId, deviceComponent.getId())
                .set(DevicePoint::getComponentType, deviceComponent.getComponentType())
                .set(DevicePoint::getComponentCode, deviceComponent.getComponentCode())
                .set(DevicePoint::getComponentName, deviceComponent.getComponentName())
                .set(DevicePoint::getMainDeviceId, deviceMain.getId())
                .set(DevicePoint::getMainDeviceType, deviceMain.getMainDeviceType())
                .set(DevicePoint::getMainDeviceCode, deviceMain.getMainDeviceCode())
                .set(DevicePoint::getMainDeviceName, deviceMain.getMainDeviceName())
                .set(DevicePoint::getBayId, deviceBay.getId())
                .set(DevicePoint::getBayType, deviceBay.getBayType())
                .set(DevicePoint::getBayCode, deviceBay.getBayCode())
                .set(DevicePoint::getBayName, deviceBay.getBayName())
                .set(DevicePoint::getVoltId, deviceVoltage.getId())
                .set(DevicePoint::getVoltCode, deviceVoltage.getVoltCode())
                .set(DevicePoint::getVoltName, deviceVoltage.getVoltName())
                .set(DevicePoint::getStationId, facInfo.getId())
                .set(DevicePoint::getStationCode, facInfo.getStationCode())
                .set(DevicePoint::getStationName, facInfo.getStationName())
                .set(DevicePoint::getRecognitionTypeList, ptType);

        if (RecTypeEnum.METER.getType().equals(Integer.valueOf(ptType))) {
            updateQuery.set(DevicePoint::getMeterType, StringUtils.isNotBlank(subPtType) && !StringUtils.equals("null", subPtType) ? Integer.valueOf(subPtType) : MeterTypeEnum.OILPOS.getType());
        }
        if (RecTypeEnum.POSITION.getType().equals(Integer.valueOf(ptType))) {
            updateQuery.set(DevicePoint::getPositionStateType, StringUtils.isNotBlank(subPtType) && !StringUtils.equals("null", subPtType) ? Integer.valueOf(subPtType) : PositionStateTypeEnum.CIRCUIT_BREAKER_STATUS.getType());
        }

        devicePointService.update(updateQuery);
    }

    /**
     * 保存标定与停靠关联表
     *
     * @param assId  标定ID
     * @param stopId 停靠点ID
     */
    private void saveCalibrationPointJson(String assId, String stopId) {
        CalibrationPointJson calibrationPointJson = calibrationPointJsonService.getOne(new LambdaQueryWrapper<CalibrationPointJson>()
                .eq(CalibrationPointJson::getCalibrateId, assId));
        if (calibrationPointJson == null) {
            calibrationPointJsonService.save(CalibrationPointJson.builder().calibrateId(assId).stopId(stopId).build());
        } else {
            calibrationPointJsonService.update(new LambdaUpdateWrapper<CalibrationPointJson>()
                    .eq(CalibrationPointJson::getCalibrateId, assId)
                    .set(CalibrationPointJson::getStopId, stopId));
        }
    }

    private void bindRobotsToFacilities(Map<String, String> robotFac) {
        robotFac.forEach((robotCode, belongFac) -> {
            robotService.update(new LambdaUpdateWrapper<Robot>()
                    .eq(Robot::getRobotCode, robotCode)
                    .set(Robot::getBelongFacId, belongFac));
        });
    }


    @Override
    public R<PageResponse<DeviceForAlarmPointVO>> pageForAlarm(DevicePointForAlarmPageDTO devicePointPageDTO) {
        List<Integer> pointStateList = devicePointPageDTO.getPointStateList();
        Integer normal = null;
        Integer abnormal = null;
        if (CollectionUtils.isNotEmpty(pointStateList) && pointStateList.size() != 2) {
            if (pointStateList.contains(1)) {
                normal = 1;
            }
            if (pointStateList.contains(2)) {
                abnormal = 2;
            }
        }

        Long pageNum = devicePointPageDTO.getPageNum();
        Long pageSize = devicePointPageDTO.getPageSize();
        Long offset = (pageNum - 1) * pageSize;

        List<DeviceForAlarmPointVO> rows = this.baseMapper.pageForAlarm(devicePointPageDTO, normal, abnormal, offset, pageSize);
        rows.forEach(x -> {
            Integer pointState = x.getPointState();
            if (pointState == null) {
                x.setPointState(1);
                x.setPointStateDesc("正常");
            } else if (Objects.equals(1, pointState)) {
                x.setPointStateDesc("正常");
            } else if (Objects.equals(pointState, 2)) {
                x.setPointStateDesc("异常");
            }

            if (StrUtil.isNotBlank(x.getImportantLevel())) {
                x.setImportantLevel(ImportantLevelEnum.descByLevel(Integer.parseInt(x.getImportantLevel())));
            }
        });
        Long total = this.baseMapper.pageForAlarmTotal(devicePointPageDTO, normal, abnormal);

        PageResponse<DeviceForAlarmPointVO> r = new PageResponse<>(devicePointPageDTO.getPageNum(), devicePointPageDTO.getPageSize(), rows, total);
        return R.ok(r);
    }

    @Override
    public R<Boolean> export(Long stationId, Integer exportPointType, HttpServletResponse response) {
        // 校验参数信息
        R<Boolean> checkResult = checkExportParams(stationId);
        if (!checkResult.getData()) {
            return checkResult;
        }

        String stationName = facInfoService.getById(stationId).getStationName();
        List<DevicePoint> devicePointList =  queryByStationId(stationId);

        FileUtils.deleteFolder(new File(FilePathManagerUtil.getDockerPathBySystemPath("/excel/")));

        // exportPointType 导出点位文件类型，1-标定点表 2-基础点表 3-导入点表
        if (Objects.equals(exportPointType, DigitalConstant.ONE)) {
            Map<Integer, String> positionStateTypeMap = devicePropertyService.getPositionList().stream().collect(Collectors.toMap(DevicePropertyVO::getType, DevicePropertyVO::getValue, (v1, v2) -> v2));
            List<PointCalibrationExcelBO> pointCalibrationExcelBOList = devicePointList.stream().map(devicePoint -> {
                List<String> recTypeList = new ArrayList<>();
                if (StrUtil.isNotBlank(devicePoint.getRecognitionTypeList())) {
                    recTypeList = Arrays.stream(devicePoint.getRecognitionTypeList().split(StrUtil.COMMA)).map(RecTypeEnum::getDescByTypeStr).filter(StrUtil::isNotBlank).collect(Collectors.toList());
                }
                return PointCalibrationExcelBO.builder()
                        .pointName(devicePoint.getPointName())
                        .componentName(devicePoint.getComponentName())
                        .mainDeviceName(devicePoint.getMainDeviceName())
                        .bayName(devicePoint.getBayName())
                        .voltName(devicePoint.getVoltName())
                        .isDemarcate(Objects.equals(devicePoint.getDemarcateState(), 1) ? "已标定" : "未标定")
                        .recType1(recTypeList.size() > 0 ? recTypeList.get(0) : null)
                        .recType2(recTypeList.size() > 1 ? recTypeList.get(1) : null)
                        .meterType(MeterTypeEnum.getDescByType(devicePoint.getMeterType()))
                        .positionStateType(positionStateTypeMap.get(devicePoint.getPositionStateType()))
                        .importantLevel(ImportantLevelEnum.getDescByLevel(devicePoint.getImportantLevel()))
                        .imgPathList(Lists.newArrayList(devicePoint.getOriginCalibrationPath()))
                        .build();
            }).collect(Collectors.toList());
            exportPointCalibrationFile(pointCalibrationExcelBOList, stationName, response);
        } else if (Objects.equals(exportPointType, DigitalConstant.TWO)) {
            List<DeviceInfoExcelBO> deviceInfoExcelList = buildDeviceInfoExcelList(devicePointList);
            export(deviceInfoExcelList, stationId, response);
        } else if (Objects.equals(exportPointType, DigitalConstant.THREE)) {
            String dockerPath = FilePathManagerUtil.getDockerPathBySystemPath(excelTemplateConfig.getLocalPointExcelTemplatePath());
            exportDataToExcel(dockerPath, stationName, devicePointList, response);
        }
        return R.ok();
    }

    @Override
    public ImportCalibrationVO importCalibrationImg(MultipartFile file, Long robotId, Long facId) {
        FacInfo facInfo = facInfoService.getById(facId);
        if (Objects.isNull(facInfo)) {
            throw new RobotException("厂站不存在");
        }
        String calibrationPath = ACCOUNT_IMAGE_CALIBRATION_FILE + facInfo.getStationName() + FileConstants.SEPARATOR;
        // 校验文件
        checkZipFile(file);
        // 临时文件存储目录
        File tempDir = new File(ACCOUNT_TEMP_FILE);
        if (!tempDir.exists()) {
            tempDir.mkdirs();
        }
        // 标定图片存储目录
        File calibrationDir = new File(calibrationPath);
        if (!calibrationDir.exists()) {
            calibrationDir.mkdirs();
        }
        // 返回错误路径
        String errorZipFilePath = calibrationPath + cn.hutool.core.lang.UUID.randomUUID(Boolean.TRUE) + StrUtil.DOT + ZIP_FILE_TYPE;
        String returnPath = FilePathManagerUtil.getStaticPathByDockerPath(errorZipFilePath);
        List<DevicePoint> devicePointList = this.list(Wrappers.lambdaQuery(DevicePoint.class).eq(DevicePoint::getStationId, facId).eq(DevicePoint::getRobotId, robotId));
        if (CollUtil.isEmpty(devicePointList)) {
            throw new RobotException("暂无点位");
        }
        List<String> pointNameStrList = devicePointList.stream().map(DevicePoint::getPointName).collect(Collectors.toList());
        if (CollUtil.isEmpty(pointNameStrList)) {
            throw new RobotException("暂无标定点");
        }
        List<String> errorPathList = new ArrayList<>();
        List<DevicePoint> imgCalibrationPointList = new ArrayList<>();
        handleImportFile(file, calibrationPath, calibrationDir, errorZipFilePath, errorPathList, imgCalibrationPointList, pointNameStrList);
        int successImg = imgCalibrationPointList.size();
        int failImg = errorPathList.size();
        int totalImg = successImg + failImg;
        ImportCalibrationVO returnVO = ImportCalibrationVO.builder().totalImg(totalImg).successImg(successImg).failImg(failImg).build();
        if (failImg == DigitalConstant.ZERO) {
            return returnVO;
        }
        returnVO.setReturnPath(returnPath);
        return returnVO;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public R<String> importUpdateDevicePointNameExcel(MultipartFile file, Long stationId) {
        if (Objects.isNull(stationId)) {
            return R.failed("导入失败，请选择厂站信息");
        }

        // 校验文件
        R<Boolean> fileCheckResult = checkFile(file);
        if (!fileCheckResult.getData()) {
            return R.failed(fileCheckResult.getMessage());
        }

        // 标题
        AtomicReference<List<String>> titleList = new AtomicReference<>();
        // 数据内容
        List<Map<String, Object>> excelMapList = new ArrayList<>();
        // 标题是否正确 false不正确 true正确
        AtomicBoolean isLegalTitle = new AtomicBoolean(false);

        // 读取excel数据
        File importFile = FileUtils.transferToFile(file);
        ExcelUtil.readBySax(importFile, DigitalConstant.ZERO, (sheetIndex, rowIndex, rowList) -> {
            List<String> tmpTitleList = titleList.get();
            if (rowIndex == DigitalConstant.ZERO) {

            } else if (rowIndex == DigitalConstant.ONE) {
                titleList.set(rowList.stream().map(Objects::toString).collect(Collectors.toList()));
                tmpTitleList = titleList.get();

                // Excel表头校验
                isLegalTitle.set(UpdateLocalPointExcelEnum.checkTitleColumn(tmpTitleList));

                if (isLegalTitle.get()) {
                    titleList.set(tmpTitleList);
                }
            } else if (!CollUtil.isEmpty(tmpTitleList)) {
                Map<String, Object> map = new HashMap<>();
                for (int idx = DigitalConstant.ZERO; idx < rowList.size() && rowList.size() == tmpTitleList.size(); idx++) {
                    String title = tmpTitleList.get(idx);
                    Object content = rowList.get(idx);
                    map.put(title, content);
                }
                excelMapList.add(map);
            }
        });

        List<String> titleColumnList = titleList.get();
        if (CollUtil.isEmpty(titleColumnList)) {
            return R.failed("上传的Excel文件模板错误，请下载正确模板");
        }
        // 校验Excel的表头
        if (!isLegalTitle.get()) {
            return R.failed("上传的Excel文件模板错误，校验Excel的表头不通过，请下载正确模板");
        }
        if (CollUtil.isEmpty(excelMapList)) {
            return R.failed("导入Excel数据为空");
        }

        // 用来记录错误信息的map缓存，key为x,y坐标，value为具体的错误信息
        Map<String, String> errorMessageMap = new HashMap<>(DigitalConstant.SIXTEEN);

        // 用于记录Excel中点位的数据
        List<UpdatePointExcelBO> udpatePointExcelList = new ArrayList<>();

        QueryWrapper<DevicePoint> devicePointQueryWrapper = new QueryWrapper<>();
        devicePointQueryWrapper.lambda().select(DevicePoint::getId, DevicePoint::getPointName);
        List<DevicePoint> devicePointList = devicePointService.list(devicePointQueryWrapper);

        // 校验表格中的数据
        checkUpdatePointExcelData(devicePointList, excelMapList, errorMessageMap, udpatePointExcelList);

        if (MapUtil.isNotEmpty(errorMessageMap)) {
            // 说明有错误信息，则进行批注操作
            return markExcelErrorInfo(file, errorMessageMap, 0);
        }

        // 更新数据
        for (UpdatePointExcelBO updatePointExcelBO : udpatePointExcelList) {
            devicePointService.update(Wrappers.lambdaUpdate(DevicePoint.class)
                    .set(DevicePoint::getPointName, updatePointExcelBO.getUpdatePointName())
                    .eq(DevicePoint::getPointName, updatePointExcelBO.getSystemPointName())
                    .eq(DevicePoint::getStationId, stationId));
        }

        taskService.asyncRefreshCache();
        return R.ok("导入成功");
    }

    @Override
    public void downLoadExcelTemplate(Integer fileType, HttpServletResponse response) {
        if (Objects.equals(LOCAL_POINT_EXCEL_TEMPLATE_TYPE, fileType)) {
            ResponseUtils.response(response, FilePathManagerUtil.getDockerPathBySystemPath(excelTemplateConfig.getLocalPointExcelTemplatePath()), "本地点位模板");
        } else if (Objects.equals(UPDATE_POINT_NAME_DEVICE_ACCOUNT_EXCEL_TEMPLATE_TYPE, fileType)) {
            ResponseUtils.response(response, FilePathManagerUtil.getDockerPathBySystemPath(excelTemplateConfig.getUpdatePointNameDeviceAccountExcelTemplatePath()), "更新点位台账模板");
        } else {
            log.error("[excel模板下载]，模板类型错误，fileType：{}", fileType);
        }
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public R<String> importDeviceExcel(MultipartFile file, Long stationId, Long robotId) {
        // 校验文件
        R<Boolean> fileCheckResult = checkFile(file);
        if (!fileCheckResult.getData()) {
            return R.failed(fileCheckResult.getMessage());
        }
        // 读取excel数据
        File importFile = FileUtils.transferToFile(file);
        AtomicReference<List<String>> titleList = new AtomicReference<>();
        List<Map<String, Object>> excelMapList = new ArrayList<>();
        AtomicBoolean isLegalTitle = new AtomicBoolean(false);
        ExcelUtil.readBySax(importFile, DigitalConstant.ZERO, (sheetIndex, rowIndex, rowList) -> {
            List<String> tmpTitleList = titleList.get();
            if (rowIndex == DigitalConstant.ONE) {
                titleList.set(rowList.stream().map(Objects::toString).collect(Collectors.toList()));
                tmpTitleList = titleList.get();
                // Excel表头校验
                isLegalTitle.set(!LocalPointExcelEnum.checkTitleColumn(tmpTitleList));
                if (isLegalTitle.get()) {
                    titleList.set(tmpTitleList);
                }
            } else if (!CollUtil.isEmpty(tmpTitleList)) {
                Map<String, Object> map = new HashMap<>();
                for (int idx = DigitalConstant.ZERO; idx < rowList.size(); idx++) {
                    String title = tmpTitleList.get(idx);
                    Object content = rowList.get(idx);
                    map.put(title, content);
                }
                excelMapList.add(map);
            }
        });
        List<String> titleColumnList = titleList.get();
        if (CollUtil.isEmpty(titleColumnList)) {
            return R.failed("上传的Excel文件模板错误，请下载正确模板");
        }
        // 校验Excel的表头
        if (isLegalTitle.get()) {
            return R.failed("上传的Excel文件模板错误，请下载正确模板");
        }

        if (CollUtil.isEmpty(excelMapList)) {
            return R.failed("导入Excel数据为空");
        }

        if (Objects.isNull(stationId)) {
            return R.failed("导入失败，请选择厂站信息");
        }
        FacInfo facInfo = facInfoService.getById(stationId);
        if (Objects.isNull(facInfo)) {
            return R.failed("导入失败，厂站信息不存在");
        }

        if (Objects.isNull(robotId)) {
            return R.failed("导入失败，请选择机器人信息");
        }
        Robot robot = robotService.getById(robotId);
        if (Objects.isNull(robot)) {
            return R.failed("导入失败，机器人信息不存在");
        }
        // 执行本地点位的导入逻辑
        return importLocalPointExcel(file, excelMapList, facInfo, robot);
    }

    @Override
    public boolean importDevicePointByXML(MultipartFile file, Long robotId) {
        try (InputStream is = file.getInputStream()) {
            DevicePointXmlBO devicePointXmlBO = XmlUtils.toBean(is, DevicePointXmlBO.class);

            if (Objects.isNull(devicePointXmlBO)) {
                throw new RobotException("xml解析为空");
            }
            List<DevicePointItemBO> devicePointItemBOS = devicePointXmlBO.getDevicePointItemBOS();
            Set<String> stationCodes = devicePointItemBOS.stream().map(DevicePointItemBO::getStationCode).collect(Collectors.toSet());
            int i = 1;
            for (String stationCode : stationCodes) {
                FacInfo facInfo = facInfoService.getOne(new LambdaQueryWrapper<FacInfo>()
                        .eq(FacInfo::getOutStationCode, stationCode));
                if (Objects.isNull(facInfo)) {
                    facInfoService.save(FacInfo.builder().stationName("xml导入厂站" + i).stationCode(stationCode).outStationCode(stationCode).voltName("220kV").facType("1").stationType("1").currentFac(1).createTime(LocalDateTime.now()).build());
                    i++;
                }
            }
            Map<String, List<DevicePointItemBO>> collect = devicePointItemBOS.stream().collect(Collectors.groupingBy(DevicePointItemBO::getStationCode));

            for (String stationCode : collect.keySet()) {
                if (checkXmlParam(collect.get(stationCode))) {
                    FacInfo facInfo = facInfoService.getOne(new LambdaQueryWrapper<FacInfo>()
                            .eq(FacInfo::getOutStationCode, stationCode));
                    saveLocalPointExcelData(facInfo, buildExcelImportParam(devicePointItemBOS, robotId));
                }
            }

        } catch (IOException e) {
            throw new RuntimeException(e);
        }

        taskService.asyncRefreshCache();
        return true;
    }

    @Override
    public List<DevicePoint> queryByStationId(Long stationId) {
        if (Objects.isNull(stationId)) {
            return Collections.emptyList();
        }
        return this.list(Wrappers.lambdaQuery(DevicePoint.class).eq(DevicePoint::getStationId, stationId));
    }

    @Override
    public void clearPointInfo(Long pointId) {
        if (Objects.isNull(pointId)) {
            return;
        }
        this.baseMapper.clearDevicePointInfo(pointId);
    }

    /**
     * 私有方法，处理本地点位导入
     *
     * @param file         Excel文件
     * @param excelMapList Excel内容数据
     * @param facInfo      厂站信息
     * @param robot        机器人信息
     */
    private R<String> importLocalPointExcel(MultipartFile file, List<Map<String, Object>> excelMapList, FacInfo facInfo, Robot robot) {
        // 用来记录错误信息的map缓存，key为x,y坐标，value为具体的错误信息
        Map<String, String> errorMessageMap = new HashMap<>(DigitalConstant.SIXTEEN);
        // 用于记录Excel中点位的数据
        List<PointExcelBO> tourPointExcelList = new ArrayList<>();
        // 校验表格中的数据
        checkPointExcelData(excelMapList, facInfo, errorMessageMap, tourPointExcelList, robot);
        if (MapUtil.isNotEmpty(errorMessageMap)) {
            // 说明有错误信息，则进行批注操作
            return markExcelErrorInfo(file, errorMessageMap, 0);
        }
        // 保存数据
        saveLocalPointExcelData(facInfo, tourPointExcelList);
        return R.ok("导入成功");
    }

    /**
     * 只校验xml中填的参数，其它参数给默认值
     *
     * @return 校验失败提示，如果有则代表校验不通过
     */
    private boolean checkXmlParam(List<DevicePointItemBO> devicePointItemBOS) {
        FacInfo facInfo = facInfoService.getOne(new LambdaQueryWrapper<FacInfo>()
                .eq(FacInfo::getOutStationCode, devicePointItemBOS.get(0).getStationCode()));
        DevicePointItemBO devicePointItemBO;
        // 查询电压等级用于校验
        List<DevicePropertyVO> voltageProperList = devicePropertyService.getVoltageList();
        // 查询电压区域用于校验
        List<DeviceVoltage> deviceVoltageList = deviceVoltageService.queryByStationId(facInfo.getId());
        // 查询间隔用于校验
        List<DeviceBay> deviceBayList = deviceBayService.queryByStationId(facInfo.getId());
        // 查询主设备用于校验
        List<DeviceMain> deviceMainList = deviceMainService.queryByStationId(facInfo.getId());
        // 查询部件用于校验
        List<DeviceComponent> deviceComponentList = deviceComponentService.queryByStationId(facInfo.getId());
        // 表格的点位编码用于唯一性校验
        List<String> pointCodes = new ArrayList<>();
        List<String> pointNames = new ArrayList<>();
        //名称唯一性校验，全路径名
        List<String> pointNamesAllPath = new ArrayList<>();
        // 表格的部件编码用于唯一性校验
        List<String> componentCodes = new ArrayList<>();
        List<String> componentNames = new ArrayList<>();
        List<String> componentNamesAllPath = new ArrayList<>();
        // 表格的主设备编码用于唯一性校验
        List<String> mainDeviceCodes = new ArrayList<>();
        List<String> mainDeviceNames = new ArrayList<>();
        List<String> mainDeviceNamesAllPath = new ArrayList<>();
        // 表格的间隔编码用于唯一性校验
        List<String> bayCodes = new ArrayList<>();
        List<String> bayNames = new ArrayList<>();
        List<String> bayNamesAllPath = new ArrayList<>();
        // 表格的电压区域编码用于唯一性校验
        List<String> voltageCodes = new ArrayList<>();
        List<String> voltageNames = new ArrayList<>();
        List<String> voltageNamesAllPath = new ArrayList<>();

        String facName = facInfo.getStationName();
        boolean legal = true;
        // 校验点位数据
        for (int i = 0; i < devicePointItemBOS.size(); i++) {
            devicePointItemBO = devicePointItemBOS.get(i);
            String pointName = devicePointItemBO.getDeviceName();
            String pointCode = devicePointItemBO.getDeviceId();
            String recType = devicePointItemBO.getRecognitionTypeList();
            String collectType = devicePointItemBO.getSaveTypeList();
            String appearanceType = devicePointItemBO.getAppearanceType();
            String phaseType = devicePointItemBO.getPhase();
            String meterType = devicePointItemBO.getMeterType();
            String componentName = devicePointItemBO.getComponentName();
            String componentCode = devicePointItemBO.getComponentId();
            String mainDeviceName = devicePointItemBO.getMainDeviceName();
            String mainDeviceCode = devicePointItemBO.getMainDeviceId();
            String bayName = devicePointItemBO.getBayName();
            String bayCode = devicePointItemBO.getBayId();
            String voltName = devicePointItemBO.getAreaName();
            String voltCode = devicePointItemBO.getAreaId();

            // 校验点位名称
            if (StrUtil.isBlank(pointName)) {
                log.error("点位名称必填,数据位置在第{}", i);
                legal = false;
            } else {
                Boolean pointNameCheckResult = RegxUtils.checkDeviceTreeNodeName(pointName);

                if (!pointNameCheckResult) {
                    log.error("点位名称：长度为2-50位的字符，可输入中文 大小写字母 数字 罗马数字 、. # _ - ( ) （ ），且不以_result结尾,数据位置在第{}", i);
                    legal = false;
                } else {
                    String pointNameAllPath = facName + voltName + bayName + mainDeviceName + componentName + pointName;
                    if (checkNameRepeat(pointNameAllPath, pointNamesAllPath)) {
                        log.error("同一部件下点位名称不能重复,数据位置在第{}", i);
                        legal = false;
                    } else {
                        pointNamesAllPath.add(pointNameAllPath);
                    }
                }
            }

            // 校验点位编码
            if (StrUtil.isNotBlank(pointCode)) {
                boolean checkCode = Pattern.compile(RegxUtils.CODE_REGEX_STR).matcher(pointCode).matches();
                if (!checkCode) {
                    log.error("只能输入1-64位数字、字母（大小写）、英文特殊字符（!、@、#、$、%、^、&、*、_、-）,数据位置在第{}", i);
                    legal = false;
                } else {
                    if (pointCodes.contains(pointCode)) {
                        log.error("点位编码已存在,点位编码:{}", pointCode);
                        legal = false;
                    }
                    pointCodes.add(pointCode);
                }
            }

            // 校验识别类型2
            List<String> recTypeList = new ArrayList<>();
            RecTypeEnum recTypeEnum2 = null;
            String recType1 = "";
            String recType2 = "";
            if (StringUtils.isBlank(recType)) {
                log.error("识别类型不能为空,数据位置在第{}", i);
                legal = false;
            } else {

                String[] split = recType.split(",");
                if (split.length == 1) {
                    recType1 = split[0];
                }
                if (split.length > 1) {
                    recType1 = split[0];
                    recType2 = split[1];
                }
                if (StrUtil.isNotBlank(recType2)) {
                    recTypeEnum2 = RecTypeEnum.getByDesc(recType2);
                    if (Objects.isNull(recTypeEnum2)) {
                        log.error("识别类型2，类型错误,数据位置在{}", i);
                        legal = false;
                    } else {
                        recTypeList.add(String.valueOf(recTypeEnum2.getType()));
                    }
                }

                if (StrUtil.isBlank(recType1)) {
                    log.error("识别类型1必填,数据位置在{}", i);
                } else {
                    RecTypeEnum recTypeEnum1 = RecTypeEnum.valueOf(Integer.parseInt(recType1));
                    if (Objects.isNull(recTypeEnum1)) {
                        log.error("识别类型1，类型错误,数据位置在{}", i);
                        legal = false;
                    } else {
                        recTypeList.add(String.valueOf(recTypeEnum1.getType()));
                        if (Objects.nonNull(recTypeEnum2)) {
                            // 判断识别类型1和识别类型2的组合是否合法
                            boolean isLegalGroup = (Objects.equals(RecTypeEnum.METER, recTypeEnum1) && Objects.equals(RecTypeEnum.APPEARANCE, recTypeEnum2))
                                    || (Objects.equals(RecTypeEnum.METER, recTypeEnum2) && Objects.equals(RecTypeEnum.APPEARANCE, recTypeEnum1))
                                    || (Objects.equals(RecTypeEnum.POSITION, recTypeEnum1) && Objects.equals(RecTypeEnum.APPEARANCE, recTypeEnum2))
                                    || (Objects.equals(RecTypeEnum.POSITION, recTypeEnum2) && Objects.equals(RecTypeEnum.APPEARANCE, recTypeEnum1))
                                    || Objects.equals(recTypeEnum1, recTypeEnum2);
                            if (!isLegalGroup) {
                                log.error("识别类型1和识别类型2选择的内容需满足多选限制：表计读取和设备外观查看可同时选择、位置状态识别和设备外观查看可同时选择，其余不可同时选择,数据位置在{}", i);
                                legal = false;
                            }
                        }
                    }
                }
                recTypeList = recTypeList.stream().distinct().collect(Collectors.toList());
            }


            if (StrUtil.isNotBlank(collectType)) {
                // 判断采集类型是否合法
                CollectTypeEnum collectTypeEnum = CollectTypeEnum.getByCode(Integer.parseInt(collectType));
                if (Objects.isNull(collectTypeEnum)) {
                    log.error("采集类型非法,数据位置在{}", i);
                    legal = false;
                } else {
                    if ((recTypeList.contains(RecTypeEnum.ENTITY_ID.getType().toString())
                            && collectTypeEnum != CollectTypeEnum.PICTURE) ||
                            (recTypeList.contains(RecTypeEnum.INFRARED_THERMOMETER.getType().toString())
                                    && collectTypeEnum != CollectTypeEnum.INFRARED) ||
                            (recTypeList.contains(RecTypeEnum.VOICE.getType().toString())
                                    && collectTypeEnum != CollectTypeEnum.AUDIO) ||
                            (recTypeList.contains(RecTypeEnum.FLASH_CHECK.getType().toString()))
                    ) {
                        log.error("识别类型与采集类型不匹配,数据位置在{}", i);
                        legal = false;
                    }
                }
            }

            // 校验电压区域
            if (StrUtil.isNotBlank(voltName)) {
                if (CollUtil.isEmpty(voltageProperList)) {
                    log.error("电压不存在,数据位置在{}", i);
                    legal = false;
                } else {
                    String voltNameAllPath = facName + voltName;
                    if (checkNameRepeat(voltNameAllPath, voltageNamesAllPath)) {
                        log.error("同一厂站下电压名称不能重复,数据位置在{}", i);
                        legal = false;
                    }
                }
            } else {
                log.error("电压等级必填,数据位置在{}", i);
                legal = false;
            }

            // 校验电压编码
            if (StrUtil.isNotBlank(voltCode)) {
                boolean checkCode = Pattern.compile(RegxUtils.CODE_REGEX_STR).matcher(voltCode).matches();
                if (!checkCode) {
                    log.error("电压编码只能输入1-64位数字、字母（大小写）、英文特殊字符（!、@、#、$、%、^、&、*、_、-）,数据位置在{}", i);
                    legal = false;
                } else {
                    List<String> voltageNameList = deviceVoltageList.stream().map(DeviceVoltage::getVoltName).collect(Collectors.toList());
                    List<String> voltageCodeList = deviceVoltageList.stream().map(DeviceVoltage::getVoltCode).collect(Collectors.toList());
                    int index = voltageNames.indexOf(voltName);
                    if ((index == -1 && voltageCodes.contains(voltCode)) || (index != -1 && !StrUtil.equals(voltageCodes.get(index), voltCode))) {
                        log.error("电压编码已存在,数据位置在{}", i);
                        legal = false;
                    } else {
                        if (!voltageNameList.contains(voltName)) {
                            if (voltageCodeList.contains(voltCode)) {
                                log.error("电压编码已存在,数据位置在{}", i);
                                legal = false;
                            }
                        }
                    }
                }
            } else {
                List<String> voltageCodeByNameList = deviceVoltageList.stream().filter(v -> StrUtil.equals(voltName, v.getVoltName())).map(DeviceVoltage::getVoltCode).collect(Collectors.toList());
                if (CollUtil.isNotEmpty(voltageCodeByNameList) && StrUtil.isNotBlank(voltageCodeByNameList.get(DigitalConstant.ZERO))) {
                    voltCode = voltageCodeByNameList.get(DigitalConstant.ZERO);
                } else {
                    voltCode = AutoGenerateUtils.numOrLowercaseStr(DigitalConstant.THIRTY_TWO);
                }
            }
            voltageCodes.add(voltCode);
            voltageNames.add(voltName);

            // 校验间隔名称
            if (StrUtil.isBlank(bayName)) {
                log.error("间隔名称必填,数据位置在{}", i);
                legal = false;
            } else {
                Boolean bayNameCheckResult = RegxUtils.checkDeviceTreeNodeName(bayName);
                if (!bayNameCheckResult) {
                    log.error("间隔名称：长度为2-50位的字符，可输入中文 大小写字母 数字 罗马数字 、. # _ - ( ) （ ），且不以_result结尾,数据位置在{}", i);
                    legal = false;
                } else {
                    String bayNameAllPath = facName + voltName + bayName;
                    if (checkNameRepeat(bayNameAllPath, bayNamesAllPath)) {
                        log.error("同一电压下间隔名称不能重复,数据位置在{}", i);
                        legal = false;
                    }
                }
            }


            // 校验间隔编码
            if (StrUtil.isNotBlank(bayCode)) {
                boolean checkCode = Pattern.compile(RegxUtils.CODE_REGEX_STR).matcher(bayCode).matches();
                if (!checkCode) {
                    log.error("只能输入1-64位数字、字母（大小写）、英文特殊字符（!、@、#、$、%、^、&、*、_、-）,数据位置在{}", i);
                    legal = false;
                } else {
                    List<String> bayNameList = deviceBayList.stream().filter(b -> StrUtil.equals(b.getVoltName(), voltName)).map(DeviceBay::getBayName).collect(Collectors.toList());
                    List<String> bayCodeList = deviceBayList.stream().map(DeviceBay::getBayCode).collect(Collectors.toList());
                    int index = bayNames.indexOf(bayName);
                    if ((index == -1 && bayCodes.contains(bayCode)) || (index != -1 && !StrUtil.equals(bayCodes.get(index), bayCode))) {
                        log.error("间隔编码已存在,数据位置在{}", i);
                        legal = false;
                    } else {
                        if (!bayNameList.contains(bayName)) {
                            if (bayCodeList.contains(bayCode)) {
                                log.error("间隔编码已存在,数据位置在{}", i);
                                legal = false;
                            }
                        }
                    }
                }
            } else {
                List<String> bayCodeByNameList = deviceBayList.stream().filter(b -> StrUtil.equals(b.getVoltName(), voltName) && StrUtil.equals(b.getBayName(), bayName)).map(DeviceBay::getBayCode).collect(Collectors.toList());
                if (CollUtil.isNotEmpty(bayCodeByNameList) && StrUtil.isNotBlank(bayCodeByNameList.get(DigitalConstant.ZERO))) {
                    bayCode = bayCodeByNameList.get(DigitalConstant.ZERO);
                } else {
                    bayCode = AutoGenerateUtils.numOrLowercaseStr(DigitalConstant.THIRTY_TWO);
                }
            }
            bayCodes.add(bayCode);
            bayNames.add(bayName);

            // 校验主设备名称
            if (StrUtil.isBlank(mainDeviceName)) {
                log.error("主设备名称必填,数据位置在{}", i);
                legal = false;
            } else {
                Boolean mainDeviceNameCheckResult = RegxUtils.checkDeviceTreeNodeName(mainDeviceName);
                if (!mainDeviceNameCheckResult) {
                    log.error("主设备名称：长度为2-50位的字符，可输入中文 大小写字母 数字 罗马数字 、. # _ - ( ) （ ），且不以_result结尾,数据位置在{}", i);
                    legal = false;
                } else {
                    String mainDeviceNameAllPath = facName + voltName + bayName + mainDeviceName;
                    if (checkNameRepeat(mainDeviceNameAllPath, mainDeviceNamesAllPath)) {
                        log.error("同一间隔下主设备名称不能重复,数据位置在{}", i);
                        legal = false;
                    }
                }
            }

            // 校验相位类型
            if (StrUtil.isBlank(phaseType)) {
                log.error("相位必填,数据位置在{}", i);
                legal = false;
            } else {
                PhaseTypeEnum phaseTypeEnum = PhaseTypeEnum.valueOf(Integer.parseInt(phaseType));
                if (Objects.isNull(phaseTypeEnum)) {
                    log.error("相位类型非法,数据位置在{}", i);
                    legal = false;
                }
            }


            // 校验主设备编码
            if (StrUtil.isNotBlank(mainDeviceCode)) {
                boolean checkCode = Pattern.compile(RegxUtils.CODE_REGEX_STR).matcher(mainDeviceCode).matches();
                if (!checkCode) {
                    log.error("只能输入1-64位数字、字母（大小写）、英文特殊字符（!、@、#、$、%、^、&、*、_、-）,数据位置在{}", i);
                    legal = false;
                }
//                else {
//                    List<String> mainDeviceNameList = deviceMainList.stream().filter(m -> StrUtil.equals(m.getVoltName(), voltName) &&
//                            StrUtil.equals(m.getBayName(), bayName)).map(DeviceMain::getMainDeviceName).collect(Collectors.toList());
//                    List<String> mainDeviceCodeList = deviceMainList.stream().map(DeviceMain::getMainDeviceCode).collect(Collectors.toList());
//                    int index = mainDeviceNames.indexOf(mainDeviceName);
//                    if ((index == -1 && mainDeviceCodes.contains(mainDeviceCode)) || (index != -1 && !StrUtil.equals(mainDeviceCodes.get(index), mainDeviceCode))) {
//                        log.error("主设备编码已存在,数据位置在{}", i);
//                        legal = false;
//                    } else {
//                        if (checkMysqlMainCodeRepeat(mainDeviceName, mainDeviceCode)) {
//                            log.error("数据库中主设备编码已存在,数据位置在{}", i);
//                            legal = false;
//                        }
//                        if (!mainDeviceNameList.contains(mainDeviceName)) {
//                            if (mainDeviceCodeList.contains(mainDeviceCode)) {
//                                log.error("主设备编码已存在,数据位置在{}", i);
//                                legal = false;
//                            }
//                        }
//                    }
//                }
            } else {
                List<String> mainDeviceCodeByNameList = deviceMainList.stream().filter(m -> StrUtil.equals(m.getVoltName(), voltName) &&
                        StrUtil.equals(m.getBayName(), bayName) && StrUtil.equals(m.getMainDeviceName(), mainDeviceName)).map(DeviceMain::getMainDeviceCode).collect(Collectors.toList());
                if (CollUtil.isNotEmpty(mainDeviceCodeByNameList) && StrUtil.isNotBlank(mainDeviceCodeByNameList.get(DigitalConstant.ZERO))) {
                    mainDeviceCode = mainDeviceCodeByNameList.get(DigitalConstant.ZERO);
                } else {
                    mainDeviceCode = AutoGenerateUtils.numOrLowercaseStr(DigitalConstant.THIRTY_TWO);
                }
            }
            mainDeviceCodes.add(mainDeviceCode);
            mainDeviceNames.add(mainDeviceName);

            // 校验部件名称
            if (StrUtil.isBlank(componentName)) {
                log.error("部件名称必填,数据位置在{}", i);
                legal = false;
            } else {
                Boolean componentNameCheckResult = RegxUtils.checkDeviceTreeNodeName(componentName);
                if (!componentNameCheckResult) {
                    log.error("部件名称：长度为2-50位的字符，可输入中文 大小写字母 数字 罗马数字 、. # _ - ( ) （ ），且不以_result结尾,数据位置在{}", i);
                    legal = false;
                } else {
                    String componentNameAllPath = facName + voltName + bayName + mainDeviceName + componentName;
                    if (checkNameRepeat(componentNameAllPath, componentNamesAllPath)) {
                        log.error("同一主设备下部件名称不能重复,数据位置在{}", i);
                        legal = false;
                    }
                }
            }

            // 校验部件编码
            if (StrUtil.isNotBlank(componentCode)) {
                boolean checkCode = Pattern.compile(RegxUtils.CODE_REGEX_STR).matcher(componentCode).matches();
                if (!checkCode) {
                    log.error("只能输入1-64位数字、字母（大小写）、英文特殊字符（!、@、#、$、%、^、&、*、_、-）,数据位置在{}", i);
                    legal = false;
                } else {
                    List<String> componentNameList = deviceComponentList.stream().filter(c -> StrUtil.equals(c.getVoltName(), voltName) &&
                            StrUtil.equals(c.getBayName(), bayName) && StrUtil.equals(c.getMainDeviceName(), mainDeviceName)).map(DeviceComponent::getComponentName).collect(Collectors.toList());
                    List<String> componentCodeList = deviceComponentList.stream().map(DeviceComponent::getComponentCode).collect(Collectors.toList());
                    int index = componentNames.indexOf(componentName);
                    if ((index == -1 && componentCodes.contains(componentCode)) || (index != -1 && !StrUtil.equals(componentCodes.get(index), componentCode))) {
                        log.error("部件编码已存在,数据位置在{}", i);
                        legal = false;
                    } else {
                        if (!componentNameList.contains(componentName)) {
                            if (componentCodeList.contains(componentCode)) {
                                log.error("部件编码已存在,数据位置在{}", i);
                                legal = false;
                            }
                        }
                    }
                }
            } else {
                List<String> componentCodeByNameList = deviceComponentList.stream().filter(c -> StrUtil.equals(c.getVoltName(), voltName) &&
                        StrUtil.equals(c.getBayName(), bayName) && StrUtil.equals(c.getMainDeviceName(), mainDeviceName) &&
                        StrUtil.equals(c.getComponentName(), componentName)).map(DeviceComponent::getComponentCode).collect(Collectors.toList());
                if (CollUtil.isNotEmpty(componentCodeByNameList) && StrUtil.isNotBlank(componentCodeByNameList.get(DigitalConstant.ZERO))) {
                    componentCode = componentCodeByNameList.get(DigitalConstant.ZERO);
                } else {
                    componentCode = AutoGenerateUtils.numOrLowercaseStr(DigitalConstant.THIRTY_TWO);
                }
            }
            componentCodes.add(componentCode);
            componentNames.add(componentName);

            // 校验表计类型
            if (recTypeList.contains(String.valueOf(RecTypeEnum.METER.getType()))) {
                if (StrUtil.isBlank(meterType)) {
                    log.error("识别类型包含表计类型，需要选择表计类型");
                    legal = false;
                } else {
                    MeterTypeEnum meterTypeEnum = MeterTypeEnum.valueOf(Integer.parseInt(meterType));
                    if (Objects.isNull(meterTypeEnum)) {
                        log.error("表计类型非法,数据位置在{}", i);
                        legal = false;
                    }
                }
            }

        }
        return legal;
    }

    private List<PointExcelBO> buildExcelImportParam(List<DevicePointItemBO> devicePointItemBOS, Long robotId) {
        Robot byId = robotService.getById(robotId);
        String robotName;
        if (Objects.nonNull(byId)) {
            robotName = byId.getRobotName();
        } else {
            robotName = "";
        }
        return devicePointItemBOS.stream().map(devicePointItemBO -> {
            String recognitionTypeList = devicePointItemBO.getRecognitionTypeList();
            int recType1 = 1;
            if (StringUtils.isBlank(recognitionTypeList)) {
                //识别类型默认为1
                recognitionTypeList = "1";
            } else {
                String[] split = recognitionTypeList.split(",");
                if (split.length == 1) {
                    recType1 = Integer.parseInt(split[0]);
                }
            }
            PointExcelBO.PointExcelBOBuilder pointExcelBOBuilder = PointExcelBO.builder()
                    .voltName(devicePointItemBO.getAreaName())
                    .voltCode(devicePointItemBO.getAreaId())
                    .bayName(devicePointItemBO.getBayName())
                    .bayCode(devicePointItemBO.getBayId())
                    .bayType("0")
                    .mainDeviceName(devicePointItemBO.getMainDeviceName())
                    .mainDeviceCode(devicePointItemBO.getMainDeviceId())
                    .mainDeviceType(1)
                    .componentName(devicePointItemBO.getComponentName())
                    .componentCode(devicePointItemBO.getComponentId())
                    .componentType("1")
                    .pointName(devicePointItemBO.getDeviceName())
                    .pointCode(devicePointItemBO.getDeviceId())
                    .meterType(Integer.parseInt(devicePointItemBO.getMeterType()))
                    .assistFacility(Integer.parseInt(devicePointItemBO.getAppearanceType()))
                    .collectType(Integer.parseInt(devicePointItemBO.getSaveTypeList()))
                    .recType1(recType1)
                    .phaseType(Integer.parseInt(devicePointItemBO.getPhase()))
                    .deviceInfo(devicePointItemBO.getDeviceInfo())
                    .importantLevel(1)
                    .robotId(robotId)
                    .robotName(robotName);
            MainDeviceTypeEnum mainDeviceTypeEnum = MainDeviceTypeEnum.valueOf(Integer.parseInt(devicePointItemBO.getDeviceType()));
            if (Objects.nonNull(mainDeviceTypeEnum)) {
                pointExcelBOBuilder.mainDeviceType(mainDeviceTypeEnum.getType());
            } else {
                pointExcelBOBuilder.mainDeviceType(1);
            }
            FacInfo facInfo = facInfoService.getOne(new LambdaQueryWrapper<FacInfo>()
                    .orderByAsc(FacInfo::getId)
                    .last("limit 1"));
            if (Objects.nonNull(facInfo)) {
                List<Robot> robotList = robotService.list();
                if (CollUtil.isNotEmpty(robotList)) {
                    List<Robot> collect = robotList.stream().filter(robot -> robot.getBelongFacId().contains(facInfo.getId().toString())).collect(Collectors.toList());
                    if (CollUtil.isNotEmpty(collect)) {
                        Robot robot = collect.get(0);
                        pointExcelBOBuilder.robotId(robot.getId());
                        pointExcelBOBuilder.robotName(robot.getRobotName());
                    }
                }

            }

            return pointExcelBOBuilder
                    .build();
        }).collect(Collectors.toList());
    }

    public static void main(String[] args) {

    }

    /**
     * 保存本地导入的Excel数据
     *
     * @param facInfo             厂站信息
     * @param localPointExcelList 本地导入的Excel数据
     */
    private void saveLocalPointExcelData(FacInfo facInfo, List<PointExcelBO> localPointExcelList) {
        // 获取该厂站下的节点信息数据
        Long stationId = facInfo.getId();
        // 电压信息
        List<DeviceVoltage> deviceVoltageList = deviceVoltageService.queryByStationId(stationId);
        // 间隔名称和间隔的对应关系（后续新增间隔，继续将新的间隔维护到此map中）
        Map<String, DeviceVoltage> voltUniquenessName2VoltageMap = deviceVoltageList.stream()
                .collect(Collectors.toMap(DeviceVoltage::getVoltName, deviceVoltage -> deviceVoltage, (v1, v2) -> v2));

        // 间隔信息
        List<DeviceBay> deviceBayList = deviceBayService.queryByStationId(stationId);
        Map<String, DeviceBay> bayUniquenessName2BayMap = deviceBayList.stream()
                .collect(Collectors.toMap(bay -> bay.getVoltName() + StrUtil.UNDERLINE + bay.getBayName(), bay -> bay, (v1, v2) -> v2));

        // 主设备信息
        List<DeviceMain> deviceMainList = deviceMainService.queryByStationId(stationId);
        Map<String, DeviceMain> mainUniquenessName2MainMap = deviceMainList.stream()
                .collect(Collectors.toMap(main -> main.getVoltName() + StrUtil.UNDERLINE + main.getBayName() + StrUtil.UNDERLINE + main.getMainDeviceName(),
                        main -> main, (v1, v2) -> v2));

        // 部件信息
        List<DeviceComponent> deviceComponentList = deviceComponentService.queryByStationId(stationId);
        Map<String, DeviceComponent> componentUniquenessName2ComponentMap = deviceComponentList.stream()
                .collect(Collectors.toMap(component -> component.getVoltName() + StrUtil.UNDERLINE + component.getBayName()
                                + StrUtil.UNDERLINE + component.getMainDeviceName() + StrUtil.UNDERLINE + component.getComponentName(),
                        component -> component, (v1, v2) -> v2));

        // 本地巡检点信息
        List<DevicePoint> devicePointList = this.queryByStationId(stationId);
        Map<String, DevicePoint> pointUniquenessName2PointMap = devicePointList.stream()
                .collect(Collectors.toMap(point -> point.getVoltName() + StrUtil.UNDERLINE + point.getBayName()
                                + StrUtil.UNDERLINE + point.getMainDeviceName() + StrUtil.UNDERLINE + point.getComponentName() + StrUtil.UNDERLINE + point.getPointName(),
                        point -> point, (v1, v2) -> v2));

        for (PointExcelBO pointExcelBO : localPointExcelList) {
            // 处理电压
            DeviceVoltage deviceVoltage = voltUniquenessName2VoltageMap.get(pointExcelBO.getVoltName());
            if (Objects.isNull(deviceVoltage)) {
                deviceVoltage = insertOrUpdateVoltage(voltUniquenessName2VoltageMap, facInfo, pointExcelBO.getVoltName(), pointExcelBO.getVoltCode());
            }
            // 处理间隔
            DeviceBay deviceBay = bayUniquenessName2BayMap.get(deviceVoltage.getVoltName() + StrUtil.UNDERLINE + pointExcelBO.getBayName());
            if (Objects.isNull(deviceBay)) {
                deviceBay = insertOrUpdateBay(bayUniquenessName2BayMap, deviceVoltage, pointExcelBO.getBayName(), pointExcelBO.getBayType(), pointExcelBO.getBayCode());
            }
            // 处理主设备信息
            String mainUniquenessName = deviceBay.getVoltName() + StrUtil.UNDERLINE + deviceBay.getBayName() + StrUtil.UNDERLINE + pointExcelBO.getMainDeviceName();
            DeviceMain deviceMain = mainUniquenessName2MainMap.get(mainUniquenessName);
            if (Objects.isNull(deviceMain)) {
                deviceMain = insertOrUpdateMain(mainUniquenessName2MainMap, deviceBay, pointExcelBO.getMainDeviceName(), pointExcelBO.getMainDeviceType(), pointExcelBO.getPhaseType(), pointExcelBO.getMainDeviceCode());
            }
            // 处理部件信息
            String comUniquenessName = deviceMain.getVoltName() + StrUtil.UNDERLINE + deviceMain.getBayName() + StrUtil.UNDERLINE + deviceMain.getMainDeviceName() + StrUtil.UNDERLINE + pointExcelBO.getComponentName();
            DeviceComponent deviceComponent = componentUniquenessName2ComponentMap.get(comUniquenessName);
            if (Objects.isNull(deviceComponent)) {
                deviceComponent = insertOrUpdateComponent(componentUniquenessName2ComponentMap, deviceMain, pointExcelBO.getComponentName(), pointExcelBO.getComponentType(), pointExcelBO.getComponentCode());
            }
            // 处理巡检点信息
            String pointUniquenessName = deviceComponent.getVoltName() + StrUtil.UNDERLINE + deviceComponent.getBayName() + StrUtil.UNDERLINE + deviceComponent.getMainDeviceName() + StrUtil.UNDERLINE + deviceComponent.getComponentName() + StrUtil.UNDERLINE + pointExcelBO.getPointName();
            DevicePoint devicePoint = pointUniquenessName2PointMap.get(pointUniquenessName);

            insertOrUpdateLocalPoint(devicePoint, devicePointList, deviceComponent, pointExcelBO);
        }

    }

    private R<String> markExcelErrorInfo(MultipartFile file, Map<String, String> errorMessageMap, int sheetNum) {
        try {
            @Cleanup Workbook workbook = WorkbookUtil.createBook(file.getInputStream());
            CellStyle cellStyle = workbook.createCellStyle();
            cellStyle.setFillForegroundColor(IndexedColors.RED.getIndex());
            cellStyle.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            cellStyle.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            Sheet sheet = workbook.getSheetAt(sheetNum);
            sheet.getRow(1).getCell(0).setCellValue(ERROR_EXCEL_TABLE_HEAD_DESC);
            Drawing draw = sheet.createDrawingPatriarch();
            for (Map.Entry<String, String> entry : errorMessageMap.entrySet()) {
                String key = entry.getKey();
                String value = entry.getValue();
                String[] locations = key.split(StrUtil.UNDERLINE);
                int row = Integer.parseInt(locations[0]) + 1;
                int col = Integer.parseInt(locations[1]);
                ExcelUtils.setCellBackGroundColor(workbook, row, col, cellStyle, sheet);
                ExcelUtils.insertCellRich(sheet, row, col, value, draw);
            }
            String errorExcelPath = FilePathManagerUtil.getDockerPathBySystemPath(excelTemplateConfig.getErrorLocalExcelPath() + file.getOriginalFilename());
            @Cleanup BufferedOutputStream out = FileUtil.getOutputStream(errorExcelPath);
            workbook.write(out);
            out.flush();
            String returnExcelPath = "/robot" + errorExcelPath;
            return R.<String>builder().code(1).data(returnExcelPath).build();
        } catch (IOException e) {
            log.error("导入点位excel异常，excel数据加载失败", e);
            return R.failed("excel导入失败，加载异常");
        }
    }

    public Set<String> searchKeys(String pattern) {
        ScanOptions options = ScanOptions.scanOptions().match(pattern).build();

        Set<String> keys = (Set<String>) redisTemplate.execute((RedisCallback<Set<String>>) connection -> {
            Set<String> keysResult = new HashSet<>();
            Cursor<byte[]> cursor = connection.scan(options);

            while (cursor.hasNext()) {
                keysResult.add(new String(cursor.next()));
            }

            return keysResult;
        });

        return keys;
    }

    private R<Boolean> checkFile(MultipartFile file) {
        String filename = file.getOriginalFilename();
        if (StrUtil.isBlank(filename) || filename.lastIndexOf(StrUtil.DOT) < 0) {
            throw new RobotException("请上传excel格式的点表");
        }
        // 校验文件类型
        String fileType = filename.substring(filename.lastIndexOf(StrUtil.DOT) + DigitalConstant.ONE);
        if (!EXCEL_FILE_TYPE_LIST.contains(fileType)) {
            throw new RobotException("请上传excel格式的点表");
        }
        // 校验文件大小
        if (file.getSize() > EXCEL_FILE_SIZE) {
            throw new RobotException("上传的Excel文件大小不能超过50M");
        }
        return R.ok(Boolean.TRUE);
    }

    /**
     * 处理导入文件
     *
     * @param file                    导入文件
     * @param calibrationDir          标定图片目录
     * @param errorPathList           错误路径
     * @param imgCalibrationPointList 正确标定点信息集合
     * @param pointNameStrList        点位名称集合
     * @param errorZipFilePath        错误图片压缩文件路径
     */
    private void handleImportFile(MultipartFile file, String calibrationPath, File calibrationDir, String errorZipFilePath, List<String> errorPathList,
                                  List<DevicePoint> imgCalibrationPointList, List<String> pointNameStrList) {
        // 将zip文件临时存储
        File tempFile = new File(ACCOUNT_TEMP_FILE + file.getOriginalFilename());
        try {
            file.transferTo(tempFile);
        } catch (IOException e) {
            e.printStackTrace();
            log.info("文件{}上传失败", file.getOriginalFilename());
        }
        //解压文件
        try (ZipArchiveInputStream is = new ZipArchiveInputStream(new BufferedInputStream(Files.newInputStream(tempFile.toPath())))) {
            ZipEntry entry;
            while ((entry = is.getNextZipEntry()) != null) {
                String entryName = entry.getName();
                if (entry.isDirectory()) {
                    File dir = new File(calibrationDir, entryName);
                    dir.mkdirs();
                } else {
                    OutputStream os = null;
                    try {
                        String imgName = entryName;
                        os = new BufferedOutputStream(Files.newOutputStream(new File(calibrationDir, imgName).toPath()));
                        IOUtils.copy(is, os);
                        // 校验标定图片
                        ReturnWrapper returnWrapper = checkCalibrationImg(imgName, calibrationPath, pointNameStrList, imgCalibrationPointList);

                        if (!returnWrapper.isCorrectness()) {
                            errorPathList.add(returnWrapper.getMessage());
                            log.info("错误信息:{}", returnWrapper.getMessage());
                        }
                    } finally {
                        IOUtils.closeQuietly(os);
                    }
                }
            }
            // 正确的标定图片存库
            if (CollUtil.isNotEmpty(imgCalibrationPointList)) {
                this.baseMapper.updateCalibrationPointPathByDevicePointName(imgCalibrationPointList);
            }
            // 压缩错误的文件并返回
            if (CollUtil.isNotEmpty(errorPathList)) {
                zipImgFile(errorZipFilePath, errorPathList);
            }
            // 删除错误的图片和临时存储的压缩文件
            errorPathList.forEach(e -> {
                File errorImgFile = new File(e);
                errorImgFile.delete();
            });
            tempFile.delete();
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    /**
     * 压缩错误标定图片
     *
     * @param errorZipFilePath 压缩后的zip文件路径
     * @param errorPathList    错误标定图片的路径
     */
    private void zipImgFile(String errorZipFilePath, List<String> errorPathList) {
        File zipFile = new File(errorZipFilePath);
        try {
            zipFile.createNewFile();
        } catch (IOException e) {
            log.error("文件创建异常, errorZpiFilePath: {}", errorZipFilePath, e);
        }

        try (ZipOutputStream zos = new ZipOutputStream(Files.newOutputStream(zipFile.toPath()))) {
            byte[] buffer = new byte[2048];

            for (String errorImgPath : errorPathList) {
                File file = new File(errorImgPath);
                if (file.exists()) {
                    ZipEntry zipEntry = new ZipEntry(file.getName());
                    zos.putNextEntry(zipEntry);

                    try (FileInputStream fis = new FileInputStream(file)) {
                        int len;
                        while ((len = fis.read(buffer)) > 0) {
                            zos.write(buffer, 0, len);
                        }
                        zos.closeEntry();
                    } catch (IOException e) {
                        e.printStackTrace();
                    }
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    /**
     * 校验标定图片
     *
     * @param entryName               压缩文件中的图片
     * @param pointNameStrList        标定点id集合
     * @param imgCalibrationPointList 正确标定点集合
     * @return 图片路径
     */
    private ReturnWrapper checkCalibrationImg(String entryName, String calibrationPath,
                                              List<String> pointNameStrList,
                                              List<DevicePoint> imgCalibrationPointList) {
        String imgPath = calibrationPath + entryName;
        File imgFile = new File(imgPath);
        if (StrUtil.isBlank(entryName) || entryName.lastIndexOf(StrUtil.DOT) < 0) {
            return renameFile(imgFile, calibrationPath, entryName, "文件格式错误");
        }
        String fileType = entryName.substring(entryName.lastIndexOf(StrUtil.DOT) + DigitalConstant.ONE);
        if (!JPG_FILE_TYPE.equals(fileType)) {
            return renameFile(imgFile, calibrationPath, entryName, "图片文件仅支持JPG格式");
        }
        String imgName = entryName.substring(DigitalConstant.ZERO, entryName.lastIndexOf(StrUtil.DOT));
        int index = imgName.indexOf("/");
        imgName = imgName.substring(index + 1);
        if (!pointNameStrList.contains(imgName)) {
            return renameFile(imgFile, calibrationPath, entryName, "标定点不存在");
        }

        boolean containsDuplicateValue = containsDuplicateValue(pointNameStrList, imgName);
        if (containsDuplicateValue) {
            return renameFile(imgFile, calibrationPath, entryName, "标定点重复");
        } else {
            imgCalibrationPointList.add(DevicePoint.builder().pointName(imgName)
                    .originCalibrationPath(FilePathManagerUtil.getStaticPathByDockerPath(imgPath)).build());
        }

        return ReturnWrapper.builder().correctness(Boolean.TRUE).build();
    }

    /**
     * 文件重命名
     *
     * @param imgFile 源文件
     * @param imgName 源文件名称
     * @param message 重命名信息
     * @return 包装类
     */
    private ReturnWrapper renameFile(File imgFile, String storeDir, String imgName, String message) {
        String errorImgPath = storeDir + FileUtils.pathEndInsert(imgName, message);
        imgFile.renameTo(new File(errorImgPath));
        return ReturnWrapper.builder().correctness(Boolean.FALSE).message(errorImgPath).build();
    }

    public static boolean containsDuplicateValue(List<String> list, String value) {
        Set<String> set = new HashSet<>();

        for (String s : list) {
            if (s.equals(value)) {
                if (set.contains(value)) {
                    return true;
                } else {
                    set.add(value);
                }
            }
        }
        return false;
    }

    /**
     * 校验zip文件
     *
     * @param file zip文件
     */
    private void checkZipFile(MultipartFile file) {
        String fileName = file.getOriginalFilename();
        // 校验文件格式
        if (StrUtil.isBlank(fileName) || fileName.lastIndexOf(StrUtil.DOT) < 0) {
            throw new RobotException("上传的文件格式错误");
        }
        // 校验文件类型
        String fileType = fileName.substring(fileName.lastIndexOf(StrUtil.DOT) + DigitalConstant.ONE);
        if (!ZIP_FILE_TYPE.equals(fileType)) {
            throw new RobotException("上传的压缩文件格式仅支持zip格式");
        }
        // 校验文件大小
        if (file.getSize() > ZIP_FILE_SIZE) {
            throw new RobotException("上传的Zip文件大小不能超过3G");
        }
    }

    private List<DeviceInfoExcelBO> buildDeviceInfoExcelList(List<DevicePoint> devicePointList) {
        List<Long> mainDeviceIdList = devicePointList.stream().map(DevicePoint::getMainDeviceId).distinct().collect(Collectors.toList());
        List<DeviceMain> deviceMainList = deviceMainService.listByIds(mainDeviceIdList);
        List<DevicePropertyVO> positionList = devicePropertyService.getPositionList();

        return devicePointList.stream().map(devicePoint -> {
            Map<Integer, String> positionStateTypeMap = positionList.stream()
                    .collect(Collectors.toMap(DevicePropertyVO::getType, DevicePropertyVO::getValue, (v1, v2) -> v2));
            Integer mainDeviceType = devicePoint.getMainDeviceType();
            MainDeviceTypeEnum mainDeviceTypeEnum = MainDeviceTypeEnum.valueOf(mainDeviceType);
            String phaseType = PhaseTypeEnum.valueOf(devicePoint.getPhaseType()).getDescription();
            Map<Long, String> mainDeviceId2EntityId = deviceMainList.stream().filter(deviceMain -> StrUtil.isNotBlank(deviceMain.getEntityId())).collect(Collectors.toMap(DeviceMain::getId, DeviceMain::getEntityId, (v1, v2) -> v2));
            String recognitionTypeList = devicePoint.getRecognitionTypeList();
            String[] recTypeSplit = recognitionTypeList.split(StrUtil.COMMA);
            String recType1 = RecTypeEnum.valueOf(Integer.valueOf(recTypeSplit[0])).getDesc();
            String recType2 = StrUtil.EMPTY;
            if (recTypeSplit.length >= DigitalConstant.TWO) {
                recType2 = RecTypeEnum.valueOf(Integer.valueOf(recTypeSplit[1])).getDesc();
            }

            return DeviceInfoExcelBO.builder()
                    .pointName(Objects.toString(devicePoint.getPointName(), StrUtil.EMPTY))
                    .pointCode(Objects.toString(devicePoint.getPointCode(), StrUtil.EMPTY))
                    .recType1(recType1)
                    .recType2(recType2)
                    .collectType(Objects.nonNull(devicePoint.getSaveTypeList()) ? CollectTypeEnum.getByCode(devicePoint.getSaveTypeList()).getDesc() : StrUtil.EMPTY)
                    .meterType(Objects.nonNull(devicePoint.getMeterType()) ? MeterTypeEnum.getDescByType(devicePoint.getMeterType()) : StrUtil.EMPTY)
                    .positionStateType(Objects.toString(positionStateTypeMap.get(devicePoint.getPositionStateType()), StrUtil.EMPTY))
                    .importantLevel(ImportantLevelEnum.descByLevel(devicePoint.getImportantLevel()))
                    .robotName(Objects.toString(devicePoint.getRobotName(), StrUtil.EMPTY))
                    .appearanceType(Objects.nonNull(AssistFacilityTypeEnum.valueOf(devicePoint.getAppearanceType())) ? AssistFacilityTypeEnum.valueOf(devicePoint.getAppearanceType()).getDesc() : StrUtil.EMPTY)
                    .defectRecType(StrUtil.join(StrUtil.COMMA, StrUtil.isNotBlank(devicePoint.getDefectRecType()) ? Arrays.stream(devicePoint.getDefectRecType().split(StrUtil.COMMA)).map(DefectAppearanceRecTypeEnum::getDescByType).filter(Objects::nonNull).collect(Collectors.toList()) : Lists.newArrayList()))
                    .defectJudgeType(Objects.nonNull(devicePoint.getDefectJudgeType()) ? devicePoint.getDefectJudgeType() == 0 ? "否" : "是" : StrUtil.EMPTY)
                    .inspectionSubType(StrUtil.isNotBlank(devicePoint.getInspectionSubType()) ? StrUtil.join(StrUtil.COMMA, Arrays.stream(devicePoint.getInspectionSubType().split(StrUtil.COMMA)).map(InspectionTypeEnum::getDescBySubType).filter(StrUtil::isNotBlank).collect(Collectors.toList())) : StrUtil.EMPTY)
                    .voltCode(Objects.toString(devicePoint.getVoltCode(), StrUtil.EMPTY))
                    .componentName(Objects.toString(devicePoint.getComponentName(), StrUtil.EMPTY))
                    .componentCode(Objects.toString(devicePoint.getComponentCode(), StrUtil.EMPTY))
                    .componentType(Objects.toString(devicePoint.getComponentType(), StrUtil.EMPTY))
                    .mainDeviceName(Objects.toString(devicePoint.getMainDeviceName(), StrUtil.EMPTY))
                    .mainDeviceCode(Objects.toString(devicePoint.getMainDeviceCode(), StrUtil.EMPTY))
                    .mainDeviceType(Objects.nonNull(mainDeviceTypeEnum) ? mainDeviceTypeEnum.getDesc() : StrUtil.EMPTY)
                    .phase(Objects.toString(phaseType, StrUtil.EMPTY))
                    .entityId(Objects.toString(mainDeviceId2EntityId.get(devicePoint.getMainDeviceId()), StrUtil.EMPTY))
                    .bayName(Objects.toString(devicePoint.getBayName(), StrUtil.EMPTY))
                    .bayCode(Objects.toString(devicePoint.getBayCode(), StrUtil.EMPTY))
                    .bayType(Objects.toString(devicePoint.getBayType(), StrUtil.EMPTY))
                    .voltName(Objects.toString(devicePoint.getVoltName(), StrUtil.EMPTY))
                    .stationName(Objects.toString(devicePoint.getStationName(), StrUtil.EMPTY))
                    .build();
        }).collect(Collectors.toList());
    }

    private R<Boolean> checkExportParams(Long stationId) {
        FacInfo station = facInfoService.getById(stationId);
        if (Objects.isNull(station)) {
            return R.failed(Boolean.FALSE, "导出失败，厂站信息不存在");
        }
        return R.ok(Boolean.TRUE);
    }

    private void export(List<DeviceInfoExcelBO> deviceInfoExcelList, Long stationId, HttpServletResponse response) {
        ThreadPoolExecutor executor = null;

        try {
            executor = ExecutorUtils.newThreadExecutor(ThreadNameConstant.Point.POINT_EXPORT, Runtime.getRuntime().availableProcessors(), Runtime.getRuntime().availableProcessors());

            FacInfo facInfo = facInfoService.getById(stationId);
            String dateTime = DateUtil.format(DateUtil.date(), DatePattern.PURE_DATETIME_PATTERN);
            String zipName = "设备信息" + StrUtil.UNDERLINE + facInfo.getStationName() + StrUtil.UNDERLINE + dateTime;
            String[] filePaths;
            InputStream[] ins;
            int limit = 10000;
            int total = deviceInfoExcelList.size();
            if (CollUtil.isEmpty(deviceInfoExcelList)) {
                ins = new InputStream[DigitalConstant.ONE];
                filePaths = new String[DigitalConstant.ONE];
                filePaths[DigitalConstant.ZERO] = zipName + StrUtil.UNDERLINE + DigitalConstant.ONE + ExcelUtils.XLSX;
                Workbook workbook = DefaultExcelBuilder.of(DeviceInfoExcelBO.class).build(deviceInfoExcelList);
                InputStream is = ExcelUtils.workbook2InputStream(workbook);
                ins[0] = is;
            } else {
                int times = total % limit == 0 ? (total / limit) : ((total / limit) + 1);
                filePaths = new String[times];
                ins = new InputStream[times];

                CountDownLatch countDownLatch = new CountDownLatch(times);
                int size = deviceInfoExcelList.size();
                for (int i = 0; i < times; i++) {
                    int finalI = i;
                    int start = i * limit;
                    int end = Math.min(start + limit, size);

                    executor.execute(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                List<DeviceInfoExcelBO> deviceInfoExcelBOList = deviceInfoExcelList.subList(start, end);

                                ByteArrayOutputStream out = new ByteArrayOutputStream();
                                ExcelWriter writer = EasyExcel.write(out).build();
                                WriteSheet writeSheet = EasyExcel.writerSheet("设备信息数据").head(DeviceInfoExcelBO.class).registerWriteHandler(new LongestMatchColumnWidthStyleStrategy()).build();
                                writer.write(deviceInfoExcelBOList, writeSheet);
                                writer.finish();
                                byte[] bytes = out.toByteArray();
                                InputStream is = new ByteArrayInputStream(bytes);
                                out.close();

                                filePaths[finalI] = zipName + StrUtil.UNDERLINE + (finalI + 1) + ExcelUtils.XLSX;
                                ins[finalI] = is;
                            } catch (Exception e) {
                                e.printStackTrace();
                            } finally {
                                countDownLatch.countDown();
                            }
                        }
                    });
                }
                countDownLatch.await();
            }
            ExcelUtils.responseZipFile("ExportDataExcel", filePaths, ins, response);
        } catch (InterruptedException e) {
            log.error(e.getMessage(), e);
        } finally {
            ExecutorUtils.shutdown(executor);
        }
    }

    public DeviceModelItemFromHigherVO buildDeviceModelItem2HigherVO(DevicePointModelSyncVO devicePointModelSyncVO) {
        DeviceModelItemFromHigherVO deviceModelItemFromHigherVO = new DeviceModelItemFromHigherVO();

        deviceModelItemFromHigherVO.setStationName(devicePointModelSyncVO.getStationName());
        deviceModelItemFromHigherVO.setStationCode(devicePointModelSyncVO.getStationCode());
//        deviceModelItemFromHigherVO.setStationId(devicePointModelSyncVO.getStationCode());
        deviceModelItemFromHigherVO.setAreaId(devicePointModelSyncVO.getVoltCode());
        deviceModelItemFromHigherVO.setAreaName(devicePointModelSyncVO.getVoltName());
        deviceModelItemFromHigherVO.setBayId(Objects.toString(devicePointModelSyncVO.getBayCode(), StrUtil.EMPTY));
        deviceModelItemFromHigherVO.setBayName(Objects.toString(devicePointModelSyncVO.getBayName(), StrUtil.EMPTY));
        deviceModelItemFromHigherVO.setMainDeviceId(Objects.toString(devicePointModelSyncVO.getMainDeviceCode(), StrUtil.EMPTY));
        deviceModelItemFromHigherVO.setMainDeviceName(Objects.toString(devicePointModelSyncVO.getMainDeviceName(), StrUtil.EMPTY));
        deviceModelItemFromHigherVO.setComponentId(Objects.toString(devicePointModelSyncVO.getComponentCode(), StrUtil.EMPTY));
        deviceModelItemFromHigherVO.setComponentName(Objects.toString(devicePointModelSyncVO.getComponentName(), StrUtil.EMPTY));
        deviceModelItemFromHigherVO.setDeviceId(Objects.toString(devicePointModelSyncVO.getDevicePointCode(), StrUtil.EMPTY));
        deviceModelItemFromHigherVO.setDeviceName(Objects.toString(devicePointModelSyncVO.getDevicePointName(), StrUtil.EMPTY));
        deviceModelItemFromHigherVO.setDeviceType(Objects.toString(devicePointModelSyncVO.getMainDeviceType(), StrUtil.EMPTY));
        deviceModelItemFromHigherVO.setMeterType(Objects.toString(devicePointModelSyncVO.getMeterType(), StrUtil.EMPTY));
        deviceModelItemFromHigherVO.setAppearanceType(Objects.toString(devicePointModelSyncVO.getAppearanceType(), StrUtil.EMPTY));
        deviceModelItemFromHigherVO.setSaveTypeList(Objects.toString(devicePointModelSyncVO.getCollectType(), StrUtil.EMPTY));
        deviceModelItemFromHigherVO.setRecognitionTypeList(Objects.toString(devicePointModelSyncVO.getRecognitionTypeList(), StrUtil.EMPTY));
        deviceModelItemFromHigherVO.setPhase(Objects.equals(PhaseTypeEnum.PHASE_MAIN.getType(), devicePointModelSyncVO.getPhaseType()) ? StrUtil.EMPTY : Objects.toString(PhaseTypeEnum.valueOf(devicePointModelSyncVO.getPhaseType()).getType(), StrUtil.EMPTY));
        deviceModelItemFromHigherVO.setDeviceInfo(Objects.toString(devicePointModelSyncVO.getDevicePointName(), StrUtil.EMPTY));
        deviceModelItemFromHigherVO.setPointType(Objects.toString(devicePointModelSyncVO.getImportantLevel(), StrUtil.EMPTY));
        deviceModelItemFromHigherVO.setDataType("2");
        deviceModelItemFromHigherVO.setLowerValue(StrUtil.EMPTY);
        deviceModelItemFromHigherVO.setUpperValue(StrUtil.EMPTY);
        deviceModelItemFromHigherVO.setLabelAttri(StrUtil.EMPTY);
        deviceModelItemFromHigherVO.setVideoPos(JSONObject.toJSONString(Lists.newArrayList(
                VideoPosEntity2Higher.builder()
                        .robotCode(devicePointModelSyncVO.getRobotCode())
                        .robotPos(devicePointModelSyncVO.getCalibrationId())
                        .build())));

        return deviceModelItemFromHigherVO;
    }

    /**
     * （点位新增编辑）参数校验
     *
     * @param pointName           点位名称
     * @param recognitionTypeList 识别类型
     * @param meterType           表计类型
     * @param positionStateType   位置状态类型
     * @param saveTypeList        采集类型
     * @param appearanceType      辅助设施类型
     * @param defectRecType       缺陷识别类型
     * @param defectJudgeType     是否缺陷判别
     * @param operate             操作
     * @param importantLevel      重要等级
     * @return 校验结果
     */
    private R<Boolean> checkDevicePointParams(String pointName, String recognitionTypeList, Integer meterType, Integer positionStateType, Integer saveTypeList, Integer appearanceType, String defectRecType, Integer defectJudgeType, String operate, Integer importantLevel, List<Integer> inspectionSubTypes,
                                              String remark) {
        Boolean pointNameCheckResult = RegxUtils.checkDeviceTreeNodeName(pointName);
        if (!pointNameCheckResult) {
            return R.failed(Boolean.FALSE, operate + "失败，点位名称：长度为2-50位的字符，可输入中文 大小写字母 数字 罗马数字 、. # _ - ( ) （ ），且不以_result结尾");
        }
        List<String> recTypeList = new ArrayList<>(Arrays.asList(recognitionTypeList.split(StrUtil.COMMA)));
        boolean isIllegalRecType = recTypeList.stream()
                .anyMatch(recType -> !RecTypeEnum.isLegalRecType(Integer.valueOf(recType)));
        if (isIllegalRecType) {
            return R.failed(Boolean.FALSE, operate + "失败，识别类型非法");
        }

        // 校验采集类型
        Boolean isLegalCollectType = CollectTypeEnum.isLegalCollectType(saveTypeList);
        if (!isLegalCollectType) {
            return R.failed(Boolean.FALSE, operate + "失败，采集类型非法");
        }

        //识别类型是实物ID时，采集类型只能为可见光
        if (recTypeList.contains(RecTypeEnum.ENTITY_ID.getType().toString())
                && saveTypeList != CollectTypeEnum.PICTURE.getCode()) {
            return R.failed(Boolean.FALSE, operate + "失败，采集类型非法");
        }

        // 校验表计类型、位置状态类型，辅助设施类型，缺陷识别， 缺陷判别
        if (Objects.nonNull(meterType) && !MeterTypeEnum.isLegalMeterType(meterType)) {
            return R.failed(Boolean.FALSE, operate + "失败，表计类型非法");
        }
        if (Objects.nonNull(positionStateType)) {
            List<DevicePropertyVO> positionList = devicePropertyService.getPositionList();
            boolean isIllegalPositionType = positionList.stream().noneMatch(pos -> Objects.equals(pos.getType(), positionStateType));
            if (isIllegalPositionType) {
                return R.failed(Boolean.FALSE, operate + "失败，位置状态类型非法");
            }
        }
        if (!AssistFacilityTypeEnum.isLegalAssistFacilityType(appearanceType)) {
            return R.failed(Boolean.FALSE, operate + "失败，辅助设施类型非法");
        }

        if (StrUtil.isNotBlank(defectRecType)) {
            List<String> defectRecTypeList = new ArrayList<>(Arrays.asList(defectRecType.split(StrUtil.COMMA)));
            boolean isIllegalDefectRecType = defectRecTypeList.stream().noneMatch(DefectAppearanceRecTypeEnum::isLegalDefectRecType);
            if (isIllegalDefectRecType) {
                return R.failed(Boolean.FALSE, operate + "失败，缺陷识别类型不合法");
            }
        }
        if (!ImportantLevelEnum.levelVerify(importantLevel)) {
            return R.failed(Boolean.FALSE, operate + "失败，重要等级不存在");
        }
        // 校验巡视类型
        List<Integer> inspectionSubTypeList = Arrays.stream(InspectionTypeEnum.values()).map(InspectionTypeEnum::getInspectionSubType).collect(Collectors.toList());
        for (Integer inspectionSubType : inspectionSubTypes) {
            if (!inspectionSubTypeList.contains(inspectionSubType)) {
                return R.failed(Boolean.FALSE, operate + "失败，巡视子类型不存在");
            }
        }

        //识别类型是实物ID时，巡视类型不能为特殊巡视
        if (recTypeList.contains(RecTypeEnum.ENTITY_ID.getType().toString())) {
            List<Integer> tmpList = Arrays.stream(InspectionTypeEnum.values()).filter(
                    inspectionTypeEnum -> inspectionTypeEnum.getInspectionType() == InspectionTypeEnum.HIGH_TEMPERATURE_SPECIAL_INSPECTION.getInspectionType()).map(InspectionTypeEnum::getInspectionSubType).collect(Collectors.toList());
            for (Integer inspectionSubType : inspectionSubTypes) {
                if (tmpList.contains(inspectionSubType)) {
                    return R.failed(Boolean.FALSE, operate + "失败，巡视类型有误!实物ID的巡视类型不能为特殊巡视");
                }
            }
        }

        if (StrUtil.isNotEmpty(remark) && remark.length() > 100) {
            return R.failed(Boolean.FALSE, operate + "失败，备注最多100字");
        }

        return R.ok(Boolean.TRUE);
    }

    private void handleAssociateInfo(DevicePointVO devicePointVO, DevicePoint devicePoint) {
        devicePointVO.setThreePhaseFlag(devicePoint.getThreePhaseFlag());
        devicePointVO.setThreePhaseFlagDesc(Objects.equals(CommonConstants.THREE_PHASE_FLAG, devicePoint.getThreePhaseFlag()) ? "三相点位" : "非三相点位");

        String threePhaseAssociateId = devicePoint.getThreePhaseAssociateId();
        if (StrUtil.isNotBlank(threePhaseAssociateId)) {
            List<DevicePoint> devicePointList = this.baseMapper.selectList(Wrappers.lambdaQuery(DevicePoint.class)
                    .eq(DevicePoint::getThreePhaseAssociateId, threePhaseAssociateId));
            devicePointList = devicePointList.stream()
                    .filter(d -> !Objects.equals(d.getId(), devicePoint.getId())).collect(Collectors.toList());
            devicePointVO.setThreePhasePoint1(devicePointList.get(DigitalConstant.ZERO).getPointName());
            devicePointVO.setThreePhasePoint2(devicePointList.get(DigitalConstant.ONE).getPointName());
        }
        devicePointVO.setDemarcateState(devicePoint.getDemarcateState());
        devicePointVO.setDemarcateStateDesc(Objects.equals(1, devicePoint.getDemarcateState()) ? "已标定" : "未标定");
    }


    /**
     * 校验点位Excel的数据
     */
    private void checkPointExcelData(List<Map<String, Object>> excelMapList, FacInfo facInfo, Map<String, String> errorMessageMap, List<PointExcelBO> tourPointExcelList, Robot robot) {
        // 读取excel中单行的数据信息
        Map<String, Object> lineDataMap;
        // 查询位置状态类型用于校验
        List<DevicePropertyVO> positionProperList = devicePropertyService.getPositionList();
        // 查询电压等级用于校验
        List<DevicePropertyVO> voltageProperList = devicePropertyService.getVoltageList();
        // 查询电压区域用于校验
        List<DeviceVoltage> deviceVoltageList = deviceVoltageService.queryByStationId(facInfo.getId());
        // 查询间隔用于校验
        List<DeviceBay> deviceBayList = deviceBayService.queryByStationId(facInfo.getId());
        // 查询主设备用于校验
        List<DeviceMain> deviceMainList = deviceMainService.queryByStationId(facInfo.getId());
        // 查询部件用于校验
        List<DeviceComponent> deviceComponentList = deviceComponentService.queryByStationId(facInfo.getId());
        // 表格的点位编码用于唯一性校验
        List<String> pointCodes = new ArrayList<>();
        List<String> pointNames = new ArrayList<>();
        //名称唯一性校验，全路径名
        List<String> pointNamesAllPath = new ArrayList<>();
        // 表格的部件编码用于唯一性校验
        List<String> componentCodes = new ArrayList<>();
        List<String> componentNames = new ArrayList<>();
        List<String> componentNamesAllPath = new ArrayList<>();
        // 表格的主设备编码用于唯一性校验
        List<String> mainDeviceCodes = new ArrayList<>();
        List<String> mainDeviceNames = new ArrayList<>();
        List<String> mainDeviceNamesAllPath = new ArrayList<>();
        // 表格的间隔编码用于唯一性校验
        List<String> bayCodes = new ArrayList<>();
        List<String> bayNames = new ArrayList<>();
        List<String> bayNamesAllPath = new ArrayList<>();
        // 表格的电压区域编码用于唯一性校验
        List<String> voltageCodes = new ArrayList<>();
        List<String> voltageNames = new ArrayList<>();
        List<String> voltageNamesAllPath = new ArrayList<>();

        String facName = facInfo.getStationName();
        // 校验点位数据
        for (int i = 0; i < excelMapList.size(); i++) {
            lineDataMap = excelMapList.get(i);
            int rowIndex = i + DigitalConstant.ONE;
            String pointName = Objects.toString(lineDataMap.get(LocalPointExcelEnum.POINT_NAME.getDesc())).trim();
            String pointCode = Objects.toString(lineDataMap.get(LocalPointExcelEnum.POINT_CODE.getDesc()), "").trim();
            String recType1 = Objects.toString(Objects.nonNull(lineDataMap.get(LocalPointExcelEnum.REC_TYPE1.getDesc())) ? lineDataMap.get(LocalPointExcelEnum.REC_TYPE1.getDesc()) : "").trim();
            String recType2 = Objects.toString(Objects.nonNull(lineDataMap.get(LocalPointExcelEnum.REC_TYPE2.getDesc())) ? lineDataMap.get(LocalPointExcelEnum.REC_TYPE2.getDesc()) : "").trim();
            String collectType = Objects.toString(lineDataMap.get(LocalPointExcelEnum.COLLECT_TYPE.getDesc())).trim();
            String meterTypeStr = Objects.toString(lineDataMap.get(LocalPointExcelEnum.METER_TYPE.getDesc())).trim();
            String positionStateTypeStr = Objects.toString(lineDataMap.get(LocalPointExcelEnum.POSITION_STATE_TYPE.getDesc()), "");
            String importantLevel = Objects.toString(lineDataMap.get(LocalPointExcelEnum.IMPORTANT_LEVEL.getDesc())).trim();
            String componentName = Objects.toString(lineDataMap.get(LocalPointExcelEnum.COMPONENT_NAME.getDesc())).trim();
            String componentCode = Objects.toString(lineDataMap.get(LocalPointExcelEnum.COMPONENT_CODE.getDesc()), "").trim();
            String mainDeviceName = Objects.toString(lineDataMap.get(LocalPointExcelEnum.MAIN_DEVICE_NAME.getDesc())).trim();
            String mainDeviceCode = Objects.toString(lineDataMap.get(LocalPointExcelEnum.MAIN_DEVICE_CODE.getDesc()), "").trim();
            String mainDeviceType = Objects.toString(lineDataMap.get(LocalPointExcelEnum.MAIN_DEVICE_TYPE.getDesc())).trim();
            String phaseType = Objects.toString(lineDataMap.get(LocalPointExcelEnum.PHASE_TYPE.getDesc())).trim();
            String bayName = Objects.toString(lineDataMap.get(LocalPointExcelEnum.BAY_NAME.getDesc())).trim();
            String bayCode = Objects.toString(lineDataMap.get(LocalPointExcelEnum.BAY_CODE.getDesc()), "").trim();
            String bayType = Objects.toString(lineDataMap.get(LocalPointExcelEnum.BAY_TYPE.getDesc()), "").trim();
            String voltName = Objects.toString(lineDataMap.get(LocalPointExcelEnum.VOLT_NAME.getDesc())).trim();
            String voltCode = Objects.toString(lineDataMap.get(LocalPointExcelEnum.VOLT_CODE.getDesc()), "").trim();
            String inspectionType1 = Objects.toString(lineDataMap.get(LocalPointExcelEnum.INSPECTION_TYPE_1.getDesc()), "").trim();
            String inspectionType2 = Objects.toString(lineDataMap.get(LocalPointExcelEnum.INSPECTION_TYPE_2.getDesc()), "").trim();
            String inspectionType3 = Objects.toString(lineDataMap.get(LocalPointExcelEnum.INSPECTION_TYPE_3.getDesc()), "").trim();
            String inspectionType4 = Objects.toString(lineDataMap.get(LocalPointExcelEnum.INSPECTION_TYPE_4.getDesc()), "").trim();
            String inspectionType5 = Objects.toString(lineDataMap.get(LocalPointExcelEnum.INSPECTION_TYPE_5.getDesc()), "").trim();
            String inspectionType6 = Objects.toString(lineDataMap.get(LocalPointExcelEnum.INSPECTION_TYPE_6.getDesc()), "").trim();
            String inspectionType7 = Objects.toString(lineDataMap.get(LocalPointExcelEnum.INSPECTION_TYPE_7.getDesc()), "").trim();
            String inspectionType8 = Objects.toString(lineDataMap.get(LocalPointExcelEnum.INSPECTION_TYPE_8.getDesc()), "").trim();
            int pointNameIndex = LocalPointExcelEnum.POINT_NAME.getIndex();
            int pointCodeIndex = LocalPointExcelEnum.POINT_CODE.getIndex();
            int recType1Index = LocalPointExcelEnum.REC_TYPE1.getIndex();
            int recType2Index = LocalPointExcelEnum.REC_TYPE2.getIndex();
            int collectTypeIndex = LocalPointExcelEnum.COLLECT_TYPE.getIndex();
            int meterTypeIndex = LocalPointExcelEnum.METER_TYPE.getIndex();
            int positionStateIndex = LocalPointExcelEnum.POSITION_STATE_TYPE.getIndex();
            int importantLevelIndex = LocalPointExcelEnum.IMPORTANT_LEVEL.getIndex();
            int componentNameIndex = LocalPointExcelEnum.COMPONENT_NAME.getIndex();
            int componentCodeIndex = LocalPointExcelEnum.COMPONENT_CODE.getIndex();
            int mainDeviceNameIndex = LocalPointExcelEnum.MAIN_DEVICE_NAME.getIndex();
            int mainDeviceCodeIndex = LocalPointExcelEnum.MAIN_DEVICE_CODE.getIndex();
            int mainDeviceTypeIndex = LocalPointExcelEnum.MAIN_DEVICE_TYPE.getIndex();
            int phaseTypeIndex = LocalPointExcelEnum.PHASE_TYPE.getIndex();
            int bayNameIndex = LocalPointExcelEnum.BAY_NAME.getIndex();
            int bayCodeIndex = LocalPointExcelEnum.BAY_CODE.getIndex();
            int bayTypeIndex = LocalPointExcelEnum.BAY_TYPE.getIndex();
            int voltNameIndex = LocalPointExcelEnum.VOLT_NAME.getIndex();
            int voltCodeIndex = LocalPointExcelEnum.VOLT_CODE.getIndex();
            int inspectionType1Index = LocalPointExcelEnum.INSPECTION_TYPE_1.getIndex();
            int inspectionType2Index = LocalPointExcelEnum.INSPECTION_TYPE_2.getIndex();
            int inspectionType3Index = LocalPointExcelEnum.INSPECTION_TYPE_3.getIndex();
            int inspectionType4Index = LocalPointExcelEnum.INSPECTION_TYPE_4.getIndex();
            int inspectionType5Index = LocalPointExcelEnum.INSPECTION_TYPE_5.getIndex();
            int inspectionType6Index = LocalPointExcelEnum.INSPECTION_TYPE_6.getIndex();
            int inspectionType7Index = LocalPointExcelEnum.INSPECTION_TYPE_7.getIndex();
            int inspectionType8Index = LocalPointExcelEnum.INSPECTION_TYPE_8.getIndex();
            // 封装表格中的点位数据
            PointExcelBO pointExcelBO = PointExcelBO.builder().build();

            pointExcelBO.setRobotName(robot.getRobotName());
            pointExcelBO.setRobotId(robot.getId());
            // 校验点位名称
            if (StrUtil.isBlank(pointName)) {
                errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + pointNameIndex, "点位名称必填");
            } else {
                Boolean pointNameCheckResult = RegxUtils.checkDeviceTreeNodeName(pointName);

                if (!pointNameCheckResult) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + pointNameIndex, "点位名称：长度为2-50位的字符，可输入中文 大小写字母 数字 罗马数字 、. # _ - ( ) （ ），且不以_result结尾");
                } else {
                    String pointNameAllPath = facName + voltName + bayName + mainDeviceName + componentName + pointName;
                    if (checkNameRepeat(pointNameAllPath, pointNamesAllPath)) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + pointNameIndex, "同一部件下点位名称不能重复");
                    } else {
                        pointExcelBO.setPointName(pointName);
                    }
                }
            }

            // 校验点位编码
            if (StrUtil.isNotBlank(pointCode)) {
                boolean checkCode = Pattern.compile(RegxUtils.CODE_REGEX_STR).matcher(pointCode).matches();
                if (!checkCode) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + pointCodeIndex, "只能输入1-64位数字、字母（大小写）、英文特殊字符（!、@、#、$、%、^、&、*、_、-）");
                } else {
                    if (pointCodes.contains(pointCode)) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + pointCodeIndex, "点位编码已存在");
                    } else {
                        pointExcelBO.setPointCode(pointCode);
                    }
                    pointCodes.add(pointCode);
                }
            }

            // 校验识别类型2
            List<String> recTypeList = new ArrayList<>();
            RecTypeEnum recTypeEnum2 = null;
            if (StrUtil.isNotBlank(recType2)) {
                recTypeEnum2 = RecTypeEnum.getByDesc(recType2);
                if (Objects.isNull(recTypeEnum2)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + recType2Index, "识别类型2，类型错误");
                } else {
                    pointExcelBO.setRecType2(recTypeEnum2.getType());
                    recTypeList.add(String.valueOf(recTypeEnum2.getType()));
                }
            }

            if (StrUtil.isBlank(recType1)) {
                errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + recType1Index, "识别类型1必填");
            } else {
                RecTypeEnum recTypeEnum1 = RecTypeEnum.getByDesc(recType1);
                if (Objects.isNull(recTypeEnum1)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + recType1Index, "识别类型1，类型错误");
                } else {
                    pointExcelBO.setRecType1(recTypeEnum1.getType());
                    recTypeList.add(String.valueOf(recTypeEnum1.getType()));
                    if (Objects.nonNull(recTypeEnum2)) {
                        // 判断识别类型1和识别类型2的组合是否合法
                        boolean isLegalGroup = (Objects.equals(RecTypeEnum.METER, recTypeEnum1) && Objects.equals(RecTypeEnum.APPEARANCE, recTypeEnum2))
                                || (Objects.equals(RecTypeEnum.METER, recTypeEnum2) && Objects.equals(RecTypeEnum.APPEARANCE, recTypeEnum1))
                                || (Objects.equals(RecTypeEnum.POSITION, recTypeEnum1) && Objects.equals(RecTypeEnum.APPEARANCE, recTypeEnum2))
                                || (Objects.equals(RecTypeEnum.POSITION, recTypeEnum2) && Objects.equals(RecTypeEnum.APPEARANCE, recTypeEnum1))
                                || Objects.equals(recTypeEnum1, recTypeEnum2);
                        if (!isLegalGroup) {
                            errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + recType1Index, "识别类型1和识别类型2选择的内容需满足多选限制：表计读取和设备外观查看可同时选择、位置状态识别和设备外观查看可同时选择，其余不可同时选择");
                            errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + recType2Index, "识别类型1和识别类型2选择的内容需满足多选限制：表计读取和设备外观查看可同时选择、位置状态识别和设备外观查看可同时选择，其余不可同时选择");
                        }
                    }
                }
            }
            recTypeList = recTypeList.stream().distinct().collect(Collectors.toList());

            if (StrUtil.isNotBlank(collectType)) {
                // 判断采集类型是否合法
                CollectTypeEnum collectTypeEnum = CollectTypeEnum.getByDesc(collectType);
                if (Objects.isNull(collectTypeEnum)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + collectTypeIndex, "采集类型非法");
                } else {
                    if (recTypeList.contains(RecTypeEnum.ENTITY_ID.getType().toString())
                            && collectTypeEnum != CollectTypeEnum.PICTURE) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + collectTypeIndex, "识别类型与采集类型不匹配");
                    } else if (recTypeList.contains(RecTypeEnum.INFRARED_THERMOMETER.getType().toString())
                            && collectTypeEnum != CollectTypeEnum.INFRARED) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + collectTypeIndex, "识别类型与采集类型不匹配");
                    } else if (recTypeList.contains(RecTypeEnum.VOICE.getType().toString())
                            && collectTypeEnum != CollectTypeEnum.AUDIO) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + collectTypeIndex, "识别类型与采集类型不匹配");
                    } else if ((recTypeList.contains(RecTypeEnum.FLASH_CHECK.getType().toString()))
                            && ((collectTypeEnum != CollectTypeEnum.PICTURE) || collectTypeEnum != CollectTypeEnum.VIDEO)) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + collectTypeIndex, "识别类型与采集类型不匹配");
                    } else {
                        pointExcelBO.setCollectType(collectTypeEnum.getCode());
                    }
                }
            } else {
                String recType = String.join(StrUtil.COMMA, recTypeList);
                CollectTypeEnum defaultCollectType = CollectTypeEnum.getDefaultByRecType(recType);
                pointExcelBO.setCollectType(defaultCollectType.getCode());
            }

            // 校验表计类型
            Integer meterType = null;
            if (recTypeList.contains(String.valueOf(RecTypeEnum.METER.getType()))) {
                if (StrUtil.isBlank(meterTypeStr)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + meterTypeIndex, "识别类型包含表计类型，需要选择表计类型");
                } else {
                    MeterTypeEnum meterTypeEnum = MeterTypeEnum.getByDesc(meterTypeStr);
                    if (Objects.isNull(meterTypeEnum)) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + meterTypeIndex, "表计类型非法");
                    } else {
                        meterType = meterTypeEnum.getType();
                        pointExcelBO.setMeterType(meterType);
                    }
                }
            }

            // 校验位置状态类型
            Integer positionStateType = null;
            if (recTypeList.contains(String.valueOf(RecTypeEnum.POSITION.getType()))) {
                if (StrUtil.isBlank(positionStateTypeStr)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + positionStateIndex, "识别类型包含位置状态类型，需要选择位置状态类型");
                } else {
                    DevicePropertyVO positionList = positionProperList.stream().filter(deviceProperty -> StrUtil.equals(deviceProperty.getValue(), positionStateTypeStr)).findFirst().orElse(null);
                    if (Objects.isNull(positionList)) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + positionStateIndex, "位置状态类型不存在，请在设备属性管理中新增位置状态");
                    } else {
                        positionStateType = positionList.getType();
                        pointExcelBO.setPositionStateType(positionStateType);
                    }
                }
            }

            if (recTypeList.contains(String.valueOf(RecTypeEnum.APPEARANCE.getType()))) {
                String defectRecType = Stream.of(DefectAppearanceRecTypeEnum.values()).map(DefectAppearanceRecTypeEnum::getType).collect(Collectors.joining(StrUtil.COMMA));
                pointExcelBO.setDefectRecType(defectRecType);
            }

            // 校验重要等级
            if (StrUtil.isNotEmpty(importantLevel)) {
                Integer level = ImportantLevelEnum.levelByDesc(importantLevel);
                if (Objects.isNull(level)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + importantLevelIndex, "重要等级非法");
                } else {
                    pointExcelBO.setImportantLevel(level);
                }
            } else {
                pointExcelBO.setImportantLevel(ImportantLevelEnum.ONE.getLevel());
            }

            // 校验电压区域
            if (StrUtil.isNotBlank(voltName)) {
                if (CollUtil.isEmpty(voltageProperList)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + voltNameIndex, "电压不存在");
                } else {
                    String voltNameAllPath = facName + voltName;
                    if (checkNameRepeat(voltNameAllPath, voltageNamesAllPath)) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + voltNameIndex, "同一厂站下电压名称不能重复");
                    } else {
                        pointExcelBO.setVoltName(voltName);
                    }
                }
            } else {
                errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + voltNameIndex, "电压等级必填");
            }

            // 校验电压编码
            if (StrUtil.isNotBlank(voltCode)) {
                boolean checkCode = Pattern.compile(RegxUtils.CODE_REGEX_STR).matcher(voltCode).matches();
                if (!checkCode) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + voltCodeIndex, "只能输入1-64位数字、字母（大小写）、英文特殊字符（!、@、#、$、%、^、&、*、_、-）");
                } else {
                    List<String> voltageNameList = deviceVoltageList.stream().map(DeviceVoltage::getVoltName).collect(Collectors.toList());
                    List<String> voltageCodeList = deviceVoltageList.stream().map(DeviceVoltage::getVoltCode).collect(Collectors.toList());
                    int index = voltageNames.indexOf(voltName);
                    if ((index == -1 && voltageCodes.contains(voltCode)) || (index != -1 && !StrUtil.equals(voltageCodes.get(index), voltCode))) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + voltCodeIndex, "电压编码已存在");
                    } else {
                        if (!voltageNameList.contains(voltName)) {
                            if (voltageCodeList.contains(voltCode)) {
                                errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + voltCodeIndex, "电压编码已存在");
                            }
                        }
                    }
                }
            } else {
                List<String> voltageCodeByNameList = deviceVoltageList.stream().filter(v -> StrUtil.equals(voltName, v.getVoltName())).map(DeviceVoltage::getVoltCode).collect(Collectors.toList());
                if (CollUtil.isNotEmpty(voltageCodeByNameList) && StrUtil.isNotBlank(voltageCodeByNameList.get(DigitalConstant.ZERO))) {
                    voltCode = voltageCodeByNameList.get(DigitalConstant.ZERO);
                } else {
                    voltCode = AutoGenerateUtils.numOrLowercaseStr(DigitalConstant.THIRTY_TWO);
                }
            }
            voltageCodes.add(voltCode);
            voltageNames.add(voltName);
            pointExcelBO.setVoltCode(voltCode);

            // 校验间隔名称
            if (StrUtil.isBlank(bayName)) {
                errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + bayNameIndex, "间隔名称必填");
            } else {
                Boolean bayNameCheckResult = RegxUtils.checkDeviceTreeNodeName(bayName);
                if (!bayNameCheckResult) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + bayNameIndex, "间隔名称：长度为2-50位的字符，可输入中文 大小写字母 数字 罗马数字 、. # _ - ( ) （ ），且不以_result结尾");
                } else {
                    String bayNameAllPath = facName + voltName + bayName;
                    if (checkNameRepeat(bayNameAllPath, bayNamesAllPath)) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + bayNameIndex, "同一电压下间隔名称不能重复");
                    } else {
                        pointExcelBO.setBayName(bayName);
                    }
                }
            }

            // 校验间隔类型
            if (StrUtil.isNotBlank(bayType)) {
                if (bayType.length() < DigitalConstant.TWO || bayType.length() > DigitalConstant.TWENTY) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + bayTypeIndex, "间隔类型长度为2-20位的字符");
                } else {
                    Integer code = IntervalTypeEnum.getCodeByType(bayType);
                    if (null == code) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + bayTypeIndex, "间隔类型不合法");
                    } else {
                        pointExcelBO.setBayType(code.toString());
                    }
                }
            }

            // 校验间隔编码
            if (StrUtil.isNotBlank(bayCode)) {
                boolean checkCode = Pattern.compile(RegxUtils.CODE_REGEX_STR).matcher(bayCode).matches();
                if (!checkCode) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + bayCodeIndex, "只能输入1-64位数字、字母（大小写）、英文特殊字符（!、@、#、$、%、^、&、*、_、-）");
                } else {
                    List<String> bayNameList = deviceBayList.stream().filter(b -> StrUtil.equals(b.getVoltName(), voltName)).map(DeviceBay::getBayName).collect(Collectors.toList());
                    List<String> bayCodeList = deviceBayList.stream().map(DeviceBay::getBayCode).collect(Collectors.toList());
                    int index = bayNames.indexOf(bayName);
                    if ((index == -1 && bayCodes.contains(bayCode)) || (index != -1 && !StrUtil.equals(bayCodes.get(index), bayCode))) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + bayCodeIndex, "间隔编码已存在");
                    } else {
                        if (!bayNameList.contains(bayName)) {
                            if (bayCodeList.contains(bayCode)) {
                                errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + bayCodeIndex, "间隔编码已存在");
                            }
                        }
                    }
                }
            } else {
                List<String> bayCodeByNameList = deviceBayList.stream().filter(b -> StrUtil.equals(b.getVoltName(), voltName) && StrUtil.equals(b.getBayName(), bayName)).map(DeviceBay::getBayCode).collect(Collectors.toList());
                if (CollUtil.isNotEmpty(bayCodeByNameList) && StrUtil.isNotBlank(bayCodeByNameList.get(DigitalConstant.ZERO))) {
                    bayCode = bayCodeByNameList.get(DigitalConstant.ZERO);
                } else {
                    bayCode = AutoGenerateUtils.numOrLowercaseStr(DigitalConstant.THIRTY_TWO);
                }
            }
            bayCodes.add(bayCode);
            bayNames.add(bayName);
            pointExcelBO.setBayCode(bayCode);

            // 校验主设备名称
            if (StrUtil.isBlank(mainDeviceName)) {
                errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + mainDeviceNameIndex, "主设备名称必填");
            } else {
                Boolean mainDeviceNameCheckResult = RegxUtils.checkDeviceTreeNodeName(mainDeviceName);
                if (!mainDeviceNameCheckResult) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + mainDeviceNameIndex, "主设备名称：长度为2-50位的字符，可输入中文 大小写字母 数字 罗马数字 、. # _ - ( ) （ ），且不以_result结尾");
                } else {
                    String mainDeviceNameAllPath = facName + voltName + bayName + mainDeviceName;
                    if (checkNameRepeat(mainDeviceNameAllPath, mainDeviceNamesAllPath)) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + mainDeviceNameIndex, "同一间隔下主设备名称不能重复");
                    } else {
                        pointExcelBO.setMainDeviceName(mainDeviceName);
                    }
                }
            }

            // 校验相位类型
            if (StrUtil.isBlank(phaseType)) {
                errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + phaseTypeIndex, "相位必填");
            } else {
                PhaseTypeEnum phaseTypeEnum = PhaseTypeEnum.getByDescription(phaseType);
                if (Objects.isNull(phaseTypeEnum)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + phaseTypeIndex, "相位类型非法");
                } else {
                    pointExcelBO.setPhaseType(phaseTypeEnum.getType());
                }
            }

            // 校验主设备类型
            if (StrUtil.isBlank(mainDeviceType)) {
                errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + mainDeviceTypeIndex, "主设备类型必填");
            } else {
                MainDeviceTypeEnum mainDeviceTypeEnum = MainDeviceTypeEnum.getByDesc(mainDeviceType);
                if (Objects.isNull(mainDeviceTypeEnum)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + mainDeviceTypeIndex, "主设备类型非法");
                } else {
                    pointExcelBO.setMainDeviceType(mainDeviceTypeEnum.getType());
                }
            }

            // 校验主设备编码
            if (StrUtil.isNotBlank(mainDeviceCode)) {
                boolean checkCode = Pattern.compile(RegxUtils.CODE_REGEX_STR).matcher(mainDeviceCode).matches();
                if (!checkCode) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + mainDeviceCodeIndex, "只能输入1-64位数字、字母（大小写）、英文特殊字符（!、@、#、$、%、^、&、*、_、-）");
                } else {
                    List<String> mainDeviceNameList = deviceMainList.stream().filter(m -> StrUtil.equals(m.getVoltName(), voltName) &&
                            StrUtil.equals(m.getBayName(), bayName)).map(DeviceMain::getMainDeviceName).collect(Collectors.toList());
                    List<String> mainDeviceCodeList = deviceMainList.stream().map(DeviceMain::getMainDeviceCode).collect(Collectors.toList());
                    int index = mainDeviceNames.indexOf(mainDeviceName);
                    if ((index == -1 && mainDeviceCodes.contains(mainDeviceCode)) || (index != -1 && !StrUtil.equals(mainDeviceCodes.get(index), mainDeviceCode))) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + mainDeviceCodeIndex, "主设备编码已存在");
                    } else {
                        if (!mainDeviceNameList.contains(mainDeviceName)) {
                            if (mainDeviceCodeList.contains(mainDeviceCode)) {
                                errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + mainDeviceCodeIndex, "主设备编码已存在");
                            }
                        }
                    }
                }
            } else {
                List<String> mainDeviceCodeByNameList = deviceMainList.stream().filter(m -> StrUtil.equals(m.getVoltName(), voltName) &&
                        StrUtil.equals(m.getBayName(), bayName) && StrUtil.equals(m.getMainDeviceName(), mainDeviceName)).map(DeviceMain::getMainDeviceCode).collect(Collectors.toList());
                if (CollUtil.isNotEmpty(mainDeviceCodeByNameList) && StrUtil.isNotBlank(mainDeviceCodeByNameList.get(DigitalConstant.ZERO))) {
                    mainDeviceCode = mainDeviceCodeByNameList.get(DigitalConstant.ZERO);
                } else {
                    mainDeviceCode = AutoGenerateUtils.numOrLowercaseStr(DigitalConstant.THIRTY_TWO);
                }
            }
            mainDeviceCodes.add(mainDeviceCode);
            mainDeviceNames.add(mainDeviceName);
            pointExcelBO.setMainDeviceCode(mainDeviceCode);

            // 校验部件名称
            if (StrUtil.isBlank(componentName)) {
                errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + componentNameIndex, "部件名称必填");
            } else {
                Boolean componentNameCheckResult = RegxUtils.checkDeviceTreeNodeName(componentName);
                if (!componentNameCheckResult) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + componentNameIndex, "部件名称：长度为2-50位的字符，可输入中文 大小写字母 数字 罗马数字 、. # _ - ( ) （ ），且不以_result结尾");
                } else {
                    String componentNameAllPath = facName + voltName + bayName + mainDeviceName + componentName;
                    if (checkNameRepeat(componentNameAllPath, componentNamesAllPath)) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + componentNameIndex, "同一主设备下部件名称不能重复");
                    } else {
                        pointExcelBO.setComponentName(componentName);
                    }
                }
            }

            // 校验部件编码
            if (StrUtil.isNotBlank(componentCode)) {
                boolean checkCode = Pattern.compile(RegxUtils.CODE_REGEX_STR).matcher(componentCode).matches();
                if (!checkCode) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + componentCodeIndex, "只能输入1-64位数字、字母（大小写）、英文特殊字符（!、@、#、$、%、^、&、*、_、-）");
                } else {
                    List<String> componentNameList = deviceComponentList.stream().filter(c -> StrUtil.equals(c.getVoltName(), voltName) &&
                            StrUtil.equals(c.getBayName(), bayName) && StrUtil.equals(c.getMainDeviceName(), mainDeviceName)).map(DeviceComponent::getComponentName).collect(Collectors.toList());
                    List<String> componentCodeList = deviceComponentList.stream().map(DeviceComponent::getComponentCode).collect(Collectors.toList());
                    int index = componentNames.indexOf(componentName);
                    if ((index == -1 && componentCodes.contains(componentCode)) || (index != -1 && !StrUtil.equals(componentCodes.get(index), componentCode))) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + componentCodeIndex, "部件编码已存在");
                    } else {
                        if (!componentNameList.contains(componentName)) {
                            if (componentCodeList.contains(componentCode)) {
                                errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + componentCodeIndex, "部件编码已存在");
                            }
                        }
                    }
                }
            } else {
                List<String> componentCodeByNameList = deviceComponentList.stream().filter(c -> StrUtil.equals(c.getVoltName(), voltName) &&
                        StrUtil.equals(c.getBayName(), bayName) && StrUtil.equals(c.getMainDeviceName(), mainDeviceName) &&
                        StrUtil.equals(c.getComponentName(), componentName)).map(DeviceComponent::getComponentCode).collect(Collectors.toList());
                if (CollUtil.isNotEmpty(componentCodeByNameList) && StrUtil.isNotBlank(componentCodeByNameList.get(DigitalConstant.ZERO))) {
                    componentCode = componentCodeByNameList.get(DigitalConstant.ZERO);
                } else {
                    componentCode = AutoGenerateUtils.numOrLowercaseStr(DigitalConstant.THIRTY_TWO);
                }
            }
            componentCodes.add(componentCode);
            componentNames.add(componentName);
            pointExcelBO.setComponentCode(componentCode);

            // 校验巡视类型
            if (CollUtil.isEmpty(recTypeList)) {
                return;
            }
            if ((recTypeList.contains(RecTypeEnum.METER.getType().toString()) && Objects.isNull(meterType)) ||
                    (recTypeList.contains(RecTypeEnum.POSITION.getType().toString()) && Objects.isNull(positionStateType))) {
                return;
            }
            List<Integer> inspectionSubTypeList = new ArrayList<>();
            if (StrUtil.isNotBlank(inspectionType1)) {
                Integer inspectionSubType = InspectionTypeEnum.getCodeByDesc(inspectionType1);
                if (Objects.isNull(inspectionSubType)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + inspectionType1Index, "巡视类型1不存在");
                } else {
                    boolean isLegal = InspectionTypeEnum.isMatches(recTypeList, meterType, positionStateType, inspectionSubType);
                    if (!isLegal) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + inspectionType1Index, "巡视类型1与识别类型不匹配");
                    } else {
                        inspectionSubTypeList.add(inspectionSubType);
                    }
                }
            }
            if (StrUtil.isNotBlank(inspectionType2)) {
                Integer inspectionSubType = InspectionTypeEnum.getCodeByDesc(inspectionType2);
                if (Objects.isNull(inspectionSubType)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + inspectionType2Index, "巡视类型2不存在");
                } else {
                    boolean isLegal = InspectionTypeEnum.isMatches(recTypeList, meterType, positionStateType, inspectionSubType);
                    if (!isLegal) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + inspectionType2Index, "巡视类型2与识别类型不匹配");
                    } else {
                        inspectionSubTypeList.add(inspectionSubType);
                    }
                }
            }
            if (StrUtil.isNotBlank(inspectionType3)) {
                Integer inspectionSubType = InspectionTypeEnum.getCodeByDesc(inspectionType3);
                if (Objects.isNull(inspectionSubType)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + inspectionType3Index, "巡视类型3不存在");
                } else {
                    boolean isLegal = InspectionTypeEnum.isMatches(recTypeList, meterType, positionStateType, inspectionSubType);
                    if (!isLegal) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + inspectionType3Index, "巡视类型3与识别类型不匹配");
                    } else {
                        inspectionSubTypeList.add(inspectionSubType);
                    }
                }
            }
            if (StrUtil.isNotBlank(inspectionType4)) {
                Integer inspectionSubType = InspectionTypeEnum.getCodeByDesc(inspectionType4);
                if (Objects.isNull(inspectionSubType)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + inspectionType4Index, "巡视类型4不存在");
                } else {
                    boolean isLegal = InspectionTypeEnum.isMatches(recTypeList, meterType, positionStateType, inspectionSubType);
                    if (!isLegal) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + inspectionType4Index, "巡视类型4与识别类型不匹配");
                    } else {
                        inspectionSubTypeList.add(inspectionSubType);
                    }
                }
            }
            if (StrUtil.isNotBlank(inspectionType5)) {
                Integer inspectionSubType = InspectionTypeEnum.getCodeByDesc(inspectionType5);
                if (Objects.isNull(inspectionSubType)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + inspectionType5Index, "巡视类型5不存在");
                } else {
                    boolean isLegal = InspectionTypeEnum.isMatches(recTypeList, meterType, positionStateType, inspectionSubType);
                    if (!isLegal) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + inspectionType5Index, "巡视类型5与识别类型不匹配");
                    } else {
                        inspectionSubTypeList.add(inspectionSubType);
                    }
                }
            }
            if (StrUtil.isNotBlank(inspectionType6)) {
                Integer inspectionSubType = InspectionTypeEnum.getCodeByDesc(inspectionType6);
                if (Objects.isNull(inspectionSubType)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + inspectionType6Index, "巡视类型6不存在");
                } else {
                    boolean isLegal = InspectionTypeEnum.isMatches(recTypeList, meterType, positionStateType, inspectionSubType);
                    if (!isLegal) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + inspectionType6Index, "巡视类型6与识别类型不匹配");
                    } else {
                        inspectionSubTypeList.add(inspectionSubType);
                    }
                }
            }
            if (StrUtil.isNotBlank(inspectionType7)) {
                Integer inspectionSubType = InspectionTypeEnum.getCodeByDesc(inspectionType7);
                if (Objects.isNull(inspectionSubType)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + inspectionType7Index, "巡视类型7不存在");
                } else {
                    boolean isLegal = InspectionTypeEnum.isMatches(recTypeList, meterType, positionStateType, inspectionSubType);
                    if (!isLegal) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + inspectionType7Index, "巡视类型7与识别类型不匹配");
                    } else {
                        inspectionSubTypeList.add(inspectionSubType);
                    }
                }
            }
            if (StrUtil.isNotBlank(inspectionType8)) {
                Integer inspectionSubType = InspectionTypeEnum.getCodeByDesc(inspectionType8);
                if (Objects.isNull(inspectionSubType)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + inspectionType8Index, "巡视类型8不存在");
                } else {
                    boolean isLegal = InspectionTypeEnum.isMatches(recTypeList, meterType, positionStateType, inspectionSubType);
                    if (!isLegal) {
                        errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + inspectionType8Index, "巡视类型8与识别类型不匹配");
                    } else {
                        inspectionSubTypeList.add(inspectionSubType);
                    }
                }
            }
            pointExcelBO.setInspectionSubType(StrUtil.join(StrUtil.COMMA, inspectionSubTypeList.stream().distinct().collect(Collectors.toList())));
            if (MapUtil.isEmpty(errorMessageMap)) {
                tourPointExcelList.add(pointExcelBO);
            }
        }
    }

    private DeviceVoltage insertOrUpdateVoltage(Map<String, DeviceVoltage> voltUniquenessName2VoltageMap, FacInfo facInfo, String voltageName, String voltCode) {
        DeviceVoltage deviceVoltage = voltUniquenessName2VoltageMap.get(voltageName);
        if (Objects.nonNull(deviceVoltage)) {
            deviceVoltage.setUpdateBy(SecurityUtils.getUsername());
            deviceVoltage.setUpdateTime(LocalDateTime.now());
            if (StrUtil.isBlank(voltCode)) {
                voltCode = generateRandomString(voltageName, 5);
            }
            deviceVoltage.setVoltCode(voltCode);
            deviceVoltageService.updateById(deviceVoltage);
        } else {
            devicePropertyService.saveVoltageIfNecessary(voltageName);
            redisTemplate.delete(RedisConstants.DEVICE_PROPERTY);
            deviceVoltage = DeviceVoltage.builder()
                    .voltName(voltageName)
                    .voltCode(StrUtil.isNotBlank(voltCode) ? voltCode : cn.hutool.core.lang.UUID.randomUUID().toString())
                    .alarmLevel(AlarmLevelEnum.NORMAL.getValue())
                    .stationId(facInfo.getId())
                    .stationName(facInfo.getStationName())
                    .stationCode(facInfo.getOutStationCode())
                    .createBy(SecurityUtils.getUsername())
                    .createTime(LocalDateTime.now())
                    .updateBy(SecurityUtils.getUsername())
                    .updateTime(LocalDateTime.now())
                    .build();
            deviceVoltageService.save(deviceVoltage);
        }
        voltUniquenessName2VoltageMap.put(voltageName, deviceVoltage);
        return deviceVoltage;
    }

    private DeviceBay insertOrUpdateBay(Map<String, DeviceBay> bayUniquenessName2BayMap, DeviceVoltage deviceVoltage, String bayName, String bayType, String bayCode) {
        DeviceBay deviceBay = bayUniquenessName2BayMap.get(deviceVoltage.getVoltName() + StrUtil.UNDERLINE + bayName);
        if (Objects.nonNull(deviceBay)) {
            deviceBay.setBayType(bayType);
            deviceBay.setUpdateTime(LocalDateTime.now());
            if (StrUtil.isBlank(bayCode)) {
                bayCode = generateRandomString(bayName, 4);
            }
            deviceBay.setBayCode(bayCode);
            deviceBay.setUpdateBy(SecurityUtils.getUsername());
            deviceBayService.updateById(deviceBay);
        } else {
            deviceBay = DeviceBay.builder()
                    .bayType(bayType)
                    .bayName(bayName)
                    .bayCode(StrUtil.isNotBlank(bayCode) ? bayCode : cn.hutool.core.lang.UUID.randomUUID().toString())
                    .alarmLevel(AlarmLevelEnum.NORMAL.getValue())
                    .voltId(deviceVoltage.getId())
                    .voltName(deviceVoltage.getVoltName())
                    .voltCode(deviceVoltage.getVoltCode())
                    .stationId(deviceVoltage.getStationId())
                    .stationName(deviceVoltage.getStationName())
                    .stationCode(deviceVoltage.getStationCode())
                    .createBy(SecurityUtils.getUsername())
                    .createTime(LocalDateTime.now())
                    .updateBy(SecurityUtils.getUsername())
                    .updateTime(LocalDateTime.now())
                    .build();
            deviceBayService.save(deviceBay);
        }
        bayUniquenessName2BayMap.put(deviceVoltage.getVoltName() + StrUtil.UNDERLINE + bayName, deviceBay);
        return deviceBay;
    }

    private DeviceMain insertOrUpdateMain(Map<String, DeviceMain> mainUniquenessName2MainMap, DeviceBay deviceBay, String mainDeviceName, Integer mainDeviceType, Integer phaseType, String mainDeviceCode) {
        String uniquenessName = deviceBay.getVoltName() + StrUtil.UNDERLINE + deviceBay.getBayName() + StrUtil.UNDERLINE + mainDeviceName;
        DeviceMain deviceMain = mainUniquenessName2MainMap.get(uniquenessName);
        if (Objects.nonNull(deviceMain)) {
            deviceMain.setMainDeviceType(mainDeviceType);
            deviceMain.setPhaseType(phaseType);
            if (StrUtil.isBlank(mainDeviceCode)) {
                mainDeviceCode = generateRandomString(mainDeviceName, 3);
            }
            deviceMain.setMainDeviceCode(mainDeviceCode);
            deviceMain.setUpdateTime(LocalDateTime.now());
            deviceMain.setUpdateBy(SecurityUtils.getUsername());
            deviceMainService.updateById(deviceMain);
        } else {
            deviceMain = DeviceMain.builder()
                    .mainDeviceType(mainDeviceType)
                    .mainDeviceName(mainDeviceName)
                    .mainDeviceCode(StrUtil.isNotBlank(mainDeviceCode) ? mainDeviceCode : cn.hutool.core.lang.UUID.randomUUID().toString())
                    .phaseType(phaseType)
                    .threePhaseFlag(CommonConstants.NON_THREE_PHASE_FLAG)
                    .alarmLevel(AlarmLevelEnum.NORMAL.getValue())
                    .bayId(deviceBay.getId())
                    .bayType(deviceBay.getBayType())
                    .bayName(deviceBay.getBayName())
                    .bayCode(deviceBay.getBayCode())
                    .voltId(deviceBay.getVoltId())
                    .voltName(deviceBay.getVoltName())
                    .voltCode(deviceBay.getVoltCode())
                    .stationId(deviceBay.getStationId())
                    .stationName(deviceBay.getStationName())
                    .stationCode(deviceBay.getStationCode())
                    .createBy(SecurityUtils.getUsername())
                    .createTime(LocalDateTime.now())
                    .updateBy(SecurityUtils.getUsername())
                    .updateTime(LocalDateTime.now())
                    .build();
            deviceMainService.save(deviceMain);
        }
        mainUniquenessName2MainMap.put(uniquenessName, deviceMain);
        return deviceMain;
    }

    private DeviceComponent insertOrUpdateComponent(Map<String, DeviceComponent> componentUniquenessName2ComponentMap, DeviceMain deviceMain, String componentName, String componentType, String componentCode) {
        String uniquenessName = deviceMain.getVoltName() + StrUtil.UNDERLINE + deviceMain.getBayName() + StrUtil.UNDERLINE + deviceMain.getMainDeviceName() + StrUtil.UNDERLINE + componentName;
        DeviceComponent deviceComponent = componentUniquenessName2ComponentMap.get(uniquenessName);
        if (Objects.nonNull(deviceComponent)) {
            deviceComponent.setComponentType(componentType);
            if (StrUtil.isBlank(componentCode)) {
                componentCode = generateRandomString(componentName, 2);
            }
            deviceComponent.setComponentCode(componentCode);
            deviceComponent.setUpdateTime(LocalDateTime.now());
            deviceComponent.setUpdateBy(SecurityUtils.getUsername());
            deviceComponentService.updateById(deviceComponent);
        } else {
            deviceComponent = DeviceComponent.builder()
                    .componentName(componentName)
                    .componentType(componentType)
                    .componentCode(StrUtil.isNotBlank(componentCode) ? componentCode : cn.hutool.core.lang.UUID.randomUUID().toString())
                    .alarmLevel(AlarmLevelEnum.NORMAL.getValue())
                    .mainDeviceId(deviceMain.getId())
                    .mainDeviceType(deviceMain.getMainDeviceType())
                    .mainDeviceName(deviceMain.getMainDeviceName())
                    .mainDeviceCode(deviceMain.getMainDeviceCode())
                    .phaseType(deviceMain.getPhaseType())
                    .bayId(deviceMain.getBayId())
                    .bayType(deviceMain.getBayType())
                    .bayName(deviceMain.getBayName())
                    .bayCode(deviceMain.getBayCode())
                    .voltId(deviceMain.getVoltId())
                    .voltName(deviceMain.getVoltName())
                    .voltCode(deviceMain.getVoltCode())
                    .stationId(deviceMain.getStationId())
                    .stationName(deviceMain.getStationName())
                    .stationCode(deviceMain.getStationCode())
                    .createBy(SecurityUtils.getUsername())
                    .createTime(LocalDateTime.now())
                    .updateBy(SecurityUtils.getUsername())
                    .updateTime(LocalDateTime.now())
                    .build();
            deviceComponentService.save(deviceComponent);
        }
        componentUniquenessName2ComponentMap.put(uniquenessName, deviceComponent);
        return deviceComponent;
    }

    private void insertOrUpdateLocalPoint(DevicePoint devicePoint, List<DevicePoint> devicePointList, DeviceComponent deviceComponent, PointExcelBO pointExcelBO) {
//		List<DevicePoint> devicePoints = devicePointList.stream().filter(p -> StrUtil.equals(p.getPointCode(), pointExcelBO.getPointCode())).collect(Collectors.toList());

        Integer recType1 = pointExcelBO.getRecType1();
        Integer recType2 = pointExcelBO.getRecType2();
        List<String> recTypeList = new ArrayList<>();
        if (Objects.nonNull(recType1)) {
            recTypeList.add(String.valueOf(recType1));
        }
        if (Objects.nonNull(recType2)) {
            recTypeList.add(String.valueOf(recType2));
        }
        String recType = recTypeList.stream().distinct().collect(Collectors.joining(StrUtil.COMMA));
        if (Objects.nonNull(devicePoint)) {
            //重复，删除后插入
            this.removeById(devicePoint.getId());
        }
        devicePoint = DevicePoint.builder()
                .pointName(pointExcelBO.getPointName())
                .pointCode(StringUtils.isNotBlank(pointExcelBO.getPointCode()) ? pointExcelBO.getPointCode() : generateRandomString(pointExcelBO.getPointName(), 1))
                .alarmLevel(AlarmLevelEnum.NORMAL.getValue())
                .recognitionTypeList(recType)
                .robotName(pointExcelBO.getRobotName())
                .robotId(pointExcelBO.getRobotId())
                .cruiseId(DeviceUtils.generateCruiseId())
                .saveTypeList(pointExcelBO.getCollectType())
                .meterType(pointExcelBO.getMeterType())
                .positionStateType(pointExcelBO.getPositionStateType())
                .appearanceType(AssistFacilityTypeEnum.ELECTRIC_FENCE.getType())
                .defectRecType(pointExcelBO.getDefectRecType())
                .defectJudgeType(CommonConstants.NON_DEFECT_JUDGE)
                .threePhaseFlag(CommonConstants.NON_THREE_PHASE_FLAG)
                .demarcateState(CommonConstants.NON_DEMARCATE)
                .componentId(deviceComponent.getId())
                .componentType(deviceComponent.getComponentType())
                .importantLevel(pointExcelBO.getImportantLevel())
                .componentName(deviceComponent.getComponentName())
                .componentCode(deviceComponent.getComponentCode())
                .mainDeviceId(deviceComponent.getMainDeviceId())
                .mainDeviceType(deviceComponent.getMainDeviceType())
                .mainDeviceName(deviceComponent.getMainDeviceName())
                .mainDeviceCode(deviceComponent.getMainDeviceCode())
                .phaseType(deviceComponent.getPhaseType())
                .bayId(deviceComponent.getBayId())
                .bayType(deviceComponent.getBayType())
                .bayName(deviceComponent.getBayName())
                .bayCode(deviceComponent.getBayCode())
                .voltId(deviceComponent.getVoltId())
                .voltName(deviceComponent.getVoltName())
                .voltCode(deviceComponent.getVoltCode())
                .stationId(deviceComponent.getStationId())
                .stationName(deviceComponent.getStationName())
                .stationCode(deviceComponent.getStationCode())
                .createBy(SecurityUtils.getUsername())
                .createTime(LocalDateTime.now())
                .updateBy(SecurityUtils.getUsername())
                .updateTime(LocalDateTime.now())
                .inspectionSubType(pointExcelBO.getInspectionSubType())
                .build();
        this.save(devicePoint);

        // 自动关联三项点位
        autoBindThreePhasePoint(pointExcelBO.getPointName(), deviceComponent.getBayId());
    }

    /**
     * 自动关联三项点位
     *
     * @param pointName 点位名称
     */
    private void autoBindThreePhasePoint(String pointName, Long bayId) {
        if (StrUtil.isEmpty(pointName)) {
            return;
        }
        List<DevicePoint> devicePointList = this.getBaseMapper().selectList(Wrappers.<DevicePoint>lambdaQuery().in(DevicePoint::getPointName, allPhaseName(pointName)).eq(DevicePoint::getBayId, bayId));
        if (CollUtil.isNotEmpty(devicePointList)) {
            List<Long> pointIds = devicePointList.stream().map(DevicePoint::getId).collect(Collectors.toList());
            try {
                this.bindThreePhasePoint(DevicePointDTO.builder().devicePointIdList(pointIds).build());
            } catch (Exception e) {
                log.error("自动关联三项点位【{}】异常！{}", pointName, e.getMessage());
            }
        }
    }


    /**
     * 给定一个相位名称，返回所有相位名称
     *
     * @param pointName 点位名称
     */
    public static List<String> allPhaseName(String pointName) {
        String A = pointName.replaceAll("([A-C]相)(?!.*[A-C]相)", PhaseTypeEnum.PHASE_A.getDescription());
        String B = A.replaceAll("(A相)(?!.*[A-C]相)", PhaseTypeEnum.PHASE_B.getDescription());
        String C = B.replaceAll("(B相)(?!.*[A-C]相)", PhaseTypeEnum.PHASE_C.getDescription());
        return Arrays.asList(A, B, C);
    }

    private void batchDistributePoint(List<Map> dataList, String operationId) {
        log.info("点表下发到机器人本体");
        for (Map<String, Object> facMap : dataList) {
            String stationCode = Objects.toString(facMap.get("fac_id"));
            String robotCode = Objects.toString(facMap.get("robot_code"));
            FacInfo facInfo = facInfoService.getOne(new LambdaQueryWrapper<FacInfo>()
                    .eq(FacInfo::getStationCode, stationCode));
            Robot robot = robotService.getOne(new LambdaQueryWrapper<Robot>()
                    .eq(Robot::getRobotCode, robotCode));
            distributePoint(facInfo.getId(), robot.getId());
            WebSocketUtils.sendMessageByWsMonitor(WebSocketConstants.BasicAccountImportWebsocket.AUTOMATED_DEPLOYMENT,
                    WebSocketConstants.BasicAccountImportWebsocket.DISTRIBUTE_POINT,
                    JSONObject.toJSONString(operationId));

        }
    }


    private void batchSyncCalibratePoint(List<Map> dataList, String operationId) {
        List<String> caliKeys = new ArrayList<>();
        log.info("数据大小", dataList.size());
        //从机器人本体获取标定数据
        for (Map<String, Object> facMap : dataList) {
            log.info("从机器人本体获取标定数据");
            String stationCode = Objects.toString(facMap.get("fac_id"));
            String robotCode = Objects.toString(facMap.get("robot_code"));
            R<String> stringR = synCalibratePoint(stationCode, robotCode, 1);
            if (!stringR.isSuccess()) {
                throw new RobotException("从机器人本体获取标定数据,stationCode:" + stationCode + "robotCode:" + robotCode);
            }
            if (StringUtils.isNotBlank(stringR.getData())) {
                caliKeys.add(stringR.getData());
            }
        }
        if (CollectionUtils.isNotEmpty(caliKeys)) {
            waitUntilSyncIsOver(caliKeys, operationId);
        } else {
            throw new RobotException("从机器人本体获取标定数据失败");
        }
    }


    private void waitUntilSyncIsOver(List<String> caliKeys, String operationId) {
        //阻塞主线程直到标定数据同步结束
        CountDownLatch latch = new CountDownLatch(1);
        ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
        scheduler.scheduleAtFixedRate(() -> {
            try {
                List<Boolean> isExist = new ArrayList<>();
                caliKeys.forEach(key -> {
                    List<String> calibratedPoints = redisTemplate.opsForList().range(key, 0, -1);
                    log.info("calibratedPoints,{}", calibratedPoints);
                    //key还存在则代表同步未完成
                    if (CollectionUtils.isNotEmpty(calibratedPoints)) {
                        isExist.add(true);
                    }
                });
                if (CollectionUtils.isEmpty(isExist)) {
                    log.info("标定信息同步完成");
                    WebSocketUtils.sendMessageByWsMonitor(WebSocketConstants.BasicAccountImportWebsocket.AUTOMATED_DEPLOYMENT,
                            WebSocketConstants.BasicAccountImportWebsocket.SYNC_CALIBRATE_POINT,
                            JSONObject.toJSONString(operationId));
                    latch.countDown();
                }
            } catch (Exception e) {
                log.error(e.getMessage());
            }
        }, 0, 3, TimeUnit.SECONDS);

        try {
            latch.await(30, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            log.info(e.getMessage());
        } finally {
            scheduler.shutdown();
        }
    }

    private void modelSync(String operationId) {
        log.info("模型同步到图像系统");
        R<Boolean> booleanR = analysisMachineInfoService.syncModelToCbv();
        if (!booleanR.isSuccess()) {
            throw new RobotException("模型同步到图像系统失败");
        }
        WebSocketUtils.sendMessageByWsMonitor(WebSocketConstants.BasicAccountImportWebsocket.AUTOMATED_DEPLOYMENT,
                WebSocketConstants.BasicAccountImportWebsocket.MODEL_SYNC,
                JSONObject.toJSONString(operationId));
    }

    private void quickTaskCreate(List<Map> dataList, String operationId) {
        log.info("后台标准任务创建");
        for (Map<String, Object> facMap : dataList) {
            String stationCode = Objects.toString(facMap.get("fac_id"));
            FacInfo facInfo = facInfoService.getOne(new LambdaQueryWrapper<FacInfo>()
                    .eq(FacInfo::getStationCode, stationCode));
            boolean b = taskService.quickAddTask(facInfo.getId());
            WebSocketUtils.sendMessageByWsMonitor(WebSocketConstants.BasicAccountImportWebsocket.AUTOMATED_DEPLOYMENT,
                    WebSocketConstants.BasicAccountImportWebsocket.TASK_CREATE,
                    JSONObject.toJSONString(operationId));
            if (!b) {
                throw new RuntimeException("后台标准任务创建失败facInfo:" + facInfo);
            }
        }
    }

    private String generateRandomString(String deviceName, Integer deviceType) {

        switch (deviceType) {
            case 1:
                String pointCode = pointCodeMap.get(deviceName);
                if (StringUtils.isBlank(pointCode)) {
                    pointCode = UUID.randomUUID().toString().replace("-", "").substring(0, 32);
                    pointCodeMap.put(deviceName, pointCode);
                }
                return pointCode;

            case 2:
                String componentCode = componentCodeMap.get(deviceName);
                if (StringUtils.isBlank(componentCode)) {
                    componentCode = UUID.randomUUID().toString().replace("-", "").substring(0, 32);
                    componentCodeMap.put(deviceName, componentCode);
                }
                return componentCode;

            case 3:
                String mainDeviceCode = mainDeviceCodeMap.get(deviceName);
                if (StringUtils.isBlank(mainDeviceCode)) {
                    mainDeviceCode = UUID.randomUUID().toString().replace("-", "").substring(0, 32);
                    mainDeviceCodeMap.put(deviceName, mainDeviceCode);
                }
                return mainDeviceCode;

            case 4:
                String bayCode = bayCodeMap.get(deviceName);
                if (StringUtils.isBlank(bayCode)) {
                    bayCode = UUID.randomUUID().toString().replace("-", "").substring(0, 32);
                    bayCodeMap.put(deviceName, bayCode);
                }
                return bayCode;

            case 5:
                String voltCode = voltCodeMap.get(deviceName);
                if (StringUtils.isBlank(voltCode)) {
                    voltCode = UUID.randomUUID().toString().replace("-", "").substring(0, 32);
                    voltCodeMap.put(deviceName, voltCode);
                }
                return voltCode;
        }
        return UUID.randomUUID().toString().replace("-", "").substring(0, 32);
    }

    private boolean checkNameRepeat(String deviceNameAllPath, List<String> hasExistNames) {
        return hasExistNames.contains(deviceNameAllPath);
    }


    private String buildPointTagsNameList(String pointTagsCodeList, List<PointTags> pointTagsListInDb) {
        List<String> pointTagsNameList = new ArrayList<>();

        if (StringUtils.isBlank(pointTagsCodeList) || CollectionUtils.isEmpty(pointTagsListInDb)) {
            return "";
        }

        String[] split = pointTagsCodeList.split(StrUtil.COMMA);
        for (String pointTagsCode : split) {
            List<PointTags> pointTagsListByCode = pointTagsListInDb.stream().filter(pointTags -> pointTagsCode.equals(pointTags.getTagsCode())).collect(Collectors.toList());
            if (CollectionUtils.isNotEmpty(pointTagsListByCode)) {
                pointTagsNameList.add(pointTagsListByCode.get(0).getTagsName());
            }
        }
        return String.join(StrUtil.COMMA, pointTagsNameList);
    }

    /**
     * 校验点位Excel的数据
     */
    private void checkUpdatePointExcelData(List<DevicePoint> devicePointList, List<Map<String, Object>> excelMapList, Map<String, String> errorMessageMap, List<UpdatePointExcelBO> updatePointExcelBOList) {
        // 读取excel中单行的数据信息
        Map<String, Object> lineDataMap;

        List<String> allPointNameList = devicePointList.stream().map(DevicePoint::getPointName).collect(Collectors.toList());

        // excel文件中数据
        List<String> excelAllSystemPointNameList = new ArrayList<>();
        List<String> excelAllUpdatePointNameList = new ArrayList<>();
        for (int i = 0; i < excelMapList.size(); i++) {
            lineDataMap = excelMapList.get(i);
            excelAllSystemPointNameList.add(Objects.toString(lineDataMap.get(UpdateLocalPointExcelEnum.SYSTEM_POINT_NAME.getDesc()), StrUtil.EMPTY));
            excelAllUpdatePointNameList.add(Objects.toString(lineDataMap.get(UpdateLocalPointExcelEnum.UPDATE_POINT_NAME.getDesc()), StrUtil.EMPTY));
        }

        // 校验数据
        // 系统点位名称：必填校验、数据格式校验、excel中唯一性校验、在系统中唯一性校验、点位在系统中不存在校验
        // 更新点位名称：必填校验、数据格式校验
        for (int i = 0; i < excelMapList.size(); i++) {
            lineDataMap = excelMapList.get(i);
            int rowIndex = i + DigitalConstant.TWO;
            String systemPointName = Objects.toString(lineDataMap.get(UpdateLocalPointExcelEnum.SYSTEM_POINT_NAME.getDesc()), StrUtil.EMPTY);
            String updatePointName = Objects.toString(lineDataMap.get(UpdateLocalPointExcelEnum.UPDATE_POINT_NAME.getDesc()), StrUtil.EMPTY);

            int systemPointNameIndex = UpdateLocalPointExcelEnum.SYSTEM_POINT_NAME.getIndex();
            int updatePointNameIndex = UpdateLocalPointExcelEnum.UPDATE_POINT_NAME.getIndex();

            // 封装表格中的点位数据
            UpdatePointExcelBO updatePointExcelBO = UpdatePointExcelBO.builder().build();

            // 校验系统点位名称
            if (StrUtil.isBlank(systemPointName)) {
                if (StrUtil.isNotBlank(updatePointName)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + systemPointNameIndex, "系统点位名称必填");
                }
            } else {
                Boolean systemPointNameCheckResult = RegxUtils.checkDeviceTreeNodeName(systemPointName);
                if (!systemPointNameCheckResult) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + systemPointNameIndex, "点位名称：长度为2-50位的字符，可输入中文 大小写字母 数字 罗马数字 、. # _ - ( ) （ ），且不以_result结尾");
                } else if (hasElementMultiple(allPointNameList, systemPointName)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + systemPointNameIndex, "点位名称在系统中已经存在多个");
                } else if (!allPointNameList.contains(systemPointName)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + systemPointNameIndex, "点位名称在系统中不存在");
                } else {
                    updatePointExcelBO.setSystemPointName(systemPointName);
                }
            }

            // 校验更新点位名称
            if (StrUtil.isBlank(updatePointName)) {
                if (StrUtil.isNotBlank(systemPointName)) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + updatePointNameIndex, "更新点位名称必填");
                }
            } else {
                Boolean systemPointNameCheckResult = RegxUtils.checkDeviceTreeNodeName(updatePointName);
                if (!systemPointNameCheckResult) {
                    errorMessageMap.put(rowIndex + StrUtil.UNDERLINE + updatePointNameIndex, "点位名称：长度为2-50位的字符，可输入中文 大小写字母 数字 罗马数字 、. # _ - ( ) （ ），且不以_result结尾");
                } else {
                    updatePointExcelBO.setUpdatePointName(updatePointName);
                }
            }

            if (StringUtils.isNotBlank(updatePointExcelBO.getSystemPointName()) && StringUtils.isNotBlank(updatePointExcelBO.getUpdatePointName())) {
                updatePointExcelBOList.add(updatePointExcelBO);
            }
        }
    }

    /**
     * 判断是否出现多次
     *
     * @param pointNameList
     * @param element
     * @return
     */
    private boolean hasElementMultiple(List<String> pointNameList, String element) {
        long count = pointNameList.stream()
                .filter(element::equals)
                .count();
        return count > 1;
    }

    /**
     * 标定同步业务可能超时或因一些其他原因导致结束不了，60分钟后自动结束
     */
    public void cancelCalibrationScheduledTask(String stationCode, String robotCode, ScheduledExecutorService scheduledExecutorService, String operateI) {
        scheduledExecutorService.schedule(() -> {
            try {
                if (redisTemplate.hasKey(RedisConstants.SYNC_CALIBRATE_POINT_LIST + operateI)){
                    log.info("60分钟自动结束标定同步申请缓存，标定同步任务取消操作，操作ID:{} KEY:{}", operateI, RedisConstants.SYNC_CALIBRATE_POINT_LIST + operateI);
                    devicePointService.finishSyncPoint(stationCode, robotCode);
                }
            } catch (Exception e) {
                log.error(ExceptionUtils.getStackTrace(e));
            } finally {
                scheduledExecutorService.shutdown();
            }
        }, 60, TimeUnit.MINUTES);
    }

    private void exportPointCalibrationFile(List<PointCalibrationExcelBO> pointCalibrationExcelBOList, String stationName, HttpServletResponse response) {
        int imgPathMaxSize = pointCalibrationExcelBOList.stream().filter(t -> CollUtil.isNotEmpty(t.getImgPathList()) && t.getImgPathList().size() > 0)
                .map(t -> t.getImgPathList().size()).max(Integer::compareTo).orElse(1);
        List<List<String>> titleList = new ArrayList<>();
        titleList.add(Lists.newArrayList("点位名称"));
        titleList.add(Lists.newArrayList("部件名称"));
        titleList.add(Lists.newArrayList("主设备名称"));
        titleList.add(Lists.newArrayList("间隔名称"));
        titleList.add(Lists.newArrayList("电压区域"));
        titleList.add(Lists.newArrayList("是否标定"));
        titleList.add(Lists.newArrayList("识别类型1"));
        titleList.add(Lists.newArrayList("识别类型2"));
        titleList.add(Lists.newArrayList("表计类型"));
        titleList.add(Lists.newArrayList("位置状态类型"));
        titleList.add(Lists.newArrayList("重要等级"));
        for (int i = 1; i <= imgPathMaxSize; i++) {
            titleList.add(Lists.newArrayList("标定图片" + i));
        }
        List<List<PointCalibrationExcelBO>> splitList = CollUtil.split(pointCalibrationExcelBOList, 3000);
        if (CollUtil.isEmpty(splitList)) {
            splitList.add(new ArrayList<>());
        }
        String excelDirPath = FilePathManagerUtil.getDockerPathBySystemPath("/excel/");
        File excelDir = new File(excelDirPath);
        if (!excelDir.exists()) {
            excelDir.mkdirs();
        }
        List<String> filePathList = new ArrayList<>();
        for (int i = 0; i < splitList.size(); i++) {
            filePathList.add(generateCalibrationExcel(splitList, i, imgPathMaxSize, titleList, stationName, excelDirPath));
        }
        filePathList = filePathList.stream().filter(Objects::nonNull).collect(Collectors.toList());
        String zipFileName = stationName + StrUtil.UNDERLINE + DateUtil.format(new Date(), DatePattern.PURE_DATETIME_PATTERN) + ".zip";
        String zipFilePath = excelDirPath + zipFileName;
        compressFiles(filePathList, zipFilePath);
        ResponseUtils.response(response, zipFilePath, zipFileName);
    }


    private String generateCalibrationExcel(List<List<PointCalibrationExcelBO>> splitList, int i, int imgPathMaxSize, List<List<String>> titleList, String stationName, String excelDirPath) {
        try {
            List<PointCalibrationExcelBO> pointCalibrationExcelBOS = splitList.get(i);
            List<List<Object>> columnList = pointCalibrationExcelBOS.stream().map(t -> {
                List<String> imgPathList = t.getImgPathList();
                List<Object> rowList = Lists.newArrayList(t.getPointName(), t.getComponentName(), t.getMainDeviceName(), t.getBayName(),
                        t.getVoltName(), t.getIsDemarcate(), t.getRecType1(), t.getRecType2(), t.getMeterType(), t.getPositionStateType(), t.getImportantLevel());
                for (int j = 0; j < imgPathMaxSize; j++) {
                    if (CollUtil.size(imgPathList) > j) {
                        if (StringUtils.isNotBlank(imgPathList.get(j))){
                            File file = new File(FilePathManagerUtil.getDockerPathByStaticPath(imgPathList.get(j)));
                            if (file.exists()) {
                                rowList.add(file);
                            }
                        }
                    }
                }
                return rowList;
            }).collect(Collectors.toList());
            String filePath = excelDirPath + stationName + StrUtil.UNDERLINE + (i + 1) + StrUtil.UNDERLINE + DateUtil.format(new Date(), DatePattern.PURE_DATETIME_PATTERN) + ".xlsx";
            ExcelWriter excelWriter = EasyExcel.write(filePath).build();
            WriteSheet calibrationSheet = EasyExcel.writerSheet("标定点表").head(titleList).registerWriteHandler(new LongestMatchColumnWidthStyleStrategy()).build();
            excelWriter.write(columnList, calibrationSheet);
            excelWriter.finish();
            return filePath;
        } catch (Exception e) {
            log.error("表格数据组装异常:{}", ExceptionUtils.getStackTrace(e));
            return null;
        }
    }


    private void compressFiles(List<String> filePaths, String zipFilePath) {
        try (FileOutputStream fos = new FileOutputStream(zipFilePath); ZipOutputStream zos = new ZipOutputStream(fos)) {
            for (String filePath : filePaths) {
                File file = new File(filePath);
                ZipEntry zipEntry = new ZipEntry(file.getName());
                zos.putNextEntry(zipEntry);
                FileInputStream fis = new FileInputStream(file);
                byte[] buffer = new byte[1024];
                int len;
                while ((len = fis.read(buffer)) > 0) {
                    zos.write(buffer, 0, len);
                }
                fis.close();
                zos.closeEntry();
                file.delete();
            }
        } catch (IOException e) {
            log.error("文件压缩异常:", e);
        }
    }

    /**
     * 导出数据到Excel并通过响应流返回
     *
     * @param templatePath    模板文件路径
     * @param stationName     站点名称
     * @param devicePointList 数据列表
     * @param response        HttpServletResponse对象
     * @throws IOException 文件操作异常
     */
    public void exportDataToExcel(String templatePath,
                                  String stationName,
                                  List<DevicePoint> devicePointList,
                                  HttpServletResponse response) {
        InputStream templateStream = null;
        Workbook workbook = null;
        FileOutputStream fileOut = null;
        File tempFile = null;

        try {
            Map<Integer, String> positionStateTypeMap = devicePropertyService.getPositionList().stream()
                    .collect(Collectors.toMap(DevicePropertyVO::getType, DevicePropertyVO::getValue, (v1, v2) -> v2));

            templateStream = new FileInputStream(templatePath);
            workbook = new XSSFWorkbook(templateStream);

            // 获取第一个工作表
            Sheet sheet = workbook.getSheetAt(0);

            // 从第3行(index=2)开始插入数据
            int rowIndex = 2;

            // 遍历数据列表并插入到Excel
            for (DevicePoint devicePoint : devicePointList) {
                // 解析识别类型
                String[] recTypes = parseRecognitionTypes(devicePoint.getRecognitionTypeList());

                // 解析检查子类型
                List<Integer> inspectionSubTypes = parseInspectionSubTypes(devicePoint.getInspectionSubType());

                Row newRow = sheet.createRow(rowIndex++);
                createCell(newRow, 0, devicePoint.getPointName());
                createCell(newRow, 1, devicePoint.getPointCode());
                createCell(newRow, 2, RecTypeEnum.getDescByType(recTypes[0]));
                createCell(newRow, 3, RecTypeEnum.getDescByType(recTypes[1]));
                createCell(newRow, 4, CollectTypeEnum.getDescByCode(devicePoint.getSaveTypeList()));
                createCell(newRow, 5, MeterTypeEnum.getDescByType(devicePoint.getMeterType()));
                createCell(newRow, 6, positionStateTypeMap.get(devicePoint.getPositionStateType()));
                createCell(newRow, 7, ImportantLevelEnum.getDescByLevel(devicePoint.getImportantLevel()));
                createCell(newRow, 8, devicePoint.getComponentName());
                createCell(newRow, 9, devicePoint.getComponentCode());
                createCell(newRow, 10, devicePoint.getMainDeviceName());
                createCell(newRow, 11, devicePoint.getMainDeviceCode());
                createCell(newRow, 12, devicePoint.getMainDeviceType());
                createCell(newRow, 13, PhaseTypeEnum.getDescByType(devicePoint.getPhaseType()));
                createCell(newRow, 14, devicePoint.getBayName());
                createCell(newRow, 15, devicePoint.getBayCode());
                createCell(newRow, 16, devicePoint.getBayType());
                createCell(newRow, 17, devicePoint.getVoltName());
                createCell(newRow, 18, devicePoint.getVoltCode());

                // 设置检查子类型
                for (int i = 0; i < Math.min(inspectionSubTypes.size(), 8); i++) {
                    createCell(newRow, 19 + i, InspectionTypeEnum.getDescBySubType(inspectionSubTypes.get(i)
                            .toString()));
                }
            }

            // 调整所有列宽以适应内容
            for (int i = 0; i < 27; i++) {
                sheet.autoSizeColumn(i);
            }

            // 生成临时文件，使用站点名和时间戳
            String timestamp = DateUtil.format(new Date(), DatePattern.PURE_DATETIME_PATTERN);
            tempFile = File.createTempFile(stationName + "_" + timestamp, ".xlsx");
            // 程序退出时删除临时文件
            tempFile.deleteOnExit();

            // 写入文件
            fileOut = new FileOutputStream(tempFile);
            workbook.write(fileOut);

            // 获取文件路径并返回
            String tempFilePath = tempFile.getAbsolutePath();

            String excelDirPath = FilePathManagerUtil.getDockerPathBySystemPath("/excel/");
            File excelDir = new File(excelDirPath);
            if (!excelDir.exists()) {
                excelDir.mkdirs();
            }
            String zipFileName = stationName + StrUtil.UNDERLINE + DateUtil.format(new Date(), DatePattern.PURE_DATETIME_PATTERN) + ".zip";
            String zipFilePath = excelDirPath + zipFileName;

            compressFiles(Lists.newArrayList(tempFilePath), zipFilePath);

            ResponseUtils.response(response, zipFilePath, "点表信息_" + stationName);
        } catch (Exception e) {
            log.error("导出Excel文件失败: {}", e.getMessage(), e);
        } finally {
            try {
                if (fileOut != null) fileOut.close();
                if (workbook != null) workbook.close();
                if (templateStream != null) templateStream.close();
                if (tempFile.exists()) tempFile.delete();
            } catch (IOException e) {
                log.error("关闭资源失败: {}", e.getMessage(), e);
            }
        }
    }

    /**
     * 解析识别类型字符串
     */
    private String[] parseRecognitionTypes(String recognitionTypeList) {
        String[] result = new String[2];
        if (StringUtils.isNotBlank(recognitionTypeList)) {
            String[] split = recognitionTypeList.split(",");
            if (split.length >= 1) result[0] = split[0];
            if (split.length >= 2) result[1] = split[1];
        }
        return result;
    }

    /**
     * 解析检查子类型字符串
     */
    private List<Integer> parseInspectionSubTypes(String inspectionSubType) {
        List<Integer> result = new ArrayList<>();
        if (StringUtils.isNotBlank(inspectionSubType)) {
            String[] split = inspectionSubType.split(",");
            for (String s : split) {
                if (result.size() < 8) {
                    result.add(Integer.valueOf(s));
                } else {
                    break;
                }
            }
        }
        return result;
    }

    // 创建单元格并设置值
    private static void createCell(Row row, int columnIndex, Object value) {
        Cell cell = row.createCell(columnIndex);

        // 根据值的类型设置不同的单元格类型
        if (value instanceof String) {
            cell.setCellValue((String) value);
        } else if (value instanceof Integer) {
            cell.setCellValue((Integer) value);
        } else if (value instanceof Double) {
            cell.setCellValue((Double) value);
        } else if (value instanceof Boolean) {
            cell.setCellValue((Boolean) value);
        } else if (value != null) {
            cell.setCellValue(value.toString());
        }
    }
}
