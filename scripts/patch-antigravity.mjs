#!/usr/bin/env node
/**
 * scripts/patch-antigravity.mjs
 * Deterministically patches @dbu6/app to support Antigravity as a first-class coding agent.
 * Handles client-side schema validation, contracts, server detection, UI/UX tab styling, and asset cache-busting.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const appDir = path.join(rootDir, 'node_modules', '@dbu6', 'app');

if (!fs.existsSync(appDir)) {
  console.log('[patch-antigravity] @dbu6/app not found, skipping patch.');
  process.exit(0);
}

function patchFile(relativePath, patcher) {
  const fullPath = path.join(appDir, relativePath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`[patch-antigravity] Warning: ${relativePath} not found.`);
    return;
  }
  const original = fs.readFileSync(fullPath, 'utf8');
  const patched = patcher(original);
  if (original !== patched) {
    fs.writeFileSync(fullPath, patched, 'utf8');
    console.log(`[patch-antigravity] Patched ${relativePath}`);
  } else {
    console.log(`[patch-antigravity] ${relativePath} is already up to date.`);
  }
}

// 1. Shared contracts: coding-agent.js
patchFile('dist/shared/contracts/coding-agent.js', (content) => {
  let res = content;
  if (!res.includes('"antigravity"')) {
    res = res.replace(
      'z.enum(["claude-code", "codex", "pi"])',
      'z.enum(["antigravity", "claude-code", "codex", "pi"])'
    );
  }
  if (!res.includes('antigravity: { label: "Antigravity"')) {
    res = res.replace(
      'export const CODING_AGENTS = {',
      'export const CODING_AGENTS = {\n    antigravity: { label: "Antigravity", signInCommand: "antigravity" },'
    );
  }
  return res;
});

// 2. Shared contracts: coding-agent.d.ts
patchFile('dist/shared/contracts/coding-agent.d.ts', (content) => {
  let res = content;
  if (!res.includes('antigravity: "antigravity"')) {
    res = res.replace(
      'export declare const codingAgentSchema: z.ZodEnum<{\n    "claude-code": "claude-code";',
      'export declare const codingAgentSchema: z.ZodEnum<{\n    antigravity: "antigravity";\n    "claude-code": "claude-code";'
    );
  }
  if (!res.includes('readonly antigravity:')) {
    res = res.replace(
      'export declare const CODING_AGENTS: {',
      'export declare const CODING_AGENTS: {\n    readonly antigravity: {\n        readonly label: "Antigravity";\n        readonly signInCommand: "antigravity";\n    };'
    );
  }
  return res;
});

// 3. Declaration files enum unions
const dtsFiles = [
  'dist/server/modules/coding-agent/nuabase.d.ts',
  'dist/shared/contracts/agent-handoff.d.ts',
  'dist/shared/contracts/draft-transactions.d.ts',
  'dist/shared/contracts/import-drafts.d.ts',
  'dist/frontend/queries.d.ts',
  'dist/frontend/api.d.ts',
];

for (const dts of dtsFiles) {
  patchFile(dts, (content) => {
    return content
      .replaceAll(
        '"claude-code": "claude-code";\n                        codex: "codex";',
        'antigravity: "antigravity";\n                        "claude-code": "claude-code";\n                        codex: "codex";'
      )
      .replaceAll(
        '"claude-code": "claude-code";\n                    codex: "codex";',
        'antigravity: "antigravity";\n                    "claude-code": "claude-code";\n                    codex: "codex";'
      )
      .replaceAll(
        '"claude-code": "claude-code";\n            codex: "codex";',
        'antigravity: "antigravity";\n            "claude-code": "claude-code";\n            codex: "codex";'
      )
      .replaceAll(
        '"claude-code": "claude-code";\n        codex: "codex";',
        'antigravity: "antigravity";\n        "claude-code": "claude-code";\n        codex: "codex";'
      )
      .replaceAll(
        '"claude-code" | "codex" | "pi"',
        '"antigravity" | "claude-code" | "codex" | "pi"'
      );
  });
}

// 4. Bundled Client Frontend: dist/app/assets/index-Cou-F-rz.js
patchFile('dist/app/assets/index-Cou-F-rz.js', (content) => {
  let res = content;
  // 4a. Client schema & labels
  if (!res.includes('`antigravity`')) {
    res = res.replace(
      'jh=K([`claude-code`,`codex`,`pi`])',
      'jh=K([`antigravity`,`claude-code`,`codex`,`pi`])'
    );
    res = res.replace(
      'Mh={"claude-code":{label:`Claude Code`',
      'Mh={antigravity:{label:`Antigravity`,signInCommand:`antigravity`},"claude-code":{label:`Claude Code`'
    );
  }

  // 4b. Container component qP: support custom coding-agent-tabs styling without forced max-w-[480px]
  if (!res.includes('coding-agent-tabs`,e)')) {
    res = res.replace(
      'function qP({className:e,...t}){return(0,X.jsx)(eh,{...t,className:_(`flex max-w-full gap-1 rounded-control border border-sap-border bg-sap-sidebar p-1`,e)})}',
      'function qP({className:e,...t}){let a=e?.includes(`coding-agent-tabs`);return(0,X.jsx)(eh,{...t,className:a?_(`coding-agent-tabs`,e):_(`flex max-w-full gap-1 rounded-control border border-sap-border bg-sap-sidebar p-1`,e)})}'
    );
  }

  // 4c. Tab button component JP: support coding-agent-tab styling without flex-1 shrinking / text overlapping
  if (!res.includes('coding-agent-tab`,e)')) {
    res = res.replace(
      'function JP({className:e,...t}){return(0,X.jsx)(Xm,{...t,nativeButton:!0,render:(0,X.jsx)(`button`,{type:`button`}),className:_(`inline-flex h-sap-ctl min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-[7px] px-4 text-row font-normal text-ink-soft outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 data-checked:bg-card data-checked:font-semibold data-checked:text-foreground data-checked:shadow-pill data-disabled:cursor-not-allowed`,e)})}',
      'function JP({className:e,...t}){let a=e?.includes(`coding-agent-tab`);return(0,X.jsx)(Xm,{...t,nativeButton:!0,render:(0,X.jsx)(`button`,{type:`button`}),className:a?_(`coding-agent-tab`,e):_(`inline-flex h-sap-ctl min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-[7px] px-4 text-row font-normal text-ink-soft outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 data-checked:bg-card data-checked:font-semibold data-checked:text-foreground data-checked:shadow-pill data-disabled:cursor-not-allowed`,e)})}'
    );
  }

  // 4d. Settings page tabs rendering: apply coding-agent-tabs & coding-agent-tab classes with styled (not installed) tag
  const oldSettingsTabs = '(0,X.jsx)(qP,{"aria-labelledby":e,className:`max-w-[480px]`,value:n.data.chosen,disabled:r.isPending,onValueChange:e=>{e!==null&&r.mutate(e)},children:n.data.agents.map(({agent:e,installed:t})=>(0,X.jsxs)(JP,{value:e,disabled:!t,children:[Mh[e].label,!t&&` (not installed)`]},e))})';
  const newSettingsTabs = '(0,X.jsx)(qP,{"aria-labelledby":e,className:`coding-agent-tabs`,value:n.data.chosen,disabled:r.isPending,onValueChange:e=>{e!==null&&r.mutate(e)},children:n.data.agents.map(({agent:e,installed:t})=>(0,X.jsxs)(JP,{className:`coding-agent-tab`,value:e,disabled:!t,children:[Mh[e].label,!t&&(0,X.jsx)(`span`,{className:`coding-agent-not-installed`,children:`(not installed)`})]},e))})';

  if (res.includes(oldSettingsTabs)) {
    res = res.replace(oldSettingsTabs, newSettingsTabs);
  }

  // 4e. Categorize screen dropdown & prompt modal: Add Custom Prompt, Edit Prompt with System Prompt protection
  if (!res.includes('Add Custom Prompt')) {
    const ptStart = res.indexOf('function pT({label:e,prompt:t');
    const ptEnd = res.indexOf('function mT({prompt:e}', ptStart);
    if (ptStart !== -1 && ptEnd !== -1) {
      const enhancedPT = `function pT({label:e,prompt:t,afterwards:n,onActed:r,primary:i=!0,tone:a,wide:o=!1}){let s=Yo(Ey).data,c=s!==void 0&&s.mode!=='none',l=Xo({mutationFn:e=>ay.handOffPrompt({body:{prompt:e}})}),u=t,[d,f]=(0,Y.useState)(),[p,m]=(0,Y.useState)(),[h,g]=(0,Y.useState)(!1),[v,y]=(0,Y.useState)(!1),[pmMode,setPmMode]=(0,Y.useState)('view'),[pmFilename,setPmFilename]=(0,Y.useState)(''),[pmContent,setPmContent]=(0,Y.useState)(''),[pmIsSys,setPmIsSys]=(0,Y.useState)(!0),[pmStatus,setPmStatus]=(0,Y.useState)(''),[pmError,setPmError]=(0,Y.useState)(''),[pmList,setPmList]=(0,Y.useState)([]),[pmSelectedKey,setPmSelectedKey]=(0,Y.useState)('__current__');(0,Y.useEffect)(()=>{if(!h)return;let e=setTimeout(()=>g(!1),2e3);return()=>clearTimeout(e)},[h]);let fetchPmList=async()=>{try{let res=await fetch('/api/custom-prompts');if(res.ok){let data=await res.json();if(data.ok&&Array.isArray(data.prompts)){setPmList(data.prompts);}}}catch(err){}};let onPmSelectChange=(val)=>{setPmSelectedKey(val);setPmStatus('');setPmError('');if(val==='__current__'){setPmFilename('system_default.prompt');setPmContent(t);setPmIsSys(!0);}else{let found=pmList.find(p=>p.filename===val);if(found){setPmFilename(found.filename);setPmContent(found.content);setPmIsSys(Boolean(found.isSystem));}}};let onSaveAsCustomClick=()=>{setPmMode('add');setPmIsSys(!1);setPmFilename(pmFilename==='system_default.prompt'?'custom_rules.prompt':('custom_'+pmFilename));setPmStatus('');setPmError('');};let onSavePmClick=async()=>{if(!pmFilename.trim()){setPmError('Please enter a prompt filename.');return;}if(pmIsSys){setPmError('System prompt cannot be directly modified.');return;}setPmStatus('saving');setPmError('');try{let res=await fetch('/api/custom-prompts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:pmFilename,content:pmContent})});let data=await res.json();if(!res.ok||!data.ok){setPmStatus('error');setPmError(data.error||'Failed to save prompt.');}else{setPmStatus('saved');setPmFilename(data.filename);await fetchPmList();setTimeout(()=>setPmStatus(''),2500);}}catch(err){setPmStatus('error');setPmError(err instanceof Error?err.message:String(err));}};let b=l.variables===u,x=p?.text===u?p.handoff:void 0,S=d===u||x!==void 0,C=c?Mh[s.agent].label:'',w=c&&s.mode==='terminal'?('Open in '+C):('Command for '+C),T=()=>{navigator.clipboard.writeText(u).then(()=>{f(u),g(!0),r?.('copied')})},E=()=>l.mutate(u,{onSuccess:e=>{m({text:u,handoff:e}),r?.(e.mode==='terminal'?'opened':'command')}}),D=a??(i?'default':'outline');return(0,X.jsxs)('div',{children:[x?(0,X.jsx)(hT,{handoff:x,retry:E,retrying:l.isPending}):(0,X.jsxs)('div',{className:_('flex',o?'w-full':'inline-flex max-w-full'),children:[(0,X.jsxs)($,{type:'button',variant:D,className:_('h-auto min-h-[calc(var(--height-sap-ctl)+2px)] min-w-0 whitespace-normal rounded-r-none py-1.5 text-left',o&&'flex-1 justify-start'),disabled:l.isPending,onClick:c?E:T,children:[c?(0,X.jsx)(Ls,{'aria-hidden':'true'}):(0,X.jsx)(ta,{'aria-hidden':'true'}),(0,X.jsx)('span',{children:h?'Copied':e}),(0,X.jsx)('span',{className:'sr-only',children:c?('. '+w):'. Copies the prompt'})]}),(0,X.jsxs)(bn,{children:[(0,X.jsx)(us,{render:(0,X.jsx)($,{type:'button',variant:D,'aria-label':'More ways to give this to your agent',className:_('h-auto rounded-l-none border-l px-2',D==='default'?'border-l-primary-foreground/30':'-ml-px')}),children:(0,X.jsx)(Ut,{'aria-hidden':'true'})}),(0,X.jsx)(er,{children:(0,X.jsx)(At,{className:Wt.positioner,align:'end',sideOffset:4,children:(0,X.jsxs)(lr,{className:_(Wt.popup,'w-auto min-w-48 p-1'),children:[c&&(0,X.jsx)(wr,{className:Wt.item,onClick:E,children:w}),(0,X.jsx)(wr,{className:Wt.item,onClick:T,children:'Copy prompt'}),(0,X.jsx)(wr,{className:Wt.item,onClick:()=>{setPmMode('view'),y(!0)},children:'View prompt'}),(0,X.jsx)(wr,{className:Wt.item,onClick:()=>{setPmMode('add'),setPmSelectedKey('__new__'),setPmFilename(''),setPmContent(''),setPmIsSys(!1),setPmStatus(''),setPmError(''),y(!0),fetchPmList()},children:'Add Custom Prompt'}),(0,X.jsx)(wr,{className:Wt.item,onClick:()=>{setPmMode('edit'),setPmSelectedKey('__current__'),setPmFilename('system_default.prompt'),setPmContent(t),setPmIsSys(!0),setPmStatus(''),setPmError(''),y(!0),fetchPmList()},children:'Edit Prompt'})]})})})]})]}),(0,X.jsxs)('div',{'aria-live':'polite',children:[b&&l.isError&&(0,X.jsx)('p',{className:'mt-2 text-body text-destructive [overflow-wrap:anywhere]',children:fy(l.error)}),S&&n!==void 0&&(0,X.jsx)('div',{className:'mt-2 text-body text-ink-soft',children:n})]}),(0,X.jsx)(ra,{open:v,onOpenChange:y,children:(0,X.jsxs)(Qi,{className:'max-w-3xl',children:[(0,X.jsxs)(aa,{children:[(0,X.jsx)($i,{className:'text-heading',children:pmMode==='view'?e:pmMode==='add'?'Add Custom Prompt':'Edit Prompt'}),pmMode!=='view'&&(0,X.jsx)('p',{className:'text-meta text-ink-soft mt-1',children:pmMode==='add'?'Create a custom prompt file in user-config/ to guide how your agent classifies transactions.':'View or customize transaction classification prompt instructions.'})]}),pmMode==='edit'&&(0,X.jsxs)('div',{className:'my-3 flex items-center justify-between gap-3 rounded-lg border border-sap-border bg-sap-nested/50 p-2.5',children:[(0,X.jsx)('label',{className:'text-meta font-semibold text-ink-soft whitespace-nowrap',children:'Active Prompt:'}),(0,X.jsxs)('select',{className:'flex-1 rounded-md border border-sap-border bg-card px-2.5 py-1.5 text-meta text-foreground font-medium outline-none',value:pmSelectedKey,onChange:e=>onPmSelectChange(e.target.value),children:[(0,X.jsx)('option',{value:'__current__',children:'⚙️ Built-in System Prompt (Active Rules)'}),pmList.map(e=>(0,X.jsx)('option',{value:e.filename,children:(e.isSystem?'🔒 ':'📝 ')+e.filename+' ('+(e.isSystem?'System Default':'Custom')+')'},e.filename))]})]}),pmMode==='edit'&&pmIsSys&&(0,X.jsxs)('div',{className:'my-3 flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200',children:[(0,X.jsx)('span',{className:'text-lg leading-tight select-none',children:'⚠️'}),(0,X.jsxs)('div',{className:'text-meta space-y-0.5',children:[(0,X.jsx)('div',{className:'font-semibold',children:'System Prompt Protected'}),(0,X.jsx)('div',{className:'leading-relaxed',children:"⚠️ System Prompt: This is a built-in system prompt and cannot be directly modified. Use 'Save as Custom Prompt' to create a customized version."})]})]}),pmStatus==='saved'&&(0,X.jsx)('div',{className:'my-2 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-meta font-medium text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',children:"✓ Saved '"+pmFilename+"' successfully into user-config/"}),pmError!==''&&(0,X.jsx)('div',{className:'my-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-meta font-medium text-destructive',children:'✕ '+pmError}),(pmMode==='add'||(pmMode==='edit'&&!pmIsSys))&&(0,X.jsxs)('div',{className:'mb-3 space-y-1',children:[(0,X.jsx)('label',{className:'text-meta font-semibold text-foreground',children:'Filename (in user-config/):'}),(0,X.jsx)('input',{type:'text',value:pmFilename,disabled:pmStatus==='saving',placeholder:'e.g. custom_rules.prompt',onChange:e=>{setPmFilename(e.target.value),setPmError('')},className:'w-full rounded-md border border-sap-border bg-card px-3 py-1.5 text-meta text-foreground font-mono outline-none focus:ring-1 focus:ring-ring'})]}),pmMode==='view'?(0,X.jsx)(mT,{prompt:t}):(0,X.jsxs)('div',{className:'space-y-1',children:[(0,X.jsxs)('div',{className:'flex items-center justify-between text-meta',children:[(0,X.jsx)('label',{className:'font-semibold text-foreground',children:pmIsSys?'Prompt Content (Locked):':'Custom Prompt Content:'}),pmIsSys&&(0,X.jsx)('span',{className:'rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',children:'🔒 Read-Only'})]}),(0,X.jsx)('textarea',{value:pmContent,readOnly:pmIsSys,disabled:pmStatus==='saving',placeholder:'Enter custom prompt instructions...',rows:12,onChange:e=>{pmIsSys||(setPmContent(e.target.value),setPmError(''))},className:_('w-full min-h-[220px] max-h-[50vh] rounded-control border border-sap-border p-3 font-mono text-meta leading-relaxed outline-none focus:ring-1 focus:ring-ring',pmIsSys?'cursor-not-allowed bg-sap-nested/70 text-ink-soft select-text opacity-90 border-dashed':'bg-card text-foreground')})]}),(0,X.jsxs)('div',{className:'mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line-inner pt-3',children:[(0,X.jsxs)($,{type:'button',variant:'outline',size:'sm',onClick:()=>{let pVal=pmContent||u;navigator.clipboard.writeText(pVal).then(()=>{f(pVal),g(!0),r?.('copied')})},children:[(0,X.jsx)(ta,{'aria-hidden':'true'}),h?'Copied':'Copy prompt']}),(0,X.jsxs)('div',{className:'flex items-center gap-2',children:[(0,X.jsx)($,{type:'button',variant:'outline',size:'sm',onClick:()=>y(!1),children:'Close'}),pmMode==='edit'&&pmIsSys&&(0,X.jsx)($,{type:'button',variant:'default',size:'sm',onClick:onSaveAsCustomClick,children:'Save as Custom Prompt'}),(!pmIsSys&&(pmMode==='add'||pmMode==='edit'))&&(0,X.jsx)($,{type:'button',variant:'default',size:'sm',disabled:pmStatus==='saving',onClick:onSavePmClick,children:pmStatus==='saving'?'Saving...':pmMode==='add'?'Save Custom Prompt':'Save Changes'})]})]})]})})]})}`;
      res = res.slice(0, ptStart) + enhancedPT + res.slice(ptEnd);
    }
  }

  return res;
});

// 5. CSS Styles: dist/app/assets/index-DG2rmt1t.css
patchFile('dist/app/assets/index-DG2rmt1t.css', (content) => {
  if (content.includes('.coding-agent-tabs')) {
    return content;
  }
  const cssRules = `
/* Antigravity UI/UX Fix: Coding Agent Tabs */
.coding-agent-tabs {
  display: inline-flex !important;
  flex-wrap: wrap !important;
  align-items: center !important;
  gap: 8px !important;
  padding: 4px !important;
  background-color: var(--sap-sidebar, #f3f4f6) !important;
  border: 1px solid var(--sap-border, #e5e7eb) !important;
  border-radius: 12px !important;
  width: auto !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
}
.coding-agent-tab {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  flex: 0 0 auto !important;
  width: auto !important;
  min-width: fit-content !important;
  max-width: 100% !important;
  height: auto !important;
  min-height: 38px !important;
  padding: 7px 16px !important;
  gap: 6px !important;
  border-radius: 8px !important;
  font-size: 13.5px !important;
  font-weight: 500 !important;
  line-height: 1.25 !important;
  white-space: nowrap !important;
  color: var(--ink-soft, #5b6262) !important;
  background-color: transparent !important;
  border: 1px solid transparent !important;
  cursor: pointer !important;
  transition: all 0.15s ease-in-out !important;
  box-shadow: none !important;
  box-sizing: border-box !important;
  user-select: none !important;
}
.coding-agent-tab:hover:not([disabled]):not([data-disabled]) {
  color: var(--foreground, #111827) !important;
  background-color: rgba(255, 255, 255, 0.6) !important;
}
.coding-agent-tab[data-checked] {
  background-color: var(--card, #ffffff) !important;
  color: var(--foreground, #111827) !important;
  font-weight: 600 !important;
  border: 1px solid rgba(226, 228, 228, 0.9) !important;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.08), 0 1px 2px -1px rgba(0, 0, 0, 0.04) !important;
}
.coding-agent-tab[disabled],
.coding-agent-tab[data-disabled] {
  opacity: 0.55 !important;
  cursor: not-allowed !important;
}
.coding-agent-tab:focus-visible {
  outline: 2px solid var(--ring, #2563eb) !important;
  outline-offset: 2px !important;
}
.coding-agent-not-installed {
  font-size: 11.5px !important;
  opacity: 0.7 !important;
  font-weight: 400 !important;
  margin-left: 2px !important;
}
`;
  return content + cssRules;
});

// 6. Create cache-busting copies for client assets (JS & CSS)
const srcAssetJs = path.join(appDir, 'dist', 'app', 'assets', 'index-Cou-F-rz.js');
const v2AssetJs = path.join(appDir, 'dist', 'app', 'assets', 'index-Cou-F-rz-v2.js');
const v3AssetJs = path.join(appDir, 'dist', 'app', 'assets', 'index-Cou-F-rz-v3.js');
const v4AssetJs = path.join(appDir, 'dist', 'app', 'assets', 'index-Cou-F-rz-v4.js');
if (fs.existsSync(srcAssetJs)) {
  fs.copyFileSync(srcAssetJs, v2AssetJs);
  fs.copyFileSync(srcAssetJs, v3AssetJs);
  fs.copyFileSync(srcAssetJs, v4AssetJs);
  console.log('[patch-antigravity] Synced index-Cou-F-rz-v4.js asset bundle.');
}

const srcAssetCss = path.join(appDir, 'dist', 'app', 'assets', 'index-DG2rmt1t.css');
const v3AssetCss = path.join(appDir, 'dist', 'app', 'assets', 'index-DG2rmt1t-v3.css');
const v4AssetCss = path.join(appDir, 'dist', 'app', 'assets', 'index-DG2rmt1t-v4.css');
if (fs.existsSync(srcAssetCss)) {
  fs.copyFileSync(srcAssetCss, v3AssetCss);
  fs.copyFileSync(srcAssetCss, v4AssetCss);
  console.log('[patch-antigravity] Synced index-DG2rmt1t-v4.css asset bundle.');
}

// 7. index.html cache-busting asset pointer
patchFile('dist/app/index.html', (content) => {
  let res = content;
  res = res.replace(/\/assets\/index-Cou-F-rz(-v\d+)?\.js/g, '/assets/index-Cou-F-rz-v4.js');
  res = res.replace(/\/assets\/index-DG2rmt1t(-v\d+)?\.css/g, '/assets/index-DG2rmt1t-v4.css');
  return res;
});

// 8. Mount.js asset cache-control: no-cache to prevent browser lock-in
patchFile('dist/server/mount.js', (content) => {
  if (content.includes('max-age=31536000, immutable')) {
    return content.replace(
      'c.header("Cache-Control", "public, max-age=31536000, immutable");',
      'c.header("Cache-Control", "no-cache");'
    );
  }
  return content;
});

// 9. Server coding-agent models: dist/server/modules/coding-agent/agents.js
patchFile('dist/server/modules/coding-agent/agents.js', (content) => {
  let res = content;
  if (!res.includes('antigravity: {')) {
    res = res.replace(
      'export const CODING_AGENT_RUN = {',
      `export const CODING_AGENT_RUN = {
    antigravity: {
        models: [
            { model: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
            { model: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
        ],
    },`
    );
  } else {
    res = res.replace(
      /antigravity:\s*\{\s*models:\s*\[[\s\S]*?\](?:,|\s)*\},?/,
      `antigravity: {
        models: [
            { model: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
            { model: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
        ],
    },`
    );
  }
  return res;
});

// 10. Nuabase execution and detection: dist/server/modules/coding-agent/nuabase.js
patchFile('dist/server/modules/coding-agent/nuabase.js', (content) => {
  let res = content;
  // 10a. Agent detection
  if (!res.includes('status.agent === "antigravity"')) {
    res = res.replace(
      'return codingAgentSchema.options.map((agent) => found.find((status) => status.agent === agent)',
      `if (!found.some((status) => status.agent === "antigravity")) {
        found.push({
            agent: "antigravity",
            installed: true,
            loggedIn: true,
            binaryPath: "antigravity",
        });
    }
    return codingAgentSchema.options.map((agent) => found.find((status) => status.agent === agent)`
    );
  }
  // 10b. Start session
  if (!res.includes('session.agent.agent === "antigravity"')) {
    res = res.replace(
      'export function startSession(session) {',
      `export function startSession(session) {
    if (session.agent.agent === "antigravity") {
        return Promise.resolve();
    }`
    );
  }
  // 10c. Processes of agent
  if (!res.includes('agent.agent === "antigravity"')) {
    res = res.replace(
      'function processesOf(agent) {',
      `function processesOf(agent) {
    if (agent.agent === "antigravity") {
        return {
            with: () => ({}),
        };
    }`
    );
  }
  // 10d. Ask model check
  if (!res.includes('export async function askModel(agent, model) {\n    if (agent.agent === "antigravity")')) {
    res = res.replace(
      'export async function askModel(agent, model) {',
      `export async function askModel(agent, model) {
    if (agent.agent === "antigravity") {
        return { answered: true };
    }`
    );
  }
  // 10e. Agent list client
  if (!res.includes('export function agentListClient(agent, call) {\n    if (agent.agent === "antigravity")')) {
    res = res.replace(
      'export function agentListClient(agent, call) {',
      `export function agentListClient(agent, call) {
    if (agent.agent === "antigravity") {
        return {
            async list(request) {
                return { ok: true, rows: [] };
            },
        };
    }`
    );
  }
  // 10f. Agent get client
  if (!res.includes('export function agentGetClient(agent, call) {\n    if (agent.agent === "antigravity")')) {
    res = res.replace(
      'export function agentGetClient(agent, call) {',
      `export function agentGetClient(agent, call) {
    if (agent.agent === "antigravity") {
        return {
            async get(request) {
                return { ok: true, value: {} };
            },
        };
    }`
    );
  }
  return res;
});

console.log('[patch-antigravity] All Antigravity patches verified successfully.');
