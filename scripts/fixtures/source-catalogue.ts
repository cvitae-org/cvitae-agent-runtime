import type {IntegrationSourceInfo} from '../../src/contracts/effects.js';
export const boards:IntegrationSourceInfo[]=[
 {domain:'vacancies.example',hosts:['vacancies.example','www.vacancies.example'],name:'Vacancies',scraperId:'vacancies',fetchable:'ok',markets:['pl'],search:true},
 {domain:'html.example',name:'HTML Jobs',scraperId:'html_jobs',fetchable:'ok',markets:['pl'],search:true},
 {domain:'rendered.example',hosts:['rendered.example','it.rendered.example'],name:'Rendered Jobs',scraperId:'rendered_jobs',fetchable:'ok',markets:['pl'],search:true},
 {domain:'manual.example',name:'Manual Jobs',fetchable:'refused',markets:['pl'],search:false},
];
