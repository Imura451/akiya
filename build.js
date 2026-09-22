#!/usr/bin/env node
/*
 * 空き家の管理人 ― 3言語のページを書き出す
 *
 *   node build.js
 *
 * 読むもの
 *   lang/vi.json・ja.json・en.json … ページの文言（Huong さんが直すファイル）
 *   data/properties.json          … 物件（井村さんが足すファイル）
 *   data/settings.json            … 為替レート・連絡先・提携業者・動画
 *   src/                          … ページのひな形・見た目・動き
 *   assets/                       … 写真
 *
 * 書き出すもの（docs/ に作ります。中身は毎回作り直します）
 *   docs/index.html               … 言語を判定して振り分ける入口
 *   docs/vi/・ja/・en/            … 言語ごとのページ
 *   docs/vi/p/<物件ID>.html       … 物件の詳細
 *   docs/sitemap.xml・robots.txt・404.html
 *
 * Node.js の標準機能だけで動きます。追加のインストールは不要です。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const LANG_DIR = path.join(ROOT, 'lang');
const DATA_DIR = path.join(ROOT, 'data');
const SRC_DIR = path.join(ROOT, 'src');
const ASSET_DIR = path.join(ROOT, 'assets');
const DOCS = path.join(ROOT, 'docs');

/* 言語。先頭がいちばん優先されます（ベトナム語が基本） */
const LANGS = ['vi', 'ja', 'en'];

/* ページ。nav は上部メニューに出すかどうか */
const PAGES = [
  { key: 'index',      file: 'index.html',      nav: true },
  { key: 'properties', file: 'properties.html', nav: true },
  { key: 'flow',       file: 'flow.html',       nav: true },
  { key: 'services',   file: 'services.html',   nav: true },
  { key: 'about',      file: 'about.html',      nav: true },
  { key: 'contact',    file: 'contact.html',    nav: false }
];
/* メニューの見出しに使う文言の場所 */
const NAV_LABEL = { index: 'home', properties: 'properties', flow: 'flow',
                    services: 'services', about: 'about', contact: 'contact' };

const warnings = [];
const warn = m => warnings.push(m);

/* ================================================================== *
 * 1. ごく小さなテンプレートエンジン
 *    {{key}}  … 文字を差し込む（< > などは自動で無害化）
 *    {{&key}} … HTMLのまま差し込む
 *    {{#key}}…{{/key}} … 値があるときだけ出す（配列なら繰り返す）
 *    {{^key}}…{{/key}} … 値が無いときだけ出す
 * ================================================================== */
const TOKEN = /\{\{(!|#|\^|\/|&)?\s*([\w.\-]*)\s*\}\}/g;

function parse(tpl, name) {
  const root = { children: [] };
  const stack = [root];
  let last = 0, m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(tpl)) !== null) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.children.push({ type: 'text', value: tpl.slice(last, m.index) });
    last = m.index + m[0].length;
    const sigil = m[1], key = m[2];
    if (sigil === '#' || sigil === '^') {
      const node = { type: sigil === '#' ? 'section' : 'inverted', name: key, children: [] };
      top.children.push(node);
      stack.push(node);
    } else if (sigil === '/') {
      if (stack.length === 1) throw new Error(`${name}: {{/${key}}} に対応する開始がありません`);
      stack.pop();
    } else if (sigil !== '!') {
      top.children.push({ type: 'var', name: key, raw: sigil === '&' });
    }
  }
  if (last < tpl.length) stack[stack.length - 1].children.push({ type: 'text', value: tpl.slice(last) });
  if (stack.length !== 1) throw new Error(`${name}: {{#…}} が閉じられていません`);
  return root;
}

function lookup(stack, name) {
  if (name === '.') return stack[stack.length - 1];
  const parts = name.split('.');
  for (let i = stack.length - 1; i >= 0; i--) {
    let cur = stack[i], ok = true;
    for (const p of parts) {
      if (cur !== null && typeof cur === 'object' && p in cur) cur = cur[p];
      else { ok = false; break; }
    }
    if (ok && cur !== undefined) return cur;
  }
  return undefined;
}

