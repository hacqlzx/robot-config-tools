const fs = require('fs');
const path = require('path');

const jsonPath = 'D:/wechat_cache_file/xwechat_files/wxid_8go9sh976ppg12_bc5c/msg/file/2026-06/fac_data_西安750kV泾渭变.json';
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
const outDir = 'D:/dev/code/robotConfigTools/output';

// Flatten
const rows = [];
function flatten(obj, ancestors) {
    if (Array.isArray(obj)) { obj.forEach(item => flatten(item, ancestors)); return; }
    if (typeof obj !== 'object' || obj === null) return;
    const cur = { ...ancestors };
    if (obj.type === 'voltage_grade') cur.voltage_grade = obj.name;
    else if (obj.type === 'gap') cur.area = obj.name;
    else if (obj.type === 'room') cur.panel = obj.name;
    else if (obj.type === 'cubicle') cur.device = obj.name;
    else if (obj.type === 'point') {
        rows.push({
            voltage_grade: cur.voltage_grade || '', area: cur.area || '',
            panel: cur.panel || '', device: cur.device || '',
            name: obj.name, ass_id: obj.ass_id, cruise_id: obj.cruise_id,
            pt_type: obj.pt_type, sub_pt_type: obj.sub_pt_type || '',
            impt_type: obj.impt_type, stop_id: obj.stop_id
        });
        return;
    }
    if (obj.children) flatten(obj.children, cur);
}
flatten(data, {});
console.log('Rows:', rows.length);

// CSV
const headers = ['电压等级','区域','屏柜','巡检设备','测点名称','ass_id','cruise_id','pt_type','sub_pt_type','impt_type','stop_id'];
function esc(v) { const s = String(v||''); return /[,"\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; }
const csv = '\uFEFF' + headers.join(',') + '\n' + rows.map(r => [r.voltage_grade,r.area,r.panel,r.device,r.name,r.ass_id,r.cruise_id,r.pt_type,r.sub_pt_type,r.impt_type,r.stop_id].map(esc).join(',')).join('\n');
fs.writeFileSync(path.join(outDir,'西安750kV泾渭变_巡检数据.csv'), csv, 'utf-8');
console.log('CSV done');

// Build tree
const panelMap = new Map();
rows.forEach(r => {
    if (!panelMap.has(r.panel)) panelMap.set(r.panel, { name: r.panel, device: r.device, points: [] });
    panelMap.get(r.panel).points.push(r);
});
const tree = [...panelMap.values()];

// HTML
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
const html = '<!DOCTYPE html>\n<html lang="zh-CN">\n' +
fs.readFileSync(path.join(__dirname, 'template.html'), 'utf-8')
    .replace('{{TREE_DATA}}', JSON.stringify(tree))
    .replace('{{ROW_COUNT}}', rows.length)
    .replace('{{PANEL_COUNT}}', tree.length)
    .replace('{{IMPT_COUNT}}', rows.filter(r=>r.impt_type===2).length)
    .replace('{{GEN_TIME}}', new Date().toLocaleString('zh-CN'));
fs.writeFileSync(path.join(outDir,'西安750kV泾渭变_巡检数据.html'), html, 'utf-8');
console.log('HTML done');
