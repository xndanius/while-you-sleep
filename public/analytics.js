(() => {
  'use strict';
  const queue = [];
  const seenViews = new Set();
  let ready = false;
  let active = true;
  const postId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,160}$/.test(value);
  function emit(type,id) {
    if (!active || !postId(id)) return;
    if (type === 'view' && seenViews.has(id)) return;
    if (type === 'view') seenViews.add(id);
    const event = {path:`${type}:${id}`,title:type === 'save' ? 'Save an idea' : 'Read an idea',event:true,referrer:''};
    if (ready) window.goatcounter.count(event);
    else if (queue.length < 1000) queue.push(event);
  }
  window.wysAnalytics = Object.freeze({view:id => emit('view',id),save:id => emit('save',id)});
  async function start() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(),15000);
    try {
      const response = await fetch('api/analytics.json',{signal:controller.signal,cache:'no-store',headers:{Accept:'application/json'}});
      if (!response.ok) { active = false; queue.length = 0; return; }
      const config = await response.json();
      if (config.provider !== 'goatcounter' || !config.site) { active = false; queue.length = 0; return; }
      const site = new URL(config.site);
      if (site.protocol !== 'https:' || site.username || site.password || site.port || site.search || site.hash || site.pathname !== '/' ||
        !/^[a-z0-9][a-z0-9-]{0,62}\.goatcounter\.com$/.test(site.hostname) || site.hostname === 'www.goatcounter.com') { active = false; queue.length = 0; return; }
      const isMachine = /\/machine(?:\.html|\/(?:index\.html)?)?$/.test(location.pathname);
      window.goatcounter = {no_onload:true,no_events:true,endpoint:`${site.origin}/count`,path:isMachine ? '/machine' : '/',
        title:isMachine ? 'While You Sleep — machine' : 'While You Sleep — feed',referrer:''};
      const script = document.createElement('script');
      script.src = 'https://gc.zgo.at/count.js';
      script.async = true;
      script.dataset.goatcounter = `${site.origin}/count`;
      script.onload = () => {
        if (typeof window.goatcounter?.count !== 'function') { active = false; queue.length = 0; return; }
        if (typeof window.goatcounter.filter === 'function' && window.goatcounter.filter()) { active = false; queue.length = 0; return; }
        ready = true;
        window.goatcounter.count();
        queue.splice(0).forEach(event => window.goatcounter.count(event));
      };
      script.onerror = () => { active = false; queue.length = 0; };
      document.head.append(script);
    } catch { active = false; queue.length = 0; }
    finally { clearTimeout(timeout); }
  }
  start();
})();
