// Which ways of styling a page survive the preview's content security policy (the same one the Forge iframe applies:
// no 'unsafe-inline' for styles)? Open /csp-probe.html. Each row is applied or not, with the violations the browser
// reported. This is the evidence behind the "legacy Atlaskit Button and Pagination render unstyled" note in CLAUDE.md.
(function () {
  'use strict';
  const RED = 'rgb(255, 0, 0)';
  const violations = [];
  document.addEventListener('securitypolicyviolation', (event) => violations.push(`${event.violatedDirective}: ${(event.sample || event.blockedURI || '').slice(0, 50)}`));

  const experiments = [
    ['<style> element with text (emotion in development)', (el) => {
      const style = document.createElement('style');
      style.appendChild(document.createTextNode('.p1{color:rgb(255,0,0)}'));
      document.head.appendChild(style);
      el.className = 'probe p1';
    }],
    ['empty <style> + insertRule (emotion in production)', (el) => {
      const style = document.createElement('style');
      document.head.appendChild(style);
      style.sheet.insertRule('.p2{color:rgb(255,0,0)}');
      el.className = 'probe p2';
    }],
    ['style="..." attribute through setAttribute', (el) => el.setAttribute('style', 'color:rgb(255,0,0)')],
    ['element.style.color = ... (what React style props do)', (el) => { el.style.color = RED; }],
    ['constructable stylesheet (adoptedStyleSheets)', (el) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('.p5{color:rgb(255,0,0)}');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      el.className = 'probe p5';
    }],
    ['<link rel="stylesheet"> from the same origin (how Atlaskit\'s new components ship their CSS)', (el) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/preview/probe.css';
      document.head.appendChild(link);
      el.className = 'probe p6';
      return new Promise((resolve) => { link.onload = resolve; link.onerror = resolve; });
    }],
  ];

  async function run() {
    const rows = [];
    for (const [name, setup] of experiments) {
      const el = document.createElement('div');
      el.className = 'probe';
      el.textContent = name;
      document.body.appendChild(el);
      const before = violations.length;
      let error = '';
      try { await setup(el); } catch (e) { error = String(e.message || e); }
      await new Promise((resolve) => setTimeout(resolve, 30));
      rows.push({ name, applied: getComputedStyle(el).color === RED, violations: violations.slice(before), error });
    }
    window.__probe = rows;
    const out = document.getElementById('results');
    out.textContent = rows.map((r) => `${r.applied ? 'APPLIED  ' : 'BLOCKED  '} ${r.name}${r.violations.length ? `\n           violation: ${r.violations.join(' | ')}` : ''}${r.error ? `\n           error: ${r.error}` : ''}`).join('\n');
  }
  run();
})();