function truthy(v) {
  if (v === undefined || v === null || v === false) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'number') return v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return Boolean(v);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderNodes(nodes, stack) {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') { out += n.value; continue; }
    const v = lookup(stack, n.name);
    if (n.type === 'var') {
      if (v === undefined || v === null || v === false) continue;
      out += n.raw ? String(v) : esc(v);
    } else if (n.type === 'section') {
      if (!truthy(v)) continue;
      if (Array.isArray(v)) v.forEach(item => { out += renderNodes(n.children, stack.concat([item])); });
      else out += renderNodes(n.children, stack.concat([v]));
    } else if (n.type === 'inverted') {
      if (!truthy(v)) out += renderNodes(n.children, stack);
    }
  }
  return out;
}

const tplCache = {};
function render(file, data) {
  if (!tplCache[file]) {
    const src = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    tplCache[file] = parse(src, file);
  }
  return renderNodes(tplCache[file].children, [data]);
}

/* ================================================================== *
 * 2. JSON の読み込み
 *    書き間違いがあったら、何行目の何文字目かを日本語で知らせます
 * ================================================================== */
function readJSON(file) {
  const rel = path.relative(ROOT, file);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { fail(`${rel} が見つかりません。`); }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // メモ帳が付ける見えない文字
  try {
    return JSON.parse(text);
  } catch (e) {
    const m = /position (\d+)/.exec(e.message);
    let where = '';
    if (m) {
      const pos = Number(m[1]);
      const before = text.slice(0, pos);
      const line = before.split('\n').length;
      const col = pos - before.lastIndexOf('\n');
      const src = text.split('\n')[line - 1] || '';
      where = `\n  ${line}行目の${col}文字目あたりです:\n    ${src.trim()}`;
    }
    fail(`${rel} の書き方に誤りがあります。${where}\n` +
         '  よくある原因: 行の最後の「,」の付け忘れ・付けすぎ、「"」の閉じ忘れ、全角の「，」「”」');
  }
}

function fail(msg) {
  console.error('\nエラー: ' + msg + '\n');
  process.exit(1);
}

/* ベトナム語・英語に無い項目は、英語 → 日本語の順で補います。
   Huong さんの翻訳が途中でも、ページが壊れないようにするためです */
function merge(base, over) {
  if (Array.isArray(over)) return over;
  /* 空欄（""）は「わざと空けてある」ものとして、そのまま使います */
  if (over === undefined || over === null) return base;
  if (typeof over !== 'object' || typeof base !== 'object' || Array.isArray(base)) return over;
  const out = Object.assign({}, base);
  for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
  return out;
}

/* 日本語にあって、ほかの言語に無い項目を探します */
function missingKeys(base, other, prefix) {
  const miss = [];
  if (!base || typeof base !== 'object' || Array.isArray(base)) return miss;
  for (const k of Object.keys(base)) {
    if (k.startsWith('_')) continue;
    const p = prefix ? prefix + '.' + k : k;
    if (!other || !(k in other)) miss.push(p);
    else if (typeof base[k] === 'object' && !Array.isArray(base[k])) miss.push(...missingKeys(base[k], other[k], p));
  }
  return miss;
}

/* ================================================================== *
 * 3. 数字の書き方（言語ごと）
 * ================================================================== */
const LOCALE = { vi: 'vi-VN', ja: 'ja-JP', en: 'en-US' };
const THIS_YEAR = new Date().getFullYear();

