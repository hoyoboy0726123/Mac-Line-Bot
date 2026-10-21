// 雲端主機用 UTC；把 Date 的「本地時間」固定成台灣時間（UTC+8，沒有夏令時間），
// 每日統計、每日摘要時間、預約日期才會跟桌面版一樣。
const OFFSET = 8 * 60; // 分鐘
const MS = OFFSET * 60000;
const D = Date.prototype;
const shifted = (d) => new Date(d.getTime() + MS);

for (const name of ['FullYear', 'Month', 'Date', 'Day', 'Hours', 'Minutes', 'Seconds', 'Milliseconds']) {
  const getUTC = D[`getUTC${name}`];
  D[`get${name}`] = function () { return getUTC.call(shifted(this)); };
  if (name === 'Day') continue;
  const setUTC = D[`setUTC${name}`];
  D[`set${name}`] = function (...args) {
    const s = shifted(this);
    setUTC.apply(s, args);
    return this.setTime(s.getTime() - MS);
  };
}
D.getTimezoneOffset = function () { return -OFFSET; };
D.toDateString = function () {
  const s = shifted(this);
  return s.toUTCString().slice(0, 16).replace(',', '');
};
export const TIMEZONE = 'Asia/Taipei';
