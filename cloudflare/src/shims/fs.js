'use strict';
// 雲端版沒有檔案系統。只提供圖文選單圖片（打包時內嵌），其他讀檔一律當作找不到。
import menu from '../../../windows/src/core/assets/richmenu-mil.png';

const notFound = (p) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
export function readFileSync(p) {
  if (/richmenu-mil\.png$/.test(String(p))) return Buffer.from(menu);
  throw notFound(p);
}
export const existsSync = () => false;
export const mkdirSync = () => {};
export const writeFileSync = () => {};
export const appendFileSync = () => {};
export const renameSync = () => {};
export const copyFileSync = () => {};
export const unlinkSync = () => {};
export const chmodSync = () => {};
export const readdirSync = () => [];
export default { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync, renameSync, copyFileSync, unlinkSync, chmodSync, readdirSync };