function num(n, lang, frac) {
  return Number(n).toLocaleString(LOCALE[lang], { minimumFractionDigits: frac || 0, maximumFractionDigits: frac || 2 });
}
function fmtPrice(n, lang, t) {
  if (!n) return '';
  if (lang === 'ja') return n % 10000 === 0 ? num(n / 10000, 'ja') + '万円' : num(n, 'ja') + '円';
  if (lang === 'vi') return num(n, 'vi') + ' ' + t.props.units.yen;
  return '¥' + num(n, 'en');
}
function fmtVnd(n, rate, lang, t) {
  if (!n || !rate) return '';
  const v = n * rate;
  const pre = t.props.vndPrefix;
  if (lang === 'vi') return `${pre} ${num(Math.round(v / 1e6), 'vi')} triệu đồng`;
  if (lang === 'ja') return v >= 1e8 ? `${pre}${num(Math.round(v / 1e7) / 10, 'ja', 1)}億ドン` : `${pre}${num(Math.round(v / 1e4), 'ja')}万ドン`;
  return `${pre} ${num(Math.round(v / 1e6), 'en')} million VND`;
}
function fmtArea(x, lang, t) {
  if (!x && x !== 0) return '';
  return num(x, lang) + (lang === 'ja' ? '' : ' ') + t.props.units.sqm;
}
function fmtBuilt(y, lang) {
  if (!y) return '';
  const age = THIS_YEAR - Number(y);
  if (lang === 'ja') return `${y}年（築${age}年）`;
  if (lang === 'vi') return `${y} (${age} năm)`;
  return `${y} (${age} years)`;
}
function fmtYield(y, lang) {
  if (!y && y !== 0) return '';
  return num(y, lang, 1) + '%';
}
/* {"ja": "...", "vi": "..."} の形から、その言語の文を取り出します */
function loc(v, lang) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'object') return String(v);
  return v[lang] || v.en || v.ja || '';
}

/* ================================================================== *
 * 4. 本体
 * ================================================================== */
