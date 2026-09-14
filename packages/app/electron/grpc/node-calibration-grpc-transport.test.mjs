import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { NodeCalibrationGrpcTransport } from "./node-calibration-grpc-transport.ts";

const protoPath = fileURLToPath(new URL("./proto/external-interaction-calibration.proto", import.meta.url));

test("production transport loads the calibration service definition", async () => {
  const transport = new NodeCalibrationGrpcTransport(protoPath);
  assert.deepEqual(transport.status(1), { connected: false, robotCode: null, changedAt: null });
  await assert.rejects(
    transport.connect(1, "robot-01", { host: "", port: 50051 }),
    /连接地址无效/,
  );
  transport.remove(1);
});
