import type {IntegrationSourceInfo} from '../../contracts/effects.js';
export type Board = IntegrationSourceInfo;
export type BoardFetchability = Board['fetchable'];
export const hostOf=(url:string):string=>{try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}};
export const boardFor=(url:string,boards:readonly Board[]=[]):Board|undefined=>{const host=hostOf(url);return host?boards.find(board=>(board.hosts??[board.domain]).some(domain=>host===domain.replace(/^www\./,''))):undefined;};
export const isFetchable=(url:string,boards:readonly Board[]=[]):boolean=>boardFor(url,boards)?.fetchable!=='refused';
export const searchableBoards=(market='pl',boards:readonly Board[]=[]):Board[]=>boards.filter(board=>board.search&&board.markets.includes(market.toLowerCase()));
export const scrapableBoards=(market='pl',boards:readonly Board[]=[]):Board[]=>searchableBoards(market,boards).filter(board=>board.scraperId!==undefined);
