import * as pc from "playcanvas";

export function updateLineEntity(line: pc.Entity, from: pc.Vec3, to: pc.Vec3, thickness = 0.05) {
  const mid = new pc.Vec3().add2(from, to).mulScalar(0.5);
  const len = from.clone().sub(to).length();
  const fwd = new pc.Vec3().sub2(to, from).normalize();
  const target = mid.clone().add(fwd);

  line.setLocalPosition(mid);
  line.setLocalScale(thickness, thickness, len);
  if (Math.abs(fwd.y) > 0.999) {
    line.lookAt(target.x, target.y, target.z, 1, 0, 0);
  } else {
    line.lookAt(target.x, target.y, target.z, 0, 1, 0);
  }
}

function createSolidMaterial(color: pc.Color): pc.StandardMaterial {
  const material = new pc.StandardMaterial();
  material.diffuse = color;
  material.emissive = color;
  material.useLighting = false;
  material.update();
  return material;
}

export function createSphere(app: pc.Application, pos: pc.Vec3, color: pc.Color, scale = 0.15): pc.Entity {
  const sphere = new pc.Entity("draw-pt");
  sphere.addComponent("render", { type: "sphere", material: createSolidMaterial(color) });
  sphere.setLocalScale(scale, scale, scale);
  sphere.setLocalPosition(pos);
  app.root.addChild(sphere);
  return sphere;
}

export function createLine(app: pc.Application, from: pc.Vec3, to: pc.Vec3, color: pc.Color, thickness = 0.05): pc.Entity {
  const line = new pc.Entity("draw-line");
  line.addComponent("render", { type: "box", material: createSolidMaterial(color) });
  updateLineEntity(line, from, to, thickness);
  app.root.addChild(line);
  return line;
}
