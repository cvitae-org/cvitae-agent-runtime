import type { ApplicationField } from '../../contracts/application-agent.js';

export const normalizeField = (text:string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').toLowerCase().replace(/[_-]/g,' ').replace(/\s+/g,' ').trim();
export const proseField = (field:ApplicationField) => /cover.?letter|motivation|why.*(join|work|apply)|about yourself|additional (information|message)|message.*(recruit|employer)|describe|tell us|what (interests|motivates)|how (would|have|do)|experience with|list motywacyjny|motywac|dlaczego|wiadomosc|o sobie|opisz|opowiedz/.test(normalizeField(field.label+' '+field.key));
export const protectedField = (field:ApplicationField) => field.type==='checkbox' || field.type==='unsupported' || /password|haslo|captcha|verification|race|ethnic|religio|disabil|veteran|gender|plec|orientac|criminal|karalnos|national id|pesel|passport|paszport|bank|account number|social security|consent|privacy|agree|zgod|rodo|polityk/.test(normalizeField(field.label+' '+field.key));
export const factCatalogue = (profile:Record<string,unknown>,preferences:Record<string,unknown>) => {
  const facts:Record<string,string>={};
  const visit=(value:unknown,path:string) => {
    if(typeof value==='string' && value.trim()) facts[path]=value;
    else if(typeof value==='number' || typeof value==='boolean') facts[path]=String(value);
    else if(value && typeof value==='object') for(const [key,item] of Object.entries(value)) visit(item,path+'.'+key);
  };
  visit(profile,'profile');visit(preferences,'preferences');
  // Explicit formatting of user-owned amounts/units gives the drafter facts it
  // can copy without inventing a salary or converting gross/net and periods.
  for(const contract of ['b2b','employment']) {
    const prefix='preferences.'+contract;
    const amount=facts[prefix+'.amount'],currency=facts[prefix+'.currency'],period=facts[prefix+'.period'],basis=facts[prefix+'.basis'];
    if(amount&&currency&&period&&basis) {
      facts[prefix+'.formatted.en']=`${amount} ${currency} ${basis==='netPlusVat'?'net + VAT':basis} / ${period}`;
      const periods:Record<string,string>={month:'miesiąc',year:'rok',day:'dzień',hour:'godzinę'};
      const bases:Record<string,string>={gross:'brutto',net:'netto',netPlusVat:'netto + VAT'};
      facts[prefix+'.formatted.pl']=`${amount} ${currency} ${bases[basis]??basis} / ${periods[period]??period}`;
    }
  }
  const kind=facts['preferences.availability.kind'];
  if(kind==='date'&&facts['preferences.availability.date'])facts['preferences.availability.formatted']=facts['preferences.availability.date'];
  if(kind==='immediately'||kind==='negotiable') {
    facts['preferences.availability.formatted.en']=kind==='immediately'?'Immediately':'Negotiable';
    facts['preferences.availability.formatted.pl']=kind==='immediately'?'Od zaraz':'Do uzgodnienia';
  }
  if(kind==='noticePeriod')for(const language of ['en','pl']) {
    const amount=facts['preferences.availability.amount'],unit=facts['preferences.availability.unit'];
    const units:Record<string,string>={days:'dni',weeks:'tygodni',months:'miesięcy'};
    if(amount&&unit)facts['preferences.availability.formatted.'+language]=language==='pl'?`Okres wypowiedzenia: ${amount} ${units[unit]??unit}`:`Notice period: ${amount} ${unit}`;
  }
  return facts;
};
export const directAnswer = (field:ApplicationField,facts:Record<string,string>):string|undefined => {
  if(protectedField(field) || field.type==='file') return undefined;
  const label=normalizeField(field.label), key=normalizeField(field.key), auto=field.autocomplete;
  const name=facts['profile.personal.name'];
  let value:string|undefined;
  if(auto==='name'||/^(full name|name|imie i nazwisko)\s*\*?$/.test(label)) value=name;
  else if(auto==='given-name'||/^(first name|imie)(\b|\s*\*)/.test(label+' '+key)) value=name?.split(/\s+/)[0];
  else if(auto==='family-name'||/^(last name|surname|nazwisko)(\b|\s*\*)/.test(label+' '+key)) value=name?.split(/\s+/).slice(1).join(' ');
  else if(auto==='email'||field.type==='email'||/e.?mail/.test(label)) value=facts['profile.personal.email'];
  else if(auto==='tel'||field.type==='tel'||/phone|telefon/.test(label)) value=facts['profile.personal.phone'];
  else if(auto==='country-name'||/^(country|kraj)\s*\*?$/.test(label)) value=facts['preferences.location.country'];
  else if(/^(city|miasto)\s*\*?$/.test(label)) value=facts['preferences.location.city'];
  else if(/^(location|lokalizacja|miejsce zamieszkania)\s*\*?$/.test(label)) value=facts['profile.personal.location'];
  else if(/linkedin|github|portfolio|website|strona/.test(label)) {
    value=Object.entries(facts).find(([path])=>path.startsWith('profile.personal.links.') && label.includes(normalizeField(path.split('.').at(-1)!)))?.[1];
  }
  value??=Object.entries(facts).find(([path])=>path.startsWith('preferences.details.') && normalizeField(path.slice('preferences.details.'.length))===label.replace(/\s*\*$/,''))?.[1];
  if(!value || field.maxLength>=0&&value.length>field.maxLength) return undefined;
  if(field.options.length) return field.options.find(option=>normalizeField(option.label)===normalizeField(value!)||option.value===value)?.value;
  return value;
};
