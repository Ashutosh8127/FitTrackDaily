/*
  simple-chart.js
  Minimal chart helper exposing `renderLineChart(canvas, labels, data, options)`
  - lightweight, dependency-free
  - draws a simple smoothed-ish line and dots
*/
(function(){
  window.renderLineChart = function(canvas, labels, data, opts){
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);
    if(!data || !data.length) return;
    const max = Math.max(...data), min = Math.min(...data);
    const range = (max - min) || 1;
    // background grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
    for(let i=0;i<4;i++){ const y = 5 + (i*(h-10)/3); ctx.beginPath(); ctx.moveTo(5,y); ctx.lineTo(w-5,y); ctx.stroke(); }
    // line
    ctx.beginPath(); ctx.lineWidth = 2; ctx.strokeStyle = opts.color || '#10b981';
    data.forEach((v,i)=>{
      const x = 5 + (i/(data.length-1))*(w-10);
      const y = h-5 - ((v-min)/range)*(h-10);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
    // dots
    data.forEach((v,i)=>{
      const x = 5 + (i/(data.length-1))*(w-10);
      const y = h-5 - ((v-min)/range)*(h-10);
      ctx.fillStyle = '#c7f9ea'; ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
    });
  };
})();
