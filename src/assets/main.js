/* =====================================================================
   空き家の管理人 ― 画面の動き

   1. スマートフォンのメニュー
   2. 言語の切り替え（選んだ言語を覚えておく）
   3. 物件の絞り込み
   4. 写真のスライド
   5. 動画（押したときだけ読み込む）
   6. 相談フォームの送信

   文言はこのファイルに書きません。ページから受け取った window.AKIYA.text を使います。
   ===================================================================== */
(function () {
  'use strict';

  var A = window.AKIYA || { lang: 'vi', text: {} };
  var T = A.text || {};

  /* 選んだ言語を覚えておく入れ物。
     ブラウザの設定によっては使えないので、失敗してもページは普通に動くようにしています */
  var KEY = 'akiya-lang';
  function saveLang(code) {
    try { window.localStorage.setItem(KEY, code); } catch (e) { /* 使えなくても構いません */ }
  }

  /* ------------------------------------------------------------------
     1. スマートフォンのメニュー
     ------------------------------------------------------------------ */
  var btn = document.querySelector('.menu-btn');
  var nav = document.getElementById('gnav');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* ------------------------------------------------------------------
     2. 言語の切り替え
        押した言語を覚えておき、次にトップへ来たときもその言語で開きます
     ------------------------------------------------------------------ */
  Array.prototype.forEach.call(document.querySelectorAll('[data-lang]'), function (a) {
    a.addEventListener('click', function () { saveLang(a.getAttribute('data-lang')); });
  });
  /* いま見ている言語も覚えておきます（リンクから直接来た人のため） */
  saveLang(A.lang);

  /* ------------------------------------------------------------------
     3. 物件の絞り込み
     ------------------------------------------------------------------ */
  var grid = document.getElementById('pgrid');
  if (grid) {
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.pcard'));
    var hits = document.getElementById('hits');
    var empty = document.getElementById('pempty');
    /* いま選んでいる条件。空文字は「すべて」 */
    var sel = { area: '', type: '', tag: '', price: null, yield: '' };

    function match(c) {
      if (sel.area && c.getAttribute('data-area') !== sel.area) return false;
      if (sel.type && c.getAttribute('data-type') !== sel.type) return false;
      if (sel.tag && (',' + c.getAttribute('data-tags') + ',').indexOf(',' + sel.tag + ',') < 0) return false;
      if (sel.price) {
        /* 価格帯の区切りは、ボタンに書いてある金額（data/settings.json の priceBands）を使います */
        var p = Number(c.getAttribute('data-price'));
        if (p < sel.price.min) return false;
        if (sel.price.max !== null && p > sel.price.max) return false;
      }
      if (sel.yield && !(Number(c.getAttribute('data-yield')) >= Number(sel.yield))) return false;
      return true;
    }
    function apply() {
      var n = 0;
      cards.forEach(function (c) {
        var ok = match(c);
        c.hidden = !ok;
        if (ok) n++;
      });
      if (hits) hits.textContent = n;
      if (empty) empty.hidden = n !== 0;
    }
    Array.prototype.forEach.call(document.querySelectorAll('.frow'), function (row) {
      var g = row.getAttribute('data-group');
      row.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.pill') : null;
        if (!b) return;
        Array.prototype.forEach.call(row.querySelectorAll('.pill'), function (x) { x.classList.remove('is-on'); });
        b.classList.add('is-on');
        var v = b.getAttribute('data-v') || '';
        if (g === 'price') {
          var mx = b.getAttribute('data-max');
          sel.price = v ? { min: Number(b.getAttribute('data-min') || 0), max: mx === '' || mx === null ? null : Number(mx) } : null;
        } else {
          sel[g] = v;
        }
        apply();
      });
    });
  }

  /* ------------------------------------------------------------------
     4. 写真のスライド
        指で横に動かすこともできます
     ------------------------------------------------------------------ */
  Array.prototype.forEach.call(document.querySelectorAll('[data-slider]'), function (s) {
    var track = s.querySelector('.slider__track');
    var now = s.querySelector('[data-slider-now]');
    var items = track.children.length;
    function go(dir) {
      track.scrollBy({ left: dir * track.clientWidth, behavior: 'smooth' });
    }
    s.querySelector('.slider__btn--prev').addEventListener('click', function () { go(-1); });
    s.querySelector('.slider__btn--next').addEventListener('click', function () { go(1); });
    track.addEventListener('scroll', function () {
      var i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      if (now) now.textContent = Math.min(items, i + 1);
    }, { passive: true });
  });

  /* ------------------------------------------------------------------
     5. 動画
        最初から読み込むとページが重くなるので、押したときに差し替えます
     ------------------------------------------------------------------ */
  Array.prototype.forEach.call(document.querySelectorAll('.vid[data-video]'), function (v) {
    v.addEventListener('click', function () {
      var id = v.getAttribute('data-video');
      var box = document.createElement('div');
      box.className = 'vid-frame';
      var f = document.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&rel=0';
      f.title = T.playVideo || 'video';
      f.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
      f.allowFullscreen = true;
      box.appendChild(f);
      v.parentNode.replaceChild(box, v);
    });
  });

  /* ------------------------------------------------------------------
     6. 相談フォーム
        会社サイトと同じ受け口へ送ります。Gmail と Lark に届きます
     ------------------------------------------------------------------ */
  var form = document.getElementById('cform');
  if (form) {
    var box = document.getElementById('fMsgBox');
    var send = document.getElementById('fSend');
    var msg = document.getElementById('fMsg');

    /* 物件の詳細から来たときは、どの物件の相談かを最初から書いておきます */
    try {
      var p = new URLSearchParams(location.search).get('p');
      if (p && msg && !msg.value) msg.value = (T.propertyPrefix || 'ID') + ': ' + p + '\n\n';
    } catch (e) { /* 古いブラウザでは何もしません */ }

    function show(text, ok) {
      box.textContent = text;
      box.className = 'fmsg ' + (ok ? 'ok' : 'ng');
      box.hidden = false;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = String(v).trim(); });

      if (!data.name || !data.email || !data.message) { show(T.missing, false); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) { show(T.badEmail, false); return; }

      send.disabled = true;
      send.textContent = T.sending;
      box.hidden = true;

      fetch(A.formEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
        .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })
        .then(function (d) {
          if (d && d.ok) { form.reset(); show(T.ok, true); }
          else { show(T.ng, false); }
        })
        .catch(function () { show(T.ng, false); })
        .finally(function () { send.disabled = false; send.textContent = T.send; });
    });
  }
})();
