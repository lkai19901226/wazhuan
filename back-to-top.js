/**
 * 回到顶部按钮 - 全局通用组件
 * 固定定位在内容区域右侧紧挨边缘处，垂直居中。
 * 使用方式：在页面底部 </body> 前引入 <script src="back-to-top.js"></script>
 */
(function () {
  'use strict';

  if (document.getElementById('backToTop')) return;

  var SHOW_THRESHOLD = 300;
  var GAP = 12; // 距离内容区右边缘的像素

  var btn = document.createElement('button');
  btn.id = 'backToTop';
  btn.setAttribute('aria-label', '回到顶部');
  btn.setAttribute('title', '回到顶部');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>';

  // 自动检测滚动容器（仅当容器自身有 overflow:scroll/auto 时才使用，否则回退到 window）
  function getScrollContainer() {
    var el = document.querySelector('.article-page') || document.getElementById('detailContainer');
    if (el) {
      var style = window.getComputedStyle(el);
      var overflowY = style.overflowY;
      // 只有当容器自身可滚动时才用它，否则用 window
      if (overflowY === 'scroll' || overflowY === 'auto') return el;
    }
    return null;
  }

  function getScrollY() {
    var sc = getScrollContainer();
    if (sc) return sc.scrollTop;
    return window.scrollY || document.documentElement.scrollTop;
  }

  function scrollToTop() {
    var sc = getScrollContainer();
    if (sc) {
      sc.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // 查找主内容区：按优先级匹配所有已知页面容器
  function getMainContent() {
    return document.querySelector('.main-content') ||      // index.html
           document.getElementById('detailContainer') ||   // detail.html
           document.querySelector('.article-page') ||      // article.html
           document.querySelector('.app-detail-page') ||   // app-detail.html
           document.querySelector('.main') ||              // editor.html, admin.html
           document.querySelector('.editor-wrapper') ||    // editor.html 回退
           null;
  }

  function positionBtn() {
    var content = getMainContent();

    if (content) {
      var rect = content.getBoundingClientRect();
      var btnLeft = rect.right + GAP;
      // 防止按钮超出视口右边界
      if (btnLeft + btn.offsetWidth > window.innerWidth - 8) {
        btnLeft = window.innerWidth - btn.offsetWidth - 8;
      }
      btn.style.left = btnLeft + 'px';
      btn.style.right = 'auto';
    } else {
      btn.style.left = 'auto';
      btn.style.right = '20px';
    }
  }

  btn.addEventListener('click', scrollToTop);

  var handler = function () {
    btn.classList.toggle('visible', getScrollY() > SHOW_THRESHOLD);
  };

  var sc = getScrollContainer();
  if (sc) {
    sc.addEventListener('scroll', handler, { passive: true });
  } else {
    window.addEventListener('scroll', handler, { passive: true });
  }

  // 持续监听位置变化（页面动态渲染、侧边栏展开等）
  var rafId;
  function watchPosition() {
    positionBtn();
    rafId = requestAnimationFrame(watchPosition);
  }

  // 监听窗口 resize
  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(positionBtn, 100);
  });

  function insert() {
    if (!document.body) {
      requestAnimationFrame(insert);
      return;
    }
    document.body.appendChild(btn);
    requestAnimationFrame(function () {
      positionBtn();
      handler();
      watchPosition();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', insert);
  } else {
    insert();
  }
})();
