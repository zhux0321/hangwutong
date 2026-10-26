'use strict';

// 每次打开都重新确认；不把“已知晓”保存为永久授权。
window.AppSession = { accepted: false, ready: false };
const notice = document.getElementById('developmentNotice');
const acknowledge = document.getElementById('developmentAck');
const proceed = document.getElementById('developmentContinue');
notice.addEventListener('cancel', event => event.preventDefault());
acknowledge.onchange = () => { proceed.disabled = !acknowledge.checked; };
function loadAppScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src + '?v=1.4.1';
    script.onload = resolve;
    script.onerror = () => reject(new Error('程序文件加载失败，请重新解压完整交付包'));
    document.body.appendChild(script);
  });
}
document.getElementById('developmentForm').onsubmit = async event => {
  event.preventDefault();
  if (!acknowledge.checked || AppSession.accepted) return;
  proceed.disabled = true;
  proceed.textContent = '正在打开…';
  try {
    await window.LocalData.start();
    await loadAppScript('booking-parser.js');
    await loadAppScript('booking-import.js');
    await loadAppScript('settings.js');
    await loadAppScript('app.js');
    AppSession.accepted = true;
    AppSession.ready = true;
    document.getElementById('application').inert = false;
    notice.close();
    window.dispatchEvent(new Event('hangwutong-ready'));
  } catch (error) {
    document.getElementById('developmentError').textContent = error.message;
    proceed.textContent = '打开失败，请刷新页面重试';
  }
};
notice.showModal();
