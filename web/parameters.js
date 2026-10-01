// The Python Parameters dataclass remains the reference for ranges and defaults.
export const definitions = [
  ['persistence', 'Persistence', 'p', 0, 1, .01, .15, 'How much of the previous image remains', '%'],
  ['gain', 'Feedback gain', 'g', 0, 2, .01, .85, 'Strength of the transformed image', '%'],
  ['diffusion', 'Spatial diffusion', 'v', 0, 1, .01, .05, 'Contribution from neighboring pixels', '%'],
  ['sigma', 'Blur', 'b', 0, 10, .1, 1.2, 'Width of spatial smoothing', 'px'],
  ['zoom', 'Zoom', 'z', .5, 1.5, .001, 1.015, 'Magnification per iteration', 'x'],
  ['angle', 'Rotation', 'a', -180, 180, 1, 2, 'Rotation per iteration', 'deg'],
  ['injection', 'Input signal', 'u', 0, 1, .01, .12, 'Amount of fresh video added', '%'],
  ['brightness', 'Brightness', 'l', -1, 1, .01, 0, 'Shift toward dark or light', ''],
  ['invert', 'Invert luminance', 'i', 0, 1, 1, 0, 'Swap light and dark in the feedback', 'bool'],
  ['color_cycle', 'Color cycle', 'c', -1, 1, .01, .12, 'Positive: red → green → blue; negative: reverse', '%'],
  ['saturation', 'Feedback saturation', 't', 0, 2, .01, 1, 'Grayscale at 0, original at 1, vivid at 2', 'x'],
].map(([id,label,key,min,max,step,value,hint,unit]) => ({id,label,key,min,max,step,value,hint,unit}));
export function defaults() { return Object.fromEntries(definitions.map(d => [d.id,d.value])); }
export function format(d, value) {
  if (d.unit === 'bool') return value ? 'ON' : 'OFF';
  if (d.unit === '%') return `${Number((value * 100).toFixed(1))}%`;
  if (d.unit === 'deg') return `${Number(value.toFixed(2))}°`;
  if (d.unit === 'px') return `${Number(value.toFixed(2))} px`;
  if (d.unit === 'x') return `${Number(value.toFixed(d.id === 'zoom' ? 4 : 3))}×`;
  return Number(value.toFixed(3)).toString();
}
