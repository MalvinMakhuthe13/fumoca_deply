/**
 * NIFGaussianTimelinePanel — compact playback controls for native splat tracks.
 * This is a viewer control surface, not a mesh/rig animation editor.
 */
export class NIFGaussianTimelinePanel {
  constructor(container, viewer) {
    if (!container || !viewer) throw new Error('Timeline panel requires a container and NIFViewer');
    if (!viewer.gaussianAnimation) throw new Error('NIF has no native Gaussian animation');
    this.container=container;
    if(getComputedStyle(this.container).position==='static')this.container.style.position='relative';
    this.viewer=viewer;
    this.duration=viewer.gaussianAnimation.duration;
    this._raf=null;
    this._build();
    this._sync();
    this._tick();
  }

  _build() {
    const root=document.createElement('section');
    root.setAttribute('aria-label','Gaussian animation timeline');
    root.style.cssText='position:absolute;left:12px;right:12px;bottom:12px;z-index:30;display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(12,16,22,.82);backdrop-filter:blur(14px);color:#fff;font:12px/1.2 system-ui,sans-serif;box-sizing:border-box';
    const button=(label,title)=>{
      const el=document.createElement('button');
      el.type='button';el.textContent=label;el.title=title;el.setAttribute('aria-label',title);
      el.style.cssText='border:1px solid rgba(255,255,255,.24);border-radius:7px;background:rgba(255,255,255,.08);color:inherit;padding:7px 10px;cursor:pointer;white-space:nowrap';
      return el;
    };
    this.playButton=button('Play','Play Gaussian animation');
    this.pauseButton=button('Pause','Pause Gaussian animation');
    this.range=document.createElement('input');
    this.range.type='range';this.range.min='0';this.range.max=String(this.duration);this.range.step='0.001';this.range.value='0';
    this.range.setAttribute('aria-label','Animation playhead');
    this.range.style.cssText='flex:1;min-width:40px;accent-color:#91c8ff;cursor:pointer';
    this.time=document.createElement('output');this.time.style.cssText='min-width:82px;text-align:right;font-variant-numeric:tabular-nums';
    this.speed=document.createElement('select');this.speed.setAttribute('aria-label','Playback speed');
    for(const value of ['0.25','0.5','1','1.5','2']){const option=document.createElement('option');option.value=value;option.textContent=value+'×';if(value==='1')option.selected=true;this.speed.append(option);}
    this.speed.style.cssText='border:1px solid rgba(255,255,255,.24);border-radius:7px;background:#202833;color:inherit;padding:7px 5px';
    this.loop=document.createElement('input');this.loop.type='checkbox';this.loop.setAttribute('aria-label','Loop animation');
    const loopLabel=document.createElement('label');loopLabel.style.cssText='display:flex;align-items:center;gap:4px;white-space:nowrap';loopLabel.append(this.loop,document.createTextNode('Loop'));
    root.append(this.playButton,this.pauseButton,this.range,this.time,this.speed,loopLabel);
    const stop=e=>e.stopPropagation();
    for(const el of [root,this.playButton,this.pauseButton,this.range,this.speed,this.loop]) el.addEventListener('pointerdown',stop);
    this.playButton.addEventListener('click',e=>{e.stopPropagation();this.viewer.playGaussianAnimation({from:this.viewer.gaussianAnimationTime,speed:Number(this.speed.value),loop:this.loop.checked});});
    this.pauseButton.addEventListener('click',e=>{e.stopPropagation();this.viewer.pauseGaussianAnimation();});
    this.range.addEventListener('input',e=>{e.stopPropagation();this.viewer.seekGaussianAnimation(Number(this.range.value));this._sync();});
    this.speed.addEventListener('change',e=>{e.stopPropagation();if(this.viewer.isGaussianAnimationPlaying)this.viewer.setGaussianAnimationSpeed(Number(this.speed.value));});
    this.element=root;
    this.container.append(root);
  }

  _sync() {
    const t=Math.max(0,Math.min(this.duration,this.viewer.gaussianAnimationTime));
    if(document.activeElement!==this.range)this.range.value=String(t);
    this.time.textContent=t.toFixed(2)+' / '+this.duration.toFixed(2)+' s';
    this.playButton.disabled=this.viewer.isGaussianAnimationPlaying;
    this.pauseButton.disabled=!this.viewer.isGaussianAnimationPlaying;
    this.playButton.style.opacity=this.playButton.disabled?'.45':'1';
    this.pauseButton.style.opacity=this.pauseButton.disabled?'.45':'1';
  }

  _tick() {
    this._sync();
    this._raf=requestAnimationFrame(()=>this._tick());
  }

  destroy() {
    if(this._raf!=null)cancelAnimationFrame(this._raf);
    this._raf=null;
    this.element?.remove();
  }
}