function main() {
  const settings = readJSON(path.join(DATA_DIR, 'settings.json'));
  const allProps = readJSON(path.join(DATA_DIR, 'properties.json'));
  if (!Array.isArray(allProps)) fail('data/properties.json は [ ] で囲んだ一覧にしてください。');

  const raw = {};
  for (const L of LANGS) raw[L] = readJSON(path.join(LANG_DIR, L + '.json'));

  /* 翻訳の抜けを知らせます（ページは英語か日本語で補って作ります） */
  for (const L of LANGS) {
    if (L === 'ja') continue;
    const miss = missingKeys(raw.ja, raw[L], '');
    if (miss.length) warn(`lang/${L}.json に無い項目が ${miss.length} 件あります（ほかの言語で補いました）: ${miss.slice(0, 6).join(', ')}${miss.length > 6 ? ' …' : ''}`);
  }
  const T = {};
  for (const L of LANGS) T[L] = L === 'ja' ? raw.ja : merge(merge(raw.ja, raw.en), raw[L]);

  const siteUrl = String(settings.siteUrl || '').replace(/\/?$/, '/');
  /* 検索エンジンに載せるかどうか。false のあいだは、全ページを検索に出さない設定にします */
  const INDEX = settings.searchEngines === true;
  if (!INDEX) warn('検索エンジンには載せない設定です（data/settings.json の searchEngines）。本番の準備が整ったら true にしてください');
  const basePath = new URL(siteUrl).pathname;   // 例: /akiya/
  const rate = settings.exchange && Number(settings.exchange.jpyToVnd) > 0 ? Number(settings.exchange.jpyToVnd) : 0;
  if (!rate) warn('為替レートが未設定のため、ドンでの金額は出していません（data/settings.json の exchange）');
  if (!(settings.partner && settings.partner.name)) warn('提携の宅建業者が未設定のため、「確認中」と表示しています（data/settings.json の partner）');

  /* 載せる物件 */
  const seen = new Set();
  const props = allProps.filter(p => {
    if (!p || !p.id) { warn('id の無い物件がありました。飛ばします'); return false; }
    if (!/^[a-z0-9\-]+$/.test(p.id)) { warn(`物件ID「${p.id}」は半角の小文字・数字・ハイフンだけにしてください。飛ばします`); return false; }
    if (seen.has(p.id)) { warn(`物件ID「${p.id}」が重複しています。2件目を飛ばします`); return false; }
    seen.add(p.id);
    if (p.published === false) return false;
    if (p.sample && !settings.showSamples) return false;
    return true;
  });

  /* 種別と用途の確認。決めた言葉以外が書いてあったら知らせます */
  const TYPES = settings.types || [];
  const TAGS = settings.tags || [];
  for (const p of props) {
    if (!p.type) warn(`${p.id}: 種別（type）がありません。${TYPES.join(' / ')} のどれかを書いてください`);
    else if (TYPES.indexOf(p.type) < 0) warn(`${p.id}: 種別「${p.type}」は決めた言葉にありません。${TYPES.join(' / ')} のどれかにしてください`);
    for (const g of (p.tags || [])) {
      if (TAGS.indexOf(g) < 0) warn(`${p.id}: 用途の印「${g}」は決めた言葉にありません。${TAGS.join(' / ')} のどれかにしてください`);
    }
  }

  /* 写真の確認 */
  for (const p of props) {
    for (const f of (p.photos || [])) {
      if (!fs.existsSync(path.join(ASSET_DIR, 'properties', p.id, f))) {
        warn(`${p.id}: 写真 assets/properties/${p.id}/${f} が見つかりません`);
      }
    }
  }

  /* 書き出し先を作り直します */
  fs.rmSync(DOCS, { recursive: true, force: true });
  fs.mkdirSync(DOCS, { recursive: true });

  /* 見た目・動き・写真を写します */
  copyDir(path.join(SRC_DIR, 'assets'), path.join(DOCS, 'assets'));
  copyDir(ASSET_DIR, path.join(DOCS, 'assets'));

  const sitemap = [];
  let pageCount = 0;

  for (const L of LANGS) {
    const t = T[L];
    const langDir = path.join(DOCS, L);
    fs.mkdirSync(path.join(langDir, 'p'), { recursive: true });

    /* ---- どのページにも共通の値 ---- */
    const common = (root, pageKey, fileForLang, canonical, extra) => {
      const langLinks = LANGS.map(code => ({
        code, short: T[code].meta.langShort, name: T[code].meta.langName,
        href: root + code + '/' + fileForLang, current: code === L
      }));
      const navItems = PAGES.filter(p => p.nav).map(p => ({
        label: t.nav[NAV_LABEL[p.key]], href: root + L + '/' + p.file, current: p.key === pageKey
      }));
      const footerItems = navItems.concat([{ label: t.nav.contact, href: root + L + '/contact.html' }]);
      const peopleView = (t.about.people || []).map(pp => {
        const file = path.join(ASSET_DIR, 'people', pp.key + '.jpg');
        return Object.assign({}, pp, { photo: fs.existsSync(file) ? root + 'assets/people/' + pp.key + '.jpg' : '' });
      });
      const m = settings.messengers || {};
      const mlist = [['zalo', 'Zalo'], ['messenger', 'Messenger'], ['whatsapp', 'WhatsApp'], ['line', 'LINE']]
        .filter(([k]) => m[k]).map(([key, label]) => ({ key, label, url: m[key] }));
      return Object.assign({
        t, lang: L, root, pageKey, siteUrl, canonical,
        alternates: LANGS.map(code => ({ hreflang: code, href: siteUrl + code + '/' + fileForLang.replace(/index\.html$/, '') })),
        ogImage: siteUrl + 'assets/ogp-' + L + '.png',
        company: settings.company,
        address: L === 'ja' ? settings.company.addressJa : settings.company.addressEn,
        zipShown: L === 'ja' ? settings.company.zip + ' ' : '',
        telShown: L === 'ja' ? settings.company.tel : settings.company.telIntl,
        telHref: '+81' + settings.company.tel.replace(/^0/, '').replace(/-/g, ''),
        partner: settings.partner || {},
        videos: settings.videos || {},
        exchange: settings.exchange || {},
        hasVnd: !!rate,
        formEndpoint: settings.form.endpoint,
        langLinks, navItems, footerItems,
        people: peopleView,
        /* 2人で写った写真（assets/people/duo.jpg）があれば、トップでは1枚で見せます */
        duoPhoto: fs.existsSync(path.join(ASSET_DIR, 'people', 'duo.jpg')) ? root + 'assets/people/duo.jpg' : '',
        duoCaption: t.home.duoFromLeft + ' ' + peopleView.map(pp => L === 'ja' ? pp.name + '（' + pp.role + '）' : pp.name + ' (' + pp.role + ')').join(L === 'ja' ? '、' : ', '),
        messengers: { length: mlist.length, list: mlist },
        isVi: L === 'vi', isJa: L === 'ja', isEn: L === 'en',
        year: THIS_YEAR,
        jsText: safeJSON(Object.assign({}, t.contact.form, { playVideo: t.common.playVideo }))
      }, extra || {});
    };

    /* ---- 物件を、その言語の表示に整えます ---- */
    const view = (p, root) => ({
      id: p.id,
      sample: !!p.sample,
      sampleBadge: t.common.sampleBadge,
      noPhoto: t.props.noPhoto,
      labels: t.props.labels,
      href: root + L + '/p/' + p.id + '.html',
      area: p.area || '',
      type: p.type || '',
      typeLabel: (t.props.types || {})[p.type] || '',
      tagsAttr: (p.tags || []).join(','),
      tagList: (p.tags || []).map(g => ({ key: g, label: (t.props.tags || {})[g] || g })),
      price: p.price || 0,
      yieldPercent: p.yieldPercent || 0,
      city: loc(p.city, L),
      priceText: fmtPrice(p.price, L, t),
      vndText: fmtVnd(p.price, rate, L, t),
      landText: fmtArea(p.landArea, L, t),
      buildingText: fmtArea(p.buildingArea, L, t),
      builtText: fmtBuilt(p.builtYear, L),
      yieldText: fmtYield(p.yieldPercent, L),
      yieldBasis: loc(p.yieldBasis, L),
      layout: loc(p.layout, L),
      structure: loc(p.structure, L),
      station: loc(p.station, L),
      status: loc(p.status, L),
      rebuild: loc(p.rebuild, L),
      comment: loc(p.comment, L),
      mapQuery: p.mapQuery || '',
      mapQueryEnc: encodeURIComponent(p.mapQuery || ''),
      /* 動画は2本。videoTalk＝管理人2人の解説、videoVisit＝現地調査の記録。
         以前の書き方（video）も、解説の動画として読みます */
      videoTalk: p.videoTalk || p.video || '',
      videoVisit: p.videoVisit || '',
      visited: !!p.videoVisit,
      badgeVisited: t.props.badgeVisited,
      cover: (p.photos && p.photos[0]) ? root + 'assets/properties/' + p.id + '/' + p.photos[0] : '',
      photos: {
        length: (p.photos || []).length,
        list: (p.photos || []).map((f, i) => ({ src: root + 'assets/properties/' + p.id + '/' + f, alt: `${loc(p.city, L)} ${i + 1}` }))
      }
    });

    const cardsHtml = (list, root) => list.map(p => render('partials/card.html', view(p, root))).join('\n');

    /* 絞り込みの選択肢は、いま載っている物件から作ります。
       選べるものが1つしかない行は、押す意味がないので出しません */
    const areaKeys = [...new Set(props.map(p => p.area).filter(Boolean))];
    const areaOpts = { length: areaKeys.length > 1 ? areaKeys.length : 0,
                       list: areaKeys.map(k => ({ key: k, label: (t.props.areas || {})[k] || k })) };
    const typeKeys = TYPES.filter(k => props.some(p => p.type === k));
    const typeOpts = { length: typeKeys.length > 1 ? typeKeys.length : 0,
                       list: typeKeys.map(k => ({ key: k, label: (t.props.types || {})[k] || k })) };
    /* 用途の印は、1件でも付いていれば出します（付いていない物件との区別になるため） */
    const tagKeys = TAGS.filter(k => props.some(p => (p.tags || []).indexOf(k) >= 0));
    const tagOpts = { length: tagKeys.length,
                      list: tagKeys.map(k => ({ key: k, label: (t.props.tags || {})[k] || k })) };
    /* 価格帯。区切りは data/settings.json の priceBands で変えられます */
    const priceOpts = (settings.priceBands || []).map(b => ({
      key: b.key, min: b.min || 0, max: b.max === null || b.max === undefined ? '' : b.max,
      label: (t.props.priceLabels || {})[b.key] || b.key
    }));

    /* ---- 通常のページ ---- */
    for (const pg of PAGES) {
      const root = '../';
      const canonical = siteUrl + L + '/' + (pg.file === 'index.html' ? '' : pg.file);
      const title = pg.key === 'index'
        ? `${t.meta.siteName}${t.meta.titleSep}${t.home.heroTitle}`
        : `${t.nav[NAV_LABEL[pg.key]]}${t.meta.titleSep}${t.meta.siteName}`;
      const extra = {
        pageTitle: title,
        pageDesc: t.seo[pg.key] || t.seo.home,
        latestCards: { length: Math.min(3, props.length), html: cardsHtml(props.slice(0, 3), root) },
        cards: { length: props.length, html: cardsHtml(props, root) },
        areaOpts, typeOpts, tagOpts, priceOpts,
        heroTitleHtml: phraseHtml(t.home.heroTitle),
        videoTitleHtml: phraseHtml(t.home.videoTitle)
      };
      extra.noindex = !INDEX;
      const data = common(root, pg.key, pg.file, canonical, extra);
      data.body = render('pages/' + pg.file, data);
      fs.writeFileSync(path.join(langDir, pg.file), render('layout.html', data), 'utf8');
      pageCount++;
      sitemap.push(canonical);
    }

    /* ---- 物件の詳細 ---- */
    for (const p of props) {
      const root = '../../';
      const file = 'p/' + p.id + '.html';
      const canonical = siteUrl + L + '/' + file;
      const pv = view(p, root);
      const data = common(root, 'property', file, canonical, {
        p: pv,
        pageTitle: `${pv.city} ${pv.priceText}${t.meta.titleSep}${t.meta.siteName}`,
        pageDesc: [pv.city, pv.priceText, pv.yieldText && `${t.props.labels.yield} ${pv.yieldText}`, pv.station].filter(Boolean).join(' / '),
        noindex: !!p.sample || !INDEX
      });
      data.body = render('pages/property.html', data);
      fs.writeFileSync(path.join(langDir, 'p', p.id + '.html'), render('layout.html', data), 'utf8');
      pageCount++;
      if (!p.sample) sitemap.push(canonical);
    }
  }

  /* ---- 入口（言語を判定して振り分けます） ---- */
  fs.writeFileSync(path.join(DOCS, 'index.html'), entryPage(T, siteUrl, INDEX), 'utf8');

  /* ---- 見つからないページ（どの深さのURLでも出るので、絶対パスで作ります） ---- */
  {
    const L = LANGS[0], t = T[L];
    const data = Object.assign(
      { t, lang: L, root: basePath, pageKey: '404', siteUrl, canonical: siteUrl,
        alternates: [], ogImage: siteUrl + 'assets/ogp-' + L + '.png', noindex: true,
        pageTitle: `${t.notFound.title}${t.meta.titleSep}${t.meta.siteName}`, pageDesc: t.notFound.text,
        company: settings.company, address: settings.company.addressEn, zipShown: '', telShown: settings.company.telIntl,
        telHref: '+81' + settings.company.tel.replace(/^0/, '').replace(/-/g, ''),
        partner: settings.partner || {}, formEndpoint: settings.form.endpoint, year: THIS_YEAR,
        langLinks: LANGS.map(code => ({ code, short: T[code].meta.langShort, name: T[code].meta.langName, href: basePath + code + '/index.html', current: code === L })),
        navItems: [], footerItems: [], jsText: '{}' });
    data.body = render('pages/404.html', data);
    fs.writeFileSync(path.join(DOCS, '404.html'), render('layout.html', data), 'utf8');
  }

  /* ---- 検索エンジン向け ---- */
  if (!INDEX) sitemap.length = 0;   // 載せない設定のあいだは、サイトマップを空にします
  fs.writeFileSync(path.join(DOCS, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    sitemap.map(u => `  <url><loc>${esc(u)}</loc></url>`).join('\n') + '\n</urlset>\n', 'utf8');
  fs.writeFileSync(path.join(DOCS, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}sitemap.xml\n`, 'utf8');
  /* GitHub Pages に「そのまま公開して」と伝えるための空のファイル */
  fs.writeFileSync(path.join(DOCS, '.nojekyll'), '', 'utf8');

  /* ---- 結果 ---- */
  console.log(`\n完了: ${LANGS.length}言語 × ページ ${PAGES.length} ＋ 物件 ${props.length}件 ＝ ${pageCount}ページを書き出しました。`);
  console.log(`  サンプルの物件: ${props.filter(p => p.sample).length}件（本番前に data/settings.json の showSamples を false にしてください）`);
  if (warnings.length) {
    console.log('\n確認してほしいこと:');
    for (const w of warnings) console.log('  ・' + w);
  }
  console.log('');
}

/* 入口のページ。
   前に選んだ言語 → ブラウザの言語 → ベトナム語 の順で決めて、そのページへ移ります */
function entryPage(T, siteUrl, INDEX) {
  const alt = LANGS.map(L => `<link rel="alternate" hreflang="${L}" href="${siteUrl}${L}/">`).join('\n');
  const links = LANGS.map(L => `<li><a href="${L}/index.html" lang="${L}">${esc(T[L].meta.langName)}</a></li>`).join('');
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(T.vi.meta.siteName)} | ${esc(T.ja.meta.siteName)} | ${esc(T.en.meta.siteName)}</title>
<meta name="description" content="${esc(T.vi.seo.home)}">
${INDEX ? '' : '<meta name="robots" content="noindex">'}
<link rel="canonical" href="${siteUrl}">
${alt}
<link rel="alternate" hreflang="x-default" href="${siteUrl}">
<meta property="og:title" content="${esc(T.vi.meta.siteName)} | ${esc(T.vi.home.heroTitle)}">
<meta property="og:description" content="${esc(T.vi.seo.home)}">
<meta property="og:image" content="${siteUrl}assets/ogp-vi.png">
<script>
(function () {
  var ok = ['vi', 'ja', 'en'], l = null;
  try { l = window.localStorage.getItem('akiya-lang'); } catch (e) {}
  if (ok.indexOf(l) < 0) {
    l = null;
    var list = navigator.languages || [navigator.language || ''];
    for (var i = 0; i < list.length && !l; i++) {
      var s = String(list[i]).toLowerCase();
      if (s.indexOf('vi') === 0) l = 'vi';
      else if (s.indexOf('ja') === 0) l = 'ja';
      else if (s.indexOf('en') === 0) l = 'en';
    }
  }
  location.replace((l || 'vi') + '/index.html');
})();
</script>
<style>body{font-family:"Segoe UI",Arial,sans-serif;padding:40px 20px;text-align:center}a{color:#1B2A4A;font-weight:700}ul{list-style:none;padding:0}li{margin:10px 0}</style>
</head>
<body>
<p>${esc(T.vi.meta.siteName)}</p>
<ul>${links}</ul>
</body>
</html>
`;
}

/* ページの中の <script> に文言を埋め込むとき、壊れないように整えます。
   U+2028・U+2029 は目に見えない改行の文字で、そのままだとスクリプトが止まります */
function safeJSON(obj) {
  /* 逆スラッシュも文字コードで持ちます。ソースに直接書くと、編集の途中で消えることがあるためです */
  const BS = String.fromCharCode(92);
  const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
  return JSON.stringify(obj)
    .split('<').join(BS + 'u003c')
    .split(LS).join(BS + 'u2028')
    .split(PS).join(BS + 'u2029');
}

/* 見出しを、読点（, や 、）の位置でだけ折り返すようにします。
   「日本の家／を持つ」「Việt／Nam」のように、言葉の途中で切れるのを防ぎます */
function phraseHtml(text) {
  const parts = String(text || '').split(/(?<=[,、。]|\. )\s*/).filter(Boolean);
  /* 日本語のように単語のあいだに空白を入れない文では、つなぎ目にも空白を入れません。
     入れると「夫と、 ベトナム人」のように、見えるすき間ができてしまいます */
  const joiner = String(text || '').indexOf(' ') >= 0 ? ' ' : '';
  return parts.map(x => '<span class="ph">' + esc(x) + '</span>').join(joiner);
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name.startsWith('.') || name === 'Thumbs.db' || name === 'desktop.ini') continue;
    const s = path.join(src, name), d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

main();
