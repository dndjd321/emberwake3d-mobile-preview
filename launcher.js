'use strict';
const BUILD_ID = '6fe3463';
const panel = document.getElementById('panel');
const statusText = document.getElementById('status');
const play = document.getElementById('play');
const canvas = document.getElementById('canvas');
const fullscreen = document.getElementById('fullscreen');
let bundlePromise;
let controller;
let failed = false;
let fetchedBytes = 0;
window.emberBundle = async function(name) {
  const manifest = await bundlePromise;
  const entry = manifest[name];
  if (!entry) throw Error('알 수 없는 게임 파일: ' + name);
  const buffers = [];
  const total = Object.values(manifest).reduce((sum, e) => sum + e.download, 0);
  for (const part of entry.parts) {
    const response = await fetch(part + '?v=' + BUILD_ID, {signal:controller.signal});
    if (!response.ok) throw Error('게임 파일 다운로드 실패: ' + response.status);
    const buffer = await response.arrayBuffer();
    buffers.push(buffer);
    fetchedBytes += buffer.byteLength;
    statusText.textContent = '게임 다운로드 중 · ' + Math.min(100, Math.round(fetchedBytes / total * 100)) + '%';
  }
  const data = await new Response(new Blob(buffers).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if (data.byteLength !== entry.size) throw Error('게임 파일 크기가 맞지 않습니다. 새로고침해 주세요.');
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2,'0')).join('');
  if (hash !== entry.sha256) throw Error('게임 파일 검증에 실패했습니다. 새로고침해 주세요.');
  return data;
};
async function enterFullscreen() {
  try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch (_) {}
  try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (_) {}
}
fullscreen.onclick = enterFullscreen;
play.onclick = async () => {
  if (failed) { location.reload(); return; }
  play.disabled = true;
  controller = new AbortController();
  let deadline;
  try {
    const missing = Engine.getMissingFeatures({threads:false});
    if (!('DecompressionStream' in window)) missing.push('최신 브라우저의 압축 해제 기능');
    if (missing.length) throw Error('이 브라우저에서는 실행할 수 없습니다.\n' + missing.join('\n') + '\n최신 Chrome 또는 Safari에서 열어 주세요.');
    await enterFullscreen();
    statusText.textContent = '게임 파일을 불러오는 중…';
    bundlePromise = fetch('bundle.json?v=' + BUILD_ID, {signal:controller.signal}).then(r => { if (!r.ok) throw Error('파일 목록을 불러오지 못했습니다.'); return r.json(); });
    const touch = matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 0;
    let exited = false;
    const engine = new Engine({executable:'index',canvas,canvasResizePolicy:2,focusCanvas:true,gdextensionLibs:[],args:['--main-pack','index.pck','--',...(touch?['--touch']:[])],onExit:code=>{
      exited = true;
      failed = true;
      clearTimeout(deadline);
      controller.abort();
      panel.hidden = false;
      panel.style.display = 'grid';
      fullscreen.hidden = true;
      play.disabled = false;
      play.textContent = '다시 시작';
      statusText.textContent = code === 0 ? '게임을 종료했습니다.' : '게임 실행이 중단되었습니다 (' + code + '). 새로고침해서 다시 시도해 주세요.';
    }});
    const startup = async () => {
      await Promise.all([engine.load('index'), window.emberBundle('index.pck').then(data=>engine.preloadFile(data,'index.pck'))]);
      if (controller.signal.aborted) throw Error('실행이 중단되었습니다.');
      statusText.textContent = '게임 시작 중…';
      await engine.init('index');
      if (controller.signal.aborted) throw Error('실행이 중단되었습니다.');
      await engine.start();
    };
    await Promise.race([startup(), new Promise((_, reject) => { deadline = setTimeout(() => { controller.abort(); reject(Error('로딩 시간이 초과되었습니다. Wi-Fi 연결을 확인하고 다시 시도해 주세요.')); },180000); })]);
    clearTimeout(deadline);
    if (exited) return;
    panel.hidden = true;
    panel.style.display = 'none';
    fullscreen.hidden = false;
    canvas.focus();
  } catch (error) {
    clearTimeout(deadline);
    controller.abort();
    failed = true;
    console.error(error);
    statusText.textContent = error.message || String(error);
    play.disabled = false;
    play.textContent = '다시 시도';
  }
};
