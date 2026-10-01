import {FeedbackEngine} from './engine.js';
import {definitions,defaults,format} from './parameters.js';

const $ = id => document.getElementById(id);
const canvas = $('output');
const sourceCanvas = document.createElement('canvas');
sourceCanvas.width = canvas.width; sourceCanvas.height = canvas.height;
const context = sourceCanvas.getContext('2d');
const preview = $('preview').getContext('2d');
const video = $('camera-video');
let params = defaults();
let engine, stream, cameraRequest = 0;
let mode = 'color', source = 'synthetic', paused = false, selected = 'zoom';
let graphicsLost = false;
let tick = 0, lastTime = 0, accumulator = 0, lastRate = 0, frames = 0;
const held = new Set();
const rows = new Map();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function status(message, error = false) {
  $('status').textContent = message; $('status').classList.toggle('error',error);
}

for (const d of definitions) {
  const row = document.createElement('div'); row.className = 'parameter';
  row.innerHTML = `<div class="parameter-top"><kbd>${d.key.toUpperCase()}</kbd><label for="param-${d.id}">${d.label}</label><output for="param-${d.id}"></output></div><small id="hint-${d.id}">${d.hint}</small><input id="param-${d.id}" type="range" min="${d.min}" max="${d.max}" step="${d.step}" aria-describedby="hint-${d.id}" disabled>`;
  const input = row.querySelector('input');
  input.addEventListener('input',() => { params[d.id] = Number(input.value); select(d.id); refresh(); });
  input.addEventListener('focus',() => select(d.id));
  rows.set(d.id,row); $('parameters').append(row);
}

function select(id) { selected = id; refresh(); }
function refresh() {
  for (const d of definitions) {
    const row = rows.get(d.id);
    row.hidden = mode === 'mono' && ['color_cycle','saturation'].includes(d.id);
    row.classList.toggle('selected',d.id===selected);
    row.querySelector('input').value = params[d.id];
    row.querySelector('output').textContent = format(d,params[d.id]);
  }
  const d = definitions.find(d => d.id===selected);
  $('selected').textContent = `${d.key.toUpperCase()} / ${d.label} / ${format(d,params[selected])}`;
}
refresh();

function drawSource() {
  const w = sourceCanvas.width, h = sourceCanvas.height;
  if (source === 'camera' && video.readyState >= 2) {
    // Match the Python demo's resize-to-fit behavior, without mirroring.
    context.drawImage(video,0,0,w,h);
  } else {
    context.fillStyle = '#808080'; context.fillRect(0,0,w,h);
    const x = w*(.5+.25*Math.cos(tick/37)), y = h*(.5+.25*Math.sin(tick/53));
    context.fillStyle = '#fca849'; context.beginPath(); context.arc(x,y,h/12,0,Math.PI*2); context.fill();
    context.fillStyle = '#30cbdc'; context.fillRect(w/5,h/4,w/7,h/4);
    context.strokeStyle = '#bcf28a'; context.lineWidth = 5;
    context.beginPath(); context.arc(w*.74,h*.67,h/10,0,Math.PI*2); context.stroke();
  }
  preview.save(); preview.filter = mode==='mono' ? 'grayscale(1)' : 'none';
  preview.drawImage(sourceCanvas,0,0,160,120); preview.restore();
}

function stopCamera() {
  cameraRequest++;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null; video.srcObject = null;
  $('camera').textContent = 'Enable camera';
}
function useShapes(message = 'Moving shapes / local feedback loop') {
  stopCamera(); source = 'synthetic'; $('source').value = source;
  status(message);
}
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    useShapes(); status('Camera access needs HTTPS or localhost and a supported browser. You can still play with moving shapes.',true); return;
  }
  const request = ++cameraRequest;
  $('camera').disabled = true;
  status('Waiting for camera permission…');
  let candidate;
  try {
    candidate = await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480}},audio:false});
    if (request !== cameraRequest) { candidate.getTracks().forEach(t => t.stop()); return; }
    video.srcObject = candidate;
    await video.play();
    if (request !== cameraRequest) { candidate.getTracks().forEach(t => t.stop()); return; }
    stream = candidate; source = 'camera'; $('source').value = source;
    $('camera').textContent = 'Stop camera';
    for (const track of stream.getVideoTracks()) track.addEventListener('ended',() => {
      if (source === 'camera') useShapes('Camera disconnected. Switched to moving shapes.');
    });
    status('Camera live / video stays on this device');
  } catch (error) {
    candidate?.getTracks().forEach(t => t.stop());
    if (request === cameraRequest) {
      useShapes();
      status(error.name === 'NotAllowedError' ? 'Camera permission was declined. Moving shapes are still ready to play.' : `Could not start the camera (${error.name}). Try moving shapes or another camera-enabled browser.`,true);
    }
  } finally { $('camera').disabled = false; }
}

