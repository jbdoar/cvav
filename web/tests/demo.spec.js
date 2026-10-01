import {test,expect} from '@playwright/test';

test('starts without camera permission; sliders, keyboard, modes, reset, and snapshot work', async ({page}) => {
  const errors=[]; page.on('pageerror',e => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('#status')).toContainText('Moving shapes');
  await expect(page.locator('#pause')).toBeEnabled();
  await expect(page.locator('#rate')).toContainText('STEPS / SEC');
  await page.screenshot({path:'test-results/demo-desktop.png',fullPage:true});
  await page.locator('#pause').click();
  await expect(page.locator('#pause')).toHaveText('Resume');
  // Global keyboard controls leave focused form widgets alone.
  await page.locator('h1').click();
  await page.keyboard.press('z'); await page.keyboard.press('=');
  await expect(page.locator('#selected')).toContainText('1.016');
  await page.keyboard.press('Shift+=');
  await expect(page.locator('#selected')).toContainText('1.0161');
  await page.keyboard.press('i'); await page.keyboard.press('=');
  await expect(page.locator('#selected')).toContainText('ON');
  await page.keyboard.press('-');
  await expect(page.locator('#selected')).toContainText('OFF');
  await page.keyboard.press('z');
  await page.keyboard.press('d');
  await expect(page.locator('#param-zoom')).toHaveValue('1.015');
  await page.locator('#experiment').selectOption('mono');
  await expect(page.locator('#param-color_cycle')).toBeHidden();
  await page.locator('#experiment').selectOption('color');
  await expect(page.locator('#param-color_cycle')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.locator('#snapshot').click();
  expect((await download).suggestedFilename()).toMatch(/cvav-color.*png/);
  await page.locator('#clear').click();
  const pixel = await page.locator('#output').evaluate(canvas => {
    const gl=canvas.getContext('webgl2'), data=new Uint8Array(4);
    gl.readPixels(10,10,1,1,gl.RGBA,gl.UNSIGNED_BYTE,data); return [...data];
  });
  expect(pixel.slice(0,3)).toEqual([128,128,128]);
  expect(errors).toEqual([]);
});

test('shader output agrees with Python reference cases', async ({page}) => {
  await page.goto('./');
  await expect(page.locator('#status')).toContainText('Moving shapes');
  const results = await page.evaluate(async () => {
    const {FeedbackEngine} = await import('./engine.js');
    const fixture=await (await fetch('./tests/fixtures.json')).json();
    const canvas=document.createElement('canvas'); canvas.width=fixture.width; canvas.height=fixture.height;
    const engine=await FeedbackEngine.create(canvas), gl=engine.gl;
    const source=document.createElement('canvas'); source.width=fixture.width; source.height=fixture.height;
    const ctx=source.getContext('2d'), image=ctx.createImageData(fixture.width,fixture.height);
    fixture.frame.flat().forEach((rgb,i) => image.data.set([...rgb,255],i*4)); ctx.putImageData(image,0,0);
    const results=[];
    for (const item of fixture.cases) {
      engine.reset();
      const state=new Float32Array(item.initial.slice().reverse().flat().flatMap(rgb => [...rgb,1]));
      gl.bindTexture(gl.TEXTURE_2D,engine.states[engine.current].texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,fixture.width,fixture.height,gl.RGBA,gl.FLOAT,state);
      engine.step(source,item.params,item.color);
      gl.bindFramebuffer(gl.FRAMEBUFFER,engine.states[engine.current].framebuffer);
      const pixels=new Float32Array(fixture.width*fixture.height*4);
      gl.readPixels(0,0,fixture.width,fixture.height,gl.RGBA,gl.FLOAT,pixels);
      let error=0;
      for(let y=0;y<fixture.height;y++) for(let x=0;x<fixture.width;x++) for(let c=0;c<3;c++) {
        error=Math.max(error,Math.abs(pixels[((fixture.height-1-y)*fixture.width+x)*4+c]-item.expected[y][x][c]));
      }
      results.push({name:item.name,error,glError:gl.getError()});
    }
    return results;
  });
  for (const result of results) {
    expect(result.glError, result.name).toBe(0);
    // OpenCV quantizes warp interpolation to a 1/32-pixel table; GPU uses exact fractions.
    expect(result.error,result.name).toBeLessThan(result.name==='transform' ? .04 : .005);
  }
});

test('camera refusal leaves the synthetic instrument usable', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async () => {throw new DOMException('No','NotAllowedError');}});
  });
  await page.goto('./');
  await expect(page.locator('#camera')).toBeEnabled();
  await page.locator('#camera').click();
  await expect(page.locator('#status')).toContainText('declined');
  await expect(page.locator('#source')).toHaveValue('synthetic');
  await expect(page.locator('#pause')).toBeEnabled();
});

test('mobile layout fits and reduced-motion preference starts paused', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('./');
  await expect(page.locator('#pause')).toHaveText('Resume');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:'test-results/demo-mobile.png',fullPage:true});
});

test('missing WebGL gives a useful message', async ({page}) => {
  await page.addInitScript(() => {
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...rest) { return type==='webgl2' ? null : original.call(this,type,...rest); };
  });
  await page.goto('./');
  await expect(page.locator('#status')).toContainText('needs WebGL 2');
  await expect(page.locator('#camera')).toBeDisabled();
});

test('camera stream starts and stops without leaking tracks', async ({page}) => {
  await page.addInitScript(() => {
    window.cameraStopped = false;
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async () => {
      const camera=document.createElement('canvas'); camera.width=640; camera.height=480;
      const ctx=camera.getContext('2d'); ctx.fillStyle='red'; ctx.fillRect(0,0,640,480);
      const stream=camera.captureStream(30);
      const track=stream.getVideoTracks()[0], original=track.stop.bind(track);
      track.stop=() => { window.cameraStopped=true; original(); };
      return stream;
    }});
  });
  await page.goto('./');
  await expect(page.locator('#camera')).toBeEnabled();
  await page.locator('#camera').click();
  await expect(page.locator('#status')).toContainText('Camera live');
  await expect(page.locator('#camera')).toHaveText('Stop camera');
  await page.locator('#camera').click();
  await expect(page.locator('#source')).toHaveValue('synthetic');
  expect(await page.evaluate(() => window.cameraStopped)).toBe(true);
});
