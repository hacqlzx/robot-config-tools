import assert from "node:assert/strict";
import test from "node:test";
import { MockCalibrationGrpc } from "./calibration-grpc-mock.ts";

const request = {
  SendCode: "robot-config-tools",
  ReceiveCode: "robot-01",
  Time: new Date().toISOString(),
  camera_id: "12",
  type: 1,
};
const endpoint = { host: "192.168.1.20", port: 50051 };

test("sessions are isolated and replies match the protocol", async () => {
  const grpc = new MockCalibrationGrpc();
  assert.equal(grpc.status(1).connected, false);
  grpc.connect(1, "robot-01", endpoint);
  assert.equal(grpc.status(1).connected, true);
  assert.equal(grpc.status(2).connected, false);
  const reply = await grpc.deliver(1, request);
  assert.equal(reply.Code, "0");
  assert.equal(reply.SendCode, request.ReceiveCode);
  assert.equal(reply.ReceiveCode, request.SendCode);
  await assert.rejects(grpc.deliver(2, request), /未建立/);
  grpc.disconnect(1, "robot-01");
  await assert.rejects(grpc.deliver(1, request), /未建立/);
});

test("invalid requests and disconnection during delivery fail", async () => {
  const grpc = new MockCalibrationGrpc();
  assert.throws(() => grpc.connect(1, " "), /编码无效/);
  assert.throws(() => grpc.connect(1, "robot-01", { host: " ", port: 50051 }), /连接地址无效/);
  assert.throws(() => grpc.connect(1, "robot-01", { host: "192.168.1.20", port: 0 }), /连接地址无效/);
  assert.throws(() => grpc.connect(1, "robot-01", { host: "192.168.1.20", port: 65536 }), /连接地址无效/);
  grpc.connect(1, "robot-01", endpoint);
  await assert.rejects(grpc.deliver(1, { ...request, type: 2 }), /参数无效/);
  const pending = grpc.deliver(1, request);
  grpc.disconnect(1, "robot-01");
  await assert.rejects(pending, /已断开/);
});

test("cleanup for an old robot does not disconnect a new robot", () => {
  const grpc = new MockCalibrationGrpc();
  grpc.connect(1, "robot-01", endpoint);
  grpc.connect(1, "robot-02", endpoint);
  assert.equal(grpc.disconnect(1, "robot-01").robotCode, "robot-02");
  assert.equal(grpc.status(1).connected, true);
  grpc.remove(1);
  assert.equal(grpc.status(1).connected, false);
});
