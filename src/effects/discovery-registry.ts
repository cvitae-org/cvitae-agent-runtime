/** Installed source definitions, never derived from scraped listing URLs. */
export type DiscoveryRegistration = {
  id: string; label: string; hosts: readonly string[]; refused?: boolean; optIn?: boolean;
  visible?: boolean; defaultSelected?: boolean; browserOnly?: boolean;
  browser?: { listing: string; parameter?: string; planner?: 'bulldogjob' };
};
export const discoveryRegistrations: readonly DiscoveryRegistration[] = [
  { id: 'justjoin', defaultSelected: true, label: 'Just Join IT', hosts: ['justjoin.it'] },
  { id: 'nofluffjobs', defaultSelected: true, label: 'No Fluff Jobs', hosts: ['nofluffjobs.com'] },
  { id: 'pracuj', defaultSelected: true, label: 'Pracuj', hosts: ['pracuj.pl'] },
  { id: 'bulldogjob', browser: { listing: 'https://bulldogjob.pl/companies/jobs', planner: 'bulldogjob' }, label: 'Bulldogjob', hosts: ['bulldogjob.pl'], optIn: true },
  { id: 'theprotocol', browser: { listing: 'https://theprotocol.it/praca', parameter: 'kw' }, label: 'the:protocol', hosts: ['theprotocol.it'], optIn: true },
  { id: 'solidjobs', label: 'SOLID.Jobs', hosts: ['solid.jobs'], optIn: true },
  { id: 'adzuna', visible: false, label: 'Adzuna Polska', hosts: ['adzuna.pl'], optIn: true },
  { id: 'jooble', visible: false, label: 'Jooble Polska', hosts: ['pl.jooble.org'], optIn: true },
  { id: 'careerjet', visible: false, label: 'Careerjet Polska', hosts: ['careerjet.pl', 'jobviewtrack.com'], optIn: true },
  { id: 'arbeitnow', visible: false, label: 'Arbeitnow', hosts: ['arbeitnow.com', 'arbeitnow.co.uk', 'arbeitnow.fr'], optIn: true },
  { id: 'indeed', visible: false, label: 'Indeed', hosts: ['indeed.com'], optIn: true },
  { id: 'linkedin', browserOnly: true, browser: { listing: 'https://www.linkedin.com/jobs/search/', parameter: 'keywords' }, label: 'LinkedIn', hosts: ['linkedin.com', 'www.linkedin.com'], optIn: true },
  { id: 'glassdoor', visible: false, label: 'Glassdoor', hosts: ['glassdoor.com'], optIn: true },
  { id: 'google', visible: false, optIn: true, label: 'Google Jobs', hosts: ['google.com'] },
  { id: 'zip_recruiter', visible: false, optIn: true, label: 'ZipRecruiter', hosts: ['ziprecruiter.com'] },
  { id: 'bayt', visible: false, optIn: true, label: 'Bayt', hosts: ['bayt.com'] },
  { id: 'naukri', visible: false, optIn: true, label: 'Naukri', hosts: ['naukri.com'] },
  { id: 'bdjobs', visible: false, optIn: true, label: 'BDJobs', hosts: ['bdjobs.com'] }
];
