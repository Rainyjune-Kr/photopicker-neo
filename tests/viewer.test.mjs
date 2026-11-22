import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Window } from "happy-dom";

// Exercise the production UI, replacing only the desktop IPC and layout services.
const dist = new URL("../dist/", import.meta.url);
const html = readFileSync(new URL("index.html", dist), "utf8");
const asset = html.match(/src="([^"]+\.js)"/)[1].replace(/^\//, "");
const bundle = readFileSync(new URL(asset, dist), "utf8");

async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await delay(10);
  }
  assert.ok(check(), "Timely UI update");
}

async function viewer(test, handle, names = ["A", "B"]) {
  const w = new Window({url:"http://localhost", settings:{
    enableJavaScriptEvaluation:true, suppressInsecureJavaScriptEnvironmentWarning:true,
  }});
  test.after(() => w.close());
  w.isTauri = true;
  w.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback([{contentRect:{width:900}}]); }
    disconnect() {}
  };
  let seq = 0;
  w.URL.createObjectURL = () => "blob:preview-" + seq++;
  w.URL.revokeObjectURL = () => {};
  w.__TAURI_INTERNALS__ = {invoke: async (cmd, args) => {
    if (cmd === "ui_language") return "ko";
    if (cmd === "choose_folder") return { generation:1, path:"/shoot", pick:"/shoot/pick",
      photos:names.map(name => ({name:name+".HIF",format:"HEIF",pair_format:"Raw"})) };
    return handle(cmd, args);
  }};
  w.document.body.innerHTML = '<div id="root"></div>';
  w.eval(bundle);
  const q = selector => w.document.querySelector(selector);
  const button = label => q('button[aria-label="' + label + '"]');
  await until(() => button("폴더 열기"));
  button("폴더 열기").click();
  await until(() => q(".stage"));
  return {w,q,button};
}

test("failed preview allows lazy EXIF and partial, complete or unsuccessful pick feedback", async ctx => {
  let reads = 0;
  let outcome = "failed";
  const {w,q,button} = await viewer(ctx, (cmd) => {
    if (cmd === "preview") throw "HEIF 미리보기를 읽을 수 없습니다. 원본은 복사할 수 있습니다.";
    if (cmd === "photo_info") { reads++; return {rows:[["ISO","200"]],gps:null}; }
    if (cmd === "copy_pick") return [
      {format:"HEIF",status:outcome === "exists" ? "exists" : "copied",detail:null},
      {format:"RAW",status:outcome,detail:outcome === "failed" ? "disk full" : null},
    ];
  });
  await until(() => q(".stage").textContent.includes("원본은 복사"));
  assert.equal(reads,0);
  button("촬영 정보").click();
  await until(() => q("#shooting-info")?.textContent.includes("200"));
  assert.equal(reads,1);
  w.localStorage.setItem("photopicker.settings.v1",JSON.stringify({mode:"both",destinations:[
    {id:"1",label:"pick",shortcut:"1",path:""}]}));
  const pick = () => w.dispatchEvent(new w.KeyboardEvent("keydown",{key:"1"}));
  pick();
  await until(() => q(".copied-mark.partial"));
  assert.match(q(".status").textContent,/부분 복사됨.*HEIF 복사됨.*RAW 복사 실패.*disk full/);
  outcome = "copied";
  pick();
  await until(() => q(".copied-mark.complete"));
  outcome = "exists";
  pick();
  await until(() => !q(".copied-mark"));
  assert.match(q(".status").textContent,/RAW 동명 파일 있음/);
});

test("wait for image display and discard stale EXIF when changing photos", async ctx => {
  const reads = [];
  const {w,q,button} = await viewer(ctx, (cmd,args) => {
    if (cmd === "preview") return new ArrayBuffer(4);
    if (cmd === "photo_info") return new Promise(resolve => reads.push({index:args.index, resolve}));
  });
  button("촬영 정보").click();
  await until(() => q(".stage img"));
  assert.equal(reads.length,0);
  q(".stage img").dispatchEvent(new w.Event("load"));
  await until(() => reads.length === 1);
  button("다음 사진").click();
  await until(() => q('.stage img[alt="B.HIF"]'));
  q(".stage img").dispatchEvent(new w.Event("error"));
  await until(() => reads.length === 2);
  assert.deepEqual(reads.map(r=>r.index),[0,1]);
  reads[1].resolve({rows:[["ISO","800"]],gps:null});
  await until(() => q("#shooting-info")?.textContent.includes("800"));
  reads[0].resolve({rows:[["ISO","100"]],gps:null});
  await delay(20);
  assert.match(q("#shooting-info").textContent,/800/);
});

test("scrolling the virtual filmstrip loads visible thumbnails without changing the selected photo", async ctx => {
  const thumbnails = new Set();
  const names = Array.from({length:100}, (_, i) => "shot-" + i);
  const {w,q,button} = await viewer(ctx, (cmd,args) => {
    if (cmd === "preview") {
      if (args.thumbnail) thumbnails.add(args.index);
      return new ArrayBuffer(4);
    }
  }, names);
  const film = q(".film");
  await until(() => thumbnails.has(0));
  assert.ok(!thumbnails.has(50));
  film.scrollLeft = 50 * 126;
  film.dispatchEvent(new w.Event("scroll"));
  await until(() => thumbnails.has(50) && button("shot-50.HIF"));
  assert.equal(q(".film-scroll").valueAsNumber, film.scrollLeft);
  assert.match(q(".status").textContent,/shot-0\.HIF/);
  button("shot-50.HIF").click();
  await until(() => q('.stage img[alt="shot-50.HIF"]'));
  assert.match(q(".status").textContent,/shot-50\.HIF/);
});

test("settings downloads on demand and waits for the installer after verification", async ctx => {
  let finishDownload, beginInstall;
  let checks = 0;
  const {w,q,button} = await viewer(ctx, (cmd,args) => {
    if (cmd === "preview") return new ArrayBuffer(1);
    if (cmd === "plugin:app|version") return "0.1.0";
    if (cmd === "check_update") { checks++; return {version:"0.1.1"}; }
    if (cmd === "download_update") {
      args.progress.onmessage({received:5,total:10});
      return new Promise(resolve => { finishDownload = resolve; });
    }
    if (cmd === "install_update") {
      beginInstall = () => args.installing.onmessage(null);
      return new Promise(() => {});
    }
  });
  w.__TAURI_INTERNALS__.transformCallback = () => 1;
  button("설정").click();
  await until(() => q(".updates button"));
  assert.equal(checks, 0);
  const click = () => q(".updates button").click();
  click();
  await until(() => q(".updates").textContent.includes("0.1.1"));
  click();
  await until(() => q(".updates progress")?.value === 5);
  assert.equal(q(".updates progress").max, 10);
  finishDownload();
  await until(() => q(".updates button").textContent.includes("설치하고 재시작"));
  click();
  await until(() => q(".updates").textContent.includes("복사 작업 완료 대기"));
  beginInstall();
  await until(() => q(".updates").textContent.includes("설치 후 재시작 중"));
});