$('source').addEventListener('change',() => $('source').value==='camera' ? startCamera() : useShapes());
$('camera').addEventListener('click',() => source==='camera' ? useShapes() : startCamera());
$('experiment').addEventListener('change',() => {
  mode = $('experiment').value;
  if (mode==='mono' && ['color_cycle','saturation'].includes(selected)) selected = 'zoom';
  engine.reset(); refresh(); drawSource();
});
function pause() {
  paused = !paused; held.clear(); accumulator = 0;
  $('pause').textContent = paused ? 'Resume' : 'Pause';
  if (paused) $('rate').textContent = 'PAUSED';
  $('pause').setAttribute('aria-pressed',String(paused));
}
function reset() { params = defaults(); refresh(); }
$('pause').addEventListener('click',pause);
$('clear').addEventListener('click',() => engine.reset());
$('defaults').addEventListener('click',reset);
$('snapshot').addEventListener('click',() => {
  engine.display();
  canvas.toBlob(blob => {
    if (!blob) { status('The browser could not create a snapshot.',true); return; }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `cvav-${mode}-${Date.now()}.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
    status('Snapshot saved.');
  });
});
$('fullscreen').addEventListener('click',async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('screen').requestFullscreen();
  } catch { status('Full screen is unavailable in this browser. You can still resize or zoom the page.',true); }
});

function adjust(sign, fine, scale=1) {
  const d = definitions.find(d => d.id===selected);
  const step = d.step*(fine ? .1 : 1)*scale;
  params[d.id] = d.unit==='bool' ? (sign>0 ? 1 : 0) : Math.min(d.max,Math.max(d.min,params[d.id]+sign*step));
  refresh();
}
function editing(target) { return target instanceof HTMLElement && (target.matches('input,select,textarea,button') || target.isContentEditable); }
window.addEventListener('keydown',event => {
  if (!engine || event.ctrlKey || event.metaKey || event.altKey || editing(event.target)) return;
  const key = event.key.toLowerCase();
  const sign = ['+','='].includes(key) ? 1 : ['-','_'].includes(key) ? -1 : 0;
  if (sign) {
    event.preventDefault();
    if (!event.repeat) adjust(sign,event.shiftKey);
    held.add(event.code); return;
  }
  if (key==='shift') return;
  if (event.repeat) return;
  const d = definitions.find(d => d.key===key && !rows.get(d.id).hidden);
  if (d) { select(d.id); event.preventDefault(); }
  else if (key===' ') { event.preventDefault(); pause(); }
  else if (key==='r') engine.reset();
  else if (key==='d') reset();
});
let shift = false;
window.addEventListener('keydown',e => { shift=e.shiftKey; });
window.addEventListener('keyup',e => { held.delete(e.code); shift=e.shiftKey; });
window.addEventListener('blur',() => { held.clear(); shift=false; });
document.addEventListener('visibilitychange',() => { held.clear(); lastTime=0; accumulator=0; });
window.addEventListener('pagehide',stopCamera);
canvas.addEventListener('webglcontextlost',e => {
  e.preventDefault(); graphicsLost=true; paused=true; held.clear(); stopCamera();
  document.querySelectorAll('button,input,select').forEach(element => { element.disabled=true; });
  status('The graphics context was lost. Reload this page to restart the instrument.',true);
});

function animate(now) {
  if (graphicsLost) return;
  if (!document.hidden) {
    const dt = lastTime ? Math.min((now-lastTime)/1000,.1) : 0;
    lastTime = now;
    if (held.has('Equal') || held.has('NumpadAdd')) adjust(1,shift,dt*15);
    if (held.has('Minus') || held.has('NumpadSubtract')) adjust(-1,shift,dt*15);
    if (!paused) {
      accumulator += dt;
      // Bound catch-up work: under load the simulation slows rather than queuing frames.
      let steps = 0;
      while (accumulator >= 1/30 && steps < 2) {
        drawSource(); engine.step(sourceCanvas,params,mode==='color');
        tick++; frames++; steps++; accumulator -= 1/30;
      }
      if (steps===2) accumulator=0;
    }
    engine.display();
    if (now-lastRate >= 1000) {
      $('rate').textContent = paused ? 'PAUSED' : `${Math.round(frames*1000/(now-lastRate))} STEPS / SEC`;
      frames=0; lastRate=now;
    }
  }
  requestAnimationFrame(animate);
}

try {
  engine = await FeedbackEngine.create(canvas);
  document.querySelectorAll('button,input,select').forEach(element => { element.disabled=false; });
  if (!$('screen').requestFullscreen) $('fullscreen').hidden=true;
  drawSource();
  status('Moving shapes / local feedback loop');
  if (reducedMotion) { pause(); status('Paused for your reduced-motion preference. Press Resume when you’re ready.'); }
  requestAnimationFrame(animate);
} catch (error) {
  stopCamera(); status(error.message,true);
  $('rate').textContent = 'UNAVAILABLE';
}
